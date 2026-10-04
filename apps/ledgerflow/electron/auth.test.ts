import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createAuth } from './auth.ts'
import { openDatabase } from './database.ts'

const device = { id: 'device-1', name: 'PC-1' }
const tempFile = () => join(mkdtempSync(join(tmpdir(), 'aicom-auth-')), 'data.sqlite')
const admin = { username: 'Giulia', name: 'Giulia Rossi', password: 'motdepasse-1', role: 'admin' as const }

function setup(file = tempFile()) {
  let clock = Date.parse('2026-10-01T09:00:00Z')
  const db = openDatabase(file)
  const auth = createAuth(db, device, () => undefined, () => clock)
  return { db, auth, file, advance: (ms: number) => { clock += ms }, events: () => db.listAccess(100, 0).rows.map((row) => `${row.user}:${row.event}`).reverse() }
}

test('the first account becomes administrator, is signed in, and gets a recovery code', () => {
  const { auth, events } = setup()
  assert.equal(auth.hasUsers(), false)
  const created = auth.create({ ...admin, role: 'user' })
  assert.ok(created.ok && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(created.recoveryCode!))
  assert.deepEqual(created.ok && [created.user.username, created.user.role, created.user.active], ['giulia', 'admin', true])
  assert.equal(auth.current()?.username, 'giulia')
  assert.deepEqual(events(), ['giulia:user_created', 'giulia:login'])
})

test('passwords are never stored in clear, locally or in the file sent to Drive', () => {
  const { db, auth, file } = setup()
  auth.create(admin)
  const exported = JSON.stringify(db.exportData('PC-1'))
  assert.equal(exported.includes('motdepasse-1'), false)
  assert.ok(exported.includes('"_users"') && exported.includes('"salt"'))
  db.close()
  assert.equal(readFileSync(file).includes('motdepasse-1'), false)
})

test('the interface can neither read nor overwrite the accounts', () => {
  const { db, auth } = setup()
  auth.create(admin)
  assert.equal('_users' in db.load(), false)
  db.save({ clients: { C1: { name: 'A' } }, _users: { giulia: { hash: 'forged' } } }, { user: 'x', device: 'PC-1' }, 'attack')
  db.save({}, { user: 'x', device: 'PC-1' }, 'wipe')
  auth.logout()
  assert.equal(auth.login('giulia', 'motdepasse-1').ok, true)
  assert.equal(db.isEmpty(), true)
})

test('sign-in checks the password, and every attempt is recorded with date and time', () => {
  const { auth, db, advance } = setup()
  auth.create(admin)
  auth.logout()
  assert.deepEqual(auth.login('giulia', 'wrong'), { ok: false, reason: 'invalid' })
  assert.deepEqual(auth.login('nobody', 'motdepasse-1'), { ok: false, reason: 'invalid' })
  assert.equal(auth.current(), undefined)
  advance(60_000)
  assert.equal(auth.login(' GIULIA ', 'motdepasse-1').ok, true)
  const rows = db.listAccess(10, 0).rows
  assert.deepEqual(rows.map((row) => [row.user, row.event]), [['giulia', 'login'], ['nobody', 'login_failed'], ['giulia', 'login_failed'], ['giulia', 'logout'], ['giulia', 'login'], ['giulia', 'user_created']])
  assert.deepEqual([rows[0].at, rows[0].deviceName], ['2026-10-01T09:01:00.000Z', 'PC-1'])
})

test('five wrong attempts pause sign-in for thirty seconds', () => {
  const { auth, advance } = setup()
  auth.create(admin)
  auth.logout()
  for (let attempt = 0; attempt < 5; attempt += 1) auth.login('giulia', 'wrong')
  assert.deepEqual(auth.login('giulia', 'motdepasse-1'), { ok: false, reason: 'locked', waitSeconds: 30 })
  advance(31_000)
  assert.equal(auth.login('giulia', 'motdepasse-1').ok, true)
})

test('only an administrator adds, disables or resets other accounts', () => {
  const { auth } = setup()
  auth.create(admin)
  assert.deepEqual(auth.create({ username: 'marco', name: 'Marco', password: 'court', role: 'user' }), { ok: false, reason: 'weak' })
  assert.deepEqual(auth.create({ username: 'giulia', name: 'Autre', password: 'motdepasse-2', role: 'user' }), { ok: false, reason: 'exists' })
  assert.equal(auth.create({ username: 'marco', name: 'Marco Bianchi', password: 'motdepasse-2', role: 'user' }).ok, true)
  assert.deepEqual(auth.list().map((user) => [user.username, user.role]), [['giulia', 'admin'], ['marco', 'user']])
  assert.deepEqual(auth.setActive('giulia', false), { ok: false, reason: 'forbidden' })

  auth.logout()
  auth.login('marco', 'motdepasse-2')
  assert.deepEqual(auth.create({ username: 'luca', name: 'Luca', password: 'motdepasse-3', role: 'admin' }), { ok: false, reason: 'forbidden' })
  assert.deepEqual(auth.changePassword('giulia', 'motdepasse-9'), { ok: false, reason: 'forbidden' })
  assert.equal(auth.changePassword('marco', 'motdepasse-4').ok, true)

  auth.logout()
  auth.login('giulia', 'motdepasse-1')
  assert.equal(auth.setActive('marco', false).ok, true)
  auth.logout()
  assert.deepEqual(auth.login('marco', 'motdepasse-4'), { ok: false, reason: 'invalid' })
})

