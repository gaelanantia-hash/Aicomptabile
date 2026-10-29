import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { LoaderCircle, MonitorSmartphone, TriangleAlert } from 'lucide-react'
import type { DesktopApi, DesktopState, SyncState } from './desktopApi'
import type { Store } from './sageData'
import { fromSnapshot, toSnapshot } from './sageSnapshot'
import logo from './assets/aicom-logo.webp'
import type { Locale, Translate } from './desktop/helpers'
import { preloadScreens } from './desktop/screens'
import { SignIn } from './desktop/signIn'
import { Setup } from './desktop/setup'
import { Workspace } from './desktop/workspace'
import './App.css'
import './CloudAccess.css'
import './DesktopApp.css'

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
