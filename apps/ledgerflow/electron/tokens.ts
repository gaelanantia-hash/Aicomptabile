import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Account } from '../src/desktopApi.ts'

/** OS-backed encryption: DPAPI on Windows, Keychain on macOS (Electron safeStorage). */
export type Cipher = { available(): boolean; encrypt(text: string): Buffer; decrypt(data: Buffer): string }
export type StoredAuth = { refreshToken: string; account: Account }

// The refresh token is only ever written encrypted. Without OS encryption it stays in memory and the customer signs in again at next start.
export function createVault(file: string, cipher: Cipher) {
  let memory: StoredAuth | null = null
  return {
    load(): StoredAuth | null {
      if (memory) return memory
      if (!cipher.available() || !existsSync(file)) return null
      try {
        memory = JSON.parse(cipher.decrypt(readFileSync(file))) as StoredAuth
      } catch {
        memory = null
      }
      return memory
    },
    save(auth: StoredAuth) {
      memory = auth
      if (!cipher.available()) return
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, cipher.encrypt(JSON.stringify(auth)), { mode: 0o600 })
    },
    clear() {
      memory = null
      rmSync(file, { force: true })
    },
  }
}
