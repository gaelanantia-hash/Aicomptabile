import { lazy, Suspense, useCallback, useEffect, useRef, useState, type Dispatch, type InputHTMLAttributes, type ReactNode, type SetStateAction } from 'react'
import {
  ArrowDownLeft, BookOpen, Eye, EyeOff, Building2, ChartColumn, Check, ChevronDown, CircleHelp, ClipboardCheck, Cloud, CloudOff, FileInput, FileSearch, FileSpreadsheet, HardDrive,
  KeyRound, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut, MonitorSmartphone, RefreshCw, Settings, ShieldCheck, ShoppingCart, Store as StoreIcon,
  Trash2, TriangleAlert, UserRound, Wallet, X,
} from 'lucide-react'
import type { AccessEvent, AccessRow, AppUser, AuditRow, AuthResult, DesktopApi, DesktopState, LicenseReason, Revision, SyncState } from './desktopApi'
import type { FinanceSection } from './FinanceSections'
import { exportWorkbook } from './sageExport'
import { countries, createEmptyStore, createStore, setupFor, vatRatesOf, type ModuleId, type Store } from './sageData'
import { fromSnapshot, toSnapshot } from './sageSnapshot'
import logo from './assets/aicom-logo.webp'
import logoMark from './assets/aicom-mark.webp'
import { downloadXlsx } from './xlsx'
import './App.css'
import './CloudAccess.css'
import './DesktopApp.css'

// The working screens load after the splash and sign-in, which then appear sooner; preloadScreens fetches them in the background.
const loadSageModules = () => import('./SageModules')
const loadFinanceSections = () => import('./FinanceSections')
const SageModules = lazy(() => loadSageModules().then((module) => ({ default: module.SageModules })))
const FinanceView = lazy(() => loadFinanceSections().then((module) => ({ default: module.FinanceView })))
const preloadScreens = () => Promise.all([loadSageModules(), loadFinanceSections()]).catch(() => undefined)

type Locale = 'en' | 'fr'
type Translate = (fr: string, en: string) => string
type Section = FinanceSection | ModuleId | 'audit'

const workspace = [
  { id: 'overview', icon: LayoutDashboard, fr: 'Vue d’ensemble', en: 'Overview', frText: 'Les chiffres clés et ce qui reste à traiter, calculés sur vos écritures.', enText: 'Key figures and what is left to do, computed from your entries.' },
  { id: 'invoices', icon: FileInput, fr: 'Factures fournisseurs', en: 'Supplier invoices', frText: 'Vérifiez les factures reçues avant de les comptabiliser.', enText: 'Check received invoices before posting them.' },
  { id: 'bank', icon: ArrowDownLeft, fr: 'Rapprochement bancaire', en: 'Bank matching', frText: 'Rapprochez le relevé bancaire avec les factures ouvertes.', enText: 'Match the bank statement to open invoices.' },
  { id: 'close', icon: ClipboardCheck, fr: 'Clôture mensuelle', en: 'Month-end close', frText: 'Suivez les contrôles de fin de période, puis verrouillez-la.', enText: 'Track end-of-period checks, then lock the period.' },
  { id: 'forecast', icon: Wallet, fr: 'Prévision de trésorerie', en: 'Cash forecast', frText: 'Anticipez vos entrées et sorties de trésorerie sur 13 semaines.', enText: 'Plan cash inflows and outflows over 13 weeks.' },
  { id: 'analysis', icon: ChartColumn, fr: 'Analyse des articles', en: 'Item analysis', frText: 'Comparez ce qui a été enregistré, ce qui a été vendu et ce qui reste.', enText: 'Compare what was registered, what was sold and what remains.' },
  { id: 'data', icon: FileSearch, fr: 'Qualité des données', en: 'Data quality', frText: 'Repérez les fiches incomplètes ou en double.', enText: 'Find incomplete or duplicate records.' },
  { id: 'audit', icon: ShieldCheck, fr: 'Piste d’audit', en: 'Audit trail', frText: 'Qui a modifié quoi, quand, depuis quel PC, avec la valeur avant et après.', enText: 'Who changed what, when, from which PC, with the value before and after.' },
  { id: 'help', icon: CircleHelp, fr: 'Aide & conseils', en: 'Help & guidance', frText: 'Trouvez comment réaliser une opération.', enText: 'Find out how to carry out a task.' },
] as const

const modules = [
  { id: 'commercial', icon: ShoppingCart, fr: 'Gestion commerciale', en: 'Sales management' },
  { id: 'caisse', icon: StoreIcon, fr: 'Saisie de caisse', en: 'Point of sale' },
  { id: 'compta', icon: BookOpen, fr: 'Comptabilité', en: 'Accounting' },
] as const

const currencies: [string, string][] = [
  ['EUR', 'Euro (€)'], ['XAF', 'Franc CFA — Afrique centrale (FCFA)'], ['XOF', 'Franc CFA — Afrique de l’Ouest (F CFA)'], ['USD', 'Dollar US ($)'], ['CHF', 'Franc suisse (CHF)'],
  ['GBP', 'Livre sterling (£)'], ['CAD', 'Dollar canadien'], ['MAD', 'Dirham marocain'], ['TND', 'Dinar tunisien'], ['DZD', 'Dinar algérien'],
]

const licenseMessages: Record<LicenseReason, [string, string]> = {
  missing: ['Saisissez votre code de licence.', 'Enter your licence code.'],
  invalid: ['Ce code de licence n’est pas reconnu.', 'This licence code is not recognised.'],
  expired: ['Cette licence est arrivée à échéance.', 'This licence has expired.'],
  revoked: ['Cette licence a été désactivée. Contactez le support.', 'This licence was disabled. Contact support.'],
  device_limit: ['Cette licence est déjà utilisée sur le nombre maximal de PC.', 'This licence is already in use on its maximum number of PCs.'],
  grace_expired: ['La licence n’a pas pu être vérifiée depuis trop longtemps. Connectez-vous à Internet.', 'The licence could not be verified for too long. Connect to the Internet.'],
  unreachable: ['Service de licences injoignable. Vérifiez votre connexion et réessayez.', 'Licence service unreachable. Check your connection and try again.'],
  not_registered: ['Aucune licence AICOM n’est associée à ce compte Google.', 'No AICOM licence is linked to this Google account.'],
}

function licenceLabel(license: DesktopState['license'], tr: Translate) {
  if (license.trial) return tr(`Version d’essai jusqu’au ${license.expires}`, `Trial version until ${license.expires}`)
  if (license.dev) return tr('Mode développement', 'Development mode')
  return `${license.customer ?? ''}${license.expires ? ` · ${tr('jusqu’au', 'until')} ${license.expires}` : ''}`
}

function syncLabel(sync: SyncState, localOnly: boolean, tr: Translate): { text: string; tone: 'good' | 'busy' | 'warn' } {
  if (localOnly) return { text: tr('Sur ce PC uniquement (sans Google)', 'On this PC only (no Google)'), tone: 'warn' }
  switch (sync.status) {
    case 'synced': return { text: tr('Enregistré sur Google', 'Saved to Google'), tone: 'good' }
    case 'pending': return { text: tr('Modifications à envoyer', 'Changes waiting to upload'), tone: 'busy' }
    case 'syncing': return { text: tr('En synchronisation…', 'Syncing…'), tone: 'busy' }
    case 'offline': return { text: tr('Hors ligne · enregistré sur ce PC', 'Offline · saved on this PC'), tone: 'warn' }
    case 'conflict': return { text: tr('Conflit à résoudre', 'Conflict to resolve'), tone: 'warn' }
    case 'locked': return { text: tr('Ouvert sur un autre PC', 'Open on another PC'), tone: 'warn' }
    case 'reauth': return { text: tr('Reconnexion Google requise', 'Google sign-in required'), tone: 'warn' }
    case 'unlock': return { text: tr('Connexion requise pour ouvrir les données', 'Sign in to open the data'), tone: 'warn' }
    case 'error': return { text: sync.detail === 'quota' ? tr('Espace Google Drive plein', 'Google Drive is full') : sync.detail === 'newer_schema' ? tr('Mettez à jour AICOM', 'Update AICOM') : sync.detail === 'insufficient_scopes' ? tr('Autorisation Google à renouveler', 'Google permission needs renewal') : tr('Erreur de synchronisation', 'Sync error'), tone: 'warn' }
    default: return { text: tr('Non connecté', 'Not connected'), tone: 'warn' }
  }
}

