import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AppUser, AuthResult } from '../src/desktopApi.ts'
import type { Database } from './database.ts'
import type { Device } from './sync.ts'

/** Stored with the company data (and so in the customer's Drive). Passwords and recovery codes are kept only as salted scrypt hashes. */
type StoredUser = AppUser & { salt: string; hash: string; recoverySalt: string; recoveryHash: string }
type NewUser = { username: string; name: string; password: string; role: 'admin' | 'user' }
export type Auth = ReturnType<typeof createAuth>

const collection = '_users'
const MAX_FAILURES = 5
const LOCK_MS = 30_000
export const MIN_PASSWORD_LENGTH = 8

const derive = (secret: string, salt: string) => scryptSync(secret.normalize('NFKC'), Buffer.from(salt, 'base64'), 32)
const matches = (secret: string, salt: string, hash: string) => timingSafeEqual(derive(secret, salt), Buffer.from(hash, 'base64'))
const publicUser = ({ username, name, role, active, createdAt }: StoredUser): AppUser => ({ username, name, role, active, createdAt })
const normalize = (username: string) => String(username ?? '').trim().toLowerCase()

function seal(secret: string) {
  const salt = randomBytes(16).toString('base64')
  return { salt, hash: derive(secret, salt).toString('base64') }
}

/** A code such as 7K2Q-M0X9-3TZ4, shown once, that lets its owner set a new password. */
function newRecoveryCode() {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const bytes = randomBytes(12)
  const characters = Array.from(bytes, (byte) => alphabet[byte & 31])
  return [0, 4, 8].map((start) => characters.slice(start, start + 4).join('')).join('-')
}

/**
 * Sign-in to the application. Accounts belong to the company data, so the same credentials work on every PC of the customer.
 * Every attempt, successful or not, is written to the access history.
 */
export function createAuth(db: Database, device: Device, onChange: () => void, now: () => number = Date.now) {
  let current: StoredUser | undefined
  let failures = 0
  let lockedUntil = 0

  const find = (username: string) => db.getRecord<StoredUser>(collection, normalize(username))
  const users = () => db.listRecords<StoredUser>(collection)
  const log = (user: string, event: Parameters<Database['logAccess']>[2]) => {
    db.logAccess(device, user, event, new Date(now()).toISOString())
    onChange()
  }
  const save = (user: StoredUser) => db.putRecord(collection, user.username, user)
  const failed = (username: string): AuthResult => {
    failures += 1
    if (failures >= MAX_FAILURES) lockedUntil = now() + LOCK_MS
    log(normalize(username) || '?', 'login_failed')
    return { ok: false, reason: 'invalid' }
  }
  const locked = (): AuthResult | undefined => now() < lockedUntil ? { ok: false, reason: 'locked', waitSeconds: Math.ceil((lockedUntil - now()) / 1000) } : undefined

  return {
    hasUsers: () => users().length > 0,
    current: () => current && publicUser(current),
    list: () => current ? users().map(publicUser) : [],

    login(username: string, password: string): AuthResult {
      const blocked = locked()
      if (blocked) return blocked
      const user = find(username)
      if (!user || !user.active || !matches(String(password ?? ''), user.salt, user.hash)) return failed(username)
      failures = 0
      current = user
      log(user.username, 'login')
      return { ok: true, user: publicUser(user) }
    },

    logout() {
      if (current) log(current.username, 'logout')
      current = undefined
    },

    /** Forgets who is signed in without writing a line, when the data space itself is closed or replaced. */
    reset() {
      current = undefined
    },

    create(input: NewUser): AuthResult {
      const first = users().length === 0
      if (!first && current?.role !== 'admin') return { ok: false, reason: 'forbidden' }
      const username = normalize(input.username)
      if (!/^[a-z0-9._-]{3,40}$/.test(username) || !String(input.name ?? '').trim() || String(input.password ?? '').length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weak' }
      if (find(username)) return { ok: false, reason: 'exists' }
      const recoveryCode = newRecoveryCode()
      const recovery = seal(recoveryCode)
      const user: StoredUser = {
        username, name: input.name.trim().slice(0, 80), role: first ? 'admin' : input.role === 'admin' ? 'admin' : 'user', active: true, createdAt: new Date(now()).toISOString(),
        ...seal(input.password), recoverySalt: recovery.salt, recoveryHash: recovery.hash,
      }
      save(user)
      log(username, 'user_created')
      // The very first account signs in straight away; it has just proved it knows the password.
      if (first) {
        current = user
        log(username, 'login')
      }
      return { ok: true, user: publicUser(user), recoveryCode }
    },

    setActive(username: string, active: boolean): AuthResult {
      const user = find(username)
      if (current?.role !== 'admin' || !user) return { ok: false, reason: 'forbidden' }
      // The last active administrator cannot be switched off: nobody could manage accounts any more.
      if (!active && user.role === 'admin' && users().filter((item) => item.role === 'admin' && item.active).length <= 1) return { ok: false, reason: 'forbidden' }
      save({ ...user, active })
      log(user.username, active ? 'user_enabled' : 'user_disabled')
      return { ok: true, user: publicUser({ ...user, active }) }
    },

    changePassword(username: string, password: string): AuthResult {
      const user = find(username)
      if (!current || !user || (current.role !== 'admin' && current.username !== user.username)) return { ok: false, reason: 'forbidden' }
      if (String(password ?? '').length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weak' }
      const updated = { ...user, ...seal(password) }
      save(updated)
      if (current.username === user.username) current = updated
      log(user.username, 'password_changed')
      return { ok: true, user: publicUser(updated) }
    },

    recover(username: string, recoveryCode: string, password: string): AuthResult {
      const blocked = locked()
      if (blocked) return blocked
      const user = find(username)
      const code = String(recoveryCode ?? '').trim().toUpperCase()
      if (!user || !user.active || !matches(code, user.recoverySalt, user.recoveryHash)) return failed(username)
      if (String(password ?? '').length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weak' }
      const next = newRecoveryCode()
      const recovery = seal(next)
      const updated = { ...user, ...seal(password), recoverySalt: recovery.salt, recoveryHash: recovery.hash }
      save(updated)
      failures = 0
      current = updated
      log(user.username, 'password_recovered')
      return { ok: true, user: publicUser(updated), recoveryCode: next }
    },
  }
}
