// Contract between the desktop shell (Electron main process) and the interface. Types only, plus the bridge lookup.

export type Account = { sub: string; email: string }
/** `unlock`: the Drive copy is encrypted and this PC does not hold the key yet; signing in opens it. */
export type SyncStatus = 'disconnected' | 'synced' | 'pending' | 'syncing' | 'offline' | 'conflict' | 'locked' | 'reauth' | 'unlock' | 'error'
export type SyncState = { status: SyncStatus; lastSyncAt?: string; detail?: string; lockedBy?: string }
export type LicenseReason = 'missing' | 'invalid' | 'expired' | 'revoked' | 'device_limit' | 'grace_expired' | 'unreachable'
export type LicenseState = { valid: boolean; customer?: string; expires?: string | null; validUntil?: string; reason?: LicenseReason; dev?: boolean; trial?: boolean }
/** `metered`: the download waits for the customer because the connection is paid by volume; `size` is the most it will transfer, in bytes. */
export type UpdateState = { status: 'idle' | 'available' | 'downloading' | 'ready' | 'error'; version?: string; notes?: string; url?: string; metered?: boolean; size?: number }

export type AccessEvent = 'login' | 'login_failed' | 'logout' | 'user_created' | 'password_changed' | 'password_recovered' | 'user_disabled' | 'user_enabled'
/** One line of the access history: who, on which PC, what, and when (ISO date and time). */
export type AccessRow = { device: string; seq: number; at: string; user: string; deviceName: string; event: AccessEvent; hash: string }
export type AppUser = { username: string; name: string; role: 'admin' | 'user'; active: boolean; createdAt: string }
/** `no_key`: on a new PC, this account cannot open the encrypted Drive copy yet; an account already used since the update must sign in first. */
export type AuthFailure = 'invalid' | 'locked' | 'forbidden' | 'exists' | 'weak' | 'no_key'
export type AuthResult = { ok: true; user: AppUser; recoveryCode?: string } | { ok: false; reason: AuthFailure; waitSeconds?: number }

export type DesktopState = {
  /** Sign-in to the application itself. `hasUsers` is false until the first account is created. */
  auth: { hasUsers: boolean; user?: AppUser }
  version: string
  devMode: boolean
  googleConfigured: boolean
  licenseConfigured: boolean
  device: string
  license: LicenseState
  account?: Account
  localOnly: boolean
  sync: SyncState
  hasData: boolean
  errorReports: boolean
  update: UpdateState
}

/** Every record of the company, grouped by collection then by record id. */
export type Snapshot = Record<string, Record<string, unknown>>
export type AuditRow = { id: number; at: string; user: string; device: string; collection: string; recordId: string; action: 'create' | 'update' | 'delete'; reason: string; before: unknown; after: unknown }
export type Revision = { id: string; modifiedTime: string; size?: string }

export type DesktopApi = {
  getState(): Promise<DesktopState>
  activateLicense(code: string): Promise<LicenseState>
  deactivateLicense(): Promise<DesktopState>
  connectGoogle(): Promise<DesktopState>
  cancelConnect(): Promise<void>
  disconnectGoogle(): Promise<DesktopState>
  useLocalOnly(): Promise<DesktopState>
  loadData(): Promise<Snapshot | null>
  saveData(snapshot: Snapshot, reason: string): Promise<void>
  syncNow(): Promise<SyncState>
  resolveConflict(keep: 'local' | 'remote'): Promise<SyncState>
  takeOverLock(): Promise<SyncState>
  listAudit(limit: number, offset: number): Promise<{ rows: AuditRow[]; total: number }>
  listRevisions(): Promise<Revision[]>
  restoreRevision(id: string): Promise<void>
  exportBackup(): Promise<string | null>
  importBackup(): Promise<boolean>
  storageQuota(): Promise<{ limit?: number; usage?: number } | null>
  savePdf(name: string): Promise<string | null>
  setErrorReports(enabled: boolean): Promise<void>
  reportError(message: string, stack: string): Promise<void>
  checkUpdate(): Promise<UpdateState>
  installUpdate(): Promise<void>
  downloadUpdate(): Promise<void>
  openExternal(url: string): Promise<void>
  quit(): Promise<void>
  /** Development builds only: sets the OAuth desktop client when no desktop.config.json provides it. */
  setGoogleClient(clientId: string, clientSecret: string): Promise<DesktopState>
  /** Writes a copy of the current data to the local backups folder and returns its path. */
  backupNow(): Promise<string>
  login(username: string, password: string): Promise<AuthResult>
  logout(): Promise<DesktopState>
  /** Creates the first account without being signed in; afterwards only an administrator can add accounts. */
  createUser(user: { username: string; name: string; password: string; role: 'admin' | 'user' }): Promise<AuthResult>
  listUsers(): Promise<AppUser[]>
  setUserActive(username: string, active: boolean): Promise<AuthResult>
  /** An administrator can set anyone's password; other users only their own. */
  changePassword(username: string, password: string): Promise<AuthResult>
  /** Sets a new password with the recovery code shown when the account was created; returns a fresh code. */
  recoverPassword(username: string, recoveryCode: string, password: string): Promise<AuthResult>
  listAccess(limit: number, offset: number): Promise<{ rows: AccessRow[]; total: number; intact: boolean }>
  onSync(listener: (state: SyncState) => void): () => void
  onDataReplaced(listener: () => void): () => void
  onLicense(listener: (state: LicenseState) => void): () => void
  onUpdate(listener: (state: UpdateState) => void): () => void
}

/** Present only when the interface runs inside the installed desktop app. */
export const desktop = (globalThis as { aicom?: DesktopApi }).aicom