export function DesktopApp({ api }: { api: DesktopApi }) {
  const [locale, setLocale] = useState<Locale>('fr')
  const [state, setState] = useState<DesktopState | null>(null)
  const [store, setStoreState] = useState<Store | null>(null)
  const [setupActive, setSetupActive] = useState(false)
  const [failure, setFailure] = useState('')
  const persisted = useRef<Store | null>(null)
  const reason = useRef('')
  const tr: Translate = (fr, en) => locale === 'fr' ? fr : en

  const refresh = useCallback(async () => {
    const next = await api.getState()
    setState(next)
    return next
  }, [api])

  const loadStore = useCallback(async () => {
    const snapshot = await api.loadData()
    const loaded = snapshot ? fromSnapshot(snapshot) : null
    persisted.current = loaded
    setStoreState(loaded)
  }, [api])

  useEffect(() => {
    // The data are loaded before the state is published: otherwise a returning user would briefly look like a new one and be sent to setup.
    api.getState().then(async (next) => {
      await loadStore()
      setState(next)
      // While the customer reads the sign-in screen, so a module opens at once afterwards.
      setTimeout(() => { void preloadScreens() }, 300)
    }).catch((error: unknown) => setFailure(String(error)))
    const stop = [
      api.onSync((sync) => setState((current) => current && { ...current, sync })),
      api.onLicense((license) => setState((current) => current && { ...current, license })),
      api.onUpdate((update) => setState((current) => current && { ...current, update })),
      api.onDataReplaced(() => { void loadStore().then(refresh) }),
    ]
    const online = () => { void api.syncNow() }
    const crashed = (event: ErrorEvent) => { void api.reportError(event.message, event.error instanceof Error ? event.error.stack ?? '' : '') }
    const rejected = (event: PromiseRejectionEvent) => { void api.reportError(String(event.reason instanceof Error ? event.reason.message : event.reason), event.reason instanceof Error ? event.reason.stack ?? '' : '') }
    window.addEventListener('online', online)
    window.addEventListener('error', crashed)
    window.addEventListener('unhandledrejection', rejected)
    return () => {
      for (const unsubscribe of stop) unsubscribe()
      window.removeEventListener('online', online)
      window.removeEventListener('error', crashed)
      window.removeEventListener('unhandledrejection', rejected)
    }
  }, [api, loadStore, refresh])

  // Every change to the company data is written to the local database straight away; the upload to Drive follows on its own.
  useEffect(() => {
    if (!store || store === persisted.current) return
    persisted.current = store
    api.saveData(toSnapshot(store), reason.current).catch((error: unknown) => setFailure(String(error)))
    reason.current = ''
  }, [api, store])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = 'AICOM'
  }, [locale])

  const connected = Boolean(state && state.license.valid && (state.account || state.localOnly))
  // Accounts exist but nobody is signed in: the sign-in screen comes before anything else, including the rest of setup.
  // An encrypted Drive copy this PC cannot open yet is unlocked by signing in, before any data are on the PC.
  const mustSignIn = Boolean(connected && ((state!.auth.hasUsers && !state!.auth.user) || state!.sync.status === 'unlock'))
  const ready = Boolean(connected && store && state!.auth.user)
  // Once setup is needed it stays on screen until its last step is confirmed, even after the missing piece is in place.
  if (state && !ready && !mustSignIn && !setupActive) setSetupActive(true)

  if (failure) return <main className="portal-loading"><TriangleAlert size={20} /><span>{failure}</span><button type="button" onClick={() => window.location.reload()}>{tr('Réessayer', 'Retry')}</button></main>
  if (!state) return <main className="aicom-splash" aria-label={tr('Ouverture d’AICOM', 'Opening AICOM')}>
    <img src={logo} alt="AICOM — La tua contabilità, semplice." />
    <LoaderCircle className="spin-icon" size={20} />
  </main>

  const blockers = <SyncBlockers api={api} sync={state.sync} tr={tr} />
  if (mustSignIn) {
    return <>
      <SignIn api={api} state={state} locale={locale} setLocale={setLocale} tr={tr} onSignedIn={async () => {
        await loadStore()
        await refresh()
      }} />
      {blockers}
    </>
  }
  if (!ready || setupActive) {
    return <>
      <Setup api={api} state={state} store={store} locale={locale} setLocale={setLocale} tr={tr} refresh={refresh} loadStore={loadStore}
        onCreate={async (created) => {
          await api.saveData(toSnapshot(created), 'Initial setup')
          persisted.current = created
          setStoreState(created)
          await refresh()
        }}
        onFinish={() => setSetupActive(false)} />
      {blockers}
    </>
  }

  return <>
    <Workspace api={api} state={state} store={store!} setStore={setStoreState as Dispatch<SetStateAction<Store>>} locale={locale} setLocale={setLocale} tr={tr}
      refresh={refresh} loadStore={loadStore} onAction={(action, record) => { reason.current = `${action} · ${record}` }}
      onSignOut={async () => {
        const next = await api.logout()
        persisted.current = null
        setStoreState(null)
        setState(next)
      }} />
    {blockers}
  </>
}

function authMessage(result: Extract<AuthResult, { ok: false }>, tr: Translate) {
  switch (result.reason) {
    case 'locked': return tr(`Trop de tentatives. Réessayez dans ${result.waitSeconds} secondes.`, `Too many attempts. Try again in ${result.waitSeconds} seconds.`)
    case 'forbidden': return tr('Action réservée à un administrateur.', 'Only an administrator can do this.')
    case 'exists': return tr('Cet identifiant existe déjà.', 'This username already exists.')
    case 'no_key': return tr('Ce compte ne peut pas encore ouvrir les données chiffrées sur un nouveau PC. Connectez-vous d’abord avec un compte déjà utilisé depuis la mise à jour (par exemple l’administrateur).', 'This account cannot open the encrypted data on a new PC yet. First sign in with an account already used since the update (for example the administrator).')
    case 'weak': return tr('Identifiant : 3 à 40 lettres, chiffres, point ou tiret. Mot de passe : 8 caractères minimum.', 'Username: 3 to 40 letters, digits, dot or dash. Password: at least 8 characters.')
    default: return tr('Identifiant, mot de passe ou code incorrect.', 'Wrong username, password or code.')
  }
}

/** A password field whose content can be shown, to check what was typed. */
function PasswordInput({ tr, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { tr: Translate }) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-field">
      <input {...props} type={visible ? 'text' : 'password'} spellCheck={false} />
      <button className="password-toggle" type="button" aria-pressed={visible} title={visible ? tr('Masquer le mot de passe', 'Hide the password') : tr('Afficher le mot de passe', 'Show the password')}
        aria-label={visible ? tr('Masquer le mot de passe', 'Hide the password') : tr('Afficher le mot de passe', 'Show the password')} onClick={() => setVisible(!visible)}>
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  )
}

function RecoveryCode({ code, tr }: { code: string; tr: Translate }) {
  return (
    <div className="dk-recovery" role="status">
      <strong>{tr('Code de secours — notez-le maintenant', 'Recovery code — write it down now')}</strong>
      <code>{code}</code>
      <span>{tr('Il ne sera plus affiché. C’est le seul moyen de retrouver l’accès si le mot de passe est oublié.', 'It will not be shown again. It is the only way back in if the password is forgotten.')}</span>
    </div>
  )
}

/** Asked every time the application opens, once accounts exist. */
function SignIn({ api, state, locale, setLocale, tr, onSignedIn }: { api: DesktopApi; state: DesktopState; locale: Locale; setLocale: (locale: Locale) => void; tr: Translate; onSignedIn: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [newCode, setNewCode] = useState('')

  async function submit() {
    setBusy(true)
    setMessage('')
    try {
      const result = mode === 'login' ? await api.login(username, password) : await api.recoverPassword(username, code, password)
      if (!result.ok) {
        setMessage(authMessage(result, tr))
        setPassword('')
      } else if (result.recoveryCode) setNewCode(result.recoveryCode)
      else await onSignedIn()
    } finally { setBusy(false) }
  }

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <span className="portal-brand"><img className="brand-mark" src={logoMark} alt="" />AICOM</span>
        <button className="portal-language" type="button" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}>{locale.toUpperCase()}</button>
      </header>
      <div className="portal-content">
        <section className="portal-panel">
          <div className="portal-icon"><LockKeyhole size={21} /></div>
          <div className="portal-eyebrow">{tr('ACCÈS PROTÉGÉ', 'PROTECTED ACCESS')}</div>
          {newCode ? <>
            <h1>{tr('Mot de passe modifié', 'Password changed')}</h1>
            <RecoveryCode code={newCode} tr={tr} />
            <div className="portal-form"><button className="portal-submit" type="button" onClick={() => { void onSignedIn() }}>{tr('Continuer', 'Continue')}</button></div>
          </> : <>
            <h1>{mode === 'login' ? tr('Connexion à AICOM', 'Sign in to AICOM') : tr('Mot de passe oublié', 'Forgotten password')}</h1>
            {state.sync.status === 'unlock' && <p className="portal-description">{tr('Vos données sur Google Drive sont chiffrées. Votre identifiant AICOM les ouvre sur ce PC.', 'Your data on Google Drive are encrypted. Your AICOM sign-in opens them on this PC.')}</p>}
            <p className="portal-description">{mode === 'login' ? tr('Saisissez votre identifiant et votre mot de passe.', 'Enter your username and password.') : tr('Saisissez votre identifiant, le code de secours reçu à la création du compte, puis un nouveau mot de passe.', 'Enter your username, the recovery code given when the account was created, then a new password.')}</p>
            <form className="portal-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <label>{tr('Identifiant', 'Username')}<input value={username} required autoFocus autoComplete="username" spellCheck={false} onChange={(event) => setUsername(event.target.value)} /></label>
              {mode === 'recover' && <label>{tr('Code de secours', 'Recovery code')}<input className="dk-code" value={code} required placeholder="XXXX-XXXX-XXXX" spellCheck={false} onChange={(event) => setCode(event.target.value)} /></label>}
              <label>{mode === 'login' ? tr('Mot de passe', 'Password') : tr('Nouveau mot de passe', 'New password')}<PasswordInput tr={tr} value={password} required minLength={mode === 'recover' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={(event) => setPassword(event.target.value)} /></label>
              {message && <p className="portal-error" role="alert">{message}</p>}
              <button className="portal-submit" type="submit" disabled={busy}>{busy && <LoaderCircle className="spin-icon" size={16} />}{mode === 'login' ? tr('Se connecter', 'Sign in') : tr('Changer le mot de passe', 'Change the password')}</button>
            </form>
            <button className="portal-link forgot-link" type="button" onClick={() => { setMode(mode === 'login' ? 'recover' : 'login'); setMessage(''); setPassword('') }}>{mode === 'login' ? tr('Mot de passe oublié ?', 'Forgotten password?') : tr('Retour à la connexion', 'Back to sign-in')}</button>
          </>}
        </section>
        <footer className="portal-footer"><span><LockKeyhole size={13} />{tr('Chaque accès est enregistré avec la date et l’heure', 'Every access is recorded with date and time')}</span><span>{state.account?.email ?? state.device}</span></footer>
      </div>
    </main>
  )
}

