import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { after, before, beforeEach, test } from 'node:test'
import type { SyncState } from '../src/desktopApi.ts'
import { openDatabase } from './database.ts'
import { createDrive } from './drive.ts'
import { createKeyring, isSealed, unseal, wrapKey } from './encryption.ts'
import { googleEndpoints, refreshTokens } from './oauth.ts'
import { createSync, decideSync, LOCK_TTL_MS } from './sync.ts'
import { startFakeGoogle } from './testing/fakeGoogle.ts'

let google: Awaited<ReturnType<typeof startFakeGoogle>>
let clock = Date.now()
before(async () => { google = await startFakeGoogle() })
after(() => google.close())
beforeEach(() => {
  google.files.clear()
  google.options.quotaExceeded = false
  google.options.insufficientScopes = false
  google.options.onUpload = undefined
  google.options.downloads = 0
  clock = Date.now()
})

const actor = { user: 'cliente@example.com', device: 'PC' }

/** One installed PC signed in to the shared Google account. */
// The PCs of a test share one company key, as PCs already unlocked would; `keyed: false` is a PC that has never opened the data.
const testKey = randomBytes(32)
const recoveryCode = 'ABCD-EFGH-JKMN'
const testSlots = [wrapKey(testKey, 'cliente', 'password', 'motdepasse'), wrapKey(testKey, 'cliente', 'recovery', recoveryCode)]

function pc(name: string, endpoints = google.endpoints, auditChunkRows?: number, keyed = true) {
  const dir = mkdtempSync(join(tmpdir(), `aicom-${name}-`))
  const refresh = google.grant()
  const db = openDatabase(join(dir, 'data.sqlite'))
  const keyring = createKeyring(db)
  if (keyed) {
    keyring.setKey(testKey)
    keyring.setSlots(testSlots)
  }
  const states: SyncState[] = []
  let replaced = 0
  const drive = createDrive(endpoints, async () => (await refreshTokens(endpoints, { clientId: 'desktop' }, refresh)).accessToken)
  const sync = createSync({ db, drive, keyring, device: { id: `id-${name}`, name }, backupDir: join(dir, 'backups'), onState: (state) => states.push(state), onReplaced: () => { replaced += 1 }, now: () => clock, auditChunkRows })
  return {
    db, sync, states, dir, keyring,
    replaced: () => replaced,
    edit(records: Record<string, unknown>) {
      if (db.save({ clients: records }, actor, 'edit')) sync.markDirty()
      sync.stop()
    },
    clients: () => db.load().clients,
  }
}
const dataFile = () => [...google.files.values()].find((file) => file.name === 'aicom-data.json')!
const readDrive = (content: Buffer) => {
  const parsed = JSON.parse(gunzipSync(content).toString('utf8')) as unknown
  return isSealed(parsed) ? JSON.parse(unseal(testKey, parsed)) : parsed
}
const driveData = () => readDrive(dataFile().revisions.at(-1)!.content)

/** Lets the other PC's "open elsewhere" marker lapse, as when that PC has been closed for a while. */
const later = () => { clock += LOCK_TTL_MS + 1 }

test('decision table', () => {
  assert.equal(decideSync(undefined, undefined, false, true), 'noop')
  assert.equal(decideSync(undefined, undefined, true, false), 'create')
  assert.equal(decideSync('r1', 'r1', false, false), 'noop')
  assert.equal(decideSync('r1', 'r1', true, false), 'push')
  assert.equal(decideSync('r2', 'r1', false, false), 'pull')
  assert.equal(decideSync('r2', 'r1', true, false), 'conflict')
  assert.equal(decideSync('r1', undefined, false, true), 'pull')
})

test('first PC creates the AICOM folder and data file on Drive', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  assert.equal((await one.sync.run()).status, 'synced')
  const names = [...google.files.values()].map((file) => file.name).sort()
  assert.deepEqual(names, ['AICOM', 'aicom-data.json'])
  assert.equal(one.db.getSetting('dirty'), '0')
})

