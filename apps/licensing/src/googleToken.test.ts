import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import { createGoogleVerifier } from './googleToken.ts'

const clientId = 'desktop-client.apps.googleusercontent.com'
const nowMs = Date.parse('2026-10-20T10:00:00Z')
const seconds = nowMs / 1000

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } }
}
const google = keyPair('key-1')

function idToken(claims: Record<string, unknown>, key = google, header: Record<string, unknown> = { alg: 'RS256', kid: key.jwk.kid, typ: 'JWT' }) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${part(header)}.${part({ iss: 'https://accounts.google.com', aud: clientId, sub: '1234567890', email: 'Anne@Gmail.com', email_verified: true, iat: seconds - 10, exp: seconds + 3600, ...claims })}`
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key.privateKey).toString('base64url')}`
}

function verifier(keys = [google.jwk]) {
  let fetches = 0
  const verify = createGoogleVerifier({ audiences: [clientId], now: () => nowMs, fetchKeys: async () => { fetches += 1; return { keys: [...keys], maxAgeSeconds: 3600 } } })
  return { verify, fetches: () => fetches }
}

test('a genuine Google ID token gives the account, e-mail lower-cased', async () => {
  assert.deepEqual(await verifier().verify(idToken({})), { email: 'anne@gmail.com', sub: '1234567890' })
})

test('wrong audience, issuer, expiry, unverified e-mail or algorithm are refused', async () => {
  const { verify } = verifier()
  assert.equal(await verify(idToken({ aud: 'another-app.apps.googleusercontent.com' })), null)
  assert.equal(await verify(idToken({ iss: 'https://evil.example.com' })), null)
  assert.equal(await verify(idToken({ exp: seconds - 1 })), null)
  assert.equal(await verify(idToken({ iat: seconds + 3600 })), null)
  assert.equal(await verify(idToken({ email_verified: false })), null)
  assert.equal(await verify(idToken({}, google, { alg: 'none', kid: 'key-1' })), null)
  assert.equal(await verify('not.a.token'), null)
  assert.equal(await verify(''), null)
})

test('a token signed with any other key, or altered after signing, is refused', async () => {
  const { verify } = verifier()
  const forger = keyPair('key-1')
  assert.equal(await verify(idToken({}, forger)), null)
  const [header, , signature] = idToken({}).split('.')
  const altered = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId, sub: '1', email: 'boss@gmail.com', email_verified: true, exp: seconds + 3600 })).toString('base64url')
  assert.equal(await verify(`${header}.${altered}.${signature}`), null)
})

test('keys are cached, and fetched again for a key id not seen yet', async () => {
  const rotated = keyPair('key-2')
  const keys = [google.jwk]
  const { verify, fetches } = verifier(keys)
  await verify(idToken({}))
  await verify(idToken({}))
  assert.equal(fetches(), 1)
  keys.push(rotated.jwk)
  assert.deepEqual(await verify(idToken({}, rotated)), { email: 'anne@gmail.com', sub: '1234567890' })
  assert.equal(fetches(), 2)
})
