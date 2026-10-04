import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createApp, isNewer } from './app.ts'
import { createFileStore, createMemoryStore } from './store.ts'
import { generateCode, generateKeys, hashCode, loadPrivateKey, verifyToken } from './token.ts'

const keys = generateKeys()
const adminToken = 'test-admin-token'
const logged: Record<string, unknown>[] = []
let clock = new Date('2026-10-01T10:00:00Z')
let server: Server
let base = ''

before(async () => {
  const app = createApp({
    store: createMemoryStore(), privateKey: loadPrivateKey(keys.privateKey), adminToken, graceDays: 14, limits: { general: 1000, activation: 1000 }, now: () => clock, log: (entry) => logged.push(entry),
    releases: { win32: { version: '1.2.0', url: 'https://example.com/AICOM-Setup-1.2.0.exe', notes: 'Corrections' } },
  })
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => { server.close() })

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() as Record<string, never> }
}
const create = async (body: object) => (await post('/v1/admin/licenses', body, adminToken)).body as unknown as { code: string; id: string }
const activate = (code: string, deviceId: string) => post('/v1/licenses/activate', { code, deviceId, deviceName: `PC ${deviceId}`, appVersion: '1.0.0' })

test('licence codes are readable, unique and stored only as a hash', () => {
  const code = generateCode()
  assert.match(code, /^AICOM(-[0-9A-HJKMNP-TV-Z]{5}){4}$/)
  assert.notEqual(code, generateCode())
  assert.equal(hashCode(` ${code.toLowerCase()} `), hashCode(code))
})

test('activation returns a signed token bound to the customer and the PC', async () => {
  const { code } = await create({ customer: 'Maison Lumière SAS', maxDevices: 1 })
  const { status, body } = await activate(code, 'pc-1')
  assert.equal(status, 200)
  const token = verifyToken(body.token, keys.publicKey)!
  assert.deepEqual([token.t, token.customer, token.deviceId, token.expires], ['act', 'Maison Lumière SAS', 'pc-1', null])
  assert.equal(token.validUntil, '2026-10-15T10:00:00.000Z')
  assert.equal(verifyToken(body.token, generateKeys().publicKey), null)
  assert.equal(verifyToken(`${Buffer.from(JSON.stringify({ ...token, customer: 'Other' })).toString('base64url')}.${String(body.token).split('.')[1]}`, keys.publicKey), null)
})

test('the PC limit is enforced, and freeing a seat lets another PC in', async () => {
  const { code } = await create({ customer: 'Two seats', maxDevices: 2 })
  assert.equal((await activate(code, 'pc-1')).status, 200)
  assert.equal((await activate(code, 'pc-1')).status, 200)
  assert.equal((await activate(code, 'pc-2')).status, 200)
  assert.deepEqual(await activate(code, 'pc-3').then((result) => [result.status, result.body.error]), [403, 'device_limit'])
  await post('/v1/licenses/deactivate', { code, deviceId: 'pc-1' })
  assert.equal((await activate(code, 'pc-3')).status, 200)
})

test('the periodic check renews a known PC and refuses an unknown one', async () => {
  const { code } = await create({ customer: 'Check', maxDevices: 1 })
  await activate(code, 'pc-1')
  clock = new Date('2026-10-05T10:00:00Z')
  const renewed = await post('/v1/licenses/check', { code, deviceId: 'pc-1' })
  assert.equal(verifyToken(renewed.body.token, keys.publicKey)!.validUntil, '2026-10-19T10:00:00.000Z')
  assert.equal((await post('/v1/licenses/check', { code, deviceId: 'pc-9' })).status, 404)
  clock = new Date('2026-10-01T10:00:00Z')
})

