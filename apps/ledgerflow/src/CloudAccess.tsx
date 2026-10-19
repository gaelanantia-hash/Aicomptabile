import { useEffect, useState } from 'react'
import { Building2, Cloud, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { sendEmailVerification, type User } from '@firebase/auth'
import { cloudRequest, createAccount, sendPasswordReset, signIn, signOutAccount, subscribeToAuth, type CloudWorkspace } from './cloudClient'
import logoMark from './assets/aicom-mark.webp'
import './CloudAccess.css'

type PortalLocale = 'fr' | 'en'
type CloudSession = { user: User; workspace: CloudWorkspace }
type CloudAccessProps = { children: (session: CloudSession) => React.ReactNode }

const labels = {
  fr: {
    signIn: 'Connexion', signUp: 'Créer un compte', email: 'Adresse e-mail', password: 'Mot de passe',
    passwordHint: '12 caractères minimum', continue: 'Continuer', forgot: 'Mot de passe oublié ?',
    verifyTitle: 'Vérifiez votre adresse e-mail', verifyText: 'Ouvrez le lien reçu par e-mail, puis reconnectez-vous pour accéder à votre espace.',
    signOut: 'Se déconnecter', loading: 'Connexion sécurisée…', resetSent: 'Lien de réinitialisation envoyé.',
    company: 'Nom de l’entreprise', createWorkspace: 'Créer l’espace', workspaceTitle: 'Créer votre espace AICOM',
    workspaceText: 'Choisissez une capacité de stockage. Elle couvre les documents de votre entreprise dans l’espace AICOM.',
    storage: 'Quota documentaire', choose: 'Choisir', gb10: '10 Go', gb50: '50 Go', gb200: '200 Go',
    cloudManaged: 'Hébergement Google Cloud géré par AICOM', protected: 'Accès protégé par compte et vérification d’e-mail',
    workspaceError: 'Impossible de charger votre espace. Réessayez.', authError: 'Connexion impossible. Vérifiez vos informations et réessayez.',
    createError: 'Impossible de créer l’espace. Réessayez.', pending: 'Chargement de vos espaces…',
    noWorkspace: 'Aucun espace associé à votre compte.', already: 'Vous avez déjà un compte ?', newAccount: 'Nouveau sur AICOM ?',
    useLogin: 'Se connecter', useRegister: 'Créer un compte', reset: 'Envoyer le lien',
  },
  en: {
    signIn: 'Sign in', signUp: 'Create account', email: 'Email address', password: 'Password',
    passwordHint: 'At least 12 characters', continue: 'Continue', forgot: 'Forgot password?',
    verifyTitle: 'Verify your email address', verifyText: 'Open the link we sent by email, then sign in again to access your workspace.',
    signOut: 'Sign out', loading: 'Securing your session…', resetSent: 'Password reset link sent.',
    company: 'Company name', createWorkspace: 'Create workspace', workspaceTitle: 'Create your AICOM workspace',
    workspaceText: 'Choose a storage quota for your company documents in AICOM.',
    storage: 'Document storage quota', choose: 'Choose', gb10: '10 GB', gb50: '50 GB', gb200: '200 GB',
    cloudManaged: 'Google Cloud hosting managed by AICOM', protected: 'Account access with verified email',
    workspaceError: 'Could not load your workspace. Try again.', authError: 'Sign-in failed. Check your details and try again.',
    createError: 'Could not create the workspace. Try again.', pending: 'Loading your workspaces…',
    noWorkspace: 'No workspace is linked to your account.', already: 'Already have an account?', newAccount: 'New to AICOM?',
    useLogin: 'Sign in', useRegister: 'Create an account', reset: 'Send reset link',
  },
} as const

export function CloudAccess({ children }: CloudAccessProps) {
  const [locale, setLocale] = useState<PortalLocale>('fr')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([])
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('')
  const t = labels[locale]

  useEffect(() => subscribeToAuth((nextUser) => {
    setUser(nextUser)
    setAuthLoading(false)
    setWorkspaceLoading(Boolean(nextUser?.emailVerified))
    setWorkspaceError('')
    if (!nextUser?.emailVerified) {
      setWorkspaces([])
      setActiveWorkspaceId('')
    }
  }), [])

  useEffect(() => {
    if (!user?.emailVerified) return
    let active = true
    cloudRequest<{ workspaces: CloudWorkspace[] }>(user, '/api/workspaces')
      .then((result) => {
        if (active) {
          setWorkspaces(result.workspaces)
          setActiveWorkspaceId((current) => result.workspaces.some((workspace) => workspace.id === current) ? current : result.workspaces[0]?.id ?? '')
        }
      })
      .catch(() => { if (active) setWorkspaceError(t.workspaceError) })
      .finally(() => { if (active) setWorkspaceLoading(false) })
    return () => { active = false }
  }, [user, t.workspaceError])

  if (authLoading) return <PortalMessage label={t.loading} />
  if (!user) return <AuthForm locale={locale} setLocale={setLocale} />
  if (!user.emailVerified) return <VerifyEmail user={user} locale={locale} setLocale={setLocale} />
  if (workspaceLoading) return <PortalMessage label={t.pending} />
  if (workspaceError) return <PortalMessage label={workspaceError} action={t.signOut} onAction={() => { void signOutAccount() }} />
  if (workspaces.length === 0) return <WorkspaceForm user={user} locale={locale} setLocale={setLocale} />

  const workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0]
  return <>{children({ user, workspace })}</>
}