test('a new PC on the same account finds all the data', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' }, C2: { name: 'B' } })
  await one.sync.run()
  await one.sync.release()

  const two = pc('two')
  assert.equal((await two.sync.run()).status, 'synced')
  assert.deepEqual(two.clients(), { C1: { name: 'A' }, C2: { name: 'B' } })
  assert.equal(two.replaced(), 1)
  assert.equal(two.db.listAudit(10, 0).total, 2)
})

test('edits travel from one PC to the other and back', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()
  await one.sync.release()
  const two = pc('two')
  await two.sync.run()
  two.edit({ C1: { name: 'A' }, C2: { name: 'from two' } })
  await two.sync.run()
  await two.sync.release()

  assert.equal((await one.sync.run()).status, 'synced')
  assert.deepEqual(one.clients(), { C1: { name: 'A' }, C2: { name: 'from two' } })
})

test('an app open on another PC is detected, and can be taken over', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()

  const two = pc('two')
  const locked = await two.sync.run()
  assert.deepEqual([locked.status, locked.lockedBy], ['locked', 'one'])
  assert.equal(two.clients(), undefined)

  assert.equal((await two.sync.takeOverLock()).status, 'synced')
  assert.deepEqual(two.clients(), { C1: { name: 'A' } })
  assert.equal((await one.sync.run()).status, 'locked')
})

test('a PC that was closed properly does not block the next one', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()
  await one.sync.release()
  assert.equal((await pc('two').sync.run()).status, 'synced')
})

test('simultaneous edits on two PCs raise a conflict; keeping this PC overwrites Drive', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()
  later()
  const two = pc('two')
  await two.sync.run()
  later()

  one.edit({ C1: { name: 'edited on one' } })
  two.edit({ C1: { name: 'edited on two' } })
  await two.sync.run()
  later()
  assert.equal((await one.sync.run()).status, 'conflict')
  assert.deepEqual(one.clients(), { C1: { name: 'edited on one' } })

  assert.equal((await one.sync.resolveConflict('local')).status, 'synced')
  later()
  await two.sync.run()
  assert.deepEqual(two.clients(), { C1: { name: 'edited on one' } })
})

test('keeping the Drive version saves this PC\'s version to a local backup first', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()
  later()
  const two = pc('two')
  await two.sync.run()
  later()
  one.edit({ C1: { name: 'edited on one' } })
  two.edit({ C1: { name: 'edited on two' } })
  await two.sync.run()
  later()
  await one.sync.run()

  assert.equal((await one.sync.resolveConflict('remote')).status, 'synced')
  assert.deepEqual(one.clients(), { C1: { name: 'edited on two' } })
  assert.equal(readdirSync(join(one.dir, 'backups')).filter((file) => file.startsWith('conflict-')).length, 1)
})

test('offline: edits stay in the local copy and are sent when the connection returns', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()

  const unreachable = { ...googleEndpoints, token: 'http://127.0.0.1:9/token', api: 'http://127.0.0.1:9/drive/v3', upload: 'http://127.0.0.1:9/upload' }
  const offline = pc('offline', unreachable)
  offline.edit({ C9: { name: 'written offline' } })
  assert.equal((await offline.sync.run()).status, 'offline')
  assert.deepEqual(offline.clients(), { C9: { name: 'written offline' } })
  assert.equal(offline.db.getSetting('dirty'), '1')

  one.edit({ C1: { name: 'A' }, C2: { name: 'later' } })
  assert.equal((await one.sync.run()).status, 'synced')
  assert.equal(driveData().records.clients.C2.name, 'later')
})

test('revoked Google access asks to reconnect and loses nothing', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()
  google.revokeAll()
  one.edit({ C1: { name: 'edited while revoked' } })
  assert.equal((await one.sync.run()).status, 'reauth')
  assert.deepEqual(one.clients(), { C1: { name: 'edited while revoked' } })
  assert.equal(one.db.getSetting('dirty'), '1')
})

test('a full Google Drive is reported as such', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  google.options.quotaExceeded = true
  assert.deepEqual(await one.sync.run().then((state) => [state.status, state.detail]), ['error', 'quota'])
})

