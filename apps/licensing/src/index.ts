import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp, type Release } from './app.ts'
import { createFileStore, type Store } from './store.ts'
import { loadPrivateKey } from './token.ts'

if (!process.env.LICENSE_PRIVATE_KEY) throw new Error('LICENSE_PRIVATE_KEY is required (create one with: npm run admin -- keygen).')

async function createStore(): Promise<Store> {
  if (process.env.STORE === 'firestore') return (await import('./firestoreStore.ts')).createFirestoreStore(process.env.FIRESTORE_COLLECTION)
  if (process.env.NODE_ENV === 'production') throw new Error('Set STORE=firestore in production: the file store does not survive a Cloud Run restart.')
  return createFileStore(process.env.LICENSE_FILE || join(process.cwd(), 'data', 'licenses.json'))
}

const releasesFile = join(process.cwd(), 'releases.json')
const releases = existsSync(releasesFile) ? JSON.parse(readFileSync(releasesFile, 'utf8')) as Record<string, Release> : {}

const app = createApp({
  store: await createStore(),
  privateKey: loadPrivateKey(process.env.LICENSE_PRIVATE_KEY),
  adminToken: process.env.ADMIN_TOKEN,
  releases,
  graceDays: Number(process.env.GRACE_DAYS || 14),
})

const port = Number(process.env.PORT || 8090)
app.listen(port, '0.0.0.0', () => console.info(JSON.stringify({ severity: 'INFO', message: `AICOM licensing service listening on ${port}` })))
