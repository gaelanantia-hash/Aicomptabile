// Administration from the command line. Talks to the running service with ADMIN_TOKEN; never touches the database directly.
//   npm run admin -- keygen
//   npm run admin -- create "Maison Lumière SAS" --devices 2 --expires 2027-12-31
//   npm run admin -- create "Maison Lumière SAS" --devices 2 --emails anne@gmail.com,paul@gmail.com
//   npm run admin -- emails <id> --add marie@gmail.com --remove paul@gmail.com
//   npm run admin -- list
//   npm run admin -- revoke <id>
//   npm run admin -- reset-devices <id>
//   npm run admin -- delete <id>          (erases the record: deletion requests)
import { randomBytes } from 'node:crypto'
import { generateKeys } from './token.ts'

const [command, ...rest] = process.argv.slice(2)
const option = (name: string) => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}

async function call(method: string, path: string, body?: unknown) {
  const base = (process.env.LICENSE_SERVER_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '')
  if (!process.env.ADMIN_TOKEN) throw new Error('Set ADMIN_TOKEN (and LICENSE_SERVER_URL for a deployed service).')
  const response = await fetch(`${base}/v1/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`)
  return payload
}

switch (command) {
  case 'keygen': {
    const keys = generateKeys()
    console.log('Service secrets (store in Secret Manager, never in the app or the repository):')
    console.log(`  LICENSE_PRIVATE_KEY=${keys.privateKey}`)
    console.log(`  ADMIN_TOKEN=${randomBytes(32).toString('base64url')}`)
    console.log('\nPublic key (goes in the app\'s desktop.config.json as licensePublicKey):')
    console.log(`  ${keys.publicKey}`)
    break
  }
  case 'create':
    console.log(await call('POST', '/licenses', { customer: rest[0], maxDevices: Number(option('devices') ?? 1), expires: option('expires'), emails: option('emails') }))
    break
  case 'emails':
    console.log(await call('POST', `/licenses/${await resolveId(rest[0])}/emails`, { add: option('add') ?? '', remove: option('remove') ?? '' }))
    break
  case 'list':
    console.table(((await call('GET', '/licenses')) as { licenses: { id: string; customer: string; maxDevices: number; expires: string | null; revoked: boolean; activations: unknown[]; emails?: string[] }[] }).licenses
      .map((license) => ({ id: license.id.slice(0, 12), customer: license.customer, emails: (license.emails ?? []).join(', ') || '—', devices: `${license.activations.length}/${license.maxDevices}`, expires: license.expires ?? '—', revoked: license.revoked })))
    break
  case 'revoke':
  case 'reset-devices':
    console.log(await call('POST', `/licenses/${await resolveId(rest[0])}/${command}`))
    break
  case 'delete':
    console.log(await call('DELETE', `/licenses/${await resolveId(rest[0])}`))
    break
  default:
    console.log('Commands: keygen | create <customer> [--devices N] [--expires YYYY-MM-DD] [--emails a@x,b@y] | emails <id> [--add a@x,b@y] [--remove c@z] | list | revoke <id> | reset-devices <id> | delete <id>')
}

/** Accepts the short id shown by `list` as well as the full one. */
async function resolveId(prefix: string) {
  const { licenses } = await call('GET', '/licenses') as { licenses: { id: string }[] }
  const matches = licenses.filter((license) => license.id.startsWith(prefix ?? ' '))
  if (matches.length !== 1) throw new Error(`Expected exactly one licence matching "${prefix}", found ${matches.length}.`)
  return matches[0].id
}
