import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { AuthRevokedError, buildAuthUrl, createPkce, exchangeCode, listenForRedirect, readAccount, refreshTokens, revokeToken, scopes } from './oauth.ts'
import { startFakeGoogle } from './testing/fakeGoogle.ts'
import { createVault } from './tokens.ts'

let google: Awaited<ReturnType<typeof startFakeGoogle>>
const client = { clientId: 'desktop-client' }
before(async () => { google = await startFakeGoogle() })
after(() => google.close())

test('PKCE challenge is the SHA-256 of the verifier', () => {
  const { verifier, challenge } = createPkce()
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'))
  assert.ok(verifier.length >= 43)
})

test('the sign-in URL asks only for identity and app-created Drive files', () => {
  const url = new URL(buildAuthUrl(google.endpoints, client, 'http://127.0.0.1:1/oauth2/callback', 'challenge', 'state'))
  assert.deepEqual(url.searchParams.get('scope')?.split(' '), ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'])
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(scopes.some((scope) => scope.endsWith('/auth/drive')), false)
})

test('browser sign-in returns a code on the loopback address and exchanges it for tokens', async () => {
  const listener = await listenForRedirect()
  try {
    const pkce = createPkce()
    const code = listener.waitForCode('state-1')
    const page = await fetch(buildAuthUrl(google.endpoints, client, listener.redirectUri, pkce.challenge, 'state-1'))
    assert.match(await page.text(), /Connexion réussie/)
    const tokens = await exchangeCode(google.endpoints, client, await code, pkce.verifier, listener.redirectUri)
    assert.ok(tokens.refreshToken)
    assert.deepEqual(readAccount(tokens.idToken!), { sub: 'sub-1', email: 'cliente@example.com' })
    assert.ok((await refreshTokens(google.endpoints, client, tokens.refreshToken)).accessToken)
  } finally { listener.close() }
})

test('a code cannot be redeemed without the matching PKCE verifier', async () => {
  const listener = await listenForRedirect()
  try {
    const code = listener.waitForCode('state-2')
    await fetch(buildAuthUrl(google.endpoints, client, listener.redirectUri, createPkce().challenge, 'state-2'))
    await assert.rejects(exchangeCode(google.endpoints, client, await code, 'wrong-verifier', listener.redirectUri), AuthRevokedError)
  } finally { listener.close() }
})

test('a redirect with the wrong state is refused', async () => {
  const listener = await listenForRedirect()
  try {
    const code = listener.waitForCode('expected')
    code.catch(() => undefined)
    const response = await fetch(`${listener.redirectUri}?code=abc&state=forged`)
    assert.equal(response.status, 400)
    await assert.rejects(code)
  } finally { listener.close() }
})

test('a revoked refresh token is reported as revoked access', async () => {
  const refresh = google.grant()
  await revokeToken(google.endpoints, refresh)
  await assert.rejects(refreshTokens(google.endpoints, client, refresh), AuthRevokedError)
})

test('the token vault writes only encrypted content and survives a restart', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'aicom-vault-')), 'auth.bin')
  const cipher = { available: () => true, encrypt: (text: string) => Buffer.from(text, 'utf8').reverse(), decrypt: (data: Buffer) => Buffer.from(data).reverse().toString('utf8') }
  const auth = { refreshToken: 'secret-refresh-token', account: { sub: 's', email: 'a@b.c' } }
  createVault(file, cipher).save(auth)
  assert.equal(readFileSync(file).includes('secret-refresh-token'), false)
  assert.deepEqual(createVault(file, cipher).load(), auth)
  createVault(file, cipher).clear()
  assert.equal(createVault(file, cipher).load(), null)
})

test('without OS encryption the token is never written to disk', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'aicom-vault-')), 'auth.bin')
  const cipher = { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' }
  const vault = createVault(file, cipher)
  vault.save({ refreshToken: 'secret', account: { sub: 's', email: 'a@b.c' } })
  assert.equal(vault.load()?.refreshToken, 'secret')
  assert.equal(createVault(file, cipher).load(), null)
})
