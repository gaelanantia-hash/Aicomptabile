// First-run wizard: licence, Google account, company and first user.
import { useState } from 'react'
import { Building2, Check, Cloud, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react'
import type { DesktopApi, DesktopState } from '../desktopApi'
import { countries, createEmptyStore, createStore, setupFor, vatRatesOf, type Store } from '../sageData'
import logoMark from '../assets/aicom-mark.webp'
import { type Locale, type Translate, authMessage, currencies, errorMessage, licenceLabel, licenseMessages, syncLabel } from './helpers'
import { PasswordInput, RecoveryCode } from './fields'

export function Setup({ api, state, store, locale, setLocale, tr, refresh, loadStore, onCreate, onFinish }: {
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
      setMessage(errorMessage(error, tr))
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
              <div className="portal-form">
                {state.license.reason === 'reauth'
                  ? <button className="portal-submit" type="button" disabled={busy} onClick={() => { void connect() }}>{busy && <LoaderCircle className="spin-icon" size={16} />}{tr('Reconnecter Google', 'Reconnect Google')}</button>
                  : <button className="portal-submit" type="button" disabled={busy} onClick={() => { void retryAccount() }}>{busy && <LoaderCircle className="spin-icon" size={16} />}{tr('Réessayer', 'Try again')}</button>}
              </div>
              {state.license.reason !== 'reauth' && <button className="portal-link" type="button" disabled={busy} onClick={() => { void connect() }}>{tr('Utiliser un autre compte Google', 'Use another Google account')}</button>}
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
