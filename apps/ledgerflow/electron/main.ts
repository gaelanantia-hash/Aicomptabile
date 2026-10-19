import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname, release } from 'node:os'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import electronUpdater from 'electron-updater'
import type { Account, DesktopState, Snapshot, SyncState, UpdateState } from '../src/desktopApi.ts'
import { createAuth, type Auth } from './auth.ts'
import { createAutoBackup } from './backup.ts'
import { loadConfig } from './config.ts'
import { openDatabase, type Database } from './database.ts'
import { createDrive } from './drive.ts'
import { createLicenseClient } from './license.ts'
import { isMeteredConnection } from './network.ts'
import { AuthRevokedError, buildAuthUrl, createPkce, exchangeCode, listenForRedirect, readAccount, refreshTokens, revokeToken, type Tokens } from './oauth.ts'
import { createSync, type Sync } from './sync.ts'
import { createVault } from './tokens.ts'

const devMode = !app.isPackaged
const devUrl = process.env.AICOM_DEV_URL
if (process.env.AICOM_USER_DATA) app.setPath('userData', process.env.AICOM_USER_DATA)

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const userData = app.getPath('userData')
const appRoot = app.getAppPath()
const webRoot = join(appRoot, 'dist')
// Environment overrides are for development and tests only: in an installed build they would let anyone change the licence settings.
const config = loadConfig(join(appRoot, 'desktop.config.json'), devMode ? process.env : {})
const contentSecurityPolicy = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:", "img-src 'self' data: blob:", "connect-src 'self'", "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'none'",
].join('; ')

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? { ...fallback, ...JSON.parse(readFileSync(file, 'utf8')) as T } : fallback
  } catch {
    return fallback
  }
}

mkdirSync(userData, { recursive: true })
const deviceFile = join(userData, 'device.json')
const device = readJson(deviceFile, { id: '', name: hostname() })
if (!device.id) {
  device.id = randomUUID()
  writeFileSync(deviceFile, JSON.stringify(device))
}
const settingsFile = join(userData, 'settings.json')
const settings = readJson(settingsFile, { errorReports: false, localOnly: false, googleClientId: '', googleClientSecret: '' })
const saveSettings = () => writeFileSync(settingsFile, JSON.stringify(settings))

const vault = createVault(join(userData, 'auth.bin'), {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data),
})
const license = createLicenseClient({ serverUrl: config.licenseServerUrl, publicKey: config.licensePublicKey, device, appVersion: app.getVersion(), file: join(userData, 'license.json'), devMode, trialUntil: config.trialUntil, clockFile: join(userData, 'clock.json') })
// Working without a Google account (data on this PC only) is offered to developers and to trial builds, never to licensed installs.
const localAllowed = () => devMode || license.state().trial === true
// The installer carries the OAuth client in desktop.config.json. When run from the project folder without one, it can be typed into Settings instead.
const oauthClient = () => config.googleClientId
  ? { clientId: config.googleClientId, clientSecret: config.googleClientSecret || undefined }
  : { clientId: settings.googleClientId, clientSecret: settings.googleClientSecret || undefined }

let window: BrowserWindow | undefined
let session: { account?: Account; db: Database; sync?: Sync; auth: Auth } | undefined
let tokens: Tokens | undefined
let pendingSignIn: Awaited<ReturnType<typeof listenForRedirect>> | undefined
let update: UpdateState = { status: 'idle' }
let heartbeat: NodeJS.Timeout | undefined
let quitting = false

const send = (channel: string, payload?: unknown) => window?.webContents.send(`aicom:${channel}`, payload)

