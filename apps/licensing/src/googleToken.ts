import { createPublicKey, verify, type JsonWebKey } from 'node:crypto'

/** The Google account an ID token was issued for, once its signature and claims have been checked. */
export type GoogleIdentity = { email: string; sub: string }
export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity | null>
type Jwk = JsonWebKey & { kid?: string }
type KeySet = { keys: Jwk[]; maxAgeSeconds?: number }

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

/** Google's current signing keys, with how long they may be cached. */
export async function fetchGoogleKeys(): Promise<KeySet> {
  const response = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Google keys answered ${response.status}.`)
  const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1]
  return { keys: ((await response.json()) as { keys: Jwk[] }).keys, maxAgeSeconds: maxAge ? Number(maxAge) : undefined }
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>

/**
 * Checks an ID token issued by Google to the AICOM desktop client: RS256 signature with Google's published keys, issuer,
 * audience (one of `audiences`, the OAuth client IDs), expiry, and a verified e-mail address. Anything else returns null.
 */
export function createGoogleVerifier({ audiences, fetchKeys = fetchGoogleKeys, now = Date.now }: { audiences: string[]; fetchKeys?: () => Promise<KeySet>; now?: () => number }): GoogleVerifier {
  let cache: { keys: Jwk[]; until: number } | undefined

  async function keyFor(kid: string, refresh: boolean) {
    if (refresh || !cache || cache.until < now()) {
      const fetched = await fetchKeys()
      cache = { keys: fetched.keys, until: now() + (fetched.maxAgeSeconds ?? 3600) * 1000 }
    }
    return cache.keys.find((key) => key.kid === kid)
  }

  return async (idToken) => {
    const [header, payload, signature] = String(idToken ?? '').split('.')
    if (!header || !payload || !signature) return null
    try {
      const { alg, kid } = decode(header)
      if (alg !== 'RS256' || typeof kid !== 'string') return null
      // A key not in the cache may be a new one Google has just started using: fetch the set once more.
      const jwk = await keyFor(kid, false) ?? await keyFor(kid, true)
      if (!jwk) return null
      const signed = verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))
      if (!signed) return null
      const claims = decode(payload)
      const seconds = now() / 1000
      if (!ISSUERS.has(String(claims.iss))) return null
      if (!audiences.includes(String(claims.aud))) return null
      if (typeof claims.exp !== 'number' || claims.exp < seconds) return null
      if (typeof claims.iat === 'number' && claims.iat > seconds + 300) return null
      if (claims.email_verified !== true && claims.email_verified !== 'true') return null
      if (typeof claims.email !== 'string' || typeof claims.sub !== 'string') return null
      return { email: claims.email.trim().toLowerCase(), sub: claims.sub }
    } catch {
      return null
    }
  }
}