/** Situations that must be settled before going on: the app open on another PC, or two PCs having edited at once. */
function SyncBlockers({ api, sync, tr }: { api: DesktopApi; sync: SyncState; tr: Translate }) {
  const [busy, setBusy] = useState(false)
  const act = (work: () => Promise<unknown>) => {
    setBusy(true)
    void work().finally(() => setBusy(false))
  }
  if (sync.status !== 'locked' && sync.status !== 'conflict') return null
  return (
    <div className="modal-backdrop">
      <section className="import-dialog dk-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dk-blocker-title">
        <div className="import-dialog-header"><div><span className="import-dialog-icon"><MonitorSmartphone size={18} /></span><div>
          <h2 id="dk-blocker-title">{sync.status === 'locked' ? tr('AICOM est ouvert sur un autre PC', 'AICOM is open on another PC') : tr('Deux versions de vos données', 'Two versions of your data')}</h2>
          <p>{sync.status === 'locked'
            ? tr(`Vos données sont en cours d’utilisation sur « ${sync.lockedBy} ». Fermez AICOM sur l’autre PC, ou prenez la main ici.`, `Your data are in use on “${sync.lockedBy}”. Close AICOM on the other PC, or take over here.`)
            : tr('Ce PC et un autre PC ont modifié les données chacun de leur côté. Choisissez la version à conserver ; l’autre reste récupérable (historique Google Drive ou sauvegarde locale).', 'This PC and another PC both changed the data. Choose the version to keep; the other remains recoverable (Google Drive history or local backup).')}</p>
        </div></div></div>
        <div className="import-dialog-footer">
          {sync.status === 'locked' ? <>
            <button className="cancel-button" type="button" disabled={busy} onClick={() => { void api.quit() }}>{tr('Quitter', 'Quit')}</button>
            <button className="primary-button" type="button" disabled={busy} onClick={() => act(() => api.takeOverLock())}>{tr('Prendre la main sur ce PC', 'Take over on this PC')}</button>
          </> : <>
            <button className="cancel-button" type="button" disabled={busy} onClick={() => act(() => api.resolveConflict('remote'))}>{tr('Garder la version Google Drive', 'Keep the Google Drive version')}</button>
            <button className="primary-button" type="button" disabled={busy} onClick={() => act(() => api.resolveConflict('local'))}>{tr('Garder la version de ce PC', 'Keep this PC’s version')}</button>
          </>}
        </div>
      </section>
    </div>
  )
}