async function accessToken(refresh = false) {
  if (!refresh && tokens && tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken
  const stored = vault.load()
  if (!stored) throw new AuthRevokedError()
  tokens = await refreshTokens(config.endpoints, oauthClient(), stored.refreshToken)
  return tokens.accessToken
}

function closeSession() {
  clearInterval(heartbeat)
  session?.sync?.stop()
  session?.db.close()
  session = undefined
}

function openSession(account?: Account) {
  closeSession()
  // One local database per Google account, so switching account never mixes two companies' data.
  const db = openDatabase(join(userData, `data-${account?.sub ?? 'local'}.sqlite`))
  const sync = account && createSync({
    db, device, backupDir: join(userData, 'backups'),
    drive: createDrive(config.endpoints, accessToken),
    onState: (state) => send('sync', state),
    onReplaced: () => send('data-replaced'),
  })
  // Signing in or out, and every account change, adds a line to the access history, which must then reach Drive.
  session = { account, db, sync, auth: createAuth(db, device, () => sync?.markDirty()) }
  if (sync) heartbeat = setInterval(() => { void sync.run() }, 60_000)
  else {
    // Without Drive there is no revision history: a dated copy a day, the last 30 kept, guards against a damaged or mistaken database.
    const autoBackup = createAutoBackup({ dir: join(userData, 'backups', 'auto'), exportData: () => db.exportData(device.name), isEmpty: () => db.isEmpty() })
    const backup = () => {
      try {
        autoBackup.run()
      } catch (error) {
        void reportError(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack ?? '' : '', 'backup')
      }
    }
    backup()
    heartbeat = setInterval(backup, 3_600_000)
  }
}

function currentState(): DesktopState {
  return {
    version: app.getVersion(), devMode, googleConfigured: Boolean(oauthClient().clientId), licenseConfigured: license.configured(), device: device.name,
    license: license.state(), account: session?.account, localOnly: Boolean(session && !session.account),
    sync: session?.sync?.state() ?? { status: 'disconnected' }, hasData: session ? !session.db.isEmpty() : false, errorReports: settings.errorReports, update,
    auth: { hasUsers: session?.auth.hasUsers() ?? false, user: session?.auth.current() },
  }
}

async function connectGoogle(): Promise<DesktopState> {
  if (!oauthClient().clientId) throw new Error('Google sign-in is not configured in this build.')
  pendingSignIn?.close()
  const listener = pendingSignIn = await listenForRedirect()
  try {
    const pkce = createPkce()
    const state = randomUUID()
    await shell.openExternal(buildAuthUrl(config.endpoints, oauthClient(), listener.redirectUri, pkce.challenge, state))
    const code = await listener.waitForCode(state)
    const issued = await exchangeCode(config.endpoints, oauthClient(), code, pkce.verifier, listener.redirectUri)
    if (!issued.refreshToken || !issued.idToken) throw new Error('Google did not grant offline access. Try again and accept the requested permissions.')
    const account = readAccount(issued.idToken)
    // Work done in local mode before any account was connected moves to the account, unless the account already has data.
    const localData = session && !session.account && !session.db.isEmpty() ? session.db.exportData(device.name) : undefined
    tokens = issued
    vault.save({ refreshToken: issued.refreshToken, account })
    settings.localOnly = false
    saveSettings()
    openSession(account)
    await session!.sync!.run()
    if (localData && session!.db.isEmpty()) {
      session!.db.importData(localData)
      session!.sync!.markDirty()
      await session!.sync!.run()
    }
    window?.focus()
    return currentState()
  } finally {
    listener.close()
    if (pendingSignIn === listener) pendingSignIn = undefined
  }
}

async function disconnectGoogle(): Promise<DesktopState> {
  const stored = vault.load()
  await session?.sync?.release()
  if (stored) await revokeToken(config.endpoints, stored.refreshToken).catch(() => undefined)
  vault.clear()
  tokens = undefined
  // The local database stays on disk: reconnecting the same account finds every record again.
  closeSession()
  return currentState()
}

function scrub(text: string) {
  return text.split(homedir()).join('~').slice(0, 4000)
}

// Technical details only, and only with the customer's consent. Accounting data never leave the PC through this path.
async function reportError(message: string, stack: string, origin: string) {
  if (!settings.errorReports || !config.licenseServerUrl) return
  await fetch(`${config.licenseServerUrl}/v1/errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appVersion: app.getVersion(), platform: process.platform, osVersion: release(), origin, message: scrub(message), stack: scrub(stack) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}

async function checkUpdate(): Promise<UpdateState> {
  if (config.licenseServerUrl) {
    try {
      const query = new URLSearchParams({ platform: process.platform, current: app.getVersion() })
      const latest = await (await fetch(`${config.licenseServerUrl}/v1/updates/latest?${query}`, { signal: AbortSignal.timeout(10_000) })).json() as { updateAvailable?: boolean; version?: string; notes?: string; url?: string }
      if (latest.updateAvailable && update.status === 'idle') update = { status: 'available', version: latest.version, notes: latest.notes, url: latest.url }
      else if (latest.updateAvailable) update = { ...update, notes: latest.notes, url: latest.url }
    } catch {
      // Offline or service unreachable: try again at the next start.
    }
  }
  if (app.isPackaged && config.updateFeedUrl) await electronUpdater.autoUpdater.checkForUpdates().catch(() => undefined)
  send('update', update)
  return update
}

function setupUpdater() {
  if (!app.isPackaged || !config.updateFeedUrl) return
  const { autoUpdater } = electronUpdater
  autoUpdater.setFeedURL({ provider: 'generic', url: config.updateFeedUrl })
  // Downloads are started here, not by the updater: on a metered connection (phone hotspot, data plan) the customer decides.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  const publish = (next: UpdateState) => {
    update = { ...update, ...next }
    send('update', update)
  }
  autoUpdater.on('update-available', (info) => {
    if (update.status === 'downloading' || update.status === 'ready') return
    const size = info.files.reduce((total, file) => total + (file.size ?? 0), 0) || undefined
    void isMeteredConnection().then((metered) => {
      if (metered) return publish({ status: 'available', version: info.version, metered: true, size })
      publish({ status: 'downloading', version: info.version, metered: false })
      autoUpdater.downloadUpdate().catch(() => undefined)
    })
  })
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version }))
  autoUpdater.on('error', () => publish({ status: update.status === 'downloading' ? 'error' : update.status }))
}

function requireSession() {
  if (!session) throw new Error('No data space is open.')
  return session
}

/** Company data are only handed out once someone has signed in to the application (or before the first account exists). */
function requireSignedIn() {
  const open = requireSession()
  if (open.auth.hasUsers() && !open.auth.current()) throw new Error('Sign in to AICOM first.')
  return open
}

const handlers: Record<string, (...args: never[]) => unknown> = {
  getState: () => currentState(),
  activateLicense: (code: string) => license.activate(String(code)),
  deactivateLicense: async () => {
    await license.deactivate()
    send('license', license.state())
    return currentState()
  },
  connectGoogle,
  cancelConnect: () => pendingSignIn?.cancel(),
  disconnectGoogle,
  useLocalOnly: () => {
    if (!localAllowed()) throw new Error('Local-only mode is available in development and trial builds only.')
    settings.localOnly = true
    saveSettings()
    openSession()
    return currentState()
  },
  loadData: () => session && !session.db.isEmpty() && (!session.auth.hasUsers() || session.auth.current()) ? session.db.load() : null,
  saveData: (snapshot: Snapshot, reason: string) => {
    const { db, account, sync, auth } = requireSignedIn()
    if (db.save(snapshot, { user: auth.current()?.username ?? account?.email ?? 'local', device: device.name }, String(reason ?? ''))) sync?.markDirty()
  },
  syncNow: () => session?.sync?.run() ?? { status: 'disconnected' } satisfies SyncState,
  resolveConflict: (keep: 'local' | 'remote') => requireSession().sync?.resolveConflict(keep === 'remote' ? 'remote' : 'local'),
  takeOverLock: () => requireSession().sync?.takeOverLock(),
  listAudit: (limit: number, offset: number) => requireSignedIn().db.listAudit(Number(limit) || 50, Number(offset) || 0),
  listRevisions: async () => {
    const { db } = requireSignedIn()
    const fileId = db.getSetting('fileId')
    return fileId ? createDrive(config.endpoints, accessToken).listRevisions(fileId) : []
  },
  restoreRevision: async (id: string) => { await requireSignedIn().sync?.restoreRevision(String(id)) },
  exportBackup: async () => {
    const { db } = requireSignedIn()
    const result = await dialog.showSaveDialog(window!, { defaultPath: `aicom-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'AICOM', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, JSON.stringify(db.exportData(device.name)))
    return result.filePath
  },
  importBackup: async () => {
    const { db, sync } = requireSignedIn()
    const result = await dialog.showOpenDialog(window!, { defaultPath: join(userData, 'backups'), properties: ['openFile'], filters: [{ name: 'AICOM', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return false
    sync?.backupLocal('before-import')
    db.importData(JSON.parse(readFileSync(result.filePaths[0], 'utf8')))
    sync?.markDirty()
    send('data-replaced')
    return true
  },
  storageQuota: () => session?.account ? createDrive(config.endpoints, accessToken).quota().catch(() => null) : null,
  savePdf: async (name: string) => {
    const result = await dialog.showSaveDialog(window!, { defaultPath: `${String(name).replace(/[^\w.-]+/g, '-')}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, await window!.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }))
    return result.filePath
  },
  setGoogleClient: (clientId: string, clientSecret: string) => {
    if (!devMode) throw new Error('The Google client is fixed in installed builds.')
    settings.googleClientId = String(clientId ?? '').trim()
    settings.googleClientSecret = String(clientSecret ?? '').trim()
    saveSettings()
    return currentState()
  },
  login: (username: string, password: string) => requireSession().auth.login(String(username), String(password)),
  logout: () => {
    session?.auth.logout()
    return currentState()
  },
  createUser: (user: { username: string; name: string; password: string; role: 'admin' | 'user' }) => requireSession().auth.create(user ?? {}),
  listUsers: () => requireSession().auth.list(),
  setUserActive: (username: string, active: boolean) => requireSession().auth.setActive(String(username), Boolean(active)),
  changePassword: (username: string, password: string) => requireSession().auth.changePassword(String(username), String(password)),
  recoverPassword: (username: string, code: string, password: string) => requireSession().auth.recover(String(username), String(code), String(password)),
  listAccess: (limit: number, offset: number) => {
    const { db } = requireSignedIn()
    return { ...db.listAccess(Number(limit) || 50, Number(offset) || 0), intact: db.verifyAccess() }
  },
  backupNow: () => {
    const { db } = requireSignedIn()
    const folder = join(userData, 'backups')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, `manual-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify(db.exportData(device.name)))
    return file
  },
  setErrorReports: (enabled: boolean) => {
    settings.errorReports = Boolean(enabled)
    saveSettings()
  },
  reportError: (message: string, stack: string) => reportError(String(message), String(stack ?? ''), 'interface'),
  checkUpdate,
  installUpdate: () => {
    if (update.status === 'ready') electronUpdater.autoUpdater.quitAndInstall()
  },
  /** The customer accepts the download that a metered connection had put on hold. */
  downloadUpdate: () => {
    if (update.status !== 'available' || !update.metered) return
    update = { ...update, status: 'downloading' }
    send('update', update)
    electronUpdater.autoUpdater.downloadUpdate().catch(() => undefined)
  },
  openExternal: async (url: string) => {
    if (/^https:\/\//.test(String(url))) await shell.openExternal(url)
  },
  quit: () => app.quit(),
}

function createWindow() {
  window = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640, show: false, backgroundColor: '#f5f7f4', title: 'AICOM', autoHideMenuBar: true,
    icon: join(webRoot, 'aicom-icon.png'),
    webPreferences: { preload: join(appRoot, 'electron', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  const home = devUrl ?? 'app://aicom/'
  // The window only ever shows the app itself; any other link opens in the customer's browser.
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(home)) event.preventDefault() })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = undefined })
  void window.loadURL(home)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })

  process.on('uncaughtException', (error) => { void reportError(error.message, error.stack ?? '', 'main') })
  process.on('unhandledRejection', (error) => { void reportError(String(error instanceof Error ? error.message : error), error instanceof Error ? error.stack ?? '' : '', 'main') })

  void app.whenReady().then(() => {
    if (!devMode) Menu.setApplicationMenu(null)
    protocol.handle('app', async (request) => {
      const target = normalize(join(webRoot, decodeURIComponent(new URL(request.url).pathname)))
      const file = target.startsWith(webRoot + sep) && existsSync(target) && statSync(target).isFile() ? target : join(webRoot, 'index.html')
      const response = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', contentSecurityPolicy)
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, headers })
    })

    for (const [name, handler] of Object.entries(handlers)) {
      ipcMain.handle(`aicom:${name}`, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        if (event.sender !== window?.webContents) throw new Error('Unexpected caller.')
        return (handler as (...values: unknown[]) => unknown)(...args)
      })
    }

    const stored = vault.load()
    if (stored) openSession(stored.account)
    else if (localAllowed() && settings.localOnly) openSession()

    setupUpdater()
    createWindow()
    void session?.sync?.run()
    void license.check().then((state) => send('license', state))
    setInterval(() => { void license.check().then((state) => send('license', state)) }, 12 * 60 * 60_000)
    setTimeout(() => { void checkUpdate() }, 8000)
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    // Closing the app ends the session: it goes into the access history like an explicit sign-out.
    if (!quitting) session?.auth.logout()
    if (quitting || !session?.sync) return
    // Upload pending edits and free the "open on this PC" marker on Drive before leaving, capped so quitting never hangs offline.
    event.preventDefault()
    quitting = true
    void Promise.race([session.sync.release(), new Promise((resolve) => setTimeout(resolve, 8000))]).finally(() => {
      closeSession()
      app.quit()
    })
  })
}
