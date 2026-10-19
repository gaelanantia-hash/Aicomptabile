import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditRow, SyncState } from '../src/desktopApi.ts'
import type { Database, DataFile } from './database.ts'
import { NewerSchemaError } from './database.ts'
import { DriveError, type Drive } from './drive.ts'
import { hasSlot, isSealed, KeyRequiredError, seal, unseal, unwrapKey, type Keyring, type KeySlot } from './encryption.ts'
import { AuthRevokedError } from './oauth.ts'

export type SyncAction = 'create' | 'push' | 'pull' | 'conflict' | 'noop'
export type Device = { id: string; name: string }
export type SyncDeps = { db: Database; drive: Drive; keyring: Keyring; device: Device; backupDir: string; onState(state: SyncState): void; onReplaced(): void; now?: () => number; auditChunkRows?: number }
export type Sync = ReturnType<typeof createSync>

/**
 * Activity-log lines move to their own Drive file once this many have built up since the last one. That file is
 * uploaded once and downloaded once per PC, so the copy sent on every save stays small however long the history grows.
 */
export const AUDIT_CHUNK_ROWS = 250

/** Another PC counts as "currently open" for this long after its last heartbeat. */
export const LOCK_TTL_MS = 150_000

/**
 * What to do with the Drive copy, from what each side has done since the last sync.
 * `syncedHead` is the Drive revision this PC last saw; `dirty` means this PC has changes not yet uploaded.
 */
export function decideSync(remoteHead: string | undefined, syncedHead: string | undefined, dirty: boolean, localEmpty: boolean): SyncAction {
  if (remoteHead === undefined) return localEmpty ? 'noop' : 'create'
  if (remoteHead === syncedHead) return dirty ? 'push' : 'noop'
  // Drive moved on. A PC with nothing of its own (new install, or no local edits) simply takes the Drive copy.
  return dirty && !localEmpty ? 'conflict' : 'pull'
}