function Setup({ api, state, store, locale, setLocale, tr, refresh, loadStore, onCreate, onFinish }: {
  api: DesktopApi; state: DesktopState; store: Store | null; locale: Locale; setLocale: (locale: Locale) => void; tr: Translate
  refresh: () => Promise<DesktopState>; loadStore: () => Promise<void>; onCreate: (store: Store) => Promise<void>; onFinish: () => void
}) {
  const [welcomed, setWelcomed] = useState(state.license.valid && !state.license.dev && !state.license.trial || Boolean(state.account))
  const [code, setCode] = useState('')
  const [company, setCompany] = useState('')
  const [sample, setSample] = useState(false)
  // Central African OHADA states come first; the empty code keeps the former setup (any currency, French chart of accounts).
  const [countryCode, setCountryCode] = useState(countries[0].code)
  const country = countries.find((item) => item.code === countryCode)
  const [currency, setCurrency] = useState('EUR')
  const [vat, setVat] = useState(String(countries[0].defaultVat))
  const chooseCountry = (code: string) => {
    setCountryCode(code)
    setVat(String(countries.find((item) => item.code === code)?.defaultVat ?? 20))
  }
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [account, setAccount] = useState({ name: '', username: '', password: '', confirm: '' })
  const [recoveryCode, setRecoveryCode] = useState('')
  const connected = Boolean(state.account || state.localOnly)
  // With a licence service, licences belong to Google accounts and activate on connection: the Google step comes first.
  const accountFirst = state.licenseConfigured
  const step = !welcomed ? 'welcome'
    : accountFirst ? !connected ? 'google' : !state.license.valid ? 'license' : !store ? 'company' : !state.auth.hasUsers ? 'user' : 'summary'
    : !state.license.valid ? 'license' : !connected ? 'google' : !store ? 'company' : !state.auth.hasUsers ? 'user' : 'summary'
  const steps = accountFirst ? ['google', 'license', 'company', 'user'] : ['license', 'google', 'company', 'user']
  const stepNumber = (id: string) => steps.indexOf(id) + 1
  const position = step === 'summary' ? steps.length : steps.indexOf(step)

  const createAccount = () => run(async () => {
    if (account.password !== account.confirm) {
      setMessage(tr('Les deux mots de passe ne sont pas identiques.', 'The two passwords do not match.'))
      return
    }
    const result = await api.createUser({ username: account.username, name: account.name, password: account.password, role: 'admin' })
    if (!result.ok) {
      setMessage(authMessage(result, tr))
      return
    }
    setRecoveryCode(result.recoveryCode ?? '')
    await refresh()
  })

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error))
    } finally { setBusy(false) }
  }

  const activate = () => run(async () => {
    const result = await api.activateLicense(code)
    if (!result.valid) setMessage(tr(...licenseMessages[result.reason ?? 'invalid']))
    await refresh()
  })
  const retryAccount = () => run(async () => {
    const result = await api.activateLicenseByAccount()
    if (!result.valid && result.reason !== 'not_registered') setMessage(tr(...licenseMessages[result.reason ?? 'invalid']))
    await refresh()
  })
  const connect = () => run(async () => {
    await api.connectGoogle()
    await refresh()
    await loadStore()
  })
  const create = () => run(() => onCreate(country
    ? sample ? createStore(company.trim(), { ...country, defaultVat: Number(vat) }) : createEmptyStore(company.trim(), { ...setupFor(country), defaultVat: Number(vat) })
    : sample ? { ...createStore(company.trim()), currency, defaultVat: Number(vat) } : createEmptyStore(company.trim(), { currency, defaultVat: Number(vat) })))

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <span className="portal-brand"><img className="brand-mark" src={logoMark} alt="" />AICOM</span>
        <button className="portal-language" type="button" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}>{locale.toUpperCase()}</button>
      </header>
      <div className="portal-content">
        <ol className="dk-steps" aria-label={tr('Étapes', 'Steps')}>{steps.map((item, index) => <li className={position === index ? 'active' : position > index ? 'done' : ''} key={item}>{index + 1}</li>)}</ol>
        <section className="portal-panel workspace-panel">
          {step === 'welcome' && <>
            <div className="portal-icon"><ShieldCheck size={21} /></div>
            <div className="portal-eyebrow">{tr('INSTALLATION', 'SETUP')}</div>
            <h1>{tr('Bienvenue dans AICOM', 'Welcome to AICOM')}</h1>
            <p className="portal-description">{state.license.trial ? tr(`Version d’essai utilisable jusqu’au ${state.license.expires}. Il suffit de donner le nom de votre entreprise pour commencer.`, `Trial version usable until ${state.license.expires}. Just give your company name to start.`) : tr('Trois étapes : activer votre licence, connecter votre compte Google, puis créer votre entreprise. Vos données comptables sont enregistrées dans votre propre Google Drive.', 'Three steps: activate your licence, connect your Google account, then create your company. Your accounting data are saved in your own Google Drive.')}</p>
            <div className="portal-form"><button className="portal-submit" type="button" onClick={() => setWelcomed(true)}>{tr('Commencer', 'Start')}</button></div>
          </>}

          {step === 'license' && <>
            <div className="portal-icon"><KeyRound size={21} /></div>
            <div className="portal-eyebrow">{tr(`ÉTAPE ${stepNumber('license')} · LICENCE`, `STEP ${stepNumber('license')} · LICENCE`)}</div>
            <h1>{tr('Activez votre licence', 'Activate your licence')}</h1>
            {accountFirst && state.account ? <>
              <p className="portal-error" role="alert">{state.license.reason === 'not_registered' || state.license.reason === 'missing'
                ? tr(`Aucune licence AICOM n’est associée au compte ${state.account.email}. Demandez à votre fournisseur d’ajouter cette adresse, puis réessayez.`, `No AICOM licence is linked to ${state.account.email}. Ask your provider to add this address, then try again.`)
                : tr(...licenseMessages[state.license.reason ?? 'invalid'])}</p>
              <div className="portal-form"><button className="portal-submit" type="button" disabled={busy} onClick={() => { void retryAccount() }}>{busy && <LoaderCircle className="spin-icon" size={16} />}{tr('Réessayer', 'Try again')}</button></div>
              <p className="portal-description">{tr('Vous avez reçu un code de licence ? Vous pouvez aussi le saisir ici.', 'Received a licence code? You can also enter it here.')}</p>
            </> : <p className="portal-description">{tr('Saisissez le code reçu à l’achat. Il sera associé à ce PC.', 'Enter the code you received on purchase. It will be linked to this PC.')}</p>}
            {!state.licenseConfigured && <p className="portal-error" role="alert">{state.license.trial ? tr(`La période d’essai s’est terminée le ${state.license.expires}. Contactez-nous pour obtenir la version complète ; vos données sont conservées sur ce PC.`, `The trial period ended on ${state.license.expires}. Contact us for the full version; your data are kept on this PC.`) : tr('Cette installation n’est pas reliée au service de licences. Contactez le support.', 'This installation is not linked to the licence service. Contact support.')}</p>}
            <form className="portal-form" onSubmit={(event) => { event.preventDefault(); void activate() }}>
              <label>{tr('Code de licence', 'Licence code')}<input className="dk-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="AICOM-XXXXX-XXXXX-XXXXX-XXXXX" autoFocus spellCheck={false} /></label>
              {(message || (!(accountFirst && state.account) && state.license.reason && state.license.reason !== 'missing' && !code)) && <p className="portal-error" role="alert">{message || tr(...licenseMessages[state.license.reason!])}</p>}
              <button className="portal-submit" type="submit" disabled={busy || !code.trim()}>{busy && <LoaderCircle className="spin-icon" size={16} />}{tr('Activer', 'Activate')}</button>
            </form>
          </>}

          {step === 'google' && <>
            <div className="portal-icon"><Cloud size={21} /></div>
            <div className="portal-eyebrow">{tr(`ÉTAPE ${stepNumber('google')} · COMPTE GOOGLE`, `STEP ${stepNumber('google')} · GOOGLE ACCOUNT`)}</div>
            <h1>{tr('Connectez votre compte Google', 'Connect your Google account')}</h1>
            <p className="portal-description">{tr('AICOM enregistre vos données dans votre Google Drive. La connexion s’ouvre dans votre navigateur.', 'AICOM saves your data in your Google Drive. Sign-in opens in your browser.')}{accountFirst && tr(' Votre licence est liée à votre adresse Google : elle s’active toute seule.', ' Your licence is linked to your Google address: it activates by itself.')}</p>
            <ul className="dk-points">
              <li><Check size={13} />{tr('AICOM n’accède qu’aux fichiers qu’il crée lui-même, pas au reste de votre Drive.', 'AICOM only accesses the files it creates itself, not the rest of your Drive.')}</li>
              <li><Check size={13} />{tr('Votre mot de passe Google n’est jamais communiqué à AICOM.', 'Your Google password is never shared with AICOM.')}</li>
              <li><Check size={13} />{tr('Sur un autre PC, le même compte retrouve toutes vos données.', 'On another PC, the same account finds all your data again.')}</li>
            </ul>
            <div className="portal-form">
              {!state.googleConfigured && <p className={state.license.trial ? 'dk-note' : 'portal-error'} role="status">{state.license.trial ? tr('Cette version d’essai fonctionne sans compte Google : vos données restent sur ce PC.', 'This trial version works without a Google account: your data stay on this PC.') : tr('La connexion Google n’est pas configurée dans cette version.', 'Google sign-in is not configured in this build.')}</p>}
              {message && <p className="portal-error" role="alert">{message}</p>}
              {(state.googleConfigured || !state.license.trial) && <button className="portal-submit" type="button" disabled={busy || !state.googleConfigured} onClick={() => { void connect() }}>{busy && <LoaderCircle className="spin-icon" size={16} />}{busy ? tr('En attente de la connexion dans votre navigateur…', 'Waiting for sign-in in your browser…') : tr('Se connecter avec Google', 'Sign in with Google')}</button>}
              {busy && <button className="portal-link" type="button" onClick={() => { void api.cancelConnect() }}>{tr('Annuler', 'Cancel')}</button>}
              {(state.devMode || state.license.trial) && !busy && <button className={state.googleConfigured ? 'portal-link' : 'portal-submit'} type="button" onClick={() => { void run(async () => { await api.useLocalOnly(); await refresh(); await loadStore() }) }}>{state.license.trial ? tr('Continuer sans Google : données sur ce PC uniquement', 'Continue without Google: data on this PC only') : tr('Continuer sans Google (développement uniquement)', 'Continue without Google (development only)')}</button>}
            </div>
          </>}

          {step === 'company' && <>
            <div className="portal-icon"><Building2 size={21} /></div>
            <div className="portal-eyebrow">{tr('ÉTAPE 3 · ENTREPRISE', 'STEP 3 · COMPANY')}</div>
            <h1>{tr('Créez votre entreprise', 'Create your company')}</h1>
            <p className="portal-description">{tr('Aucune donnée AICOM n’a été trouvée sur ce compte Google : nous créons un nouvel espace.', 'No AICOM data were found on this Google account: a new space will be created.')}</p>
            {!state.localOnly && state.sync.status !== 'synced' && <p className="portal-error" role="alert">{tr('Google Drive n’a pas pu être vérifié (', 'Google Drive could not be checked (')}{syncLabel(state.sync, false, tr).text}{tr('). Si vous avez déjà des données AICOM, rétablissez la connexion avant de continuer.', '). If you already have AICOM data, restore the connection before continuing.')} <button className="portal-link" type="button" onClick={() => { void run(async () => { await api.syncNow(); await refresh(); await loadStore() }) }}>{tr('Réessayer', 'Retry')}</button></p>}
            <form className="portal-form" onSubmit={(event) => { event.preventDefault(); void create() }}>
              <label>{tr('Nom de l’entreprise', 'Company name')}<input value={company} maxLength={120} required autoFocus onChange={(event) => setCompany(event.target.value)} /></label>
              <label>{tr('Pays', 'Country')}<select className="dk-select" value={countryCode} onChange={(event) => chooseCountry(event.target.value)}>{countries.map((item) => <option key={item.code} value={item.code}>{tr(item.fr, item.en)}</option>)}<option value="">{tr('Autre pays (plan comptable français)', 'Other country (French chart of accounts)')}</option></select>{country && <small>{tr(`Plan comptable SYSCOHADA révisé · ${country.currency}`, `Revised SYSCOHADA chart of accounts · ${country.currency}`)}</small>}</label>
              {!country && <label>{tr('Devise', 'Currency')}<select className="dk-select" value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>}
              <label>{tr('TVA appliquée par défaut', 'Default VAT')}<select className="dk-select" value={vat} onChange={(event) => setVat(event.target.value)}>{vatRatesOf({ country: countryCode }).map(String).map((rate) => <option key={rate} value={rate}>{rate === '0' ? tr('Sans TVA (0 %)', 'No VAT (0%)') : `${rate} %`}</option>)}</select><small>{tr('Modifiable ensuite dans Paramètres', 'Can be changed later in Settings')}</small></label>
              <label className="dk-check"><input type="checkbox" checked={sample} onChange={(event) => setSample(event.target.checked)} />{tr('Charger des données d’exemple pour découvrir le logiciel', 'Load sample data to explore the software')}</label>
              {message && <p className="portal-error" role="alert">{message}</p>}
              <button className="portal-submit" type="submit" disabled={busy || !company.trim()}>{busy && <LoaderCircle className="spin-icon" size={16} />}{tr('Créer l’espace', 'Create the space')}</button>
            </form>
          </>}

          {step === 'user' && <>
            <div className="portal-icon"><UserRound size={21} /></div>
            <div className="portal-eyebrow">{tr('ÉTAPE 4 · ACCÈS', 'STEP 4 · ACCESS')}</div>
            <h1>{tr('Créez votre identifiant', 'Create your sign-in')}</h1>
            <p className="portal-description">{tr('Il sera demandé à chaque ouverture d’AICOM, sur tous vos PC. Chaque accès est inscrit dans un historique qui ne peut pas être effacé.', 'It will be asked every time AICOM opens, on all your PCs. Every access is written to a history that cannot be erased.')}</p>
            <form className="portal-form" onSubmit={(event) => { event.preventDefault(); void createAccount() }}>
              <label>{tr('Nom et prénom', 'Full name')}<input value={account.name} required maxLength={80} autoFocus onChange={(event) => setAccount({ ...account, name: event.target.value })} /></label>
              <label>{tr('Identifiant', 'Username')}<input value={account.username} required autoComplete="username" spellCheck={false} onChange={(event) => setAccount({ ...account, username: event.target.value })} /><small>{tr('3 à 40 caractères : lettres, chiffres, point, tiret', '3 to 40 characters: letters, digits, dot, dash')}</small></label>
              <label>{tr('Mot de passe', 'Password')}<PasswordInput tr={tr} value={account.password} required minLength={8} autoComplete="new-password" onChange={(event) => setAccount({ ...account, password: event.target.value })} /><small>{tr('8 caractères minimum', 'At least 8 characters')}</small></label>
              <label>{tr('Confirmez le mot de passe', 'Confirm the password')}<PasswordInput tr={tr} value={account.confirm} required autoComplete="new-password" onChange={(event) => setAccount({ ...account, confirm: event.target.value })} /></label>
              {message && <p className="portal-error" role="alert">{message}</p>}
              <button className="portal-submit" type="submit" disabled={busy}>{busy && <LoaderCircle className="spin-icon" size={16} />}{tr('Créer l’identifiant', 'Create the sign-in')}</button>
            </form>
          </>}

          {step === 'summary' && <>
            <div className="portal-icon"><Check size={21} /></div>
            <div className="portal-eyebrow">{tr('RÉCAPITULATIF', 'SUMMARY')}</div>
            <h1>{tr('Tout est prêt', 'Everything is ready')}</h1>
            {recoveryCode && <RecoveryCode code={recoveryCode} tr={tr} />}
            <dl className="dk-summary">
              <div><dt>{tr('Utilisateur', 'User')}</dt><dd>{state.auth.user ? `${state.auth.user.name} (${state.auth.user.username})` : '—'}</dd></div>
              <div><dt>{tr('Entreprise', 'Company')}</dt><dd>{store?.company}</dd></div>
              <div><dt>{tr('Licence', 'Licence')}</dt><dd>{licenceLabel(state.license, tr)}</dd></div>
              <div><dt>{tr('Compte Google', 'Google account')}</dt><dd>{state.account?.email ?? tr('Aucun (mode local)', 'None (local mode)')}</dd></div>
              <div><dt>{tr('Ce PC', 'This PC')}</dt><dd>{state.device}</dd></div>
              <div><dt>{tr('Données', 'Data')}</dt><dd>{syncLabel(state.sync, state.localOnly, tr).text}</dd></div>
            </dl>
            <div className="portal-form"><button className="portal-submit" type="button" onClick={onFinish}>{tr('Ouvrir AICOM', 'Open AICOM')}</button></div>
          </>}
        </section>
        <footer className="portal-footer"><span><LockKeyhole size={13} />{tr('Vos données restent dans votre compte Google', 'Your data stay in your Google account')}</span><span>AICOM {state.version}</span></footer>
      </div>
    </main>
  )
}