test('missing Drive scopes are reported with a reconnectable permission error', async () => {
  const one = pc('missing-scopes')
  google.options.insufficientScopes = true
  const result = await one.sync.run()
  assert.deepEqual([result.status, result.detail], ['error', 'insufficient_scopes'])
})

test('an earlier Drive version can be restored, and becomes the current one everywhere', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'version 1' } })
  await one.sync.run()
  one.edit({ C1: { name: 'version 2' } })
  await one.sync.run()

  const file = [...google.files.values()].find((item) => item.name === 'aicom-data.json')!
  assert.equal(file.revisions.length, 2)
  assert.equal((await one.sync.restoreRevision(file.revisions[0].id)).status, 'synced')
  assert.deepEqual(one.clients(), { C1: { name: 'version 1' } })
  assert.equal(file.revisions.length, 3)
  assert.equal(readdirSync(join(one.dir, 'backups')).filter((name) => name.startsWith('before-restore-')).length, 1)
})

test('edits made during an upload are not marked as sent', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  google.options.onUpload = () => {
    google.options.onUpload = undefined
    one.edit({ C1: { name: 'B' } })
  }
  await one.sync.run()
  one.sync.stop()
  assert.equal(one.db.getSetting('dirty'), '1')
  assert.equal((await one.sync.run()).status, 'synced')
  assert.equal(one.db.getSetting('dirty'), '0')
  assert.equal(driveData().records.clients.C1.name, 'B')
})

test('a data file deleted from Drive is recreated from the local copy', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()
  for (const file of google.files.values()) file.trashed = true
  assert.equal((await one.sync.run()).status, 'synced')
  assert.equal([...google.files.values()].filter((file) => !file.trashed && file.name === 'aicom-data.json').length, 1)
})

test('the Drive copy is sent compressed, and plain JSON written by older versions is still read', async () => {
  const one = pc('one')
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`C${index}`, { name: `Client ${index}`, city: 'Douala' }]))
  one.edit(many)
  await one.sync.run()
  const sent = dataFile().revisions.at(-1)!.content
  assert.deepEqual([...sent.subarray(0, 2)], [0x1f, 0x8b])
  assert.ok(sent.length * 5 < JSON.stringify(driveData()).length)

  // A PC still on an earlier version uploads plain JSON: the new version must take it over unchanged.
  const legacy = { ...driveData(), records: { ...driveData().records, clients: { C1: { name: 'from an earlier version' } } } }
  dataFile().revisions.push({ id: 'legacy', content: Buffer.from(JSON.stringify(legacy)), modifiedTime: new Date().toISOString() })
  later()
  const two = pc('two')
  assert.equal((await two.sync.run()).status, 'synced')
  assert.deepEqual(two.clients(), { C1: { name: 'from an earlier version' } })
})

const auditFiles = () => [...google.files.values()].filter((file) => file.name.startsWith('aicom-audit-'))
const auditOf = (db: { listAudit(limit: number, offset: number): { rows: unknown[]; total: number } }) => db.listAudit(500, 0)

test('the activity log is archived once on Drive, and each save only sends the lines after the archive', async () => {
  const one = pc('one', google.endpoints, 3)
  for (const name of ['A', 'B', 'C', 'D']) one.edit({ C1: { name } })
  await one.sync.run()
  assert.equal(auditFiles().length, 1)
  assert.deepEqual([driveData().audit.length, driveData().auditArchive.length], [0, 1])

  one.edit({ C1: { name: 'E' } })
  await one.sync.run()
  assert.equal(auditFiles().length, 1)
  assert.deepEqual([driveData().audit.length, driveData().auditArchive.length], [1, 1])

  // A second PC gets the whole log: the archive once, then only the data file.
  later()
  const two = pc('two', google.endpoints, 3)
  assert.equal((await two.sync.run()).status, 'synced')
  assert.deepEqual(auditOf(two.db), auditOf(one.db))
  assert.equal(auditOf(two.db).total, 5)

  later()
  one.edit({ C1: { name: 'F' } })
  await one.sync.run()
  google.files.delete(auditFiles()[0].id)
  later()
  assert.equal((await two.sync.run()).status, 'synced')
  assert.deepEqual(auditOf(two.db), auditOf(one.db))
})

