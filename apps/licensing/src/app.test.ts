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
    // Stand-in for Google: "google:<e-mail>" is a valid ID token for that address, anything else is not.
    verifyGoogleToken: async (idToken) => idToken.startsWith('google:') ? { email: idToken.slice(7).toLowerCase(), sub: 'sub' } : null,
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
const activateAccount = (email: string, deviceId: string) => post('/v1/licenses/activate-account', { idToken: `google:${email}`, deviceId, deviceName: `PC ${deviceId}`, appVersion: '1.0.0' })

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

test('the health check answers on /health (Cloud Run reserves /healthz) and on /healthz', async () => {
  for (const path of ['/health', '/healthz']) {
    const response = await fetch(`${base}${path}`)
    assert.deepEqual([response.status, await response.text()], [200, 'ok'])
  }
})

test('a Google account on a licence activates it without the code, and renews with its own secret', async () => {
  const { id } = await create({ customer: 'Par compte', maxDevices: 2, emails: 'Anne@gmail.com, paul@gmail.com' })
  const first = await activateAccount('anne@gmail.com', 'pc-1')
  assert.equal(first.status, 200)
  assert.equal(JSON.stringify(first.body).includes('AICOM-'), false)
  assert.deepEqual([verifyToken(first.body.token, keys.publicKey)!.customer, first.body.email, String(first.body.renewal).split('.')[0]], ['Par compte', 'anne@gmail.com', id])

  clock = new Date('2026-10-05T10:00:00Z')
  const renewed = await post('/v1/licenses/check', { renewal: first.body.renewal, deviceId: 'pc-1' })
  assert.equal(verifyToken(renewed.body.token, keys.publicKey)!.validUntil, '2026-10-19T10:00:00.000Z')
  clock = new Date('2026-10-01T10:00:00Z')

  // The secret belongs to that PC: another PC, or a guessed secret, gets nothing.
  assert.equal((await post('/v1/licenses/check', { renewal: first.body.renewal, deviceId: 'pc-2' })).status, 404)
  assert.equal((await post('/v1/licenses/check', { renewal: `${id}.guessed-secret`, deviceId: 'pc-1' })).status, 404)
  assert.equal((await post('/v1/licenses/check', { renewal: 'nonsense', deviceId: 'pc-1' })).status, 400)
})

test('accounts not on any licence, or tokens Google did not issue, are refused', async () => {
  assert.deepEqual(await activateAccount('stranger@gmail.com', 'pc-1').then((result) => [result.status, result.body.error]), [404, 'not_registered'])
  assert.deepEqual(await post('/v1/licenses/activate-account', { idToken: 'forged', deviceId: 'pc-1' }).then((result) => [result.status, result.body.error]), [401, 'invalid'])
  assert.equal((await post('/v1/licenses/activate-account', { idToken: 'google:anne@gmail.com' })).status, 401)
})

test('account activations count against the PC limit, follow revocation, and free their seat on deactivation', async () => {
  const { id } = await create({ customer: 'Un poste', maxDevices: 1, emails: ['solo@gmail.com'] })
  const first = await activateAccount('solo@gmail.com', 'pc-1')
  assert.equal(first.status, 200)
  // Signing in again on the same PC (a reinstall) reuses its seat and replaces its secret.
  const again = await activateAccount('solo@gmail.com', 'pc-1')
  assert.equal(again.status, 200)
  assert.equal((await post('/v1/licenses/check', { renewal: first.body.renewal, deviceId: 'pc-1' })).status, 404)
  assert.deepEqual(await activateAccount('solo@gmail.com', 'pc-2').then((result) => [result.status, result.body.error]), [403, 'device_limit'])

  await post('/v1/licenses/deactivate', { renewal: `${id}.wrong`, deviceId: 'pc-1' })
  assert.deepEqual(await activateAccount('solo@gmail.com', 'pc-2').then((result) => result.status), 403)
  await post('/v1/licenses/deactivate', { renewal: again.body.renewal, deviceId: 'pc-1' })
  assert.equal((await activateAccount('solo@gmail.com', 'pc-2')).status, 200)

  await post(`/v1/admin/licenses/${id}/revoke`, {}, adminToken)
  assert.deepEqual(await activateAccount('solo@gmail.com', 'pc-2').then((result) => [result.status, result.body.error]), [403, 'revoked'])
})

