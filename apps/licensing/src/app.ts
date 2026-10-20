import { timingSafeEqual, type KeyObject } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import type { License, Store } from './store.ts'
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
}

type Refusal = 'invalid' | 'revoked' | 'expired' | 'device_limit'

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const endOfDay = (date: string) => Date.parse(`${date}T23:59:59Z`)

export function isNewer(candidate: string, current: string) {
  const parts = (version: string) => version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0)
  }
  return false
}

export function createApp({ store, privateKey, adminToken, releases = {}, graceDays = 14, limits = { general: 120, activation: 15 }, now = () => new Date(), log = (entry) => console.log(JSON.stringify(entry)) }: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(express.json({ limit: '16kb', strict: true }))
  app.use('/v1', rateLimit({ windowMs: 60_000, limit: limits.general, standardHeaders: 'draft-8', legacyHeaders: false }))
  app.use('/v1/licenses/activate', rateLimit({ windowMs: 60_000, limit: limits.activation, standardHeaders: 'draft-8', legacyHeaders: false }))

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

  /** Shared by activation and periodic check; `allowNewDevice` is the only difference between them. */
  async function grant(request: Request, response: Response, allowNewDevice: boolean) {
    const code = text(request.body?.code, 64)
    const deviceId = text(request.body?.deviceId, 64)
    if (!code || !deviceId) {
      response.status(400).json({ error: 'invalid' })
      return
    }
    let refused: Refusal = 'invalid'
    const license = await store.update(hashCode(code), (current) => {
      const blocked = refusal(current)
      const known = current.activations.find((activation) => activation.deviceId === deviceId)
      if (blocked) refused = blocked
      else if (!known && !allowNewDevice) refused = 'invalid'
      else if (!known && current.activations.length >= current.maxDevices) refused = 'device_limit'
      else {
        const timestamp = now().toISOString()
        const entry = { deviceId, deviceName: text(request.body?.deviceName, 80), appVersion: text(request.body?.appVersion, 20), activatedAt: known?.activatedAt ?? timestamp, lastSeenAt: timestamp }
        return { ...current, activations: [...current.activations.filter((activation) => activation.deviceId !== deviceId), entry] }
      }
      return undefined
    })
    if (!license) {
      response.status(refused === 'invalid' ? 404 : 403).json({ error: refused })
      return
    }
    response.json({ token: issue(license, deviceId), customer: license.customer, expires: license.expires })
  }

  // Cloud Run reserves paths ending in "z" (its front end answers /healthz itself), so monitoring there uses /health.
  app.get(['/health', '/healthz'], (_request, response) => response.status(200).send('ok'))

  app.post('/v1/licenses/activate', (request, response, next) => { grant(request, response, true).catch(next) })
  app.post('/v1/licenses/check', (request, response, next) => { grant(request, response, false).catch(next) })

  app.post('/v1/licenses/deactivate', (request, response, next) => {
    const deviceId = text(request.body?.deviceId, 64)
    store.update(hashCode(text(request.body?.code, 64)), (license) => ({ ...license, activations: license.activations.filter((activation) => activation.deviceId !== deviceId) }))
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
    if (!customer || !Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 50 || (expires !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expires))) {
      response.status(400).json({ error: 'Provide customer, maxDevices (1-50) and optional expires (YYYY-MM-DD).' })
      return
    }
    const code = generateCode()
    const license: License = { id: hashCode(code), customer, maxDevices, expires, revoked: false, createdAt: now().toISOString(), activations: [] }
    // The code is returned once, here; only its hash is kept.
    store.create(license).then(() => response.status(201).json({ code, id: license.id, customer, maxDevices, expires })).catch(next)
  })
  admin.get('/licenses', (_request, response, next) => { store.list().then((licenses) => response.json({ licenses })).catch(next) })
  admin.post('/licenses/:id/revoke', (request, response, next) => {
    store.update(String(request.params.id), (license) => ({ ...license, revoked: true }))
      .then((license) => license ? response.json({ id: license.id, revoked: true }) : response.status(404).json({ error: 'not_found' })).catch(next)
  })
  admin.post('/licenses/:id/reset-devices', (request, response, next) => {
    store.update(String(request.params.id), (license) => ({ ...license, activations: [] }))
      .then((license) => license ? response.json({ id: license.id, activations: 0 }) : response.status(404).json({ error: 'not_found' })).catch(next)
  })
  admin.delete('/licenses/:id', (request, response, next) => {
    store.remove(String(request.params.id)).then((removed) => removed ? response.json({ deleted: true }) : response.status(404).json({ error: 'not_found' })).catch(next)
  })
  app.use('/v1/admin', admin)

  app.use((_request, response) => response.status(404).json({ error: 'not_found' }))
  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    log({ severity: 'ERROR', type: 'request_failed', message: error.message })
    if (!response.headersSent) response.status(500).json({ error: 'server_error' })
  })
  return app
}
