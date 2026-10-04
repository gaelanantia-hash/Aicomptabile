import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Account } from '../src/desktopApi.ts'

export type GoogleEndpoints = { auth: string; token: string; revoke: string; api: string; upload: string }
export type OAuthClient = { clientId: string; clientSecret?: string }
export type Tokens = { accessToken: string; expiresAt: number; refreshToken?: string; idToken?: string }

export const googleEndpoints: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
}

// The minimum the app needs: who the customer is, and access to the files the app itself creates in their Drive.
export const scopes = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file']

/** Google no longer accepts the stored refresh token: the customer revoked access or it expired. */
export class AuthRevokedError extends Error {
  constructor() {
    super('Google access was revoked or expired.')
    this.name = 'AuthRevokedError'
  }
}

const base64url = (data: Buffer) => data.toString('base64url')

export function createPkce() {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export function buildAuthUrl(endpoints: GoogleEndpoints, client: OAuthClient, redirectUri: string, challenge: string, state: string) {
  const url = new URL(endpoints.auth)
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent select_account',
  }).toString()
  return url.toString()
}

const page = (title: string, text: string) => `<!doctype html><html lang="fr"><meta charset="utf-8"><title>AICOM</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:90vh;color:#253129;background:#f5f7f4"><main style="max-width:420px;text-align:center"><h1 style="font-size:20px">${title}</h1><p>${text}</p></main></body></html>`

/** Listens on a loopback port for Google's redirect. The password never passes through the app, only a one-time code. */
export async function listenForRedirect() {
  let settle: { resolve(code: string): void; reject(error: Error): void; state: string } | undefined
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/oauth2/callback' || !settle) {
      response.writeHead(404).end()
      return
    }
    const code = url.searchParams.get('code')
    const valid = code && url.searchParams.get('state') === settle.state
    response.writeHead(valid ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(valid
      ? page('Connexion réussie', 'Vous pouvez fermer cette fenêtre et revenir à AICOM.<br>You can close this window and return to AICOM.')
      : page('Connexion annulée', 'Revenez à AICOM pour réessayer.<br>Return to AICOM to try again.'))
    if (valid) settle.resolve(code)
    else settle.reject(new Error(url.searchParams.get('error') || 'Google sign-in was cancelled.'))
  })
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  let timer: NodeJS.Timeout | undefined

  return {
    redirectUri: `http://127.0.0.1:${port}/oauth2/callback`,
    waitForCode(state: string, timeoutMs = 5 * 60_000) {
      return new Promise<string>((resolve, reject) => {
        settle = { resolve, reject, state }
        timer = setTimeout(() => reject(new Error('Google sign-in timed out.')), timeoutMs)
      })
    },
    cancel() {
      settle?.reject(new Error('Google sign-in was cancelled.'))
    },
    close() {
      clearTimeout(timer)
      server.close()
      server.closeAllConnections()
    },
  }
}

async function tokenRequest(endpoints: GoogleEndpoints, client: OAuthClient, params: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams({ client_id: client.clientId, ...params })
  // Google issues a "secret" even to desktop clients and documents that it is not confidential there; PKCE is what protects the exchange.
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const response = await fetch(endpoints.token, { method: 'POST', body })
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string }
  if (payload.error === 'invalid_grant') throw new AuthRevokedError()
  if (!response.ok || !payload.access_token) throw new Error(`Google token request failed: ${payload.error_description || payload.error || response.status}`)
  return { accessToken: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000, refreshToken: payload.refresh_token, idToken: payload.id_token }
}

export function exchangeCode(endpoints: GoogleEndpoints, client: OAuthClient, code: string, verifier: string, redirectUri: string) {
  return tokenRequest(endpoints, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
}

export function refreshTokens(endpoints: GoogleEndpoints, client: OAuthClient, refreshToken: string) {
  return tokenRequest(endpoints, client, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

export async function revokeToken(endpoints: GoogleEndpoints, token: string) {
  await fetch(endpoints.revoke, { method: 'POST', body: new URLSearchParams({ token }) })
}

/** Reads the account from an ID token received directly from Google's token endpoint over TLS. */
export function readAccount(idToken: string): Account {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string; email?: string }
  if (!payload.sub || !payload.email) throw new Error('Google did not return the account identity.')
  return { sub: payload.sub, email: payload.email }
}