test('the admin manages which accounts open a licence; an address belongs to one licence only', async () => {
  const one = await create({ customer: 'Société A', maxDevices: 3, emails: 'a1@gmail.com' })
  assert.deepEqual(await post('/v1/admin/licenses', { customer: 'Société B', maxDevices: 1, emails: 'A1@gmail.com' }, adminToken).then((result) => [result.status, result.body.error]), [409, 'email_in_use'])
  assert.equal((await post('/v1/admin/licenses', { customer: 'Société C', maxDevices: 1, emails: 'not-an-email' }, adminToken)).status, 400)

  const changed = await post(`/v1/admin/licenses/${one.id}/emails`, { add: 'a2@gmail.com,a3@gmail.com', remove: 'a1@gmail.com' }, adminToken)
  assert.deepEqual(changed.body.emails, ['a2@gmail.com', 'a3@gmail.com'])
  assert.deepEqual(await activateAccount('a1@gmail.com', 'pc-1').then((result) => result.body.error), 'not_registered')
  assert.equal((await activateAccount('a3@gmail.com', 'pc-1')).status, 200)
  assert.equal((await post('/v1/admin/licenses/unknown-id/emails', { add: 'z@gmail.com' }, adminToken)).status, 404)
  assert.equal((await post(`/v1/admin/licenses/${one.id}/emails`, { add: 'a2@gmail.com' })).status, 404)
})

test('retention: the purge reports first, erases only when confirmed, and dates revocations', async () => {
  const purge = (body: object) => post('/v1/admin/purge', body, adminToken) as Promise<{ status: number; body: Record<string, never> }>
  const ended = await create({ customer: 'Ended long ago', maxDevices: 1, expires: '2026-10-31' })
  const revoked = await create({ customer: 'Revoked', maxDevices: 1 })
  const kept = await create({ customer: 'Still a customer', maxDevices: 2 })
  await activate(kept.code, 'pc-gone')
  await post(`/v1/admin/licenses/${revoked.id}/revoke`, {}, adminToken)
  const list = async () => ((await (await fetch(`${base}/v1/admin/licenses`, { headers: { Authorization: `Bearer ${adminToken}` } })).json()) as { licenses: { id: string; revokedAt?: string; activations: unknown[] }[] }).licenses
  assert.equal((await list()).find((item) => item.id === revoked.id)?.revokedAt, clock.toISOString())

  const before = clock
  clock = new Date(clock.getTime() + 26 * 30 * 24 * 3600 * 1000)
  await activate(kept.code, 'pc-current')
  try {
    assert.equal((await purge({})).status, 200)
    const report = (await purge({})).body as unknown as { remove: { id: string }[]; devices: { id: string; deviceIds: string[] }[]; done: boolean }
    assert.equal(report.done, false)
    assert.ok(report.remove.some((item) => item.id === ended.id) && report.remove.some((item) => item.id === revoked.id))
    assert.deepEqual(report.devices.find((item) => item.id === kept.id)?.deviceIds, ['pc-gone'])
    assert.ok((await list()).some((item) => item.id === ended.id), 'nothing erased without confirm')

    assert.equal(((await purge({ confirm: true })).body as unknown as { done: boolean }).done, true)
    const after = await list()
    assert.ok(!after.some((item) => item.id === ended.id || item.id === revoked.id))
    assert.equal(after.find((item) => item.id === kept.id)?.activations.length, 1)
    assert.ok(logged.some((entry) => entry.type === 'retention_purge'))
    assert.equal((await purge({ months: 0 })).status, 400)
    assert.equal((await fetch(`${base}/v1/admin/purge`, { method: 'POST' })).status, 404)
  } finally {
    clock = before
  }
})