function PortalFrame({ locale, setLocale, children }: { locale: PortalLocale; setLocale: (locale: PortalLocale) => void; children: React.ReactNode }) {
  return <main className="portal-shell"><header className="portal-header"><a className="portal-brand" href="/" aria-label="AICOM"><img className="brand-mark" src={logoMark} alt="" />AICOM</a><button className="portal-language" type="button" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}>{locale.toUpperCase()}</button></header><div className="portal-content">{children}<footer className="portal-footer"><span><LockKeyhole size={13} />{labels[locale].cloudManaged}</span><span><ShieldCheck size={13} />{labels[locale].protected}</span></footer></div></main>
}

function AuthForm({ locale, setLocale }: { locale: PortalLocale; setLocale: (locale: PortalLocale) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const t = labels[locale]
  const heading = mode === 'register' ? t.signUp : mode === 'reset' ? t.reset : t.signIn

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (mode === 'register') await createAccount(email, password)
      else if (mode === 'reset') {
        await sendPasswordReset(email)
        setMessage(t.resetSent)
      } else await signIn(email, password)
    } catch {
      setMessage(t.authError)
    } finally { setBusy(false) }
  }

  return <PortalFrame locale={locale} setLocale={setLocale}><section className="portal-panel"><div className="portal-icon"><Cloud size={21} /></div><div className="portal-eyebrow">AICOM · FINANCE CLOUD</div><h1>{heading}</h1><p className="portal-description">{locale === 'fr' ? 'Vos données comptables, disponibles dans un espace sécurisé.' : 'Your accounting data, available in a secure workspace.'}</p><form className="portal-form" onSubmit={(event) => { void submit(event) }}><label>{t.email}<span className="portal-input-wrap"><Mail size={15} /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></span></label>{mode !== 'reset' && <label>{t.password}<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : 1} required value={password} onChange={(event) => setPassword(event.target.value)} />{mode === 'register' && <small>{t.passwordHint}</small>}</label>}{message && <p className="portal-error" role="status">{message}</p>}<button className="portal-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin-icon" size={16} /> : null}{mode === 'reset' ? t.reset : t.continue}</button></form>{mode === 'login' && <button className="portal-link forgot-link" type="button" onClick={() => { setMode('reset'); setMessage('') }}>{t.forgot}</button>}<div className="portal-switch">{mode === 'register' ? t.already : t.newAccount}<button className="portal-link" type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setMessage('') }}>{mode === 'register' ? t.useLogin : t.useRegister}</button></div></section></PortalFrame>
}

function VerifyEmail({ user, locale, setLocale }: { user: User; locale: PortalLocale; setLocale: (locale: PortalLocale) => void }) {
  const [message, setMessage] = useState('')
  const t = labels[locale]
  return <PortalFrame locale={locale} setLocale={setLocale}><section className="portal-panel"><div className="portal-icon"><Mail size={21} /></div><div className="portal-eyebrow">AICOM · FINANCE CLOUD</div><h1>{t.verifyTitle}</h1><p className="portal-description">{t.verifyText}</p><p className="verified-email">{user.email}</p>{message && <p className="portal-error" role="status">{message}</p>}<button className="portal-submit" type="button" onClick={() => { void signOutAccount() }}>{t.signOut}</button><button className="portal-link reset-link" type="button" onClick={() => { void sendEmailVerification(user).then(() => setMessage(locale === 'fr' ? 'E-mail envoyé.' : 'Verification email sent.')).catch(() => setMessage(t.authError)) }}>{locale === 'fr' ? 'Renvoyer l’e-mail' : 'Resend email'}</button></section></PortalFrame>
}

function WorkspaceForm({ user, locale, setLocale }: { user: User; locale: PortalLocale; setLocale: (locale: PortalLocale) => void }) {
  const [name, setName] = useState('')
  const [quotaGiB, setQuotaGiB] = useState(10)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const t = labels[locale]

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await cloudRequest(user, '/api/workspaces', { method: 'POST', body: JSON.stringify({ name, quotaGiB }) })
      window.location.reload()
    } catch {
      setError(t.createError)
    } finally { setBusy(false) }
  }

  return <PortalFrame locale={locale} setLocale={setLocale}><section className="portal-panel workspace-panel"><div className="portal-icon"><Building2 size={21} /></div><div className="portal-eyebrow">AICOM · FINANCE CLOUD</div><h1>{t.workspaceTitle}</h1><p className="portal-description">{t.workspaceText}</p><form className="portal-form" onSubmit={(event) => { void createWorkspace(event) }}><label>{t.company}<input autoComplete="organization" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><fieldset className="quota-fieldset"><legend>{t.storage}</legend><div className="quota-options">{[10, 50, 200].map((quota) => <label className={`quota-option ${quotaGiB === quota ? 'selected' : ''}`} key={quota}><input type="radio" name="quota" value={quota} checked={quotaGiB === quota} onChange={() => setQuotaGiB(quota)} /><strong>{quota} {locale === 'fr' ? 'Go' : 'GB'}</strong><small>{t.choose}</small></label>)}</div></fieldset>{error && <p className="portal-error" role="alert">{error}</p>}<button className="portal-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin-icon" size={16} /> : null}{t.createWorkspace}</button></form><button className="portal-link reset-link" type="button" onClick={() => { void signOutAccount() }}>{t.signOut}</button></section></PortalFrame>
}

function PortalMessage({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  return <main className="portal-loading"><LoaderCircle className="spin-icon" size={22} /><span>{label}</span>{action && <button type="button" onClick={onAction}>{action}</button>}</main>
}

export type { CloudSession }