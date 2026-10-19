import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAuth } from './auth.ts'
import { openDatabase } from './database.ts'
import { createKeyring, isSealed, seal, unseal, unwrapKey, wrapKey } from './encryption.ts'

const device = { id: 'device-1', name: 'PC-1' }
const admin = { username: 'Giulia', name: 'Giulia Rossi', password: 'motdepasse-1', role: 'admin' as const }

function setup() {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'aicom-keys-')), 'data.sqlite'))
  const keyring = createKeyring(db)
  return { db, keyring, auth: createAuth(db, device, () => undefined, Date.now, keyring) }
}
const opens = (keyring: ReturnType<typeof createKeyring>, username: string, kind: 'password' | 'recovery', secret: string) =>
  unwrapKey(keyring.slots(), username, kind, secret)?.equals(keyring.key()!) ?? false

test('sealed content needs the right key, and any change to it is detected', () => {
  const key = randomBytes(32)
  const text = JSON.stringify({ records: { clients: { C1: { name: 'Hôtel Belvédère' } } } })
  const sealed = JSON.parse(seal(key, text, []))
  assert.equal(isSealed(sealed), true)
  assert.doesNotMatch(JSON.stringify(sealed), /Belv/)
  assert.equal(unseal(key, sealed), text)
  assert.throws(() => unseal(randomBytes(32), sealed))
  const altered = Buffer.from(sealed.data, 'base64')
  altered[0] ^= 1
  assert.throws(() => unseal(key, { ...sealed, data: altered.toString('base64') }))
})

test('a key slot opens only with its own user, kind and secret', () => {
  const key = randomBytes(32)
  const slots = [wrapKey(key, 'Giulia', 'password', 'secret-1')]
  assert.equal(unwrapKey(slots, ' giulia ', 'password', 'secret-1')?.equals(key), true)
  assert.equal(unwrapKey(slots, 'giulia', 'password', 'secret-2'), undefined)
  assert.equal(unwrapKey(slots, 'giulia', 'recovery', 'secret-1'), undefined)
  assert.equal(unwrapKey(slots, 'marco', 'password', 'secret-1'), undefined)
})

test('the first account creates the company key; its password and recovery code both open it', () => {
  const { keyring, auth } = setup()
  assert.equal(keyring.key(), undefined)
  const created = auth.create(admin)
  assert.ok(created.ok)
  assert.equal(keyring.key()?.length, 32)
  assert.equal(opens(keyring, 'giulia', 'password', admin.password), true)
  assert.equal(opens(keyring, 'giulia', 'recovery', created.recoveryCode!), true)
})

test('an account from before encryption gets its slot at its first sign-in', () => {
  const { db, keyring } = setup()
  createAuth(db, device, () => undefined).create(admin)
  assert.equal(keyring.key(), undefined)
  const auth = createAuth(db, device, () => undefined, Date.now, keyring)
  assert.ok(auth.login('giulia', admin.password).ok)
  assert.equal(opens(keyring, 'giulia', 'password', admin.password), true)
  // Signing in again changes nothing: no new upload for an unchanged key.
  assert.equal(keyring.grant('giulia', 'password', admin.password), false)
})

test('password changes, recovery and disabling keep the slots in step with the accounts', () => {
  const { keyring, auth } = setup()
  auth.create(admin)
  const marco = auth.create({ username: 'marco', name: 'Marco', password: 'motdepasse-2', role: 'user' })
  assert.ok(marco.ok)
  assert.equal(opens(keyring, 'marco', 'password', 'motdepasse-2'), true)

  assert.ok(auth.changePassword('marco', 'nouveau-mdp-3').ok)
  assert.equal(opens(keyring, 'marco', 'password', 'motdepasse-2'), false)
  assert.equal(opens(keyring, 'marco', 'password', 'nouveau-mdp-3'), true)

  const recovered = auth.recover('marco', marco.recoveryCode!, 'encore-un-4')
  assert.ok(recovered.ok)
  assert.equal(opens(keyring, 'marco', 'recovery', marco.recoveryCode!), false)
  assert.equal(opens(keyring, 'marco', 'recovery', recovered.recoveryCode!), true)
  assert.equal(opens(keyring, 'marco', 'password', 'encore-un-4'), true)

  auth.logout()
  assert.ok(auth.login('giulia', admin.password).ok)
  assert.ok(auth.setActive('marco', false).ok)
  assert.equal(keyring.slots().some((slot) => slot.username === 'marco'), false)
  assert.equal(opens(keyring, 'giulia', 'password', admin.password), true)
})
