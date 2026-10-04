import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { AccessEvent, AccessRow, AuditRow, Snapshot } from '../src/desktopApi.ts'

export type Actor = { user: string; device: string }
export type DataFile = { format: 'aicom-data'; schemaVersion: number; exportedAt: string; device: string; records: Snapshot; audit: AuditRow[]; access?: AccessRow[] }
export type Database = ReturnType<typeof openDatabase>

/** The data was written by a more recent version of the app: this one must be updated before it can open it. */
export class NewerSchemaError extends Error {
  constructor() {
    super('These data were saved by a newer version of AICOM. Update the application to open them.')
    this.name = 'NewerSchemaError'
  }
}

// One entry per schema version, applied in order on the local database when the app is updated. Never edit a published entry: append a new one.
const migrations = [
  `CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (collection, id));
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT NOT NULL, device TEXT NOT NULL,
     collection TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', before TEXT, after TEXT
   );
   CREATE INDEX audit_at ON audit (at DESC);`,
  // Access history. The database itself refuses to change or remove a line, whatever code asks for it.
  `CREATE TABLE access_log (
     device TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, user TEXT NOT NULL, device_name TEXT NOT NULL, event TEXT NOT NULL, hash TEXT NOT NULL,
     PRIMARY KEY (device, seq)
   );
   CREATE INDEX access_log_at ON access_log (at DESC);
   CREATE TRIGGER access_log_no_delete BEFORE DELETE ON access_log BEGIN SELECT RAISE(ABORT, 'The access history cannot be deleted.'); END;
   CREATE TRIGGER access_log_no_update BEFORE UPDATE ON access_log BEGIN SELECT RAISE(ABORT, 'The access history cannot be modified.'); END;`,
]

// Upgrades of the exchange file itself (Drive copy, backups), keyed by the version they upgrade from.
const dataUpgrades: Record<number, (data: DataFile) => DataFile> = {
  1: (data) => ({ ...data, schemaVersion: 2, access: data.access ?? [] }),
}

export const SCHEMA_VERSION = migrations.length

type AuditRecord = { id: number; at: string; user: string; device: string; collection: string; record_id: string; action: AuditRow['action']; reason: string; before: string | null; after: string | null }
type AccessRecord = { device: string; seq: number; at: string; user: string; device_name: string; event: AccessEvent; hash: string }

const toAuditRow = (row: AuditRecord): AuditRow => ({
  id: row.id, at: row.at, user: row.user, device: row.device, collection: row.collection, recordId: row.record_id, action: row.action, reason: row.reason,
  before: row.before === null ? null : JSON.parse(row.before), after: row.after === null ? null : JSON.parse(row.after),
})
const toAccessRow = (row: AccessRecord): AccessRow => ({ device: row.device, seq: row.seq, at: row.at, user: row.user, deviceName: row.device_name, event: row.event, hash: row.hash })

// Collections whose name starts with "_" belong to the app itself (user accounts). The interface never receives them and cannot overwrite them.
const reserved = (collection: string) => collection.startsWith('_')

/** A save that would alter the books in a way accounting law forbids. Nothing of that save is written. */
export class LedgerError extends Error {
  constructor(detail: string) {
    super(`Les écritures comptables validées ne peuvent être ni modifiées ni supprimées (${detail}). Passez une écriture d’annulation. / Posted entries cannot be changed or deleted (${detail}); post a reversing entry.`)
    this.name = 'LedgerError'
  }
}

/**
 * Accounting entries are permanent (OHADA Uniform Act on accounting): once written, only their matching letter may change,
 * none may be removed, and no new one may fall in a closed period. The one exception is emptying the whole ledger
 * (removing the sample data), which the interface does after a backup and which the activity log records line by line.
 */
function checkLedger(snapshot: Snapshot, existing: Map<string, string>) {
  const ledger = snapshot.entries ?? {}
  const emptied = Object.keys(ledger).length === 0
  const closed = new Set((snapshot.settings?.closedPeriods as { value?: string[] } | undefined)?.value ?? [])
  const withoutLetter = (text: string) => {
    const { letter: _letter, ...rest } = JSON.parse(text) as Record<string, unknown>
    return JSON.stringify(rest)
  }
  for (const [id, record] of Object.entries(ledger)) {
    const before = existing.get(`entries\u0000${id}`)
    const after = JSON.stringify(record)
    if (before === undefined) {
      const date = String((record as { date?: unknown }).date ?? '')
      if (closed.has(date.slice(0, 7))) throw new LedgerError(`période ${date.slice(0, 7)} clôturée`)
    } else if (before !== after && withoutLetter(before) !== withoutLetter(after)) throw new LedgerError(`écriture ${id}`)
  }
  if (!emptied) {
    for (const key of existing.keys()) {
      const [collection, id] = key.split('\u0000')
      if (collection === 'entries' && !(id in ledger)) throw new LedgerError(`écriture ${id} supprimée`)
    }
  }
}

