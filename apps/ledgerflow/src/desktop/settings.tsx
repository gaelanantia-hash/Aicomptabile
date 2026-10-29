// Settings dialog: company, users, Google account, data and updates.
import { useCallback, useEffect, useState } from 'react'
import { Building2, Cloud, FileSpreadsheet, HardDrive, KeyRound, LoaderCircle, LogOut, RefreshCw, Settings, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import type { AppUser, AuthResult, DesktopApi, DesktopState, Revision } from '../desktopApi'
import { exportWorkbook } from '../sageExport'
import { countries, createEmptyStore, vatRatesOf, type CompanyInfo, type Store } from '../sageData'
import { type Locale, type Translate, authMessage, currencies, errorMessage, licenceLabel, syncLabel } from './helpers'
import { PasswordInput, RecoveryCode } from './fields'

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

/** The details printed on invoices; each field is saved when the user leaves it. */
function CompanyInfoForm({ store, tr, onStore }: { store: Store; tr: Translate; onStore: (next: Store, action: string) => void }) {
  const [info, setInfo] = useState<CompanyInfo>(store.companyInfo)
  const taxIdLabel = countries.find((item) => item.code === store.country)?.taxIdLabel ?? 'NIF'
  const fields: [keyof CompanyInfo, string][] = [
    ['address', tr('Adresse', 'Address')], ['city', tr('Ville', 'City')], ['phone', tr('Téléphone', 'Phone')], ['email', 'E-mail'],
    ['taxId', taxIdLabel], ['rccm', 'RCCM'], ...(store.country === 'CD' ? [['nationalId', tr('Identification nationale', 'National ID')]] satisfies [keyof CompanyInfo, string][] : []),
    ['taxRegime', tr('Régime fiscal', 'Tax regime')], ['taxOffice', tr('Centre des impôts', 'Tax office')], ['bank', tr('Banque et RIB', 'Bank account')],
  ]
  const commit = () => { if (fields.some(([key]) => info[key] !== store.companyInfo[key])) onStore({ ...store, companyInfo: { ...info } }, 'Changed company settings') }
  return (
    <>
      <p className="dk-note">{tr('Ces informations sont imprimées sur les factures, comme la loi l’exige.', 'These details are printed on invoices, as the law requires.')}</p>
      <div className="sg-form dk-inline-form">
        {fields.map(([key, label]) => <label key={key}>{label}<input value={info[key]} maxLength={160} onChange={(event) => setInfo({ ...info, [key]: event.target.value })} onBlur={commit} /></label>)}
      </div>
    </>
  )
}

export function SettingsDialog({ api, state, store, tr, locale, notify, refresh, loadStore, onStore, onClose }: {
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
      const message = errorMessage(error, tr)
      if (message) notify(message)
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
          <CompanyInfoForm store={store} tr={tr} onStore={onStore} />
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
