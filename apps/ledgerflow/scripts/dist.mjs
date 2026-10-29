// Builds the Windows packages with electron-builder (run by `npm run dist` and `npm run dist:store` after the build).
//
// `npm run dist`: the installer (.exe) customers download. Signing, when its settings are in the environment (otherwise unsigned):
//   - Azure Trusted Signing: AZURE_SIGNING_ENDPOINT, AZURE_SIGNING_ACCOUNT, AZURE_SIGNING_PROFILE and AZURE_SIGNING_PUBLISHER
//     (the company name exactly as on the certificate), plus AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET to sign in;
//   - a certificate file: CSC_LINK (.pfx path or base64) and CSC_KEY_PASSWORD, read by electron-builder itself.
//
// `npm run dist:store` (--store): the package (.appx) uploaded to the Microsoft Store, which signs it. The identity comes from
// Partner Center (Product identity page): STORE_IDENTITY_NAME, STORE_PUBLISHER (CN=…) and STORE_PUBLISHER_NAME. Without them the
// package carries a test identity Windows accepts unsigned (Add-AppxPackage -AllowUnsigned), to try it on this PC.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const env = { ...process.env }
const store = process.argv.includes('--store')
const args = ['--win', ...(store ? ['appx'] : []), '--publish', 'never']

if (store) {
  // The Store signs what it publishes: a package signed here would be refused.
  for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'AZURE_SIGNING_ENDPOINT']) delete env[name]
  const identity = ['STORE_IDENTITY_NAME', 'STORE_PUBLISHER', 'STORE_PUBLISHER_NAME']
  const given = identity.filter((name) => env[name])
  if (given.length && given.length < identity.length) {
    console.error(`The Store package needs all of ${identity.join(', ')}; missing: ${identity.filter((name) => !env[name]).join(', ')}.`)
    process.exit(1)
  }
  // Microsoft's marker for packages that may be installed unsigned, for testing only; the Store refuses them.
  const test = { STORE_IDENTITY_NAME: 'AICOM.Test', STORE_PUBLISHER: 'CN=AICOM Test, OID.2.25.311729368913984317654407730594956997722=1', STORE_PUBLISHER_NAME: 'AICOM (test)' }
  const value = (name) => env[name] || test[name]
  args.push(
    `-c.appx.identityName=${value('STORE_IDENTITY_NAME')}`,
    `-c.appx.publisher=${value('STORE_PUBLISHER')}`,
    `-c.appx.publisherDisplayName=${value('STORE_PUBLISHER_NAME')}`,
  )
  console.log(given.length ? `Store package for "${env.STORE_PUBLISHER_NAME}".` : 'No Store identity: test package, to install with Add-AppxPackage -AllowUnsigned (see docs/06-rilascio.md).')
} else {
  const azure = ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'AZURE_SIGNING_PUBLISHER']
  const set = azure.filter((name) => env[name])
  if (set.length && set.length < azure.length) {
    console.error(`Azure signing needs all of ${azure.join(', ')}; missing: ${azure.filter((name) => !env[name]).join(', ')}.`)
    process.exit(1)
  }
  if (set.length) {
    // Two signing methods at once would be ambiguous: Azure wins.
    delete env.CSC_LINK
    delete env.CSC_KEY_PASSWORD
    args.push(
      `-c.win.azureSignOptions.endpoint=${env.AZURE_SIGNING_ENDPOINT}`,
      `-c.win.azureSignOptions.codeSigningAccountName=${env.AZURE_SIGNING_ACCOUNT}`,
      `-c.win.azureSignOptions.certificateProfileName=${env.AZURE_SIGNING_PROFILE}`,
      `-c.win.azureSignOptions.publisherName=${env.AZURE_SIGNING_PUBLISHER}`,
    )
    console.log(`Signing with Azure Trusted Signing as "${env.AZURE_SIGNING_PUBLISHER}".`)
  } else if (!env.CSC_LINK) {
    console.log('No signing settings: the installer will be unsigned (see docs/06-rilascio.md, T59).')
  }
}

// Started with Node directly, not through a shell, so a publisher name with spaces stays one argument.
const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js')
const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 1))
