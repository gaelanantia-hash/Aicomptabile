import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** `renewalHash`: a PC activated through its Google account renews with a secret of its own, never with the licence code. */
export type DeviceActivation = { deviceId: string; deviceName: string; appVersion: string; activatedAt: string; lastSeenAt: string; email?: string; renewalHash?: string }
/** `emails`: Google accounts that activate the licence by signing in, without ever seeing its code. `revokedAt` dates the revocation, for the retention rule. */
export type License = { id: string; customer: string; maxDevices: number; expires: string | null; revoked: boolean; revokedAt?: string; createdAt: string; activations: DeviceActivation[]; emails?: string[] }

/** Licence records only. No customer accounting data ever reaches this service. */
export type Store = {
  get(id: string): Promise<License | undefined>
  create(license: License): Promise<void>
  /** Applies `change` atomically; returning undefined leaves the record untouched. */
  update(id: string, change: (license: License) => License | undefined): Promise<License | undefined>
  list(): Promise<License[]>
  /** The licence a Google account belongs to (an address is on one licence at most). */
  findByEmail(email: string): Promise<License | undefined>
  /** Erases the record for good (data-subject deletion requests). */
  remove(id: string): Promise<boolean>
}

export function createMemoryStore(initial: License[] = [], onChange?: (licenses: License[]) => void): Store {
  const licenses = new Map(initial.map((license) => [license.id, license]))
  const changed = () => onChange?.([...licenses.values()])
  return {
    get: async (id) => structuredClone(licenses.get(id)),
    create: async (license) => {
      licenses.set(license.id, structuredClone(license))
      changed()
    },
    update: async (id, change) => {
      const current = licenses.get(id)
      const next = current && change(structuredClone(current))
      if (!next) return undefined
      licenses.set(id, next)
      changed()
      return structuredClone(next)
    },
    list: async () => structuredClone([...licenses.values()]),
    findByEmail: async (email) => structuredClone([...licenses.values()].find((license) => license.emails?.includes(email))),
    remove: async (id) => {
      const removed = licenses.delete(id)
      if (removed) changed()
      return removed
    },
  }
}

/** JSON file on disk, for local development and single-machine use. Production on Cloud Run uses Firestore. */
export function createFileStore(file: string): Store {
  const initial = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as License[] : []
  return createMemoryStore(initial, (licenses) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(licenses, null, 2))
    renameSync(`${file}.tmp`, file)
  })
}
