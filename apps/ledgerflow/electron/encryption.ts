import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Database } from './database.ts'

/**
 * The company's data key, sealed with one secret: a user's password or recovery code. The key itself never leaves the PCs;
 * Drive only holds it in this form, so reading the Drive copy takes an AICOM account, not just access to the Google account.
 */
export type KeySlot = { username: string; kind: 'password' | 'recovery'; salt: string; iv: string; tag: string; key: string }

/** Deliberately above any real data schema: versions from before encryption read it as "made by a newer AICOM" and ask to be updated. */
export const SEALED_SCHEMA = 1000
export type Sealed = { format: 'aicom-data'; schemaVersion: typeof SEALED_SCHEMA; sealed: 1; slots: KeySlot[]; iv: string; tag: string; data: string }

/** The Drive copy is encrypted and this PC does not hold its key: someone must sign in with an account that can open it. */
export class KeyRequiredError extends Error {
  slots: KeySlot[]
  constructor(slots: KeySlot[]) {
    super('The Google Drive copy is encrypted: sign in to AICOM to open it on this PC.')
    this.name = 'KeyRequiredError'
    this.slots = slots
  }
}

const ALGORITHM = 'aes-256-gcm'
const AAD = Buffer.from('aicom-sealed-1')
const b64 = (bytes: Buffer) => bytes.toString('base64')

function encrypt(key: Buffer, plain: Buffer) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv).setAAD(AAD)
  const data = Buffer.concat([cipher.update(plain), cipher.final()])
  return { iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) }
}

/** Throws when the key is wrong or the content was altered. */
function decrypt(key: Buffer, { iv, tag, data }: { iv: string; tag: string; data: string }) {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64')).setAAD(AAD)
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()])
}

const normalizeUser = (username: string) => String(username ?? '').trim().toLowerCase()
const keyFromSecret = (secret: string, salt: Buffer) => scryptSync(String(secret ?? '').normalize('NFKC'), salt, 32)

export function wrapKey(dataKey: Buffer, username: string, kind: KeySlot['kind'], secret: string): KeySlot {
  const salt = randomBytes(16)
  const { iv, tag, data } = encrypt(keyFromSecret(secret, salt), dataKey)
  return { username: normalizeUser(username), kind, salt: b64(salt), iv, tag, key: data }
}

export function unwrapKey(slots: KeySlot[], username: string, kind: KeySlot['kind'], secret: string): Buffer | undefined {
  for (const slot of slots.filter((item) => item.username === normalizeUser(username) && item.kind === kind)) {
    try {
      return decrypt(keyFromSecret(secret, Buffer.from(slot.salt, 'base64')), { iv: slot.iv, tag: slot.tag, data: slot.key })
    } catch {
      // Not this secret: try the next slot, if any.
    }
  }
  return undefined
}

export const hasSlot = (slots: KeySlot[], username: string, kind: KeySlot['kind']) => slots.some((slot) => slot.username === normalizeUser(username) && slot.kind === kind)

/** Compressed before it is encrypted: encrypted bytes look random and no longer compress, which would undo the savings on slow connections. */
export function seal(key: Buffer, text: string, slots: KeySlot[]): string {
  const sealed: Sealed = { format: 'aicom-data', schemaVersion: SEALED_SCHEMA, sealed: 1, slots, ...encrypt(key, gzipSync(text, { level: 9 })) }
  return JSON.stringify(sealed)
}

export const isSealed = (value: unknown): value is Sealed => (value as Sealed | undefined)?.sealed === 1

/** The text inside; throws when the key is not the one the content was sealed with. */
export const unseal = (key: Buffer, sealed: Sealed) => gunzipSync(decrypt(key, sealed)).toString('utf8')

export type Keyring = ReturnType<typeof createKeyring>

/** This PC's copy of the data key and of the slots that open it, kept with the local data (settings, never exported). */
export function createKeyring(db: Database) {
  const key = () => {
    const stored = db.getSetting('dataKey')
    return stored ? Buffer.from(stored, 'base64') : undefined
  }
  const slots = (): KeySlot[] => JSON.parse(db.getSetting('keySlots') ?? '[]') as KeySlot[]
  const setSlots = (next: KeySlot[]) => db.setSetting('keySlots', JSON.stringify(next))

  return {
    key,
    slots,
    setSlots,
    setKey(next: Buffer | undefined) {
      db.setSetting('dataKey', next ? b64(next) : undefined)
    },

    /** Lets `secret` open the data key for this user, creating the key the first time. Returns true when the slots changed. */
    grant(username: string, kind: KeySlot['kind'], secret: string) {
      let current = key()
      let existing = slots()
      if (!current) {
        current = randomBytes(32)
        db.setSetting('dataKey', b64(current))
        // Slots left from another key (seen on Drive before) cannot open this one.
        existing = []
      }
      if (unwrapKey(existing, username, kind, secret)?.equals(current)) return false
      const user = normalizeUser(username)
      setSlots([...existing.filter((slot) => !(slot.username === user && slot.kind === kind)), wrapKey(current, user, kind, secret)])
      return true
    },

    /** A disabled account no longer opens the Drive copy on a new PC. */
    revoke(username: string) {
      const user = normalizeUser(username)
      const existing = slots()
      const next = existing.filter((slot) => slot.username !== user)
      setSlots(next)
      return next.length !== existing.length
    },
  }
}