function Workspace({ api, state, store, setStore, locale, setLocale, tr, refresh, loadStore, onAction, onSignOut }: {
  api: DesktopApi; state: DesktopState; store: Store; setStore: Dispatch<SetStateAction<Store>>; locale: Locale; setLocale: (locale: Locale) => void; tr: Translate
  refresh: () => Promise<DesktopState>; loadStore: () => Promise<void>; onAction: (action: string, record: string) => void; onSignOut: () => Promise<void>
}) {
  const [section, setSection] = useState<Section>('overview')
  const [focus, setFocus] = useState<string | undefined>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [reconnecting, setReconnecting] = useState(false)
  const sync = syncLabel(state.sync, state.localOnly, tr)
  const money = (amount: number) => new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-IE', { style: 'currency', currency: store.currency || 'EUR' }).format(amount)
  const activeModule = modules.find((item) => item.id === section)
  const activeWorkspace = workspace.find((item) => item.id === section)
  const title = activeModule ? tr(activeModule.fr, activeModule.en) : tr(activeWorkspace!.fr, activeWorkspace!.en)
  const day = (date: string) => {
    const [year, month, dayOfMonth] = date.split('-').map(Number)
    return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(year, month - 1, dayOfMonth))
  }
  const go = (target: Section, activity?: string) => {
    setFocus(activity)
    setSection(target)
  }
  const pendingInvoices = store.supplierInvoices.filter((invoice) => invoice.status === 'needs_review').length

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  async function reconnect() {
    setReconnecting(true)
    try {
      await api.connectGoogle()
      await refresh()
      await loadStore()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally { setReconnecting(false) }
  }

  function openOrConnectGoogle() {
    if (state.localOnly && state.googleConfigured) {
      void reconnect()
      return
    }
    setSettingsOpen(true)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar dk-sidebar sg-noprint">
        <span className="brand"><img className="brand-mark" src={logoMark} alt="" /><span className="brand-name">AICOM</span></span>
        <div className="entity-select dk-entity">
          <span className="entity-icon"><Building2 size={17} /></span>
          <span className="entity-copy"><strong>{store.company}</strong><small>{licenceLabel(state.license, tr)}</small></span>
        </div>
        <div className="nav-caption">{tr('Espace de travail', 'Workspace')}</div>
        <nav className="main-nav" aria-label={tr('Espace de travail', 'Workspace')}>
          {workspace.map(({ id, icon: Icon, fr, en }) => (
            <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} title={tr(fr, en)} onClick={() => go(id)} type="button">
              <Icon size={17} strokeWidth={1.8} /><span>{tr(fr, en)}</span>{id === 'invoices' && pendingInvoices > 0 && <span className="nav-count">{pendingInvoices}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-caption module-caption">{tr('Gestion des opérations', 'Operations management')}</div>
        <nav className="main-nav" aria-label={tr('Gestion des opérations', 'Operations management')}>
          {modules.map(({ id, icon: Icon, fr, en }) => (
            <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} title={tr(fr, en)} onClick={() => go(id)} type="button"><Icon size={17} strokeWidth={1.8} /><span>{tr(fr, en)}</span></button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={`pilot-card dk-sync ${sync.tone}`} type="button" disabled={reconnecting} title={state.localOnly ? tr('Connecter votre compte Google Drive', 'Connect your Google Drive account') : tr('Synchroniser maintenant', 'Sync now')} onClick={() => {
            if (state.localOnly) openOrConnectGoogle()
            else void api.syncNow()
          }}>
            <span className="pilot-icon">{state.sync.status === 'syncing' ? <RefreshCw className="spin-icon" size={15} /> : sync.tone === 'good' ? <Cloud size={15} /> : <CloudOff size={15} />}</span>
            <div><strong>{reconnecting ? tr('En attente de Google…', 'Waiting for Google…') : sync.text}</strong><small>{state.localOnly ? tr('Cliquez pour connecter votre compte Google', 'Click to connect your Google account') : state.sync.lastSyncAt ? `${tr('Dernier envoi', 'Last upload')} ${new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(state.sync.lastSyncAt))}` : tr('Copie locale sur ce PC', 'Local copy on this PC')}</small></div>
            <span className="status-dot" />
          </button>
          <button className="nav-item settings-link" onClick={() => setSettingsOpen(true)} type="button"><Settings size={17} /><span>{tr('Paramètres', 'Settings')}</span></button>
          <div className="profile-row"><div className="avatar profile-avatar">{(state.auth.user?.name ?? 'PC').slice(0, 2).toUpperCase()}</div><div className="profile-copy"><strong>{state.auth.user?.name}</strong><small>{state.account?.email ?? state.device}</small></div><button className="dk-signout" type="button" title={tr('Se déconnecter', 'Sign out')} aria-label={tr('Se déconnecter', 'Sign out')} onClick={() => { void onSignOut() }}><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar sg-noprint">
          <div className="breadcrumb"><span>{store.company}</span><span className="crumb-slash">/</span><strong>{title}</strong></div>
          <div className="topbar-actions">
            <span className={`dk-status ${sync.tone}`} role="status">{sync.text}</span>
            {state.devMode && <button className="language-toggle" type="button" title={tr('Rafraîchir l’application', 'Refresh the application')} aria-label={tr('Rafraîchir l’application', 'Refresh the application')} onClick={() => window.location.reload()}><RefreshCw size={14} />{tr('Actualiser', 'Refresh')}</button>}
            <button className="language-toggle" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')} type="button" aria-label="Switch language">{locale.toUpperCase()}<ChevronDown size={13} /></button>
          </div>
        </header>
        <div className="page-content">
          {state.sync.status === 'reauth' && <Banner tone="warn" text={tr('L’accès à votre compte Google a été retiré ou a expiré. Vos données restent sur ce PC ; reconnectez-vous pour reprendre l’enregistrement sur Google Drive.', 'Access to your Google account was removed or expired. Your data remain on this PC; sign in again to resume saving to Google Drive.')}
            action={<button className="approve-button" type="button" disabled={reconnecting} onClick={() => { void reconnect() }}>{reconnecting ? tr('En attente du navigateur…', 'Waiting for the browser…') : tr('Reconnecter Google', 'Reconnect Google')}</button>} />}
          {state.sync.status === 'error' && <Banner tone="warn" text={state.sync.detail === 'quota' ? tr('Votre Google Drive est plein : les modifications restent sur ce PC. Libérez de l’espace dans Google Drive, puis réessayez.', 'Your Google Drive is full: changes remain on this PC. Free up space in Google Drive, then try again.') : state.sync.detail === 'newer_schema' ? tr('Vos données ont été enregistrées par une version plus récente d’AICOM. Mettez à jour l’application sur ce PC.', 'Your data were saved by a newer AICOM version. Update the application on this PC.') : state.sync.detail === 'insufficient_scopes' ? tr('Google n’a pas accordé à AICOM l’autorisation Drive nécessaire. Verifiez les autorisations OAuth de l’application, puis reconnectez le compte Google.', 'Google did not grant AICOM the required Drive permission. Check the app’s OAuth permissions, then reconnect the Google account.') : `${tr('La synchronisation a échoué', 'Sync failed')} : ${state.sync.detail ?? ''}`}
            action={<button className="approve-button" type="button" disabled={reconnecting} onClick={() => {
              if (state.sync.detail === 'insufficient_scopes') void reconnect()
              else void api.syncNow()
            }}>{state.sync.detail === 'insufficient_scopes' ? reconnecting ? tr('Ouverture de Google…', 'Opening Google…') : tr('Reconnecter Google', 'Reconnect Google') : tr('Réessayer', 'Retry')}</button>} />}
          {state.update.status === 'ready' && <Banner tone="info" text={tr(`La version ${state.update.version} est prête à être installée.`, `Version ${state.update.version} is ready to install.`) + (state.update.notes ? ` ${state.update.notes}` : '')}
            action={<button className="approve-button" type="button" onClick={() => { void api.installUpdate() }}>{tr('Redémarrer et installer', 'Restart and install')}</button>} />}
          {state.update.status === 'available' && state.update.metered && <Banner tone="info" text={tr(
            `La version ${state.update.version} est disponible. Votre connexion est facturée au volume : le téléchargement${state.update.size ? ` (${Math.ceil(state.update.size / 1_048_576)} Mo au plus)` : ''} attend votre accord.`,
            `Version ${state.update.version} is available. Your connection is metered: the download${state.update.size ? ` (up to ${Math.ceil(state.update.size / 1_048_576)} MB)` : ''} waits for your go-ahead.`)}
            action={<button className="approve-button" type="button" onClick={() => { void api.downloadUpdate() }}>{tr('Télécharger quand même', 'Download anyway')}</button>} />}
          {state.update.status === 'available' && !state.update.metered && state.update.url && <Banner tone="info" text={tr(`La version ${state.update.version} est disponible.`, `Version ${state.update.version} is available.`) + (state.update.notes ? ` ${state.update.notes}` : '')}
            action={<button className="approve-button" type="button" onClick={() => { void api.openExternal(state.update.url!) }}>{tr('Télécharger', 'Download')}</button>} />}

          <section className="welcome-row sg-noprint"><div><h1>{title}</h1><p>{activeWorkspace ? tr(activeWorkspace.frText, activeWorkspace.enText) : tr('Chaque enregistrement est sauvegardé sur ce PC, puis envoyé sur votre Google Drive.', 'Every record is saved on this PC, then sent to your Google Drive.')}</p></div></section>

          {section === 'audit' && <AuditSection api={api} tr={tr} locale={locale} revision={store} />}
          <Suspense fallback={<div className="screen-loading"><LoaderCircle className="spin-icon" size={20} /></div>}>
          {activeModule && <SageModules module={activeModule.id} initialActivity={focus} admin={state.auth.user?.role === 'admin'} locale={locale} store={store} setStore={setStore} money={money} notify={notify} audit={onAction} onModule={(id) => go(id)}
            savePdf={(name) => { void api.savePdf(name).then((file) => { if (file) notify(tr(`PDF enregistré : ${file}`, `PDF saved: ${file}`)) }) }} />}
          {activeWorkspace && activeWorkspace.id !== 'audit' && <div className="sg-module"><FinanceView section={activeWorkspace.id} admin={state.auth.user?.role === 'admin'} store={store} apply={setStore} tr={tr} money={money} day={day} notify={notify} audit={onAction} go={go} savePdf={(name) => api.savePdf(name)} /></div>}
          </Suspense>
          <footer className="page-footer sg-noprint"><span><ShieldCheck size={13} />{tr('Données enregistrées dans votre compte Google', 'Data saved in your Google account')}</span><span>AICOM · v{state.version}</span></footer>
        </div>
      </main>
      {settingsOpen && <SettingsDialog api={api} state={state} store={store} tr={tr} locale={locale} notify={notify} refresh={refresh} loadStore={loadStore} onClose={() => setSettingsOpen(false)}
        onStore={(next, action) => { onAction(action, store.company); setStore(next) }} />}
      {toast && <div className="toast-message" role="status"><Check size={17} />{toast}</div>}
    </div>
  )
}

function Banner({ tone, text, action }: { tone: 'warn' | 'info'; text: string; action?: ReactNode }) {
  return <div className={`dk-banner ${tone} sg-noprint`} role={tone === 'warn' ? 'alert' : 'status'}><TriangleAlert size={15} /><span>{text}</span>{action}</div>
}

const collectionNames: Record<string, [string, string]> = {
  clients: ['Client', 'Customer'], suppliers: ['Fournisseur', 'Supplier'], articles: ['Article', 'Item'], salesDocs: ['Document de vente', 'Sales document'],
  purchaseDocs: ['Document d’achat', 'Purchase document'], boms: ['Nomenclature', 'Bill of materials'], workOrders: ['Ordre de fabrication', 'Production order'],
  accounts: ['Compte', 'Account'], journals: ['Journal', 'Journal'], entries: ['Écriture', 'Entry'], groups: ['Groupe de commandes', 'Command group'], settings: ['Paramètre', 'Setting'],
}

function AuditSection(props: { api: DesktopApi; tr: Translate; locale: Locale; revision: unknown }) {
  const [view, setView] = useState<'access' | 'changes'>('changes')
  const { tr } = props
  return (
    <div className="sg-module">
      <div className="sg-chips dk-tabs">
        <button className={view === 'changes' ? 'active' : ''} type="button" onClick={() => setView('changes')}>{tr('Modifications des données', 'Data changes')}</button>
        <button className={view === 'access' ? 'active' : ''} type="button" onClick={() => setView('access')}>{tr('Accès au logiciel', 'Access to the software')}</button>
      </div>
      {view === 'changes' ? <AuditView {...props} /> : <AccessView {...props} />}
    </div>
  )
}

function AccessView({ api, tr, locale }: { api: DesktopApi; tr: Translate; locale: Locale }) {
  const pageSize = 50
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: AccessRow[]; total: number; intact: boolean }>({ rows: [], total: 0, intact: true })
  const events: Record<AccessEvent, [string, string, 'good' | 'warn' | '']> = {
    login: ['Connexion', 'Signed in', 'good'], logout: ['Déconnexion', 'Signed out', ''], login_failed: ['Tentative refusée', 'Refused attempt', 'warn'],
    user_created: ['Compte créé', 'Account created', ''], password_changed: ['Mot de passe modifié', 'Password changed', ''],
    password_recovered: ['Mot de passe réinitialisé par code de secours', 'Password reset with recovery code', 'warn'],
    user_disabled: ['Compte désactivé', 'Account disabled', 'warn'], user_enabled: ['Compte réactivé', 'Account re-enabled', ''],
  }
  const dateOf = (at: string) => new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(at))
  const timeOf = (at: string) => new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(at))

  useEffect(() => {
    let active = true
    void api.listAccess(pageSize, page * pageSize).then((result) => { if (active) setData(result) })
    return () => { active = false }
  }, [api, page])

  async function exportExcel() {
    const all = await api.listAccess(500, 0)
    downloadXlsx(`Historique des accès ${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Accès', rows: [['Jour', 'Heure', 'Utilisateur', 'PC', 'Événement'], ...all.rows.map((row) => [dateOf(row.at), timeOf(row.at), row.user, row.deviceName, events[row.event]?.[0] ?? row.event])] }])
  }

  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <div><div className="panel-title">{tr('Historique des accès', 'Access history')}<span className="title-count">{data.total}</span></div><div className="panel-subtitle">{tr('Qui a ouvert AICOM, quel jour, à quelle heure et sur quel PC. AICOM n’offre aucun moyen de modifier ou d’effacer ces lignes.', 'Who opened AICOM, on which day, at what time and on which PC. AICOM offers no way to change or erase these lines.')}</div></div>
        <div className="row-actions">
          <span className={`sg-badge ${data.intact ? 'good' : 'warn'}`}>{data.intact ? tr('Historique intact', 'History intact') : tr('Historique altéré hors d’AICOM', 'History altered outside AICOM')}</span>
          <button className="approve-button" type="button" onClick={() => { void exportExcel() }}><FileSpreadsheet size={13} />Excel</button>
        </div>
      </div>
      {data.rows.length ? <div className="table-scroll">
        <table className="data-table audit-table sg-table">
          <thead><tr><th>{tr('JOUR', 'DAY')}</th><th>{tr('HEURE', 'TIME')}</th><th>{tr('UTILISATEUR', 'USER')}</th><th>PC</th><th>{tr('ÉVÉNEMENT', 'EVENT')}</th></tr></thead>
          <tbody>
            {data.rows.map((row) => {
              const [fr, en, tone] = events[row.event] ?? [row.event, row.event, '']
              return <tr key={`${row.device}-${row.seq}`}><td className="date-cell">{dateOf(row.at)}</td><td><strong className="invoice-id">{timeOf(row.at)}</strong></td><td>{row.user}</td><td>{row.deviceName}</td><td><span className={`sg-badge ${tone}`}>{tr(fr, en)}</span></td></tr>
            })}
          </tbody>
        </table>
      </div> : <div className="empty-state">{tr('Aucun accès enregistré.', 'No recorded access.')}</div>}
      {data.total > pageSize && <div className="invoice-footer">
        <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, data.total)} / {data.total}</span>
        <div className="row-actions">
          <button className="approve-button" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{tr('Plus récent', 'Newer')}</button>
          <button className="approve-button" type="button" disabled={(page + 1) * pageSize >= data.total} onClick={() => setPage(page + 1)}>{tr('Plus ancien', 'Older')}</button>
        </div>
      </div>}
    </section>
  )
}

function UsersSettings({ api, state, tr, notify }: { api: DesktopApi; state: DesktopState; tr: Translate; notify: (message: string) => void }) {
  const me = state.auth.user!
  const blank = { name: '', username: '', password: '', role: 'user' as 'admin' | 'user' }
  const [users, setUsers] = useState<AppUser[]>([])
  const [form, setForm] = useState(blank)
  const [password, setPassword] = useState('')
  const [issued, setIssued] = useState('')
  const reload = useCallback(() => { void api.listUsers().then(setUsers) }, [api])
  useEffect(reload, [reload])

  async function act(work: () => Promise<AuthResult>, done: string) {
    const result = await work()
    if (!result.ok) {
      notify(authMessage(result, tr))
      return false
    }
    setIssued(result.recoveryCode ?? '')
    notify(done)
    reload()
    return true
  }

  return (
    <>
      <h3><UserRound size={14} />{tr('Utilisateurs et accès', 'Users and access')}</h3>
      <ul className="dk-revisions">
        {users.map((user) => (
          <li key={user.username}>
            <span><strong>{user.name}</strong> · {user.username} · {user.role === 'admin' ? tr('administrateur', 'administrator') : tr('utilisateur', 'user')}{!user.active && ` · ${tr('désactivé', 'disabled')}`}</span>
            {me.role === 'admin' && user.username !== me.username && <button className="approve-button" type="button" onClick={() => { void act(() => api.setUserActive(user.username, !user.active), user.active ? tr('Compte désactivé.', 'Account disabled.') : tr('Compte réactivé.', 'Account re-enabled.')) }}>{user.active ? tr('Désactiver', 'Disable') : tr('Réactiver', 'Re-enable')}</button>}
          </li>
        ))}
      </ul>
      <p className="dk-note">{tr('Un compte ne se supprime pas : il se désactive, pour que l’historique des accès reste lisible.', 'An account is never deleted: it is disabled, so the access history stays readable.')}</p>
      {issued && <RecoveryCode code={issued} tr={tr} />}
      <div className="sg-form dk-inline-form">
        <label>{tr('Mon nouveau mot de passe', 'My new password')}<PasswordInput tr={tr} value={password} minLength={8} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="approve-button" type="button" disabled={password.length < 8} onClick={() => { void act(() => api.changePassword(me.username, password), tr('Mot de passe modifié.', 'Password changed.')).then((ok) => { if (ok) setPassword('') }) }}>{tr('Changer mon mot de passe', 'Change my password')}</button>
      </div>
      {me.role === 'admin' && <div className="sg-form dk-inline-form">
        <label>{tr('Nom et prénom', 'Full name')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>{tr('Identifiant', 'Username')}<input value={form.username} spellCheck={false} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label>{tr('Mot de passe provisoire', 'Temporary password')}<PasswordInput tr={tr} value={form.password} autoComplete="new-password" onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <label>{tr('Rôle', 'Role')}<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'user' })}><option value="user">{tr('Utilisateur', 'User')}</option><option value="admin">{tr('Administrateur', 'Administrator')}</option></select></label>
        <button className="approve-button" type="button" onClick={() => { void act(() => api.createUser(form), tr('Compte créé. Remettez à la personne son code de secours.', 'Account created. Give the person their recovery code.')).then((ok) => { if (ok) setForm(blank) }) }}>{tr('Ajouter un utilisateur', 'Add a user')}</button>
      </div>}
    </>
  )
}

function AuditView({ api, tr, locale, revision }: { api: DesktopApi; tr: Translate; locale: Locale; revision: unknown }) {
  const pageSize = 50
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: AuditRow[]; total: number }>({ rows: [], total: 0 })
  const actions = { create: tr('Création', 'Created'), update: tr('Modification', 'Changed'), delete: tr('Suppression', 'Deleted') }

  useEffect(() => {
    let active = true
    // Saves are written just before this view re-reads; a short delay keeps the newest line in the list.
    const timer = window.setTimeout(() => { void api.listAudit(pageSize, page * pageSize).then((result) => { if (active) setData(result) }) }, 150)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [api, page, revision])

  return (
    <section className="panel workflow-panel">
      <div className="panel-heading"><div><div className="panel-title">{tr('Activité enregistrée', 'Recorded activity')}<span className="title-count">{data.total}</span></div><div className="panel-subtitle">{tr('Ce journal fait partie de vos données : il est synchronisé avec Google Drive.', 'This log is part of your data: it is synced with Google Drive.')}</div></div></div>
      {data.rows.length ? <div className="table-scroll">
        <table className="data-table audit-table dk-audit">
          <thead><tr><th>{tr('DATE', 'WHEN')}</th><th>{tr('UTILISATEUR', 'USER')}</th><th>PC</th><th>ACTION</th><th>{tr('ÉLÉMENT', 'RECORD')}</th><th>{tr('MOTIF', 'REASON')}</th><th>{tr('AVANT / APRÈS', 'BEFORE / AFTER')}</th></tr></thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td className="date-cell">{new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(row.at))}</td>
                <td>{row.user}</td><td>{row.device}</td>
                <td><span className={`sg-badge ${row.action === 'delete' ? 'warn' : row.action === 'create' ? 'good' : ''}`}>{actions[row.action]}</span></td>
                <td className="audit-record">{tr(...(collectionNames[row.collection] ?? [row.collection, row.collection]))} · <strong>{row.recordId}</strong></td>
                <td>{row.reason}</td>
                <td><details className="dk-diff"><summary>{tr('Voir', 'View')}</summary>
                  {row.before !== null && <><small>{tr('Avant', 'Before')}</small><pre>{JSON.stringify(row.before, null, 1)}</pre></>}
                  {row.after !== null && <><small>{tr('Après', 'After')}</small><pre>{JSON.stringify(row.after, null, 1)}</pre></>}
                </details></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : <div className="empty-state">{tr('Aucune activité enregistrée.', 'No recorded activity.')}</div>}
      {data.total > pageSize && <div className="invoice-footer">
        <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, data.total)} / {data.total}</span>
        <div className="row-actions">
          <button className="approve-button" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{tr('Plus récent', 'Newer')}</button>
          <button className="approve-button" type="button" disabled={(page + 1) * pageSize >= data.total} onClick={() => setPage(page + 1)}>{tr('Plus ancien', 'Older')}</button>
        </div>
      </div>}
    </section>
  )
}

function SettingsDialog({ api, state, store, tr, locale, notify, refresh, loadStore, onStore, onClose }: {
  api: DesktopApi; state: DesktopState; store: Store; tr: Translate; locale: Locale; notify: (message: string) => void
  refresh: () => Promise<DesktopState>; loadStore: () => Promise<void>; onStore: (next: Store, action: string) => void; onClose: () => void
}) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [companyName, setCompanyName] = useState(store.company)
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [quota, setQuota] = useState<{ limit?: number; usage?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const gigabytes = (bytes?: number) => bytes === undefined ? '—' : `${(bytes / 1024 ** 3).toFixed(1)} ${tr('Go', 'GB')}`
  const sync = syncLabel(state.sync, state.localOnly, tr)

  useEffect(() => {
    if (!state.account) return
    void api.listRevisions().then(setRevisions).catch(() => setRevisions([]))
    void api.storageQuota().then(setQuota)
  }, [api, state.account, state.sync.lastSyncAt])

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await work()
      if (done) notify(done)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  const confirmThen = (question: string, work: () => Promise<unknown>, done?: string) => { if (window.confirm(question)) void run(work, done) }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="import-dialog dk-dialog dk-settings" role="dialog" aria-modal="true" aria-labelledby="dk-settings-title">
        <div className="import-dialog-header"><div><span className="import-dialog-icon"><Settings size={18} /></span><div><h2 id="dk-settings-title">{tr('Paramètres', 'Settings')}</h2><p>AICOM {state.version} · {state.device}</p></div></div><button className="icon-button" type="button" aria-label={tr('Fermer', 'Close')} onClick={onClose}><X size={16} /></button></div>
        <div className="dk-settings-body">
          <h3><Building2 size={14} />{tr('Entreprise', 'Company')}</h3>
          <div className="sg-form dk-inline-form">
            <label>{tr('Nom', 'Name')}<input value={companyName} maxLength={120} onChange={(event) => setCompanyName(event.target.value)} onBlur={() => { if (companyName.trim() && companyName.trim() !== store.company) onStore({ ...store, company: companyName.trim() }, 'Changed company settings') }} /></label>
            <label>{tr('Devise', 'Currency')}<select value={store.currency} onChange={(event) => onStore({ ...store, currency: event.target.value }, 'Changed company settings')}>{currencies.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label>{tr('TVA par défaut', 'Default VAT')}<select value={String(store.defaultVat)} onChange={(event) => onStore({ ...store, defaultVat: Number(event.target.value) }, 'Changed company settings')}>{Array.from(new Set([...vatRatesOf(store).map(String), String(store.defaultVat)])).map((rate) => <option key={rate} value={rate}>{rate === '0' ? tr('Sans TVA (0 %)', 'No VAT (0%)') : `${rate} %`}</option>)}</select></label>
          </div>
          <p className="dk-note">{tr('Pays', 'Country')} : {countries.find((item) => item.code === store.country)?.[locale === 'fr' ? 'fr' : 'en'] ?? '—'} · {tr('Plan comptable', 'Chart of accounts')} : {store.chart === 'syscohada' ? tr('SYSCOHADA révisé', 'Revised SYSCOHADA') : tr('plan comptable général français', 'French general chart')}</p>
          <p className="dk-note">{tr('La devise change seulement l’affichage des montants. Le taux de TVA s’applique aux nouveaux articles et documents, pas à ceux déjà enregistrés.', 'The currency only changes how amounts are displayed. The VAT rate applies to new items and documents, not to those already saved.')}</p>

          <h3><Cloud size={14} />{tr('Compte Google et synchronisation', 'Google account and sync')}</h3>
          <dl className="dk-summary">
            <div><dt>{tr('Compte', 'Account')}</dt><dd>{state.account?.email ?? tr('Aucun : données sur ce PC uniquement', 'None: data on this PC only')}</dd></div>
            <div><dt>{tr('État', 'Status')}</dt><dd>{sync.text}</dd></div>
            {quota && <div><dt>{tr('Espace Google utilisé', 'Google storage used')}</dt><dd>{gigabytes(quota.usage)} / {gigabytes(quota.limit)}</dd></div>}
          </dl>
          <div className="dk-buttons">
            {!state.account && state.googleConfigured && <button className="primary-button" type="button" disabled={busy} onClick={() => { void run(async () => { await api.connectGoogle(); await refresh(); await loadStore() }, tr('Compte Google connecté. Vos données sont maintenant enregistrées sur votre Drive.', 'Google account connected. Your data are now saved to your Drive.')) }}>
              {busy ? <LoaderCircle className="spin-icon" size={14} /> : <Cloud size={14} />}{busy ? tr('En attente de la connexion dans votre navigateur…', 'Waiting for sign-in in your browser…') : tr('Connecter un compte Google', 'Connect a Google account')}</button>}
            <button className="approve-button" type="button" disabled={busy || !state.account} onClick={() => { void run(() => api.syncNow()) }}><RefreshCw size={12} />{tr('Synchroniser maintenant', 'Sync now')}</button>
            {state.account && <button className="approve-button" type="button" disabled={busy} onClick={() => confirmThen(
              tr('Déconnecter ce compte Google ? Vos données restent sur ce PC et sur votre Drive ; vous pourrez vous reconnecter, avec ce compte ou un autre.', 'Disconnect this Google account? Your data stay on this PC and in your Drive; you can sign in again with this or another account.'),
              async () => { await api.disconnectGoogle(); await refresh(); onClose() })}><LogOut size={12} />{tr('Déconnecter ou changer de compte', 'Disconnect or switch account')}</button>}
          </div>

          {!state.account && state.googleConfigured && <p className="dk-note">{tr('Votre navigateur s’ouvre sur la page Google où vous choisissez votre adresse e-mail. Les données saisies en mode local seront transférées sur ce compte s’il ne contient pas encore de données AICOM.', 'Your browser opens on the Google page where you choose your e-mail address. Data entered in local mode will move to this account if it holds no AICOM data yet.')}</p>}
          {!state.account && !state.googleConfigured && <div className="dk-setup">
            {state.devMode && <strong>{tr('Connexion Google : une étape manque', 'Google sign-in: one step is missing')}</strong>}
            {state.devMode && <p>{tr('Avant de pouvoir choisir une adresse e-mail, AICOM doit être déclaré auprès de Google. Créez un « ID client OAuth » de type « Application de bureau » dans la console Google Cloud (gratuit), puis collez ici ses deux valeurs.', 'Before an e-mail address can be chosen, AICOM must be registered with Google. Create an “OAuth client ID” of type “Desktop app” in the Google Cloud console (free), then paste its two values here.')}</p>}
            {state.devMode ? <>
              <div className="sg-form">
                <label>{tr('ID client', 'Client ID')}<input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" spellCheck={false} /></label>
                <label>{tr('Code secret du client', 'Client secret')}<input value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="GOCSPX-…" spellCheck={false} /></label>
              </div>
              <div className="dk-buttons">
                <button className="approve-button" type="button" onClick={() => { void api.openExternal('https://console.cloud.google.com/auth/clients') }}>{tr('Ouvrir la console Google', 'Open the Google console')}</button>
                <button className="primary-button" type="button" disabled={busy || !clientId.trim().endsWith('.apps.googleusercontent.com')} onClick={() => { void run(async () => { await api.setGoogleClient(clientId, clientSecret); await refresh() }, tr('Connexion Google configurée. Vous pouvez maintenant connecter votre compte.', 'Google sign-in configured. You can now connect your account.')) }}>{tr('Enregistrer', 'Save')}</button>
              </div>
            </> : <p>{state.license.trial ? tr('Cette version d’essai fonctionne sans compte Google : vos données restent sur ce PC. Pensez à exporter une sauvegarde.', 'This trial version works without a Google account: your data stay on this PC. Remember to export a backup.') : tr('Cette installation n’a pas été configurée par l’éditeur. Contactez le support.', 'This installation was not configured by the publisher. Contact support.')}</p>}
          </div>}

          <h3><HardDrive size={14} />{tr('Sauvegardes', 'Backups')}</h3>
          <p className="dk-note">{tr('Google Drive conserve les versions précédentes du fichier de données (environ 30 jours). La restauration sauvegarde d’abord l’état actuel sur ce PC.', 'Google Drive keeps earlier versions of the data file (about 30 days). Restoring first saves the current state on this PC.')}</p>
          {revisions && revisions.length > 0 && <ul className="dk-revisions">
            {revisions.slice(0, 8).map((revision, index) => (
              <li key={revision.id}><span>{new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(revision.modifiedTime))}{index === 0 && ` · ${tr('version actuelle', 'current version')}`}</span>
                {index > 0 && <button className="approve-button" type="button" disabled={busy} onClick={() => confirmThen(tr('Restaurer cette version ? Elle remplacera les données actuelles sur tous vos PC.', 'Restore this version? It will replace the current data on all your PCs.'), async () => { await api.restoreRevision(revision.id); await loadStore() }, tr('Version restaurée.', 'Version restored.'))}>{tr('Restaurer', 'Restore')}</button>}</li>
            ))}
          </ul>}
          <div className="dk-buttons">
            <button className="approve-button" type="button" disabled={busy} onClick={() => { void run(async () => { const file = await api.exportBackup(); if (file) notify(tr(`Sauvegarde enregistrée : ${file}`, `Backup saved: ${file}`)) }) }}>{tr('Exporter une sauvegarde…', 'Export a backup…')}</button>
            <button className="approve-button" type="button" disabled={busy} onClick={() => confirmThen(tr('Importer une sauvegarde ? Elle remplacera les données actuelles.', 'Import a backup? It will replace the current data.'), async () => { if (await api.importBackup()) { await loadStore(); notify(tr('Sauvegarde importée.', 'Backup imported.')) } })}>{tr('Importer une sauvegarde…', 'Import a backup…')}</button>
            <button className="approve-button" type="button" onClick={() => exportWorkbook(store)}><FileSpreadsheet size={12} />{tr('Exporter les données en Excel', 'Export data to Excel')}</button>
          </div>

          <h3><Trash2 size={14} />{tr('Repartir de zéro', 'Start from scratch')}</h3>
          <p className="dk-note">{tr('Supprime les clients, fournisseurs, articles, documents, écritures, factures et mouvements bancaires — par exemple les données d’exemple — et garde le nom de l’entreprise, le plan comptable et les journaux. Une sauvegarde est enregistrée sur ce PC juste avant.', 'Deletes customers, suppliers, items, documents, entries, invoices and bank lines — for instance the sample data — and keeps the company name, the chart of accounts and the journals. A backup is saved on this PC just before.')}</p>
          <div className="dk-buttons"><button className="approve-button dk-danger" type="button" disabled={busy} onClick={() => confirmThen(
            tr('Supprimer toutes les données de cette entreprise et repartir de zéro ?', 'Delete all the data of this company and start from scratch?'),
            async () => {
              const file = await api.backupNow()
              onStore({ ...createEmptyStore(store.company, { currency: store.currency, defaultVat: store.defaultVat, chart: store.chart, country: store.country }), accounts: store.accounts, journals: store.journals }, 'Emptied company data')
              notify(tr(`Données supprimées. Sauvegarde : ${file}`, `Data deleted. Backup: ${file}`))
              onClose()
            })}><Trash2 size={12} />{tr('Supprimer toutes les données', 'Delete all data')}</button></div>

          <h3><KeyRound size={14} />{tr('Licence', 'Licence')}</h3>
          <dl className="dk-summary">
            <div><dt>{tr('Titulaire', 'Holder')}</dt><dd>{licenceLabel(state.license, tr)}</dd></div>
            {!state.license.dev && !state.license.trial && <div><dt>{tr('Échéance', 'Expiry')}</dt><dd>{state.license.expires ?? tr('Sans échéance', 'No expiry')}</dd></div>}
            {state.license.validUntil && <div><dt>{tr('Utilisable hors ligne jusqu’au', 'Usable offline until')}</dt><dd>{new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium' }).format(new Date(state.license.validUntil))}</dd></div>}
          </dl>
          {!state.license.dev && !state.license.trial && <div className="dk-buttons"><button className="approve-button" type="button" disabled={busy} onClick={() => confirmThen(tr('Libérer la licence de ce PC ? AICOM demandera un code de licence au prochain démarrage.', 'Release the licence from this PC? AICOM will ask for a licence code next time.'), async () => { await api.deactivateLicense(); await refresh(); onClose() })}>{tr('Libérer la licence de ce PC', 'Release the licence from this PC')}</button></div>}

          {state.auth.user && <UsersSettings api={api} state={state} tr={tr} notify={notify} />}

          <h3><ShieldCheck size={14} />{tr('Confidentialité et mises à jour', 'Privacy and updates')}</h3>
          <label className="dk-check"><input type="checkbox" checked={state.errorReports} onChange={(event) => { void run(async () => { await api.setErrorReports(event.target.checked); await refresh() }) }} />{tr('Envoyer des rapports d’erreur anonymes (données techniques uniquement, jamais vos données comptables)', 'Send anonymous error reports (technical data only, never your accounting data)')}</label>
          <div className="dk-buttons"><button className="approve-button" type="button" disabled={busy} onClick={() => { void run(async () => { const update = await api.checkUpdate(); notify(update.status === 'idle' ? tr('AICOM est à jour.', 'AICOM is up to date.') : tr(`Version ${update.version} disponible.`, `Version ${update.version} available.`)) }) }}>{tr('Rechercher une mise à jour', 'Check for updates')}</button></div>
        </div>
      </section>
    </div>
  )
}
