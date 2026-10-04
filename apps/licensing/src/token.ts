import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto'

/** Signed proof that one PC may run the app until `validUntil` without contacting this service again. */
export type Activation = { t: 'act'; lic: string; customer: string; deviceId: string; expires: string | null; validUntil: string }

// Crockford base32: no I, L, O or U, so codes survive being read aloud or retyped.
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A licence code such as AICOM-7K2QF-M0X9A-3TZ4B-W8H1C (100 random bits). */
export function generateCode() {
  const bytes = randomBytes(20)
  const characters = Array.from({ length: 20 }, (_, index) => alphabet[bytes[index] & 31])
  return `AICOM-${[0, 5, 10, 15].map((start) => characters.slice(start, start + 5).join('')).join('-')}`
}

export const normalizeCode = (code: string) => code.trim().toUpperCase()

/** Codes are stored hashed: a leaked database does not hand out working licences. */
export const hashCode = (code: string) => createHash('sha256').update(normalizeCode(code)).digest('hex')

export function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  }
}

export const loadPrivateKey = (base64: string) => createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' })

export function signToken(payload: Activation, privateKey: KeyObject) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`
}

export function verifyToken(token: string, publicKey: string): Activation | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
  if (!verify(null, Buffer.from(body), key, Buffer.from(signature, 'base64url'))) return null
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Activation
}
