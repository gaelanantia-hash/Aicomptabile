// The main window once signed in: navigation, sync status, banners and the working screens.
import { Suspense, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Building2, Check, ChevronDown, Cloud, CloudOff, LoaderCircle, LogOut, RefreshCw, Settings, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { DesktopApi, DesktopState } from '../desktopApi'
import { ledgerViolation, type LedgerViolation, type Store } from '../sageData'
import logoMark from '../assets/aicom-mark.webp'
import { type Locale, type Section, type Translate, licenceLabel, modules, syncLabel, workspace } from './helpers'
import { FinanceView, SageModules } from './screens'
import { AuditSection } from './audit'
import { SettingsDialog } from './settings'

function violationMessage(violation: LedgerViolation, tr: Translate) {
  switch (violation.kind) {
    case 'removed':
    case 'changed': return tr(`La pièce ${violation.piece} est comptabilisée : elle ne peut plus être modifiée ni supprimée. Contre-passez-la.`, `Document ${violation.piece} is posted: it can no longer be changed or deleted. Reverse it instead.`)
    case 'unbalanced': return tr(`La pièce ${violation.piece} n’est pas équilibrée : elle n’a pas été enregistrée.`, `Document ${violation.piece} does not balance: it was not saved.`)
    case 'closedPeriod': return tr(`La période ${violation.period} est clôturée : rien n’a été enregistré.`, `Period ${violation.period} is closed: nothing was saved.`)
    case 'closedYear': return tr(`L’exercice ${violation.period.slice(0, 4)} est clôturé définitivement : ses mois ne peuvent pas être rouverts.`, `Financial year ${violation.period.slice(0, 4)} is closed for good: its months cannot be reopened.`)
  }
}

export function Workspace({ api, state, store, setStore, locale, setLocale, tr, refresh, loadStore, onAction, onSignOut }: {
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

  // Every change made from the screens goes through the OHADA checks on posted entries; a change that breaks them is not kept.
  // The screens already prevent these cases, so this is a safety net; an alert, because a screen's own toast would follow and hide it.
  function applyStore(next: SetStateAction<Store>) {
    const value = typeof next === 'function' ? next(store) : next
    const violation = ledgerViolation(store, value)
    if (violation) {
      window.alert(violationMessage(violation, tr))
      return
    }
    setStore(value)
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
          {activeModule && <SageModules module={activeModule.id} initialActivity={focus} admin={state.auth.user?.role === 'admin'} locale={locale} store={store} setStore={applyStore} money={money} notify={notify} audit={onAction} onModule={(id) => go(id)}
            savePdf={(name) => { void api.savePdf(name).then((file) => { if (file) notify(tr(`PDF enregistré : ${file}`, `PDF saved: ${file}`)) }) }} />}
          {activeWorkspace && activeWorkspace.id !== 'audit' && <div className="sg-module"><FinanceView section={activeWorkspace.id} admin={state.auth.user?.role === 'admin'} store={store} apply={applyStore} tr={tr} money={money} day={day} notify={notify} audit={onAction} go={go} savePdf={(name) => api.savePdf(name)} /></div>}
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
