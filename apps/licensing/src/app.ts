import { createHash, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import type { GoogleVerifier } from './googleToken.ts'
import { RETENTION_MONTHS, retentionPlan } from './retention.ts'
import type { DeviceActivation, License, Store } from './store.ts'
import { generateCode, hashCode, signToken } from './token.ts'

export type Release = { version: string; url?: string; notes?: string }
export type AppOptions = {
  store: Store
  privateKey: KeyObject
  adminToken?: string
  /** Latest published version per platform (win32, darwin). */
  releases?: Record<string, Release>
  /** How long an activated PC keeps working without reaching this service. */
  graceDays?: number
  /** Requests per minute and per IP: overall, and for licence activation (the endpoint a code-guesser would hit). */
  limits?: { general: number; activation: number }
  now?: () => Date
  log?: (entry: Record<string, unknown>) => void
  /** Checks a Google ID token for activation by account; without it, only licence codes work. */
  verifyGoogleToken?: GoogleVerifier
}

type Refusal = 'invalid' | 'revoked' | 'expired' | 'device_limit' | 'not_registered'

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const endOfDay = (date: string) => Date.parse(`${date}T23:59:59Z`)
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Addresses as the admin typed them (list or comma-separated text), lower-cased; undefined when one is malformed. */
export function parseEmails(value: unknown): string[] | undefined {
  const items = (Array.isArray(value) ? value : String(value ?? '').split(',')).map((item) => text(item, 254).toLowerCase()).filter(Boolean)
  return items.every((item) => EMAIL.test(item)) ? [...new Set(items)] : undefined
}

export function isNewer(candidate: string, current: string) {
  const parts = (version: string) => version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0)
  }
  return false
}

