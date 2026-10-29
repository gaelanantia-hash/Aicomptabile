// Sign-in screen: password or recovery code, before the data are opened.
import { useState } from 'react'
import { LoaderCircle, LockKeyhole } from 'lucide-react'
import type { DesktopApi, DesktopState } from '../desktopApi'
import logoMark from '../assets/aicom-mark.webp'
import { type Locale, type Translate, authMessage } from './helpers'
import { PasswordInput, RecoveryCode } from './fields'

/** Asked every time the application opens, once accounts exist. */
export function SignIn({ api, state, locale, setLocale, tr, onSignedIn }: { api: DesktopApi; state: DesktopState; locale: Locale; setLocale: (locale: Locale) => void; tr: Translate; onSignedIn: () => Promise<void> }) {
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
