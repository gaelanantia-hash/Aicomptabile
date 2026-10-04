import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createLicenseClient, evaluate, type Activation } from './license.ts'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const device = { id: 'device-1', name: 'PC-1' }
const day = 86_400_000
const now = Date.parse('2026-10-01T10:00:00Z')

function token(overrides: Partial<Activation> = {}, key = keys.privateKey) {
  const payload: Activation = { t: 'act', lic: 'abc', customer: 'Maison Lumière SAS', deviceId: device.id, expires: null, validUntil: new Date(now + 14 * day).toISOString(), ...overrides }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`
}

// Minimal licence service: answers with whatever the test sets.
let reply: { status: number; body: object } = { status: 200, body: {} }
let reachable = true
const server = createServer((request, response) => {
  if (!reachable) {
    request.socket.destroy()
    return
  }
  response.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body))
})
let serverUrl = ''
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => { server.close() })

const client = (clock = now, devMode = false) => createLicenseClient({ serverUrl, publicKey, device, appVersion: '1.0.0', devMode, file: join(mkdtempSync(join(tmpdir(), 'aicom-lic-')), 'license.json'), now: () => clock })

test('a valid activation is accepted; a forged, foreign-PC or altered one is not', () => {
  assert.equal(evaluate(token(), publicKey, device.id, now).valid, true)
  assert.equal(evaluate(token({}, generateKeyPairSync('ed25519').privateKey), publicKey, device.id, now).reason, 'invalid')
  assert.equal(evaluate(token({ deviceId: 'other-pc' }), publicKey, device.id, now).reason, 'invalid')
  const [body, signature] = token().split('.')
  const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), expires: null, customer: 'Pirate' })).toString('base64url')
  assert.equal(evaluate(`${altered}.${signature}`, publicKey, device.id, now).reason, 'invalid')
  assert.equal(evaluate(undefined, publicKey, device.id, now).reason, 'missing')
})

test('licence end date and offline tolerance are enforced', () => {
  assert.equal(evaluate(token({ expires: '2026-09-30' }), publicKey, device.id, now).reason, 'expired')
  assert.equal(evaluate(token({ expires: '2026-10-01' }), publicKey, device.id, now).valid, true)
  assert.equal(evaluate(token(), publicKey, device.id, now + 13 * day).valid, true)
  assert.equal(evaluate(token(), publicKey, device.id, now + 15 * day).reason, 'grace_expired')
})

test('activation stores the signed token and reports the customer', async () => {
  const license = client()
  assert.equal(license.state().reason, 'missing')
  reply = { status: 200, body: { token: token() } }
  assert.deepEqual(await license.activate(' aicom-abcde-fghjk-mnpqr-stvwx ').then((state) => [state.valid, state.customer]), [true, 'Maison Lumière SAS'])
  assert.equal(license.state().valid, true)
})

test('refusals from the service are passed on', async () => {
  for (const error of ['revoked', 'expired', 'device_limit'] as const) {
    reply = { status: 403, body: { error } }
    assert.equal((await client().activate('AICOM-X')).reason, error)
  }
  reply = { status: 404, body: { error: 'invalid' } }
  assert.equal((await client().activate('AICOM-X')).reason, 'invalid')
})

test('offline: the app keeps running until the tolerance runs out, then asks for a connection', async () => {
  let clock = now
  const license = createLicenseClient({ serverUrl, publicKey, device, appVersion: '1.0.0', devMode: false, file: join(mkdtempSync(join(tmpdir(), 'aicom-lic-')), 'license.json'), now: () => clock })
  reply = { status: 200, body: { token: token() } }
  await license.activate('AICOM-X')
  reachable = false
  clock = now + 10 * day
  assert.equal((await license.check()).valid, true)
  clock = now + 15 * day
  assert.equal((await license.check()).reason, 'grace_expired')
  reachable = true
  reply = { status: 200, body: { token: token({ validUntil: new Date(clock + 14 * day).toISOString() }) } }
  assert.equal((await license.check()).valid, true)
})

test('a licence revoked on the service stops the app at the next check', async () => {
  const license = client()
  reply = { status: 200, body: { token: token() } }
  await license.activate('AICOM-X')
  reply = { status: 403, body: { error: 'revoked' } }
  assert.equal((await license.check()).reason, 'revoked')
  assert.equal(license.state().valid, false)
})

test('releasing the licence clears it from this PC', async () => {
  const license = client()
  reply = { status: 200, body: { token: token() } }
  await license.activate('AICOM-X')
  await license.deactivate()
  assert.equal(license.state().reason, 'missing')
})

test('a trial build runs without a licence until its end date, then stops', () => {
  const options = { serverUrl: '', publicKey: '', device, appVersion: '1.0.0', devMode: false, file: join(tmpdir(), 'aicom-none.json'), trialUntil: '2026-10-31' }
  assert.deepEqual(createLicenseClient({ ...options, now: () => Date.parse('2026-10-31T20:00:00') }).state(), { valid: true, trial: true, expires: '2026-10-31' })
  assert.deepEqual(createLicenseClient({ ...options, now: () => Date.parse('2026-11-01T08:00:00') }).state(), { valid: false, trial: true, reason: 'expired', expires: '2026-10-31' })
  assert.equal(createLicenseClient({ ...options, trialUntil: 'soon' }).state().valid, false)
  // Once a licence service is configured the trial date no longer grants anything.
  assert.equal(createLicenseClient({ ...options, serverUrl, publicKey, file: join(mkdtempSync(join(tmpdir(), 'aicom-lic-')), 'license.json') }).state().reason, 'missing')
})

test('without a configured service, only development builds run', () => {
  const options = { serverUrl: '', publicKey: '', device, appVersion: '1.0.0', file: join(tmpdir(), 'aicom-none.json') }
  assert.deepEqual(createLicenseClient({ ...options, devMode: true }).state(), { valid: true, dev: true })
  assert.equal(createLicenseClient({ ...options, devMode: false }).state().valid, false)
})

test('an outage or rate limit on the service does not withdraw a working licence', async () => {
  const license = client()
  reply = { status: 200, body: { token: token() } }
  await license.activate('AICOM-X')
  for (const failure of [{ status: 500, body: { error: 'server_error' } }, { status: 503, body: {} }, { status: 429, body: {} }, { status: 404, body: { error: 'not_found' } }]) {
    reply = failure
    assert.equal((await license.check()).valid, true, `status ${failure.status}`)
  }
  reply = { status: 503, body: {} }
  assert.equal((await client().activate('AICOM-X')).reason, 'unreachable')
})

test('setting the system clock back does not extend a trial', () => {
  const clockFile = join(mkdtempSync(join(tmpdir(), 'aicom-clock-')), 'clock.json')
  const options = { serverUrl: '', publicKey: '', device, appVersion: '1.0.0', devMode: false, file: join(tmpdir(), 'aicom-none.json'), trialUntil: '2026-10-31', clockFile }
  assert.equal(createLicenseClient({ ...options, now: () => Date.parse('2026-11-02T08:00:00') }).state().valid, false)
  assert.equal(createLicenseClient({ ...options, now: () => Date.parse('2026-10-15T08:00:00') }).state().reason, 'expired')
})
