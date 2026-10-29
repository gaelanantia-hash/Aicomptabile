// Activity log and access history.
import { useEffect, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import type { AccessEvent, AccessRow, AuditRow, DesktopApi } from '../desktopApi'
import { downloadXlsx } from '../xlsx'
import type { Locale, Translate } from './helpers'

const collectionNames: Record<string, [string, string]> = {
  clients: ['Client', 'Customer'], suppliers: ['Fournisseur', 'Supplier'], articles: ['Article', 'Item'], salesDocs: ['Document de vente', 'Sales document'],
  purchaseDocs: ['Document d’achat', 'Purchase document'], boms: ['Nomenclature', 'Bill of materials'], workOrders: ['Ordre de fabrication', 'Production order'],
  accounts: ['Compte', 'Account'], journals: ['Journal', 'Journal'], entries: ['Écriture', 'Entry'], groups: ['Groupe de commandes', 'Command group'], settings: ['Paramètre', 'Setting'],
}

export function AuditSection(props: { api: DesktopApi; tr: Translate; locale: Locale; revision: unknown }) {
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