export function createSync({ db, drive, keyring, device, backupDir, onState, onReplaced, now = Date.now, auditChunkRows = AUDIT_CHUNK_ROWS }: SyncDeps) {
  let state: SyncState = { status: 'pending', lastSyncAt: db.getSetting('lastSyncAt') }
  let running: Promise<SyncState> | undefined
  let again = false
  let takeOver = false
  let changes = 0
  let timer: NodeJS.Timeout | undefined
  // Slots of an encrypted Drive copy this PC cannot open yet, kept until someone signs in.
  let pendingSlots: KeySlot[] = []

  const setState = (next: SyncState) => {
    state = { lastSyncAt: db.getSetting('lastSyncAt'), ...next }
    onState(state)
    return state
  }
  const lockProperties = (active = true) => ({ lockDevice: device.id, lockName: device.name, lockAt: active ? String(now()) : '0' })
  const dirty = () => db.getSetting('dirty') === '1'

  function backupLocal(label: string) {
    mkdirSync(backupDir, { recursive: true })
    const file = join(backupDir, `${label}-${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify(db.exportData(device.name)))
    return file
  }

  /** Reads a downloaded file, decrypting it when it is sealed. Plain files are those written before encryption, and backups. */
  async function fetchFile(id: string, revision?: string) {
    const parsed = JSON.parse(await drive.download(id, revision)) as unknown
    if (!isSealed(parsed)) return { data: parsed, slots: undefined }
    const key = keyring.key()
    if (key) {
      try {
        return { data: JSON.parse(unseal(key, parsed)) as unknown, slots: parsed.slots }
      } catch {
        // Sealed with another key (two PCs created one at the same time): signing in picks the one on Drive.
      }
    }
    throw new KeyRequiredError(parsed.slots)
  }

  /** Everything sent to Drive is encrypted: with no key yet (no account created or signed in since the update), nothing leaves the PC. */
  function sealed(text: string) {
    const key = keyring.key()
    const slots = keyring.slots()
    return key && slots.length ? seal(key, text, slots) : undefined
  }

  /** Archives the log lines not yet on Drive when there are enough of them. Recorded before the data file goes up, so a failed upload reuses it. */
  async function archiveAudit() {
    const pending = db.auditRows(db.auditChunks().at(-1)?.lastId ?? 0)
    if (pending.length < auditChunkRows) return
    const firstId = pending[0].id
    const lastId = pending.at(-1)!.id
    const content = sealed(JSON.stringify({ format: 'aicom-audit', audit: pending }))
    if (!content) return
    const file = await drive.createAuditFile(firstId, lastId, content)
    db.addAuditChunk({ fileId: file.id, firstId, lastId })
  }

  /** Completes a Drive copy with its archived log lines: those this PC already holds are reused, only the others are downloaded. */
  async function withArchivedAudit(data: DataFile): Promise<DataFile> {
    const archive = data.auditArchive ?? []
    if (!archive.length) return data
    const local = db.auditChunks()
    let shared = 0
    while (shared < archive.length && local[shared]?.fileId === archive[shared].fileId) shared += 1
    const audit: AuditRow[] = shared ? db.auditRows(0, archive[shared - 1].lastId) : []
    for (const chunk of archive.slice(shared)) audit.push(...((await fetchFile(chunk.fileId)).data as { audit: AuditRow[] }).audit)
    return { ...data, audit: [...audit, ...data.audit] }
  }

  async function upload(fileId: string | undefined) {
    const before = changes
    if (!sealed('')) return false
    await archiveAudit()
    const content = sealed(JSON.stringify(db.exportData(device.name, true)))!
    const file = fileId ? await drive.updateDataFile(fileId, content, lockProperties()) : await drive.createDataFile(content, lockProperties())
    db.setSetting('fileId', file.id)
    db.setSetting('syncedHead', file.headRevisionId)
    // Edits made while the upload was in flight are not in the uploaded copy: stay dirty so the next pass sends them.
    if (changes === before) db.setSetting('dirty', '0')
    else again = true
    return true
  }

  async function download(fileId: string, head: string | undefined, revision?: string) {
    const { data, slots } = await fetchFile(fileId, revision)
    db.importData(await withArchivedAudit(data as DataFile))
    // An earlier version keeps today's accounts able to open the copy; a routine pull takes the slots other PCs added.
    if (slots && !revision) keyring.setSlots(slots)
    db.setSetting('fileId', fileId)
    db.setSetting('syncedHead', head)
    db.setSetting('dirty', revision ? '1' : '0')
    onReplaced()
  }

  async function pass(force?: 'local' | 'remote'): Promise<SyncState> {
    const knownId = db.getSetting('fileId')
    const remote = (knownId ? await drive.getFile(knownId) : undefined) ?? await drive.findDataFile()
    if (!remote) db.setSetting('fileId', undefined)

    const lock = remote?.appProperties
    if (lock?.lockDevice && lock.lockDevice !== device.id && now() - Number(lock.lockAt) < LOCK_TTL_MS && !takeOver) {
      return setState({ status: 'locked', lockedBy: lock.lockName || lock.lockDevice })
    }
    takeOver = false

    let action = decideSync(remote?.headRevisionId, db.getSetting('syncedHead'), dirty(), db.isEmpty())
    if (action === 'conflict' && force === 'local') {
      // This PC's data win, but the access history of the other PC is carried over: it is never overwritten.
      db.mergeAccess((await fetchFile(remote!.id)).data)
      action = 'push'
    }
    if (action === 'conflict' && force === 'remote') {
      backupLocal('conflict')
      action = 'pull'
    }

    if (action === 'conflict') return setState({ status: 'conflict' })
    if ((action === 'create' || action === 'push') && !await upload(remote?.id)) return setState({ status: 'pending', detail: 'no_key' })
    else if (action === 'pull') await download(remote!.id, remote!.headRevisionId)
    if ((action === 'noop' || action === 'pull') && remote) await drive.setProperties(remote.id, lockProperties())

    db.setSetting('lastSyncAt', new Date(now()).toISOString())
    return setState({ status: 'synced' })
  }

  async function guarded(work: () => Promise<SyncState>): Promise<SyncState> {
    try {
      return await work()
    } catch (error) {
      if (error instanceof AuthRevokedError) return setState({ status: 'reauth' })
      if (error instanceof KeyRequiredError) {
        pendingSlots = error.slots
        return setState({ status: 'unlock' })
      }
      if (error instanceof NewerSchemaError) return setState({ status: 'error', detail: 'newer_schema' })
      if (error instanceof DriveError) {
        const missingScope = error.reason === 'insufficientPermissions' || /insufficient authentication scopes/i.test(error.message)
        return setState({ status: 'error', detail: error.reason === 'storageQuotaExceeded' ? 'quota' : missingScope ? 'insufficient_scopes' : error.message })
      }
      // fetch reports DNS, connection and timeout failures as TypeError: the PC is offline; data stay safe in the local copy.
      if (error instanceof TypeError) return setState({ status: 'offline' })
      return setState({ status: 'error', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  function run(force?: 'local' | 'remote'): Promise<SyncState> {
    // Waiting for a sign-in to open the encrypted copy: downloading it again every minute would only cost bandwidth.
    if (pendingSlots.length && !force) return Promise.resolve(state)
    if (running) {
      // An explicit choice (conflict resolution) must not be lost behind a routine pass already in flight.
      if (force) return running.then(() => run(force))
      again = true
      return running
    }
    clearTimeout(timer)
    setState({ status: 'syncing' })
    running = guarded(() => pass(force)).finally(() => {
      running = undefined
      if (again) {
        again = false
        schedule(0)
      }
    })
    return running
  }

  function schedule(delayMs: number) {
    clearTimeout(timer)
    timer = setTimeout(() => { void run() }, delayMs)
  }

  return {
    state: () => state,
    run,
    schedule,

    /** Call after every local save: uploads shortly after the customer stops editing. */
    markDirty() {
      changes += 1
      db.setSetting('dirty', '1')
      if (state.status === 'synced' || state.status === 'pending') setState({ status: 'pending' })
      if (state.status !== 'conflict' && state.status !== 'locked' && state.status !== 'reauth') schedule(4000)
    },

    resolveConflict: (keep: 'local' | 'remote') => run(keep),

    /**
     * Opens the encrypted Drive copy on a PC that does not hold its key yet, with a password or recovery code, then fetches it.
     * `no_slot`: this account cannot open it (created or last used before encryption); another account must sign in first.
     */
    async unlock(username: string, kind: KeySlot['kind'], secret: string): Promise<'ok' | 'invalid' | 'no_slot'> {
      if (!hasSlot(pendingSlots, username, kind)) return 'no_slot'
      const key = unwrapKey(pendingSlots, username, kind, secret)
      if (!key) return 'invalid'
      keyring.setKey(key)
      keyring.setSlots(pendingSlots)
      pendingSlots = []
      await run()
      return 'ok'
    },

    takeOverLock() {
      takeOver = true
      return run()
    },

    /** Brings back an earlier version kept by Google Drive. The current state is saved to a local backup first. */
    restoreRevision(revision: string) {
      return guarded(async () => {
        const fileId = db.getSetting('fileId')
        if (!fileId) throw new Error('No Google Drive copy to restore from.')
        backupLocal('before-restore')
        await download(fileId, db.getSetting('syncedHead'), revision)
        changes += 1
        return run('local')
      })
    },

    backupLocal,

    /** On exit: sends edits still waiting for upload, then frees the lock so the next PC opens without a warning. Best effort. */
    async release() {
      clearTimeout(timer)
      if (dirty() && (state.status === 'pending' || state.status === 'syncing' || state.status === 'synced')) await run()
      clearTimeout(timer)
      const fileId = db.getSetting('fileId')
      if (fileId && state.status !== 'locked' && state.status !== 'disconnected') await drive.setProperties(fileId, lockProperties(false)).catch(() => undefined)
    },

    stop: () => clearTimeout(timer),
  }
}
