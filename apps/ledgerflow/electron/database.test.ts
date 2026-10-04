import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { LedgerError, NewerSchemaError, openDatabase, SCHEMA_VERSION } from './database.ts'

const actor = { user: 'cliente@example.com', device: 'PC-1' }
const tempFile = () => join(mkdtempSync(join(tmpdir(), 'aicom-db-')), 'data.sqlite')

test('a new database is created at the current schema version and reopens unchanged', () => {
  const file = tempFile()
  const db = openDatabase(file)
  assert.equal(db.isEmpty(), true)
  db.save({ clients: { C1: { code: 'C1', name: 'Les Jardins' } } }, actor, 'setup')
  db.close()
  const reopened = openDatabase(file)
  assert.deepEqual(reopened.load(), { clients: { C1: { code: 'C1', name: 'Les Jardins' } } })
  reopened.close()
})

test('every create, change and delete is logged with who, when, which PC and the value before and after', () => {
  const db = openDatabase(tempFile())
  assert.equal(db.save({ clients: { C1: { name: 'A' }, C2: { name: 'B' } } }, actor, 'Saved customer'), 2)
  assert.equal(db.save({ clients: { C1: { name: 'A2' } } }, actor, 'Edited customer'), 2)
  assert.equal(db.save({ clients: { C1: { name: 'A2' } } }, actor, 'No change'), 0)
  const { rows, total } = db.listAudit(10, 0)
  assert.equal(total, 4)
  const update = rows.find((row) => row.action === 'update')!
  assert.deepEqual([update.recordId, update.before, update.after, update.user, update.device, update.reason], ['C1', { name: 'A' }, { name: 'A2' }, actor.user, actor.device, 'Edited customer'])
  const removal = rows.find((row) => row.action === 'delete')!
  assert.deepEqual([removal.recordId, removal.before, removal.after], ['C2', { name: 'B' }, null])
  assert.ok(Date.parse(update.at) > 0)
  db.close()
})

test('export then import reproduces records and the activity log on another PC', () => {
  const source = openDatabase(tempFile())
  source.save({ articles: { A: { stock: 3 } }, settings: { company: { value: 'ACME' } } }, actor, 'setup')
  source.save({ articles: { A: { stock: 2 } }, settings: { company: { value: 'ACME' } } }, actor, 'sale')
  const file = JSON.parse(JSON.stringify(source.exportData('PC-1')))
  const target = openDatabase(tempFile())
  target.importData(file)
  assert.deepEqual(target.load(), source.load())
  assert.deepEqual(target.listAudit(10, 0), source.listAudit(10, 0))
  source.close()
  target.close()
})

test('data from a newer app version are refused instead of being damaged', () => {
  const db = openDatabase(tempFile())
  assert.throws(() => db.importData({ format: 'aicom-data', schemaVersion: SCHEMA_VERSION + 1, records: {}, audit: [] }), NewerSchemaError)
  assert.throws(() => db.importData({ hello: 'world' }), /not an AICOM data file/)
  db.close()

  const file = tempFile()
  const raw = new DatabaseSync(file)
  raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
  raw.close()
  assert.throws(() => openDatabase(file), NewerSchemaError)
})

test('a failed save leaves the previous state intact', () => {
  const db = openDatabase(tempFile())
  db.save({ clients: { C1: { name: 'A' } } }, actor, 'setup')
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.throws(() => db.save({ clients: { C1: { name: 'B' }, C2: circular } }, actor, 'broken'))
  assert.deepEqual(db.load(), { clients: { C1: { name: 'A' } } })
  assert.equal(db.listAudit(10, 0).total, 1)
  db.close()
})

test('posted entries can be matched but never changed or deleted, and none can be added to a closed period', () => {
  const db = openDatabase(tempFile())
  const entry = (id: number, extra: object = {}) => ({ id, piece: 'OD-0001', journal: 'OD', date: '2026-09-10', account: '521100', label: 'Apport', debit: 100, credit: 0, ...extra })
  const settings = (closed: string[] = []) => ({ closedPeriods: { value: closed } })
  db.save({ entries: { 1: entry(1), 2: entry(2, { account: '101300', debit: 0, credit: 100 }) }, settings: settings() }, actor, 'Posted')
  // Matching letters may come and go.
  assert.equal(db.save({ entries: { 1: entry(1, { letter: 'AA' }), 2: entry(2, { account: '101300', debit: 0, credit: 100 }) }, settings: settings() }, actor, 'Matched'), 1)
  assert.throws(() => db.save({ entries: { 1: entry(1, { letter: 'AA', debit: 90 }), 2: entry(2, { account: '101300', debit: 0, credit: 100 }) }, settings: settings() }, actor, 'Edited'), LedgerError)
  assert.throws(() => db.save({ entries: { 1: entry(1, { letter: 'AA' }) }, settings: settings() }, actor, 'Deleted'), LedgerError)
  assert.throws(() => db.save({ entries: { 1: entry(1, { letter: 'AA' }), 2: entry(2, { account: '101300', debit: 0, credit: 100 }), 3: entry(3) }, settings: settings(['2026-09']) }, actor, 'Late'), LedgerError)
  // A refused save writes nothing.
  assert.equal((db.load().entries['1'] as { debit: number }).debit, 100)
  assert.equal(Object.keys(db.load().entries).length, 2)
  // Emptying the whole ledger (sample data) stays possible, and is logged.
  assert.equal(db.save({ settings: settings() }, actor, 'Emptied company data'), 2)
  db.close()
})