test('restoring a version from before an archive brings back that version of the log', async () => {
  const one = pc('one', google.endpoints, 3)
  one.edit({ C1: { name: 'A' } })
  one.edit({ C1: { name: 'B' } })
  await one.sync.run()
  one.edit({ C1: { name: 'C' } })
  one.edit({ C1: { name: 'D' } })
  await one.sync.run()
  assert.equal(one.db.auditChunks().length, 1)

  assert.equal((await one.sync.restoreRevision(dataFile().revisions[0].id)).status, 'synced')
  assert.deepEqual(one.clients(), { C1: { name: 'B' } })
  assert.equal(auditOf(one.db).total, 2)
  assert.deepEqual([one.db.auditChunks().length, driveData().auditArchive.length, driveData().audit.length], [0, 0, 2])
})

test('a Drive copy opened by hand, without its archived lines, is refused', async () => {
  const one = pc('one', google.endpoints, 3)
  for (const name of ['A', 'B', 'C']) one.edit({ C1: { name } })
  await one.sync.run()
  const other = pc('other')
  assert.throws(() => other.db.importData(driveData()), /incomplete Google Drive copy/)
  assert.equal(other.db.isEmpty(), true)
})

test('the Drive copy and the log archives are encrypted', async () => {
  const one = pc('one', google.endpoints, 3)
  for (const name of ['Hôtel Belvédère', 'Café des Arts', 'Les Jardins']) one.edit({ C1: { name } })
  await one.sync.run()
  for (const file of [dataFile(), ...auditFiles()]) {
    const raw = gunzipSync(file.revisions.at(-1)!.content).toString('utf8')
    assert.equal(isSealed(JSON.parse(raw)), true)
    assert.doesNotMatch(raw, /Jardins|Belv|Arts/)
  }
  assert.equal(auditFiles().length, 1)
  assert.equal(driveData().records.clients.C1.name, 'Les Jardins')
})

test('without a key nothing reaches Drive', async () => {
  const one = pc('one', google.endpoints, undefined, false)
  one.edit({ C1: { name: 'A' } })
  assert.deepEqual(await one.sync.run().then((state) => [state.status, state.detail]), ['pending', 'no_key'])
  assert.equal(google.files.size, 0)
  assert.equal(one.db.getSetting('dirty'), '1')
})

test('a new PC opens the encrypted copy with a password or a recovery code, and nothing else', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()

  later()
  const two = pc('two', google.endpoints, undefined, false)
  assert.equal((await two.sync.run()).status, 'unlock')
  assert.equal(two.db.isEmpty(), true)
  // While it waits for a sign-in, the routine passes do not download the copy again.
  const downloads = google.options.downloads
  await two.sync.run()
  assert.equal(google.options.downloads, downloads)

  assert.equal(await two.sync.unlock('cliente', 'password', 'wrong password'), 'invalid')
  assert.equal(await two.sync.unlock('somebody', 'password', 'motdepasse'), 'no_slot')
  assert.equal(two.db.isEmpty(), true)
  assert.equal(await two.sync.unlock('Cliente', 'password', 'motdepasse'), 'ok')
  assert.deepEqual(two.clients(), { C1: { name: 'A' } })
  assert.equal(two.keyring.key()?.equals(testKey), true)

  later()
  const three = pc('three', google.endpoints, undefined, false)
  assert.equal((await three.sync.run()).status, 'unlock')
  assert.equal(await three.sync.unlock('cliente', 'recovery', recoveryCode), 'ok')
  assert.deepEqual(three.clients(), { C1: { name: 'A' } })
})

test('a PC whose key does not match the Drive copy asks for a sign-in instead of reading it', async () => {
  const one = pc('one')
  one.edit({ C1: { name: 'A' } })
  await one.sync.run()
  later()
  const two = pc('two')
  two.keyring.setKey(randomBytes(32))
  assert.equal((await two.sync.run()).status, 'unlock')
  assert.equal(await two.sync.unlock('cliente', 'password', 'motdepasse'), 'ok')
  assert.deepEqual(two.clients(), { C1: { name: 'A' } })
})