/** Each line is sealed with the previous line of the same PC, so a line edited or removed by hand in the file shows up on verification. */
export function accessHash(previous: string, row: Omit<AccessRow, 'hash'>) {
  return createHash('sha256').update([previous, row.device, row.seq, row.at, row.user, row.deviceName, row.event].join('|')).digest('hex')
}

/** Local working copy of the customer's data. The app reads and writes here; Google Drive receives a copy. */
export function openDatabase(file: string) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (version > SCHEMA_VERSION) {
    db.close()
    throw new NewerSchemaError()
  }
  for (let index = version; index < SCHEMA_VERSION; index += 1) {
    db.exec('BEGIN')
    db.exec(migrations[index])
    db.exec(`PRAGMA user_version = ${index + 1}`)
    db.exec('COMMIT')
  }

  function transaction<T>(work: () => T): T {
    db.exec('BEGIN')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function load(includeReserved = false): Snapshot {
    const snapshot: Snapshot = {}
    for (const row of db.prepare('SELECT collection, id, data FROM records').all() as { collection: string; id: string; data: string }[]) {
      if (includeReserved || !reserved(row.collection)) (snapshot[row.collection] ??= {})[row.id] = JSON.parse(row.data)
    }
    return snapshot
  }

  const getSetting = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
  const setSetting = (key: string, value: string | undefined) => {
    if (value === undefined) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
  }
  const accessRows = (order: string, ...parameters: number[]) => (db.prepare(`SELECT * FROM access_log ${order}`).all(...parameters) as AccessRecord[]).map(toAccessRow)

  return {
    load: () => load(),
    getSetting,
    setSetting,
    isEmpty: () => (db.prepare(String.raw`SELECT COUNT(*) AS count FROM records WHERE collection NOT LIKE '\_%' ESCAPE '\'`).get() as { count: number }).count === 0,

    /** Stores the new state and logs every record that was created, changed or deleted, with its value before and after. */
    save(snapshot: Snapshot, actor: Actor, reason: string) {
      return transaction(() => {
        const rows = (db.prepare('SELECT collection, id, data FROM records').all() as { collection: string; id: string; data: string }[]).filter((row) => !reserved(row.collection))
        const existing = new Map(rows.map((row) => [`${row.collection}\u0000${row.id}`, row.data]))
        checkLedger(snapshot, existing)
        const log = db.prepare('INSERT INTO audit (at, user, device, collection, record_id, action, reason, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const upsert = db.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data')
        const at = new Date().toISOString()
        let changes = 0
        for (const [collection, records] of Object.entries(snapshot)) {
          if (reserved(collection)) continue
          for (const [id, record] of Object.entries(records)) {
            const key = `${collection}\u0000${id}`
            const after = JSON.stringify(record)
            const before = existing.get(key)
            existing.delete(key)
            if (before === after) continue
            upsert.run(collection, id, after)
            log.run(at, actor.user, actor.device, collection, id, before === undefined ? 'create' : 'update', reason, before ?? null, after)
            changes += 1
          }
        }
        for (const [key, before] of existing) {
          const [collection, id] = key.split('\u0000')
          db.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(collection, id)
          log.run(at, actor.user, actor.device, collection, id, 'delete', reason, before, null)
          changes += 1
        }
        return changes
      })
    },

    /** App-owned records (collections starting with "_"), kept out of the interface's reach. */
    getRecord<T>(collection: string, id: string) {
      const row = db.prepare('SELECT data FROM records WHERE collection = ? AND id = ?').get(collection, id) as { data: string } | undefined
      return row ? JSON.parse(row.data) as T : undefined
    },
    listRecords<T>(collection: string) {
      return (db.prepare('SELECT data FROM records WHERE collection = ? ORDER BY id').all(collection) as { data: string }[]).map((row) => JSON.parse(row.data) as T)
    },
    putRecord(collection: string, id: string, record: unknown) {
      db.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data').run(collection, id, JSON.stringify(record))
    },

    listAudit(limit: number, offset: number) {
      const rows = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?').all(Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)) as AuditRecord[]
      return { rows: rows.map(toAuditRow), total: (db.prepare('SELECT COUNT(*) AS count FROM audit').get() as { count: number }).count }
    },

    /** Adds one line to the access history. There is deliberately no counterpart that removes one. */
    logAccess(device: { id: string; name: string }, user: string, event: AccessEvent, at = new Date().toISOString()) {
      const last = db.prepare('SELECT seq, hash FROM access_log WHERE device = ? ORDER BY seq DESC LIMIT 1').get(device.id) as { seq: number; hash: string } | undefined
      const row = { device: device.id, seq: (last?.seq ?? 0) + 1, at, user: user.slice(0, 80), deviceName: device.name, event }
      db.prepare('INSERT INTO access_log (device, seq, at, user, device_name, event, hash) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.device, row.seq, row.at, row.user, row.deviceName, row.event, accessHash(last?.hash ?? '', row))
    },

    listAccess(limit: number, offset: number) {
      return {
        rows: accessRows('ORDER BY at DESC, seq DESC LIMIT ? OFFSET ?', Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)),
        total: (db.prepare('SELECT COUNT(*) AS count FROM access_log').get() as { count: number }).count,
      }
    },

    /** Checks every PC's chain of lines: numbering without gaps and each seal matching its content. */
    verifyAccess() {
      const previous = new Map<string, { seq: number; hash: string }>()
      for (const row of accessRows('ORDER BY device, seq')) {
        const before = previous.get(row.device) ?? { seq: 0, hash: '' }
        if (row.seq !== before.seq + 1 || row.hash !== accessHash(before.hash, row)) return false
        previous.set(row.device, row)
      }
      return true
    },

    exportData(device: string): DataFile {
      const audit = (db.prepare('SELECT * FROM audit ORDER BY id').all() as AuditRecord[]).map(toAuditRow)
      return { format: 'aicom-data', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), device, records: load(true), audit, access: accessRows('ORDER BY device, seq') }
    },

    /** Replaces the local copy with a data file (from Drive or from a backup). The access history is only ever added to. */
    importData(input: unknown) {
      let data = input as DataFile
      if (!data || data.format !== 'aicom-data' || typeof data.schemaVersion !== 'number' || typeof data.records !== 'object') throw new Error('This file is not an AICOM data file.')
      if (data.schemaVersion > SCHEMA_VERSION) throw new NewerSchemaError()
      while (data.schemaVersion < SCHEMA_VERSION) data = dataUpgrades[data.schemaVersion]?.(data) ?? { ...data, schemaVersion: data.schemaVersion + 1 }
      transaction(() => {
        db.exec('DELETE FROM records; DELETE FROM audit;')
        const insert = db.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?)')
        for (const [collection, records] of Object.entries(data.records)) {
          for (const [id, record] of Object.entries(records)) insert.run(collection, id, JSON.stringify(record))
        }
        const log = db.prepare('INSERT INTO audit (id, at, user, device, collection, record_id, action, reason, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        for (const row of data.audit ?? []) {
          log.run(row.id, row.at, row.user, row.device, row.collection, row.recordId, row.action, row.reason ?? '', row.before === null ? null : JSON.stringify(row.before), row.after === null ? null : JSON.stringify(row.after))
        }
        // Lines this PC already holds stay as they are; lines it has not seen yet (from another PC) are added.
        const access = db.prepare('INSERT OR IGNORE INTO access_log (device, seq, at, user, device_name, event, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
        for (const row of data.access ?? []) access.run(row.device, row.seq, row.at, row.user, row.deviceName, row.event, row.hash)
      })
    },

    /** Takes only the access lines of a data file, leaving everything else untouched. Used before this PC's version overwrites another one. */
    mergeAccess(input: unknown) {
      const access = db.prepare('INSERT OR IGNORE INTO access_log (device, seq, at, user, device_name, event, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const row of (input as DataFile | undefined)?.access ?? []) access.run(row.device, row.seq, row.at, row.user, row.deviceName, row.event, row.hash)
    },

    close: () => db.close(),
  }
}