test('revoked, expired and unknown licences are refused', async () => {
  const revoked = await create({ customer: 'Revoked', maxDevices: 1 })
  await activate(revoked.code, 'pc-1')
  assert.equal((await post(`/v1/admin/licenses/${revoked.id}/revoke`, {}, adminToken)).status, 200)
  assert.deepEqual(await post('/v1/licenses/check', { code: revoked.code, deviceId: 'pc-1' }).then((result) => [result.status, result.body.error]), [403, 'revoked'])

  const expired = await create({ customer: 'Expired', maxDevices: 1, expires: '2026-09-30' })
  assert.deepEqual(await activate(expired.code, 'pc-1').then((result) => [result.status, result.body.error]), [403, 'expired'])

  assert.deepEqual(await activate('AICOM-00000-00000-00000-00000', 'pc-1').then((result) => [result.status, result.body.error]), [404, 'invalid'])
  assert.equal((await post('/v1/licenses/activate', { code: '' })).status, 400)
})

test('offline tolerance never extends past the licence end date', async () => {
  const { code } = await create({ customer: 'Ends soon', maxDevices: 1, expires: '2026-10-05' })
  const token = verifyToken((await activate(code, 'pc-1')).body.token, keys.publicKey)!
  assert.equal(token.validUntil, '2026-10-05T23:59:59.000Z')
})

test('administration requires the admin token', async () => {
  assert.equal((await post('/v1/admin/licenses', { customer: 'X' })).status, 404)
  assert.equal((await post('/v1/admin/licenses', { customer: 'X' }, 'wrong-token-value')).status, 404)
  assert.equal((await post('/v1/admin/licenses', { customer: '', maxDevices: 1 }, adminToken)).status, 400)
  const list = await (await fetch(`${base}/v1/admin/licenses`, { headers: { Authorization: `Bearer ${adminToken}` } })).json() as { licenses: { id: string }[] }
  assert.ok(list.licenses.length > 0)
  assert.equal(JSON.stringify(list).includes('AICOM-'), false)
})

test('a licence record can be erased on request, after which its code no longer works', async () => {
  const { code, id } = await create({ customer: 'To erase', maxDevices: 1 })
  await activate(code, 'pc-1')
  const erase = () => fetch(`${base}/v1/admin/licenses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } })
  assert.equal((await erase()).status, 200)
  assert.equal((await erase()).status, 404)
  assert.equal((await post('/v1/licenses/check', { code, deviceId: 'pc-1' })).status, 404)
  assert.equal((await fetch(`${base}/v1/admin/licenses/${id}`, { method: 'DELETE' })).status, 404)
})

test('the update service announces a newer version only', async () => {
  const latest = async (current: string) => await (await fetch(`${base}/v1/updates/latest?platform=win32&current=${current}`)).json() as { updateAvailable: boolean; version: string; notes: string }
  assert.deepEqual(await latest('1.1.9').then((result) => [result.updateAvailable, result.version, result.notes]), [true, '1.2.0', 'Corrections'])
  assert.equal((await latest('1.2.0')).updateAvailable, false)
  assert.equal((await latest('1.10.0')).updateAvailable, false)
  assert.deepEqual([isNewer('1.10.0', '1.9.9'), isNewer('2.0.0', '10.0.0'), isNewer('1.0.1', '1.0.1')], [true, false, false])
})

test('error reports keep technical fields only, capped in size', async () => {
  logged.length = 0
  const response = await post('/v1/errors', { appVersion: '1.0.0', platform: 'win32', message: 'x'.repeat(2000), stack: 'at main', customerData: { client: 'Les Jardins' } })
  assert.equal(response.status, 202)
  assert.equal(String(logged[0].message).length, 500)
  assert.equal('customerData' in logged[0], false)
})

test('repeated activation attempts from one address are throttled', async () => {
  const app = createApp({ store: createMemoryStore(), privateKey: loadPrivateKey(keys.privateKey), limits: { general: 100, activation: 3 }, log: () => undefined })
  const limited = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => limited.once('listening', resolve))
  const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/v1/licenses/activate`
  const statuses: number[] = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    statuses.push((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: generateCode(), deviceId: 'pc' }) })).status)
  }
  limited.close()
  assert.deepEqual(statuses, [404, 404, 404, 429, 429])
})

test('the file store survives a restart', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'aicom-lic-')), 'licenses.json')
  const license = { id: 'abc', customer: 'Persisted', maxDevices: 1, expires: null, revoked: false, createdAt: clock.toISOString(), activations: [] }
  await createFileStore(file).create(license)
  assert.deepEqual(await createFileStore(file).get('abc'), license)
})