export function createApp({ store, privateKey, adminToken, releases = {}, graceDays = 14, limits = { general: 120, activation: 15 }, now = () => new Date(), log = (entry) => console.log(JSON.stringify(entry)), verifyGoogleToken }: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(express.json({ limit: '16kb', strict: true }))
  app.use('/v1', rateLimit({ windowMs: 60_000, limit: limits.general, standardHeaders: 'draft-8', legacyHeaders: false }))
  const activationLimit = rateLimit({ windowMs: 60_000, limit: limits.activation, standardHeaders: 'draft-8', legacyHeaders: false })
  app.use('/v1/licenses/activate', activationLimit)
  app.use('/v1/licenses/activate-account', activationLimit)

  const refusal = (license: License): Refusal | undefined => {
    if (license.revoked) return 'revoked'
    if (license.expires && endOfDay(license.expires) < now().getTime()) return 'expired'
    return undefined
  }

  function issue(license: License, deviceId: string) {
    const grace = now().getTime() + graceDays * 86_400_000
    const validUntil = new Date(license.expires ? Math.min(grace, endOfDay(license.expires)) : grace).toISOString()
    return signToken({ t: 'act', lic: license.id.slice(0, 12), customer: license.customer, deviceId, expires: license.expires, validUntil }, privateKey)
  }

  /**
   * Which licence and PC a request speaks for: the licence code, or (PCs activated through their Google account) the renewal
   * secret handed out at activation, written `<licence id>.<secret>`. `known` tells whether a PC already on the licence matches.
   */
  function credentials(request: Request) {
    const deviceId = text(request.body?.deviceId, 64)
    const code = text(request.body?.code, 64)
    if (code) return { id: hashCode(code), deviceId, known: (activation: DeviceActivation) => activation.deviceId === deviceId }
    const [id, secret] = text(request.body?.renewal, 160).split('.')
    if (!id || !secret) return undefined
    return { id, deviceId, known: (activation: DeviceActivation) => activation.deviceId === deviceId && Boolean(activation.renewalHash) && sameHash(activation.renewalHash!, sha256(secret)) }
  }

  /**
   * Adds or renews one PC on a licence. Shared by activation (by code or by account) and the periodic check;
   * `allowNewDevice` is false for the check, and `extra` carries what an account activation records on the PC.
   */
  async function attach(id: string, deviceId: string, request: Request, allowNewDevice: boolean, matches: (activation: DeviceActivation) => boolean, extra: Partial<DeviceActivation> = {}) {
    let refused: Refusal = 'invalid'
    const license = await store.update(id, (current) => {
      const blocked = refusal(current)
      const known = current.activations.find(matches)
      const seat = current.activations.some((activation) => activation.deviceId === deviceId)
      if (blocked) refused = blocked
      else if (!known && !allowNewDevice) refused = 'invalid'
      else if (!seat && current.activations.length >= current.maxDevices) refused = 'device_limit'
      else {
        const timestamp = now().toISOString()
        const previous = current.activations.find((activation) => activation.deviceId === deviceId)
        const entry: DeviceActivation = { ...previous, deviceId, deviceName: text(request.body?.deviceName, 80), appVersion: text(request.body?.appVersion, 20), activatedAt: previous?.activatedAt ?? timestamp, lastSeenAt: timestamp, ...extra }
        return { ...current, activations: [...current.activations.filter((activation) => activation.deviceId !== deviceId), entry] }
      }
      return undefined
    })
    return license ? { license } : { refused }
  }

  async function grant(request: Request, response: Response, allowNewDevice: boolean) {
    const presented = credentials(request)
    if (!presented?.deviceId) {
      response.status(400).json({ error: 'invalid' })
      return
    }
    const result = await attach(presented.id, presented.deviceId, request, allowNewDevice, presented.known)
    if (!result.license) {
      response.status(result.refused === 'invalid' ? 404 : 403).json({ error: result.refused })
      return
    }
    response.json({ token: issue(result.license, presented.deviceId), customer: result.license.customer, expires: result.license.expires })
  }

  /** Activation by Google account: the e-mail Google vouches for must be on a licence. The PC gets a renewal secret, never the code. */
  async function grantAccount(request: Request, response: Response) {
    const deviceId = text(request.body?.deviceId, 64)
    if (!verifyGoogleToken) {
      response.status(503).json({ error: 'unavailable' })
      return
    }
    const identity = deviceId ? await verifyGoogleToken(text(request.body?.idToken, 4096)) : null
    if (!identity) {
      response.status(401).json({ error: 'invalid' })
      return
    }
    const found = await store.findByEmail(identity.email)
    if (!found) {
      log({ severity: 'INFO', type: 'account_not_registered', domain: identity.email.split('@')[1] })
      response.status(404).json({ error: 'not_registered' })
      return
    }
    const secret = randomBytes(24).toString('base64url')
    const result = await attach(found.id, deviceId, request, true, (activation) => activation.deviceId === deviceId, { email: identity.email, renewalHash: sha256(secret) })
    if (!result.license) {
      response.status(403).json({ error: result.refused })
      return
    }
    response.json({ token: issue(result.license, deviceId), renewal: `${result.license.id}.${secret}`, customer: result.license.customer, expires: result.license.expires, email: identity.email })
  }

  // Cloud Run reserves paths ending in "z" (its front end answers /healthz itself), so monitoring there uses /health.
  app.get(['/health', '/healthz'], (_request, response) => response.status(200).send('ok'))

  app.post('/v1/licenses/activate', (request, response, next) => { grant(request, response, true).catch(next) })
  app.post('/v1/licenses/activate-account', (request, response, next) => { grantAccount(request, response).catch(next) })
  app.post('/v1/licenses/check', (request, response, next) => { grant(request, response, false).catch(next) })

  app.post('/v1/licenses/deactivate', (request, response, next) => {
    const presented = credentials(request)
    if (!presented) {
      response.json({ ok: true })
      return
    }
    store.update(presented.id, (license) => license.activations.some(presented.known) ? { ...license, activations: license.activations.filter((activation) => activation.deviceId !== presented.deviceId) } : undefined)
      .then(() => response.json({ ok: true })).catch(next)
  })

  app.get('/v1/updates/latest', (request, response) => {
    const release = releases[text(request.query.platform, 16) || 'win32']
    const current = text(request.query.current, 20)
    if (!release) {
      response.json({ updateAvailable: false })
      return
    }
    response.json({ updateAvailable: Boolean(current) && isNewer(release.version, current), version: release.version, url: release.url, notes: release.notes })
  })

  // Anonymous crash reports the customer opted into. Technical fields only, each capped; nothing is stored beyond the service log.
  app.post('/v1/errors', (request, response) => {
    log({
      severity: 'ERROR', type: 'client_error', appVersion: text(request.body?.appVersion, 20), platform: text(request.body?.platform, 16),
      osVersion: text(request.body?.osVersion, 40), origin: text(request.body?.origin, 16), message: text(request.body?.message, 500), stack: text(request.body?.stack, 4000),
    })
    response.status(202).json({ ok: true })
  })

  /** An address may open one licence only, so a signed-in account always lands on a single, known licence. */
  async function emailsTaken(emails: string[], ownId: string) {
    const taken: string[] = []
    for (const email of emails) {
      const holder = await store.findByEmail(email)
      if (holder && holder.id !== ownId) taken.push(email)
    }
    return taken.length ? taken : undefined
  }

  const admin = express.Router()
  admin.use((request, response, next) => {
    const presented = Buffer.from(request.get('authorization')?.replace(/^Bearer /i, '') ?? '')
    const expected = Buffer.from(adminToken ?? '')
    if (!adminToken || presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    next()
  })
  admin.post('/licenses', (request, response, next) => {
    const customer = text(request.body?.customer, 120)
    const maxDevices = Number(request.body?.maxDevices ?? 1)
    const expires = request.body?.expires ? text(request.body.expires, 10) : null
    const emails = parseEmails(request.body?.emails)
    if (!customer || !Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 50 || (expires !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) || !emails) {
      response.status(400).json({ error: 'Provide customer, maxDevices (1-50), optional expires (YYYY-MM-DD) and optional emails.' })
      return
    }
    const code = generateCode()
    const license: License = { id: hashCode(code), customer, maxDevices, expires, revoked: false, createdAt: now().toISOString(), activations: [], emails }
    void (async () => {
      const taken = await emailsTaken(emails, license.id)
      if (taken) {
        response.status(409).json({ error: 'email_in_use', emails: taken })
        return
      }
      await store.create(license)
      // The code is returned once, here; only its hash is kept.
      response.status(201).json({ code, id: license.id, customer, maxDevices, expires, emails })
    })().catch(next)
  })
  /** Google accounts allowed to activate a licence: `add` and `remove`, lists or comma-separated text. */
  admin.post('/licenses/:id/emails', (request, response, next) => {
    const add = parseEmails(request.body?.add)
    const remove = parseEmails(request.body?.remove)
    if (!add || !remove) {
      response.status(400).json({ error: 'Provide add and/or remove as e-mail addresses.' })
      return
    }
    void (async () => {
      const id = String(request.params.id)
      const taken = await emailsTaken(add, id)
      if (taken) {
        response.status(409).json({ error: 'email_in_use', emails: taken })
        return
      }
      const license = await store.update(id, (current) => ({ ...current, emails: [...new Set([...(current.emails ?? []), ...add])].filter((email) => !remove.includes(email)) }))
      if (license) response.json({ id: license.id, emails: license.emails })
      else response.status(404).json({ error: 'not_found' })
    })().catch(next)
  })
  admin.get('/licenses', (_request, response, next) => { store.list().then((licenses) => response.json({ licenses })).catch(next) })
  admin.post('/licenses/:id/revoke', (request, response, next) => {
    store.update(String(request.params.id), (license) => ({ ...license, revoked: true, revokedAt: license.revokedAt ?? now().toISOString() }))
      .then((license) => license ? response.json({ id: license.id, revoked: true }) : response.status(404).json({ error: 'not_found' })).catch(next)
  })
  admin.post('/licenses/:id/reset-devices', (request, response, next) => {
    store.update(String(request.params.id), (license) => ({ ...license, activations: [] }))
      .then((license) => license ? response.json({ id: license.id, activations: 0 }) : response.status(404).json({ error: 'not_found' })).catch(next)
  })
  admin.delete('/licenses/:id', (request, response, next) => {
    store.remove(String(request.params.id)).then((removed) => removed ? response.json({ deleted: true }) : response.status(404).json({ error: 'not_found' })).catch(next)
  })
  // Retention: erases what the privacy policy no longer allows to keep. Without `confirm` it only reports what it would erase.
  admin.post('/purge', (request, response, next) => {
    void (async () => {
      const months = Number(request.body?.months ?? RETENTION_MONTHS)
      if (!Number.isInteger(months) || months < 1) {
        response.status(400).json({ error: 'invalid_months' })
        return
      }
      const plan = retentionPlan(await store.list(), now(), months)
      const confirm = request.body?.confirm === true
      if (confirm) {
        for (const item of plan.remove) await store.remove(item.id)
        for (const item of plan.devices) await store.update(item.id, (license) => ({ ...license, activations: license.activations.filter((activation) => !item.deviceIds.includes(activation.deviceId)) }))
        log({ severity: 'NOTICE', type: 'retention_purge', months, licences: plan.remove.length, devices: plan.devices.reduce((total, item) => total + item.deviceIds.length, 0) })
      }
      response.json({ ...plan, months, done: confirm })
    })().catch(next)
  })
  app.use('/v1/admin', admin)

  app.use((_request, response) => response.status(404).json({ error: 'not_found' }))
  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    log({ severity: 'ERROR', type: 'request_failed', message: error.message })
    if (!response.headersSent) response.status(500).json({ error: 'server_error' })
  })
  return app
}
