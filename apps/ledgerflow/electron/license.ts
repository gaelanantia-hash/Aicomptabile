import { createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LicenseReason, LicenseState } from '../src/desktopApi.ts'
import type { Device } from './sync.ts'

/** Signed by the licence service after each successful check. `validUntil` is how long the app may run without reaching it. */
export type Activation = { t: 'act'; lic: string; customer: string; deviceId: string; expires: string | null; validUntil: string }
/**
 * What this PC keeps: the licence code typed by the customer, or, when the licence was activated through the Google account,
 * the renewal secret the service handed out for this PC (the code itself never reaches such a PC).
 */
type Stored = { code?: string; renewal?: string; email?: string; token?: string }
export type LicenseOptions = { serverUrl: string; publicKey: string; device: Device; appVersion: string; file: string; devMode: boolean; trialUntil?: string; clockFile?: string; now?: () => number }
export type LicenseClient = ReturnType<typeof createLicenseClient>

/** Verifies an Ed25519-signed token with the public key shipped in the app. The private key never leaves the licence service. */
export function verifyToken(token: string, publicKey: string): Activation | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
    if (!verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64url'))) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Activation
  } catch {
    return null
  }
}

export function evaluate(token: string | undefined, publicKey: string, deviceId: string, now: number): LicenseState {
  if (!token) return { valid: false, reason: 'missing' }
  const activation = verifyToken(token, publicKey)
  if (!activation || activation.t !== 'act' || activation.deviceId !== deviceId) return { valid: false, reason: 'invalid' }
  const details = { customer: activation.customer, expires: activation.expires, validUntil: activation.validUntil }
  if (activation.expires && Date.parse(`${activation.expires}T23:59:59Z`) < now) return { valid: false, reason: 'expired', ...details }
  if (Date.parse(activation.validUntil) < now) return { valid: false, reason: 'grace_expired', ...details }
  return { valid: true, ...details }
}

/** Answers from the service that withdraw the licence. Anything else (outage, rate limit, proxy page) counts as unreachable. */
const refusals: LicenseReason[] = ['invalid', 'expired', 'revoked', 'device_limit', 'not_registered']

export function createLicenseClient({ serverUrl, publicKey, device, appVersion, file, devMode, trialUntil, clockFile, now = Date.now }: LicenseOptions) {
  const read = (): Stored | null => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Stored : null
    } catch {
      return null
    }
  }
  const write = (stored: Stored) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(stored))
  }

  async function call(path: string, credentials: { code?: string; renewal?: string; idToken?: string }): Promise<{ token?: string; renewal?: string; email?: string; error?: LicenseReason }> {
    const response = await fetch(`${serverUrl}/v1/licenses/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, deviceId: device.id, deviceName: device.name, appVersion }),
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => ({})) as { token?: string; renewal?: string; email?: string; error?: string }
    if (response.ok && payload.token) return { token: payload.token, renewal: payload.renewal, email: payload.email }
    if ((response.status === 403 || response.status === 404) && refusals.includes(payload.error as LicenseReason)) return { error: payload.error as LicenseReason }
    throw new Error(`Licence service answered ${response.status}.`)
  }

  // The trial end is compared with the latest date this PC has shown, so setting the system clock back does not extend it.
  function trialNow() {
    const current = now()
    if (!clockFile) return current
    let seen = 0
    try {
      seen = Number((JSON.parse(readFileSync(clockFile, 'utf8')) as { seen?: number }).seen) || 0
    } catch {
      // First start, or the file is unreadable: start from today.
    }
    if (current - seen > 60_000) {
      try {
        mkdirSync(dirname(clockFile), { recursive: true })
        writeFileSync(clockFile, JSON.stringify({ seen: current }))
      } catch {
        // Not writable: the check still uses the latest date read.
      }
    }
    return Math.max(current, seen)
  }

  function state(): LicenseState {
    // Development builds without a licence service configured run unlicensed, clearly flagged.
    if (!serverUrl || !publicKey) {
      // Trial builds carry an end date instead of a licence service: they run freely until that day, then stop.
      if (trialUntil && /^\d{4}-\d{2}-\d{2}$/.test(trialUntil)) {
        return Date.parse(`${trialUntil}T23:59:59`) >= trialNow() ? { valid: true, trial: true, expires: trialUntil } : { valid: false, trial: true, reason: 'expired', expires: trialUntil }
      }
      return devMode ? { valid: true, dev: true } : { valid: false, reason: 'unreachable' }
    }
    const stored = read()
    const result = evaluate(stored?.token, publicKey, device.id, now())
    return stored?.email ? { ...result, email: stored.email } : result
  }
  // How this PC proves it holds the licence at each check: its code, or its renewal secret.
  const credentials = (stored: Stored) => stored.code ? { code: stored.code } : { renewal: stored.renewal }

  return {
    state,
    configured: () => Boolean(serverUrl && publicKey),

    async activate(input: string): Promise<LicenseState> {
      const code = input.trim().toUpperCase()
      if (!code) return { valid: false, reason: 'missing' }
      let result: Awaited<ReturnType<typeof call>>
      try {
        result = await call('activate', { code })
      } catch {
        return { valid: false, reason: 'unreachable' }
      }
      if (!result.token) return { valid: false, reason: result.error }
      write({ code, token: result.token })
      return state()
    },

    /** True when the customer typed a code on this PC: then the Google account is not used for the licence. */
    hasCode: () => Boolean(read()?.code),

    /**
     * Activation through the signed-in Google account: the service checks the ID token Google issued and looks the address up
     * among its licences. Nothing to type; `not_registered` when the address is on no licence.
     */
    async activateAccount(idToken: string): Promise<LicenseState> {
      if (!serverUrl || !publicKey) return state()
      let result: Awaited<ReturnType<typeof call>>
      try {
        result = await call('activate-account', { idToken })
      } catch {
        return { valid: false, reason: 'unreachable' }
      }
      if (!result.token || !result.renewal) return { valid: false, reason: result.error ?? 'invalid' }
      write({ renewal: result.renewal, email: result.email, token: result.token })
      return state()
    },

    /** Renews the activation. Offline, the last signed activation keeps the app running until its `validUntil`. */
    async check(): Promise<LicenseState> {
      const stored = read()
      if (!stored || (!stored.code && !stored.renewal) || !serverUrl || !publicKey) return state()
      try {
        const result = await call('check', credentials(stored))
        if (result.token) write({ ...stored, token: result.token })
        else {
          write({ ...stored, token: undefined })
          return { valid: false, reason: result.error }
        }
      } catch {
        // Service unreachable: fall through to the stored activation.
      }
      return state()
    },

    /** Frees this PC's seat so the licence can be activated on another one. */
    async deactivate() {
      const stored = read()
      if (stored && serverUrl) await call('deactivate', credentials(stored)).catch(() => undefined)
      rmSync(file, { force: true })
    },
  }
}