test('a forgotten password is reset with the recovery code, which then changes', () => {
  const { auth } = setup()
  const created = auth.create(admin)
  const code = created.ok ? created.recoveryCode! : ''
  auth.logout()
  assert.deepEqual(auth.recover('giulia', 'AAAA-BBBB-CCCC', 'nouveau-mot-1'), { ok: false, reason: 'invalid' })
  const recovered = auth.recover('giulia', code.toLowerCase(), 'nouveau-mot-1')
  assert.ok(recovered.ok && recovered.recoveryCode && recovered.recoveryCode !== code)
  auth.logout()
  assert.equal(auth.login('giulia', 'motdepasse-1').ok, false)
  assert.equal(auth.login('giulia', 'nouveau-mot-1').ok, true)
  auth.logout()
  assert.equal(auth.recover('giulia', code, 'encore-un-autre').ok, false)
})

test('the access history cannot be deleted or altered, even by direct database commands', () => {
  const { db, auth, file } = setup()
  auth.create(admin)
  auth.logout()
  db.close()
  const raw = new DatabaseSync(file)
  assert.throws(() => raw.exec('DELETE FROM access_log'), /cannot be deleted/)
  assert.throws(() => raw.exec("UPDATE access_log SET user = 'someone-else'"), /cannot be modified/)
  assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM access_log').get() as { count: number }).count, 3)
  raw.close()
})

test('emptying, importing or restoring the data never removes access lines', () => {
  const one = setup()
  one.auth.create(admin)
  one.db.save({ clients: { C1: { name: 'A' } } }, { user: 'giulia', device: 'PC-1' }, 'setup')
  const older = JSON.parse(JSON.stringify(one.db.exportData('PC-1')))
  one.auth.logout()
  one.auth.login('giulia', 'motdepasse-1')
  assert.equal(one.db.listAccess(10, 0).total, 4)

  one.db.save({}, { user: 'giulia', device: 'PC-1' }, 'Emptied company data')
  assert.equal(one.db.listAccess(10, 0).total, 4)
  one.db.importData(older)
  assert.equal(one.db.listAccess(10, 0).total, 4)
  one.db.importData({ ...older, access: [] })
  assert.deepEqual([one.db.listAccess(10, 0).total, one.db.verifyAccess()], [4, true])
})

test('lines from two PCs are merged and the seals still verify', () => {
  const one = setup()
  one.auth.create(admin)
  const two = openDatabase(tempFile())
  two.importData(JSON.parse(JSON.stringify(one.db.exportData('PC-1'))))
  const second = createAuth(two, { id: 'device-2', name: 'PC-2' }, () => undefined)
  assert.equal(second.login('giulia', 'motdepasse-1').ok, true)
  assert.deepEqual([two.listAccess(10, 0).total, two.verifyAccess()], [3, true])

  one.auth.logout()
  one.db.mergeAccess(JSON.parse(JSON.stringify(two.exportData('PC-2'))))
  assert.deepEqual([one.db.listAccess(10, 0).total, one.db.verifyAccess()], [4, true])
  assert.deepEqual(new Set(one.db.listAccess(10, 0).rows.map((row) => row.deviceName)), new Set(['PC-1', 'PC-2']))
})

test('a line edited or removed by hand in the file is detected', () => {
  const { db, auth, file } = setup()
  auth.create(admin)
  auth.logout()
  assert.equal(db.verifyAccess(), true)
  db.close()
  const raw = new DatabaseSync(file)
  raw.exec("DROP TRIGGER access_log_no_update; UPDATE access_log SET user = 'someone-else' WHERE seq = 2")
  raw.close()
  assert.equal(openDatabase(file).verifyAccess(), false)

  const other = setup()
  other.auth.create(admin)
  other.auth.logout()
  other.db.close()
  const tampered = new DatabaseSync(other.file)
  tampered.exec('DROP TRIGGER access_log_no_delete; DELETE FROM access_log WHERE seq = 2')
  tampered.close()
  assert.equal(openDatabase(other.file).verifyAccess(), false)
})

test('a database created before sign-in existed gains the access history on update', () => {
  const file = tempFile()
  const old = new DatabaseSync(file)
  old.exec(`CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (collection, id));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT NOT NULL, device TEXT NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', before TEXT, after TEXT);
    INSERT INTO records VALUES ('clients', 'C1', '{"name":"Existing"}');
    PRAGMA user_version = 1`)
  old.close()
  const db = openDatabase(file)
  assert.deepEqual(db.load(), { clients: { C1: { name: 'Existing' } } })
  assert.equal(createAuth(db, device, () => undefined).hasUsers(), false)
  db.importData({ format: 'aicom-data', schemaVersion: 1, exportedAt: '', device: 'PC', records: { clients: { C2: { name: 'From v1 file' } } }, audit: [] })
  assert.deepEqual(db.load(), { clients: { C2: { name: 'From v1 file' } } })
})
