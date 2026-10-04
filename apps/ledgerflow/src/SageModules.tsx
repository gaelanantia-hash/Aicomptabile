import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ArrowRight, Check, CheckCircle2, ChevronRight, FileDown, FileSpreadsheet, Link2, LockKeyhole, LockKeyholeOpen, Pencil, Plus, Printer, Trash2, Undo2 } from 'lucide-react'
import {
  accountsOf, addDays, chartOf, roundAmount, vatRatesOf, advancePurchaseDoc, advanceSalesDoc, articleInUse, registerSupplierInvoice, autoLetter, completeWorkOrder, docTotals, isTiersAccount, isoDate, tiersInUse,
  missingComponent, movesStock, nextNumber, nextSalesType, postPiece, purchaseTypes, round2, sageModules, salesTypes,
  saveSalesDoc, savePurchaseDoc, shortage, supplierStockAnalysis, tiersBalance, tiersName,
  type Article, type Client, type DocLine, type Entry, type ModuleId, type Origin, type Payment, type PieceLine,
  type PurchaseDoc, type PurchaseDocType, type SalesDoc, type SalesDocType, type Store, type Supplier,
} from './sageData'
import { entriesSheet } from './sageExport'
import { downloadXlsx, type Sheet } from './xlsx'
import './SageModules.css'

type Locale = 'en' | 'fr'
type Ctx = {
  tr: (fr: string, en: string) => string
  store: Store
  apply: (next: Store) => void
  money: (amount: number) => string
  day: (date: string) => string
  notify: (message: string) => void
  audit: (action: string, record: string) => void
  closed: (date: string) => boolean
  savePdf?: (name: string) => void
}
type ViewProps = { ctx: Ctx }
type DraftLine = { ref: string; qty: string; price: string }

const commercialGuidance: Record<string, { fr: string; en: string }> = {
  'gc.clients': {
    fr: 'Créer et mettre à jour les fiches clients : coordonnées et informations utiles pour les documents de vente.',
    en: 'Create and update customer records, including contact details used on sales documents.',
  },
  'gc.documents': {
    fr: 'Consulter les devis, commandes, livraisons et factures. Transformer un document en étape suivante ; le stock sort à la livraison.',
    en: 'Review quotes, orders, deliveries and invoices. Move a document to the next step; stock leaves when goods are delivered.',
  },
  'gc.saisie': {
    fr: 'Créer un document de vente en choisissant son type, son client et les articles. Utilisez cette entrée pour les documents autres qu’une commande directe.',
    en: 'Create a sales document by choosing its type, customer and items. Use this for documents other than a direct customer order.',
  },
  'gc.commande': {
    fr: 'Enregistrer directement une commande client avec les articles et quantités demandés ; elle ne sort pas encore le stock.',
    en: 'Record a customer order and its requested items and quantities; stock is not reduced yet.',
  },
  'gc.interrogation': {
    fr: 'Rechercher un client ou un article et consulter son activité, les quantités vendues et le stock disponible.',
    en: 'Find a customer or item and review its activity, quantities sold and available stock.',
  },
  'gc.achats': {
    fr: 'Saisir les achats avec articles et quantités. La facture fournisseur réceptionnée augmente le stock et comptabilise l’achat.',
    en: 'Record purchases with items and quantities. Receiving a supplier invoice increases stock and posts the purchase.',
  },
  'gc.articles': {
    fr: 'Créer et modifier les articles, leur prix d’achat, leur prix de vente, leur TVA et consulter leur stock.',
    en: 'Create and update items, purchase and sales prices, VAT, and view current stock.',
  },
  'gc.fabrications': {
    fr: 'Définir les composants nécessaires à un produit puis suivre sa fabrication : les composants sortent et le produit fini entre en stock.',
    en: 'Define the components needed for a product and record production: components leave stock and finished goods are added.',
  },
  'gc.inventaire': {
    fr: 'Saisir les quantités réellement comptées et valider les écarts pour corriger le stock théorique.',
    en: 'Enter physically counted quantities and validate differences to correct the recorded stock.',
  },
}

const emptyLine: DraftLine = { ref: '', qty: '1', price: '' }
const period = (date: string) => date.slice(0, 7)
const sum = (values: number[]) => round2(values.reduce((total, value) => total + value, 0))

function num(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function parseLines(store: Store, lines: DraftLine[]): DocLine[] {
  return lines.filter((line) => line.ref && num(line.qty) > 0).map((line) => ({
    ref: line.ref, qty: num(line.qty), price: num(line.price), vat: store.articles.find((article) => article.ref === line.ref)?.vat ?? store.defaultVat,
  }))
}

/** Rates offered in VAT lists: the usual ones, the company's own, and whatever the record already carries. */
function vatRates(store: Store, current: string) {
  return Array.from(new Set([...vatRatesOf(store).map(String), String(store.defaultVat), current])).filter(Boolean).sort((a, b) => Number(a) - Number(b))
}

function periodsOf(store: Store) {
  return Array.from(new Set([...store.entries.map((entry) => period(entry.date)), period(isoDate())])).sort()
}

function tiersOptions(store: Store, account: string) {
  if (account.startsWith('411')) return store.clients
  if (account.startsWith('401')) return store.suppliers
  return []
}

function stockAvailable(ctx: Ctx, lines: DocLine[]) {
  const missing = shortage(ctx.store, lines)
  if (missing) ctx.notify(ctx.tr(`Stock insuffisant pour ${missing}.`, `Not enough stock for ${missing}.`))
  return !missing
}

/** Asks before deleting; refuses, with the reason, when other records depend on this one. */
function confirmDelete(ctx: Ctx, label: string, blocked: string | false) {
  if (blocked) {
    ctx.notify(blocked)
    return false
  }
  return window.confirm(ctx.tr(`Supprimer ${label} ?`, `Delete ${label}?`))
}

function postManual(ctx: Ctx, journal: string, date: string, label: string, lines: PieceLine[]) {
  if (ctx.closed(date)) return false
  const next = postPiece(ctx.store, journal, date, label, lines)
  const piece = next.entries[next.entries.length - 1].piece
  ctx.apply(next)
  ctx.audit('Posted accounting piece', `${piece} · ${label}`)
  ctx.notify(ctx.tr(`Pièce ${piece} enregistrée dans le journal ${journal}.`, `Document ${piece} posted to journal ${journal}.`))
  return true
}

export function SageModules({ module, locale, store, setStore, money, notify, audit, onModule, savePdf, initialActivity }: {
  module: ModuleId
  locale: Locale
  store: Store
  setStore: Dispatch<SetStateAction<Store>>
  money: (amount: number) => string
  notify: (message: string) => void
  audit: (action: string, record: string) => void
  onModule: (module: ModuleId) => void
  savePdf?: (name: string) => void
  /** Activity to open first, when arriving from a link elsewhere in the app. */
  initialActivity?: string
}) {
  const [activeByModule, setActiveByModule] = useState<Record<ModuleId, string>>({ commercial: 'gc.clients', caisse: 'sc.clients', compta: 'cp.compte', ...(initialActivity ? { [module]: initialActivity } : {}) })
  const tr = (fr: string, en: string) => locale === 'fr' ? fr : en
  const current = sageModules.find((item) => item.id === module)!
  const active = activeByModule[module]
  const go = (id: string) => setActiveByModule((value) => ({ ...value, [module]: id }))
  const ctx: Ctx = {
    tr, store, money, notify, audit, savePdf,
    apply: (next) => setStore(next),
    day: (date) => {
      const [year, month, day] = date.split('-').map(Number)
      return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(year, month - 1, day))
    },
    closed: (date) => {
      if (!store.closedPeriods.includes(period(date))) return false
      notify(tr(`La période ${period(date)} est clôturée.`, `Period ${period(date)} is closed.`))
      return true
    },
  }

  return (
    <div className="sg-module">
      <div className="sg-flow sg-noprint">
        <span>{tr('Flux des données', 'Data flow')}</span>
        {sageModules.map((item, index) => (
          <span className="sg-flow-step" key={item.id}>
            {index > 0 && <ChevronRight size={13} />}
            <button className={item.id === module ? 'active' : ''} type="button" onClick={() => onModule(item.id)}>{tr(item.fr, item.en)}</button>
          </span>
        ))}
        <code>{current.sage}</code>
      </div>

      {module === 'caisse' && store.groups.length > 0 && <div className="sg-shortcuts sg-noprint">
        {store.groups.map((group) => (
          <div key={group.name}>
            <strong>{group.name}</strong>
            {group.activities.map((id) => {
              const activity = current.groups.flatMap((item) => item.activities).find((item) => item.id === id)
              return activity && <button key={id} type="button" onClick={() => go(id)}>{activity.sage}</button>
            })}
          </div>
        ))}
      </div>}

      <div className="sg-layout">
        <nav className="panel sg-menu sg-noprint" aria-label={current.sage}>
          {current.groups.map((group) => (
            <div className="sg-menu-group" key={group.sage}>
              <div className="sg-menu-caption">{tr(group.fr, group.en)}<code>{group.sage}</code></div>
              {group.activities.map((activity) => (
                <button className={`sg-menu-item ${active === activity.id ? 'active' : ''}`} key={activity.id} type="button" onClick={() => go(activity.id)}>
                  <span>{tr(activity.fr, activity.en)}{activity.optional && <em>{tr('facultatif', 'optional')}</em>}</span>
                  <code>{activity.sage}</code>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sg-work">
          {module === 'commercial' && commercialGuidance[active] && <div className="sg-guidance" role="note">
            <strong>{tr('À quoi sert cet onglet ?', 'What this tab is for')}</strong>
            <span>{tr(commercialGuidance[active].fr, commercialGuidance[active].en)}</span>
          </div>}
          <ActivityView key={active} id={active} ctx={ctx} />
        </div>
      </div>
    </div>
  )
}

export function ActivityView({ id, ctx }: ViewProps & { id: string }) {
  switch (id) {
    case 'gc.clients': return <ClientsView ctx={ctx} origin="commercial" />
    case 'gc.documents': return <SalesDocsView ctx={ctx} origin="commercial" />
    case 'gc.saisie': return <SalesDocForm ctx={ctx} origin="commercial" />
    case 'gc.commande': return <SalesDocForm ctx={ctx} origin="commercial" fixedType="commande" />
    case 'gc.interrogation': return <InterrogationView ctx={ctx} />
    case 'gc.achats': return <PurchasesView ctx={ctx} />
    case 'gc.articles': return <ArticlesView ctx={ctx} editable />
    case 'gc.fabrications': return <FabricationView ctx={ctx} />
    case 'gc.inventaire': return <InventoryView ctx={ctx} />
    case 'sc.clients': return <ClientsView ctx={ctx} origin="caisse" />
    case 'sc.documents': return <SalesDocsView ctx={ctx} origin="caisse" />
    case 'sc.saisie': return <SalesDocForm ctx={ctx} origin="caisse" />
    case 'sc.commande': return <SalesDocForm ctx={ctx} origin="caisse" fixedType="commande" />
    case 'sc.comptoir': return <CounterView ctx={ctx} />
    case 'sc.stocks': return <ArticlesView ctx={ctx} />
    case 'sc.groupe': return <GroupView ctx={ctx} />
    case 'cp.compte': return <AccountsView ctx={ctx} />
    case 'cp.journaux': return <JournalsView ctx={ctx} />
    case 'cp.piece': return <GuidedPieceView ctx={ctx} />
    case 'cp.operations': return <BankOperationView ctx={ctx} />
    case 'cp.ecritures': return <FreeEntryView ctx={ctx} />
    case 'cp.visualisation': return <EntriesView ctx={ctx} />
    case 'cp.recherche': return <SearchView ctx={ctx} />
    case 'cp.tiers': return <TiersView ctx={ctx} />
    case 'cp.avancees': return <AdvancedView ctx={ctx} />
    case 'cp.periodiques': return <PeriodicView ctx={ctx} />
    case 'cp.etats': return <ReportsView ctx={ctx} />
    default: return null
  }
}

function Panel({ title, subtitle, action, className = '', children }: { title: string; subtitle?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel sg-panel ${className}`}>
      <div className="panel-heading"><div><div className="panel-title">{title}</div>{subtitle && <div className="panel-subtitle">{subtitle}</div>}</div>{action}</div>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="sg-stat"><span>{label}</span><strong>{value}</strong></div>
}

function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn'; children: ReactNode }) {
  return <span className={`sg-badge ${tone}`}>{children}</span>
}

function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="sg-chips sg-noprint">{options.map(([id, label]) => <button className={value === id ? 'active' : ''} key={id} type="button" onClick={() => onChange(id)}>{label}</button>)}</div>
}

function SaveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <div className="sg-actions"><button className="primary-button" type="button" disabled={disabled} onClick={onClick}><Check size={14} />{label}</button></div>
}

function LinesEditor({ ctx, lines, onChange, atCost }: ViewProps & { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void; atCost?: boolean }) {
  const { tr, store, money } = ctx
  const update = (index: number, patch: Partial<DraftLine>) => onChange(lines.map((line, position) => position === index ? { ...line, ...patch } : line))
  const totals = docTotals(parseLines(store, lines), store.currency)
  return (
    <div className="sg-lines">
      <div className="sg-line sg-line-head"><span>{tr('Article', 'Item')}</span><span>{tr('Qté', 'Qty')}</span><span>{tr('PU HT', 'Unit price')}</span><span>{tr('Total HT', 'Net total')}</span><span /></div>
      {lines.map((line, index) => (
        <div className="sg-line" key={index}>
          <select aria-label={tr('Article', 'Item')} value={line.ref} onChange={(event) => {
            const article = store.articles.find((item) => item.ref === event.target.value)
            update(index, { ref: event.target.value, price: article ? String(atCost ? article.cost : article.price) : '' })
          }}>
            <option value="">—</option>
            {store.articles.map((article) => <option key={article.ref} value={article.ref}>{article.ref} · {article.name}</option>)}
          </select>
          <input aria-label={tr('Quantité', 'Quantity')} type="number" min="1" step="1" value={line.qty} onChange={(event) => update(index, { qty: event.target.value })} />
          <input aria-label={tr('Prix unitaire HT', 'Unit price')} type="number" min="0" step="0.01" value={line.price} onChange={(event) => update(index, { price: event.target.value })} />
          <span className="sg-line-total">{money(num(line.qty) * num(line.price))}</span>
          <button className="reject-button" type="button" aria-label={tr('Supprimer la ligne', 'Remove line')} disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, position) => position !== index))}><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="sg-lines-footer">
        <button className="upload-button" type="button" onClick={() => onChange([...lines, emptyLine])}><Plus size={13} />{tr('Ajouter une ligne', 'Add line')}</button>
        <span>{tr('HT', 'Net')} <strong>{money(totals.ht)}</strong></span><span>{tr('TVA', 'VAT')} <strong>{money(totals.vat)}</strong></span><span>{tr('TTC', 'Gross')} <strong>{money(totals.ttc)}</strong></span>
      </div>
    </div>
  )
}

function EntriesTable({ ctx, entries, action, renderLabel }: ViewProps & { entries: Entry[]; action?: (entry: Entry) => ReactNode; renderLabel?: (entry: Entry) => ReactNode }) {
  const { tr, store, money, day } = ctx
  if (!entries.length) return <div className="empty-state">{tr('Aucune écriture.', 'No entries.')}</div>
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  return (
    <div className="table-scroll">
      <table className="data-table sg-table">
        <thead><tr><th>DATE</th><th>{tr('JAL', 'JNL')}</th><th>{tr('PIÈCE', 'DOC')}</th><th>{tr('COMPTE', 'ACCOUNT')}</th><th>{tr('TIERS', 'PARTY')}</th><th>{tr('LIBELLÉ', 'LABEL')}</th><th className="sg-num">{tr('DÉBIT', 'DEBIT')}</th><th className="sg-num">{tr('CRÉDIT', 'CREDIT')}</th><th>{tr('LET.', 'MATCH')}</th>{action && <th />}</tr></thead>
        <tbody>
          {sorted.map((entry) => (
            <tr key={entry.id}>
              <td className="date-cell">{day(entry.date)}</td><td>{entry.journal}</td><td><strong className="invoice-id">{entry.piece}</strong></td><td>{entry.account}</td>
              <td>{tiersName(store, entry.tiers)}</td><td>{renderLabel ? renderLabel(entry) : entry.label}</td>
              <td className="sg-num">{entry.debit ? money(entry.debit) : ''}</td><td className="sg-num">{entry.credit ? money(entry.credit) : ''}</td>
              <td>{entry.letter && <Badge tone="good">{entry.letter}</Badge>}</td>{action && <td>{action(entry)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={6}>{tr('Totaux', 'Totals')}</td><td className="sg-num">{money(sum(entries.map((entry) => entry.debit)))}</td><td className="sg-num">{money(sum(entries.map((entry) => entry.credit)))}</td><td colSpan={action ? 2 : 1} /></tr></tfoot>
      </table>
    </div>
  )
}

/* Gestion commerciale · Saisie de caisse */

function ClientsView({ ctx, origin }: ViewProps & { origin: Origin }) {
  const { tr, store, money } = ctx
  const blank: Client = { code: '', name: '', city: '', email: '' }
  const [form, setForm] = useState<Client>(blank)
  const docs = store.salesDocs.filter((doc) => origin === 'commercial' || doc.origin === 'caisse')

  function save() {
    if (!form.name.trim()) {
      ctx.notify(tr('Renseignez le nom du client.', 'Enter the customer name.'))
      return
    }
    const client = { ...form, name: form.name.trim(), code: form.code || nextNumber('C', store.clients.map((item) => item.code), 4) }
    ctx.apply({ ...store, clients: form.code ? store.clients.map((item) => item.code === client.code ? client : item) : [...store.clients, client] })
    ctx.audit('Saved customer', `${client.code} · ${client.name}`)
    ctx.notify(tr('Fiche client enregistrée.', 'Customer record saved.'))
    setForm(blank)
  }

  function remove(client: Client) {
    if (!confirmDelete(ctx, client.name, tiersInUse(store, client.code) && tr('Ce client a des documents ou des écritures : il ne peut pas être supprimé.', 'This customer has documents or entries and cannot be deleted.'))) return
    ctx.apply({ ...store, clients: store.clients.filter((item) => item.code !== client.code) })
    ctx.audit('Deleted customer', `${client.code} · ${client.name}`)
    setForm(blank)
  }

  return (
    <>
      <Panel title={tr('Liste des clients', 'Customer list')} subtitle={origin === 'caisse' ? tr('Documents émis par le point de vente et solde comptable', 'Documents issued at the point of sale and ledger balance') : tr('Documents de vente et solde du compte 411', 'Sales documents and balance of account 411')}>
        <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>CODE</th><th>{tr('CLIENT', 'CUSTOMER')}</th><th>{tr('VILLE', 'CITY')}</th><th>E-MAIL</th><th className="sg-num">DOCUMENTS</th><th className="sg-num">{tr('SOLDE', 'BALANCE')}</th><th /></tr></thead>
            <tbody>
              {store.clients.map((client) => (
                <tr key={client.code}>
                  <td><strong className="invoice-id">{client.code}</strong></td><td>{client.name}</td><td>{client.city}</td><td>{client.email}</td>
                  <td className="sg-num">{docs.filter((doc) => doc.client === client.code).length}</td>
                  <td className="sg-num">{money(tiersBalance(store.entries, accountsOf(store).clients, client.code))}</td>
                  <td><div className="row-actions">
                    <button className="reject-button" type="button" aria-label={`${tr('Modifier', 'Edit')} ${client.name}`} onClick={() => setForm(client)}><Pencil size={13} /></button>
                    <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${client.name}`} onClick={() => remove(client)}><Trash2 size={13} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={form.code ? `${tr('Modifier', 'Edit')} ${form.code}` : tr('Nouveau client', 'New customer')}>
        <div className="sg-form">
          <label>{tr('Nom', 'Name')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{tr('Ville', 'City')}<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
          <label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        </div>
        <SaveButton label={tr('Enregistrer le client', 'Save customer')} onClick={save} />
      </Panel>
    </>
  )
}

function SalesDocsView({ ctx, origin }: ViewProps & { origin: Origin }) {
  const { tr, store, money, day } = ctx
  const [filter, setFilter] = useState<SalesDocType | 'all'>('all')
  const [client, setClient] = useState('')
  const docs = store.salesDocs
    .filter((doc) => (origin === 'commercial' || doc.origin === 'caisse') && (filter === 'all' || doc.type === filter) && (!client || doc.client === client))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  const typeLabel = (type: SalesDocType) => tr(salesTypes[type].fr, salesTypes[type].en)

  function advance(doc: SalesDoc, target: SalesDocType) {
    const today = isoDate()
    if (target === 'facture' && ctx.closed(today)) return
    if (movesStock(target) && !doc.stockMoved && !stockAvailable(ctx, doc.lines)) return
    ctx.apply(advanceSalesDoc(store, doc.id, today))
    ctx.audit('Transformed sales document', `${doc.id} → ${salesTypes[target].fr}`)
    ctx.notify(target === 'facture'
      ? tr('Facture créée et comptabilisée dans le journal des ventes.', 'Invoice created and posted to the sales journal.')
      : tr(`Document transformé en ${salesTypes[target].fr.toLowerCase()}.`, `Document converted to ${salesTypes[target].en.toLowerCase()}.`))
  }

  // Only documents that have neither moved stock nor been posted can simply disappear; the others are corrected by a reversal.
  function remove(doc: SalesDoc) {
    if (!window.confirm(tr(`Supprimer ${doc.id} ?`, `Delete ${doc.id}?`))) return
    ctx.apply({ ...store, salesDocs: store.salesDocs.filter((item) => item.id !== doc.id) })
    ctx.audit('Deleted sales document', doc.id)
  }
  const total = docs.reduce((sum, doc) => sum + docTotals(doc.lines, store.currency).ttc, 0)

  return (
    <Panel title={tr('Documents de vente', 'Sales documents')} subtitle={tr('Devis, commandes, bons de livraison, factures et tickets', 'Quotes, orders, delivery notes, invoices and tickets')}>
      <Chips value={filter} onChange={setFilter} options={[['all', tr('Tous', 'All')], ...(Object.keys(salesTypes) as SalesDocType[]).map((type): [SalesDocType, string] => [type, typeLabel(type)])]} />
      <div className="sg-form">
        <label>{tr('Client', 'Customer')}<select value={client} onChange={(event) => setClient(event.target.value)}>
          <option value="">{tr('Tous les clients', 'All customers')}</option>
          {store.clients.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
        </select></label>
        <div className="sg-stat"><span>{docs.length} {tr('document(s)', 'document(s)')}</span><strong>{money(total)}</strong></div>
      </div>
      {docs.length ? <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>N°</th><th>TYPE</th><th>{tr('CLIENT', 'CUSTOMER')}</th><th>DATE</th><th className="sg-num">{tr('TOTAL HT', 'NET')}</th><th className="sg-num">{tr('TOTAL TTC', 'GROSS')}</th><th>{tr('ÉTAT', 'STATUS')}</th><th /></tr></thead>
          <tbody>
            {docs.map((doc) => {
              const totals = docTotals(doc.lines, store.currency)
              const target = nextSalesType(doc.type)
              return (
                <tr key={doc.id}>
                  <td><strong className="invoice-id">{doc.id}</strong>{doc.origin === 'caisse' && origin === 'commercial' && <small className="source-file">{tr('Saisie de caisse', 'Point of sale')}</small>}</td>
                  <td>{typeLabel(doc.type)}</td><td>{tiersName(store, doc.client) || tr('Client comptoir', 'Walk-in customer')}</td><td className="date-cell">{day(doc.date)}</td>
                  <td className="sg-num">{money(totals.ht)}</td><td className="sg-num">{money(totals.ttc)}</td>
                  <td>{doc.posted ? <Badge tone="good">{tr('Comptabilisé', 'Posted')}</Badge> : doc.stockMoved ? <Badge tone="warn">{tr('Livré · à facturer', 'Delivered · to invoice')}</Badge> : <Badge>{tr('En cours', 'Open')}</Badge>}</td>
                  <td><div className="row-actions">
                    {target && <button className="approve-button" type="button" onClick={() => advance(doc, target)}>{typeLabel(target)}<ArrowRight size={12} /></button>}
                    {!doc.stockMoved && !doc.posted && <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${doc.id}`} onClick={() => remove(doc)}><Trash2 size={13} /></button>}
                  </div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div> : <div className="empty-state">{tr('Aucun document.', 'No documents.')}</div>}
    </Panel>
  )
}

function SalesDocForm({ ctx, origin, fixedType }: ViewProps & { origin: Origin; fixedType?: SalesDocType }) {
  const { tr, store } = ctx
  const [type, setType] = useState<SalesDocType>(fixedType ?? (origin === 'caisse' ? 'facture' : 'devis'))
  const [client, setClient] = useState('')
  const [date, setDate] = useState(isoDate())
  const [lines, setLines] = useState<DraftLine[]>([emptyLine])

  function save() {
    const parsed = parseLines(store, lines)
    if (!client || !parsed.length) {
      ctx.notify(tr('Choisissez un client et au moins un article.', 'Choose a customer and at least one item.'))
      return
    }
    if (type === 'facture' && ctx.closed(date)) return
    if (movesStock(type) && !stockAvailable(ctx, parsed)) return
    const next = saveSalesDoc(store, { type, client, date, lines: parsed, origin })
    const saved = next.salesDocs[next.salesDocs.length - 1]
    ctx.apply(next)
    ctx.audit('Created sales document', `${saved.id} · ${tiersName(store, client)}`)
    ctx.notify(type === 'facture'
      ? tr(`Facture ${saved.id} enregistrée et comptabilisée.`, `Invoice ${saved.id} saved and posted.`)
      : tr(`${salesTypes[type].fr} ${saved.id} enregistré.`, `${salesTypes[type].en} ${saved.id} saved.`))
    setClient('')
    setLines([emptyLine])
  }

  return (
    <Panel title={fixedType ? tr('Nouvelle commande client', 'New customer order') : tr('Nouveau document de vente', 'New sales document')} subtitle={tr('Une facture sort le stock et génère l’écriture de vente', 'An invoice moves stock and generates the sales entry')}>
      <div className="sg-form">
        {!fixedType && <label>Type<select value={type} onChange={(event) => setType(event.target.value as SalesDocType)}>
          {(['devis', 'commande', 'livraison', 'facture'] as SalesDocType[]).map((item) => <option key={item} value={item}>{tr(salesTypes[item].fr, salesTypes[item].en)}</option>)}
        </select></label>}
        <label>{tr('Client', 'Customer')}<select value={client} onChange={(event) => setClient(event.target.value)}>
          <option value="">—</option>
          {store.clients.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
        </select></label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      <LinesEditor ctx={ctx} lines={lines} onChange={setLines} />
      <SaveButton label={tr('Enregistrer le document', 'Save document')} onClick={save} />
    </Panel>
  )
}

function InterrogationView({ ctx }: ViewProps) {
  const { tr, store, money, day } = ctx
  const [mode, setMode] = useState<'client' | 'supplier' | 'article'>('client')
  const [key, setKey] = useState(store.clients[0]?.code ?? '')
  const docs = store.salesDocs.filter((doc) => mode === 'client' ? doc.client === key : mode === 'article' && doc.lines.some((line) => line.ref === key))
  const purchases = store.purchaseDocs.filter((doc) => mode === 'supplier' ? doc.supplier === key : mode === 'article' && doc.lines.some((line) => line.ref === key))
  const firstKey = { client: store.clients[0]?.code, supplier: store.suppliers[0]?.code, article: store.articles[0]?.ref }
  const invoiced = docs.filter((doc) => doc.posted)
  const article = store.articles.find((item) => item.ref === key)
  const linesOf = (list: SalesDoc[]) => list.flatMap((doc) => doc.lines).filter((line) => line.ref === key)

  return (
    <Panel title="Interrogation" subtitle={tr('Situation d’un client, d’un fournisseur ou d’un article', 'Position of a customer, a supplier or an item')}>
      <Chips value={mode} onChange={(value) => { setMode(value); setKey(firstKey[value] ?? '') }} options={[['client', tr('Client', 'Customer')], ['supplier', tr('Fournisseur', 'Supplier')], ['article', tr('Article', 'Item')]]} />
      <div className="sg-form">
        <label>{mode === 'client' ? tr('Client', 'Customer') : mode === 'supplier' ? tr('Fournisseur', 'Supplier') : tr('Article', 'Item')}<select value={key} onChange={(event) => setKey(event.target.value)}>
          {mode === 'article'
            ? store.articles.map((item) => <option key={item.ref} value={item.ref}>{item.ref} · {item.name}</option>)
            : (mode === 'client' ? store.clients : store.suppliers).map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
        </select></label>
      </div>
      {mode === 'supplier' && <>
        <div className="sg-stats">
          <Stat label={tr('Achats facturés HT', 'Invoiced purchases, net')} value={money(sum(purchases.filter((doc) => doc.posted).map((doc) => docTotals(doc.lines, store.currency).ht)))} />
          <Stat label={tr('Solde dû', 'Balance due')} value={money(tiersBalance(store.entries, accountsOf(store).suppliers, key))} />
          <Stat label={tr('Commandes en cours', 'Open orders')} value={String(purchases.filter((doc) => !doc.posted).length)} />
        </div>
        {purchases.length ? <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>N°</th><th>TYPE</th><th>DATE</th><th className="sg-num">{tr('TOTAL TTC', 'GROSS')}</th></tr></thead>
            <tbody>{purchases.map((doc) => <tr key={doc.id}><td><strong className="invoice-id">{doc.id}</strong></td><td>{tr(purchaseTypes[doc.type].fr, purchaseTypes[doc.type].en)}</td><td className="date-cell">{day(doc.date)}</td><td className="sg-num">{money(docTotals(doc.lines, store.currency).ttc)}</td></tr>)}</tbody>
          </table>
        </div> : <div className="empty-state">{tr('Aucun mouvement.', 'No activity.')}</div>}
      </>}
      {mode === 'client' ? <div className="sg-stats">
        <Stat label={tr('Chiffre d’affaires HT', 'Net revenue')} value={money(sum(invoiced.map((doc) => docTotals(doc.lines, store.currency).ht)))} />
        <Stat label={tr('Solde comptable', 'Ledger balance')} value={money(tiersBalance(store.entries, accountsOf(store).clients, key))} />
        <Stat label={tr('Documents en cours', 'Open documents')} value={String(docs.length - invoiced.length)} />
      </div> : article && <div className="sg-stats">
        <Stat label={tr('Stock réel', 'Stock on hand')} value={String(article.stock)} />
        <Stat label={tr('Valeur du stock', 'Stock value')} value={money(article.stock * article.cost)} />
        <Stat label={tr('Quantité vendue', 'Quantity sold')} value={String(sum(linesOf(invoiced).map((line) => line.qty)))} />
        <Stat label={tr('En commande client', 'On customer order')} value={String(sum(linesOf(docs.filter((doc) => doc.type === 'commande')).map((line) => line.qty)))} />
      </div>}
      {mode === 'supplier' ? null : docs.length ? <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>N°</th><th>TYPE</th><th>{tr('CLIENT', 'CUSTOMER')}</th><th>DATE</th><th className="sg-num">{mode === 'client' ? tr('TOTAL TTC', 'GROSS') : tr('QUANTITÉ', 'QUANTITY')}</th></tr></thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td><strong className="invoice-id">{doc.id}</strong></td><td>{tr(salesTypes[doc.type].fr, salesTypes[doc.type].en)}</td>
                <td>{tiersName(store, doc.client) || tr('Client comptoir', 'Walk-in customer')}</td><td className="date-cell">{day(doc.date)}</td>
                <td className="sg-num">{mode === 'client' ? money(docTotals(doc.lines, store.currency).ttc) : sum(doc.lines.filter((line) => line.ref === key).map((line) => line.qty))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : <div className="empty-state">{tr('Aucun mouvement.', 'No activity.')}</div>}
    </Panel>
  )
}

/**
 * Entry grid laid out like a supplier's paper invoice: one date and supplier, then a line per item with quantity and unit price.
 * Suppliers and items that do not exist yet are created when the invoice is saved.
 */
function SupplierInvoiceGrid({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const blankRow = { article: '', qty: '', price: '' }
  const [date, setDate] = useState(isoDate())
  const [supplier, setSupplier] = useState('')
  const [reference, setReference] = useState('')
  const [rows, setRows] = useState([blankRow, blankRow, blankRow])
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const known = store.suppliers.find((item) => same(item.name, supplier) || same(item.code, supplier))
  const filled = rows.filter((row) => row.article.trim() && num(row.qty) > 0)
  const quantity = sum(filled.map((row) => num(row.qty)))
  const net = sum(filled.map((row) => num(row.qty) * num(row.price)))
  const total = round2(net * (1 + store.defaultVat / 100))
  const previous = known ? tiersBalance(store.entries, accountsOf(store).suppliers, known.code) : 0
  const isNew = (name: string) => Boolean(name.trim()) && !store.articles.some((article) => same(article.ref, name) || same(article.name, name))

  // A fresh empty line appears as soon as the last one is used, as on a paper form that never runs out.
  function update(index: number, patch: Partial<typeof blankRow>) {
    const next = rows.map((row, position) => position === index ? { ...row, ...patch } : row)
    setRows(next.at(-1)!.article.trim() ? [...next, blankRow] : next)
  }

  function save() {
    if (!supplier.trim() || !filled.length) {
      ctx.notify(tr('Renseignez le fournisseur et au moins une ligne avec article et quantité.', 'Enter the supplier and at least one line with item and quantity.'))
      return
    }
    if (!date || ctx.closed(date)) return
    const next = registerSupplierInvoice(store, { date, supplier, reference, lines: filled.map((row) => ({ article: row.article, qty: num(row.qty), price: num(row.price) })) })
    const saved = next.purchaseDocs[next.purchaseDocs.length - 1]
    ctx.apply(next)
    ctx.audit('Registered supplier invoice', `${saved.id} · ${tiersName(next, saved.supplier)} · ${money(total)}`)
    ctx.notify(tr(`Facture ${saved.id} enregistrée : ${quantity} articles entrés en stock.`, `Invoice ${saved.id} saved: ${quantity} items received into stock.`))
    setReference('')
    setRows([blankRow, blankRow, blankRow])
  }

  return (
    <Panel title={tr('Saisir une facture fournisseur', 'Enter a supplier invoice')} subtitle={tr('Comme sur la facture papier : les articles entrent en stock, le fournisseur et les articles inconnus sont créés', 'As on the paper invoice: items enter stock; unknown suppliers and items are created')}>
      <div className="sg-form">
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>{tr('Fournisseur', 'Supplier')}<input list="sg-supplier-names" value={supplier} onChange={(event) => setSupplier(event.target.value)} />{supplier.trim() && !known && <small className="sg-new">{tr('Nouveau fournisseur : il sera créé', 'New supplier: it will be created')}</small>}</label>
        <datalist id="sg-supplier-names">{store.suppliers.map((item) => <option key={item.code} value={item.name} />)}</datalist>
        <label>{tr('N° de la facture (facultatif)', 'Invoice number (optional)')}<input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      </div>
      <datalist id="sg-article-names">{store.articles.map((article) => <option key={article.ref} value={article.name} />)}</datalist>
      <div className="table-scroll">
        <table className="data-table sg-table sg-grid">
          <thead><tr><th>{tr('ARTICLE', 'ITEM')}</th><th className="sg-num">{tr('QUANTITÉ', 'QUANTITY')}</th><th className="sg-num">{tr('PRIX UNITAIRE', 'UNIT PRICE')}</th><th className="sg-num">{tr('PRIX TOTAL', 'TOTAL PRICE')}</th><th /></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td><input aria-label={`${tr('Article', 'Item')} ${index + 1}`} list="sg-article-names" value={row.article} onChange={(event) => update(index, { article: event.target.value })} />{isNew(row.article) && <small className="sg-new">{tr('nouvel article', 'new item')}</small>}</td>
                <td className="sg-num"><input aria-label={`${tr('Quantité', 'Quantity')} ${index + 1}`} type="number" min="0" step="1" value={row.qty} onChange={(event) => update(index, { qty: event.target.value })} /></td>
                <td className="sg-num"><input aria-label={`${tr('Prix unitaire', 'Unit price')} ${index + 1}`} type="number" min="0" step="0.01" value={row.price} onChange={(event) => update(index, { price: event.target.value })} /></td>
                <td className="sg-num">{num(row.qty) && num(row.price) ? money(num(row.qty) * num(row.price)) : ''}</td>
                <td>{rows.length > 1 && <button className="reject-button" type="button" aria-label={`${tr('Supprimer la ligne', 'Remove line')} ${index + 1}`} onClick={() => setRows(rows.filter((_, position) => position !== index))}><Trash2 size={13} /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>{tr('Total', 'Total')}{store.defaultVat > 0 && ` ${tr('HT', 'net')}`}</td><td className="sg-num">{quantity}</td><td /><td className="sg-num">{money(net)}</td><td /></tr>
            {store.defaultVat > 0 && <tr><td colSpan={3}>{tr('Total TTC', 'Gross total')} ({store.defaultVat} %)</td><td className="sg-num">{money(total)}</td><td /></tr>}
            <tr><td colSpan={3}>{tr('Ancien solde dû au fournisseur', 'Previous balance owed to the supplier')}</td><td className="sg-num">{money(previous)}</td><td /></tr>
            <tr><td colSpan={3}>{tr('Nouveau solde', 'New balance')}</td><td className="sg-num">{money(round2(previous + total))}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <SaveButton label={tr('Enregistrer la facture', 'Save the invoice')} onClick={save} disabled={!supplier.trim() || !filled.length} />
    </Panel>
  )
}

function PurchasesView({ ctx }: ViewProps) {
  const { tr, store, money, day } = ctx
  const [type, setType] = useState<PurchaseDocType>('commande')
  const [supplier, setSupplier] = useState('')
  const [date, setDate] = useState(isoDate())
  const [lines, setLines] = useState<DraftLine[]>([emptyLine])
  const [filter, setFilter] = useState('')
  const [supplierTab, setSupplierTab] = useState<'suppliers' | 'stock'>('suppliers')
  const blankSupplier: Supplier = { code: '', name: '', city: '' }
  const [form, setForm] = useState<Supplier>(blankSupplier)
  const docs = [...store.purchaseDocs].reverse().filter((doc) => !filter || doc.supplier === filter)
  const stockAnalysis = supplierStockAnalysis(store)

  function saveSupplier() {
    if (!form.name.trim()) {
      ctx.notify(tr('Renseignez le nom du fournisseur.', 'Enter the supplier name.'))
      return
    }
    const saved = { ...form, name: form.name.trim(), code: form.code || nextNumber('F', store.suppliers.map((item) => item.code), 4) }
    ctx.apply({ ...store, suppliers: form.code ? store.suppliers.map((item) => item.code === saved.code ? saved : item) : [...store.suppliers, saved] })
    ctx.audit('Saved supplier', `${saved.code} · ${saved.name}`)
    ctx.notify(tr('Fiche fournisseur enregistrée.', 'Supplier record saved.'))
    setForm(blankSupplier)
  }

  function removeSupplier(item: Supplier) {
    if (!confirmDelete(ctx, item.name, tiersInUse(store, item.code) && tr('Ce fournisseur a des documents ou des écritures : il ne peut pas être supprimé.', 'This supplier has documents or entries and cannot be deleted.'))) return
    ctx.apply({ ...store, suppliers: store.suppliers.filter((other) => other.code !== item.code) })
    ctx.audit('Deleted supplier', `${item.code} · ${item.name}`)
    setForm(blankSupplier)
    if (filter === item.code) setFilter('')
  }

  function removeDoc(doc: PurchaseDoc) {
    if (!window.confirm(tr(`Supprimer ${doc.id} ?`, `Delete ${doc.id}?`))) return
    ctx.apply({ ...store, purchaseDocs: store.purchaseDocs.filter((item) => item.id !== doc.id) })
    ctx.audit('Deleted purchase document', doc.id)
  }

  function save() {
    const parsed = parseLines(store, lines)
    if (!supplier || !parsed.length) {
      ctx.notify(tr('Choisissez un fournisseur et au moins un article.', 'Choose a supplier and at least one item.'))
      return
    }
    if (type === 'facture' && ctx.closed(date)) return
    const next = savePurchaseDoc(store, { type, supplier, date, lines: parsed })
    const saved = next.purchaseDocs[next.purchaseDocs.length - 1]
    ctx.apply(next)
    ctx.audit('Created purchase document', `${saved.id} · ${tiersName(store, supplier)}`)
    ctx.notify(tr(`${purchaseTypes[type].fr} ${saved.id} enregistrée.`, `${purchaseTypes[type].en} ${saved.id} saved.`))
    setSupplier('')
    setLines([emptyLine])
  }

  function invoice(doc: PurchaseDoc) {
    const today = isoDate()
    if (ctx.closed(today)) return
    ctx.apply(advancePurchaseDoc(store, doc.id, today))
    ctx.audit('Transformed purchase document', `${doc.id} → ${purchaseTypes.facture.fr}`)
    ctx.notify(tr('Marchandise réceptionnée, facture comptabilisée dans le journal des achats.', 'Goods received, invoice posted to the purchase journal.'))
  }

  return (
    <>
      <SupplierInvoiceGrid ctx={ctx} />
      <Chips value={supplierTab} onChange={setSupplierTab} options={[
        ['suppliers', tr('Fournisseurs', 'Suppliers')],
        ['stock', 'Au Magasin'],
      ]} />
      {supplierTab === 'suppliers' ? <>
      <Panel title={tr('Fournisseurs', 'Suppliers')} subtitle={tr('Cliquez sur un fournisseur pour ne voir que ses documents', 'Click a supplier to see only its documents')}>
        <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>CODE</th><th>{tr('FOURNISSEUR', 'SUPPLIER')}</th><th>{tr('VILLE', 'CITY')}</th><th className="sg-num">DOCUMENTS</th><th className="sg-num">{tr('À VALIDER', 'TO APPROVE')}</th><th className="sg-num">{tr('SOLDE DÛ', 'BALANCE DUE')}</th><th /></tr></thead>
            <tbody>
              {store.suppliers.map((item) => (
                <tr key={item.code} className={filter === item.code ? 'sg-row-active' : ''}>
                  <td><strong className="invoice-id">{item.code}</strong></td>
                  <td><button className="text-button" type="button" onClick={() => setFilter(filter === item.code ? '' : item.code)}>{item.name}</button></td><td>{item.city}</td>
                  <td className="sg-num">{store.purchaseDocs.filter((doc) => doc.supplier === item.code).length}</td>
                  <td className="sg-num">{store.supplierInvoices.filter((invoice) => invoice.status === 'needs_review' && invoice.supplier.trim().toLowerCase() === item.name.toLowerCase()).length || ''}</td>
                  <td className="sg-num">{money(tiersBalance(store.entries, accountsOf(store).suppliers, item.code))}</td>
                  <td><div className="row-actions">
                    <button className="reject-button" type="button" aria-label={`${tr('Modifier', 'Edit')} ${item.name}`} onClick={() => setForm(item)}><Pencil size={13} /></button>
                    <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${item.name}`} onClick={() => removeSupplier(item)}><Trash2 size={13} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sg-form">
          <label>{form.code ? `${tr('Modifier', 'Edit')} ${form.code}` : tr('Nouveau fournisseur', 'New supplier')}<input placeholder={tr('Nom', 'Name')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{tr('Ville', 'City')}<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
        </div>
        <SaveButton label={tr('Enregistrer le fournisseur', 'Save supplier')} onClick={saveSupplier} />
      </Panel>
      </> : <Panel title="Au Magasin" subtitle={tr('Calcul automatique par article à partir des factures fournisseurs réceptionnées et des ventes livrées', 'Automatic item totals from received supplier invoices and shipped sales')}>
        <p className="sg-hint sg-stock-hint">{tr('Différence = quantités achetées auprès des fournisseurs − quantités vendues. Le stock réel inclut aussi le stock initial, la fabrication et les ajustements d’inventaire.', 'Balance = quantities purchased from suppliers − quantities sold. Current stock also includes opening stock, production and inventory adjustments.')}</p>
        {stockAnalysis.length ? <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>{tr('RÉFÉRENCE', 'REFERENCE')}</th><th>{tr('ARTICLE', 'ITEM')}</th><th>{tr('FAMILLE', 'FAMILY')}</th><th className="sg-num">{tr('REÇU FOURNISSEURS', 'RECEIVED')}</th><th className="sg-num">{tr('VENDU', 'SOLD')}</th><th className="sg-num">{tr('ACHETÉ − VENDU', 'PURCHASED − SOLD')}</th><th className="sg-num">{tr('STOCK RÉEL', 'CURRENT STOCK')}</th></tr></thead>
            <tbody>{stockAnalysis.map((item) => (
              <tr key={item.ref}>
                <td><strong className="invoice-id">{item.ref}</strong></td><td>{item.name}</td><td>{item.family}</td>
                <td className="sg-num">{item.received}</td><td className="sg-num">{item.sold}</td>
                <td className="sg-num">{item.balance < 0 ? <Badge tone="warn">{item.balance}</Badge> : item.balance}</td><td className="sg-num">{item.stock}</td>
              </tr>
            ))}</tbody>
          </table>
        </div> : <div className="empty-state">{tr('Aucun article enregistré.', 'No items recorded.')}</div>}
      </Panel>}
      <Panel title={filter ? `${tr('Documents de', 'Documents of')} ${tiersName(store, filter)}` : tr('Commandes et factures fournisseurs', 'Supplier orders and invoices')} subtitle={tr('La facture entre le stock et génère l’écriture d’achat', 'The invoice receives stock and generates the purchase entry')}
        action={filter ? <button className="text-button" type="button" onClick={() => setFilter('')}>{tr('Tous les fournisseurs', 'All suppliers')}</button> : undefined}>
        {!docs.length && <div className="empty-state">{tr('Aucun document.', 'No documents.')}</div>}
        <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>N°</th><th>TYPE</th><th>{tr('FOURNISSEUR', 'SUPPLIER')}</th><th>DATE</th><th className="sg-num">{tr('TOTAL TTC', 'GROSS')}</th><th>{tr('ÉTAT', 'STATUS')}</th><th /></tr></thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td><strong className="invoice-id">{doc.id}</strong></td><td>{tr(purchaseTypes[doc.type].fr, purchaseTypes[doc.type].en)}</td><td>{tiersName(store, doc.supplier)}</td>
                  <td className="date-cell">{day(doc.date)}</td><td className="sg-num">{money(docTotals(doc.lines, store.currency).ttc)}</td>
                  <td>{doc.posted ? <Badge tone="good">{tr('Comptabilisé', 'Posted')}</Badge> : <Badge>{tr('En commande', 'On order')}</Badge>}</td>
                  <td>{doc.type === 'commande' && <div className="row-actions">
                    <button className="approve-button" type="button" onClick={() => invoice(doc)}>{tr('Réceptionner et facturer', 'Receive and invoice')}<ArrowRight size={12} /></button>
                    <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${doc.id}`} onClick={() => removeDoc(doc)}><Trash2 size={13} /></button>
                  </div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={tr('Nouveau document d’achat', 'New purchase document')}>
        <div className="sg-form">
          <label>Type<select value={type} onChange={(event) => setType(event.target.value as PurchaseDocType)}>
            {(Object.keys(purchaseTypes) as PurchaseDocType[]).map((item) => <option key={item} value={item}>{tr(purchaseTypes[item].fr, purchaseTypes[item].en)}</option>)}
          </select></label>
          <label>{tr('Fournisseur', 'Supplier')}<select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
            <option value="">—</option>
            {store.suppliers.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
          </select></label>
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        </div>
        <LinesEditor ctx={ctx} lines={lines} onChange={setLines} atCost />
        <SaveButton label={tr('Enregistrer le document', 'Save document')} onClick={save} />
      </Panel>
    </>
  )
}

function ArticlesView({ ctx, editable }: ViewProps & { editable?: boolean }) {
  const { tr, store, money } = ctx
  const blank = { ref: '', name: '', family: '', cost: '', price: '', vat: String(store.defaultVat), stock: '0' }
  const [form, setForm] = useState(blank)
  const [query, setQuery] = useState('')
  const editing = store.articles.some((article) => article.ref === form.ref)
  const articles = store.articles.filter((article) => `${article.ref} ${article.name} ${article.family}`.toLowerCase().includes(query.toLowerCase()))

  function save() {
    const ref = form.ref.trim().toUpperCase()
    if (!ref || !form.name.trim() || num(form.price) <= 0) {
      ctx.notify(tr('Renseignez la référence, la désignation et le prix de vente.', 'Enter the reference, description and sales price.'))
      return
    }
    const previous = store.articles.find((article) => article.ref === ref)
    const article: Article = { ref, name: form.name.trim(), family: form.family.trim(), cost: num(form.cost), price: num(form.price), vat: num(form.vat), stock: previous ? previous.stock : num(form.stock) }
    ctx.apply({ ...store, articles: previous ? store.articles.map((item) => item.ref === ref ? article : item) : [...store.articles, article] })
    ctx.audit('Saved item', `${ref} · ${article.name}`)
    ctx.notify(tr('Fiche article enregistrée.', 'Item record saved.'))
    setForm(blank)
  }

  function remove(article: Article) {
    if (!confirmDelete(ctx, `${article.ref} · ${article.name}${article.stock ? tr(` (stock : ${article.stock})`, ` (stock: ${article.stock})`) : ''}`, articleInUse(store, article.ref) && tr('Cet article figure dans des documents, une nomenclature ou un ordre de fabrication : il ne peut pas être supprimé. Vous pouvez le modifier.', 'This item appears in documents, a bill of materials or a production order and cannot be deleted. You can edit it.'))) return
    ctx.apply({ ...store, articles: store.articles.filter((item) => item.ref !== article.ref) })
    ctx.audit('Deleted item', `${article.ref} · ${article.name}`)
    setForm(blank)
  }

  return (
    <>
      <Panel title={editable ? tr('Articles et tarifs', 'Items and price lists') : tr('Disponibilités et stocks', 'Availability and stock')} subtitle={tr('Stock réel mis à jour par les ventes, les achats, la fabrication et l’inventaire', 'Stock on hand updated by sales, purchases, production and stock counts')}>
        <div className="sg-form"><label>{tr('Rechercher', 'Search')}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('Référence, désignation, famille…', 'Reference, description, family…')} /></label></div>
        <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>{tr('RÉFÉRENCE', 'REFERENCE')}</th><th>{tr('DÉSIGNATION', 'DESCRIPTION')}</th><th>{tr('FAMILLE', 'FAMILY')}</th>{editable && <th className="sg-num">{tr('PRIX D’ACHAT', 'COST')}</th>}<th className="sg-num">{tr('PRIX HT', 'NET PRICE')}</th><th className="sg-num">{tr('PRIX TTC', 'GROSS PRICE')}</th><th className="sg-num">STOCK</th><th>{tr('DISPONIBILITÉ', 'AVAILABILITY')}</th>{editable && <th />}</tr></thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.ref}>
                  <td><strong className="invoice-id">{article.ref}</strong></td><td>{article.name}</td><td>{article.family}</td>
                  {editable && <td className="sg-num">{money(article.cost)}</td>}
                  <td className="sg-num">{money(article.price)}</td><td className="sg-num">{money(round2(article.price * (1 + article.vat / 100)))}</td><td className="sg-num">{article.stock}</td>
                  <td>{article.stock <= 0 ? <Badge tone="warn">{tr('Rupture', 'Out of stock')}</Badge> : article.stock < 10 ? <Badge tone="warn">{tr('Stock bas', 'Low stock')}</Badge> : <Badge tone="good">{tr('Disponible', 'Available')}</Badge>}</td>
                  {editable && <td><div className="row-actions">
                    <button className="reject-button" type="button" aria-label={`${tr('Modifier', 'Edit')} ${article.ref}`} onClick={() => setForm({ ref: article.ref, name: article.name, family: article.family, cost: String(article.cost), price: String(article.price), vat: String(article.vat), stock: String(article.stock) })}><Pencil size={13} /></button>
                    <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${article.ref}`} onClick={() => remove(article)}><Trash2 size={13} /></button>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {editable && <Panel title={editing ? `${tr('Modifier', 'Edit')} ${form.ref}` : tr('Nouvel article', 'New item')} subtitle={editing ? tr('Le stock se corrige par l’inventaire', 'Stock is corrected through the stock count') : undefined}>
        <div className="sg-form">
          <label>{tr('Référence', 'Reference')}<input value={form.ref} disabled={editing} onChange={(event) => setForm({ ...form, ref: event.target.value })} /></label>
          <label>{tr('Désignation', 'Description')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{tr('Famille', 'Family')}<input value={form.family} onChange={(event) => setForm({ ...form, family: event.target.value })} /></label>
          <label>{tr('Prix d’achat HT', 'Cost')}<input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
          <label>{tr('Prix de vente HT', 'Net sales price')}<input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
          <label>{tr('Taux de TVA', 'VAT rate')}<select value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })}>{vatRates(store, form.vat).map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select></label>
          {!editing && <label>{tr('Stock initial', 'Opening stock')}<input type="number" min="0" step="1" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>}
        </div>
        <SaveButton label={tr('Enregistrer l’article', 'Save item')} onClick={save} />
      </Panel>}
    </>
  )
}

function FabricationView({ ctx }: ViewProps) {
  const { tr, store, day } = ctx
  const [ref, setRef] = useState(store.boms[0]?.ref ?? '')
  const [qty, setQty] = useState('1')
  const [date, setDate] = useState(isoDate())
  const [bomRef, setBomRef] = useState('')
  const [components, setComponents] = useState<{ ref: string; qty: string }[]>([{ ref: '', qty: '1' }])
  const articleName = (code: string) => store.articles.find((article) => article.ref === code)?.name ?? code

  function createOrder() {
    if (!ref || num(qty) <= 0) return
    const id = nextNumber('OF', store.workOrders.map((order) => order.id))
    ctx.apply({ ...store, workOrders: [...store.workOrders, { id, ref, qty: num(qty), date, done: false }] })
    ctx.audit('Created production order', `${id} · ${ref} × ${num(qty)}`)
    ctx.notify(tr(`Ordre de fabrication ${id} créé.`, `Production order ${id} created.`))
  }

  function complete(id: string) {
    const order = store.workOrders.find((item) => item.id === id)!
    const missing = missingComponent(store, order)
    if (missing) {
      ctx.notify(tr(`Composant insuffisant : ${missing}.`, `Not enough component stock: ${missing}.`))
      return
    }
    ctx.apply(completeWorkOrder(store, id))
    ctx.audit('Completed production order', `${id} · ${order.ref} × ${order.qty}`)
    ctx.notify(tr('Fabrication terminée : composants sortis, produit fini entré en stock.', 'Production completed: components consumed, finished goods received.'))
  }

  function saveBom() {
    const list = components.filter((component) => component.ref && component.ref !== bomRef && num(component.qty) > 0).map((component) => ({ ref: component.ref, qty: num(component.qty) }))
    if (!bomRef || !list.length) {
      ctx.notify(tr('Choisissez un produit et au moins un composant.', 'Choose a product and at least one component.'))
      return
    }
    ctx.apply({ ...store, boms: [...store.boms.filter((bom) => bom.ref !== bomRef), { ref: bomRef, components: list }] })
    ctx.audit('Saved bill of materials', bomRef)
    ctx.notify(tr('Nomenclature enregistrée.', 'Bill of materials saved.'))
    setBomRef('')
    setComponents([{ ref: '', qty: '1' }])
  }

  return (
    <>
      <Panel title={tr('Ordres de fabrication', 'Production orders')} subtitle={tr('La clôture consomme les composants de la nomenclature', 'Completion consumes the components of the bill of materials')}>
        {store.workOrders.length ? <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>N°</th><th>{tr('PRODUIT', 'PRODUCT')}</th><th className="sg-num">{tr('QUANTITÉ', 'QUANTITY')}</th><th>DATE</th><th>{tr('ÉTAT', 'STATUS')}</th><th /></tr></thead>
            <tbody>
              {store.workOrders.map((order) => (
                <tr key={order.id}>
                  <td><strong className="invoice-id">{order.id}</strong></td><td>{order.ref} · {articleName(order.ref)}</td><td className="sg-num">{order.qty}</td><td className="date-cell">{day(order.date)}</td>
                  <td>{order.done ? <Badge tone="good">{tr('Terminé', 'Completed')}</Badge> : <Badge>{tr('Planifié', 'Planned')}</Badge>}</td>
                  <td>{!order.done && <button className="approve-button" type="button" onClick={() => complete(order.id)}><Check size={12} />{tr('Clôturer', 'Complete')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> : <div className="empty-state">{tr('Aucun ordre de fabrication.', 'No production orders.')}</div>}
        <div className="sg-form">
          <label>{tr('Produit à fabriquer', 'Product to make')}<select value={ref} onChange={(event) => setRef(event.target.value)}>{store.boms.map((bom) => <option key={bom.ref} value={bom.ref}>{bom.ref} · {articleName(bom.ref)}</option>)}</select></label>
          <label>{tr('Quantité', 'Quantity')}<input type="number" min="1" step="1" value={qty} onChange={(event) => setQty(event.target.value)} /></label>
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        </div>
        <SaveButton label={tr('Créer l’ordre de fabrication', 'Create production order')} onClick={createOrder} />
      </Panel>
      <Panel title={tr('Nomenclatures', 'Bills of materials')}>
        <div className="sg-list">
          {store.boms.map((bom) => (
            <div key={bom.ref}><strong>{bom.ref} · {articleName(bom.ref)}</strong><span>{bom.components.map((component) => `${component.qty} × ${articleName(component.ref)}`).join(' + ')}</span></div>
          ))}
        </div>
        <div className="sg-form">
          <label>{tr('Produit fini', 'Finished product')}<select value={bomRef} onChange={(event) => setBomRef(event.target.value)}>
            <option value="">—</option>
            {store.articles.map((article) => <option key={article.ref} value={article.ref}>{article.ref} · {article.name}</option>)}
          </select></label>
          {components.map((component, index) => (
            <label key={index}>{tr('Composant', 'Component')} {index + 1}
              <span className="sg-inline">
                <select value={component.ref} onChange={(event) => setComponents(components.map((item, position) => position === index ? { ...item, ref: event.target.value } : item))}>
                  <option value="">—</option>
                  {store.articles.map((article) => <option key={article.ref} value={article.ref}>{article.ref}</option>)}
                </select>
                <input aria-label={tr('Quantité', 'Quantity')} type="number" min="1" step="1" value={component.qty} onChange={(event) => setComponents(components.map((item, position) => position === index ? { ...item, qty: event.target.value } : item))} />
              </span>
            </label>
          ))}
        </div>
        <div className="sg-actions">
          <button className="upload-button" type="button" onClick={() => setComponents([...components, { ref: '', qty: '1' }])}><Plus size={13} />{tr('Ajouter un composant', 'Add component')}</button>
          <button className="primary-button" type="button" onClick={saveBom}><Check size={14} />{tr('Enregistrer la nomenclature', 'Save bill of materials')}</button>
        </div>
      </Panel>
    </>
  )
}

function InventoryView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const [counts, setCounts] = useState<Record<string, string>>({})
  const counted = (article: Article) => counts[article.ref] === undefined || counts[article.ref] === '' ? article.stock : num(counts[article.ref])
  const gaps = store.articles.filter((article) => counted(article) !== article.stock)

  function validate() {
    ctx.apply({ ...store, articles: store.articles.map((article) => ({ ...article, stock: counted(article) })) })
    ctx.audit('Validated inventory', `${gaps.length} ${gaps.length > 1 ? 'adjustments' : 'adjustment'}`)
    ctx.notify(tr(`Inventaire validé : ${gaps.length} écart(s) régularisé(s).`, `Stock count validated: ${gaps.length} adjustment(s).`))
    setCounts({})
  }

  return (
    <Panel title={tr('Inventaire du stock', 'Stock count')} subtitle={tr('Saisissez les quantités comptées ; seuls les écarts sont régularisés', 'Enter counted quantities; only differences are adjusted')}>
      <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>{tr('RÉFÉRENCE', 'REFERENCE')}</th><th>{tr('DÉSIGNATION', 'DESCRIPTION')}</th><th className="sg-num">{tr('STOCK THÉORIQUE', 'BOOK STOCK')}</th><th className="sg-num">{tr('STOCK COMPTÉ', 'COUNTED')}</th><th className="sg-num">{tr('ÉCART', 'DIFFERENCE')}</th><th className="sg-num">{tr('VALEUR DE L’ÉCART', 'DIFFERENCE VALUE')}</th></tr></thead>
          <tbody>
            {store.articles.map((article) => {
              const gap = counted(article) - article.stock
              return (
                <tr key={article.ref}>
                  <td><strong className="invoice-id">{article.ref}</strong></td><td>{article.name}</td><td className="sg-num">{article.stock}</td>
                  <td className="sg-num"><input className="sg-cell-input" aria-label={`${tr('Stock compté', 'Counted stock')} ${article.ref}`} type="number" min="0" step="1" placeholder={String(article.stock)} value={counts[article.ref] ?? ''} onChange={(event) => setCounts({ ...counts, [article.ref]: event.target.value })} /></td>
                  <td className="sg-num">{gap ? <Badge tone="warn">{gap > 0 ? `+${gap}` : gap}</Badge> : '—'}</td><td className="sg-num">{gap ? money(gap * article.cost) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <SaveButton label={tr('Valider l’inventaire', 'Validate stock count')} onClick={validate} disabled={!gaps.length} />
    </Panel>
  )
}

function CounterView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const today = isoDate()
  const [lines, setLines] = useState<DraftLine[]>([emptyLine])
  const [payment, setPayment] = useState<Payment>('cash')
  const [client, setClient] = useState('')
  const tickets = store.salesDocs.filter((doc) => doc.type === 'ticket' && doc.date === today)
  const total = (mode?: Payment) => sum(tickets.filter((doc) => !mode || doc.payment === mode).map((doc) => docTotals(doc.lines, store.currency).ttc))

  function cashIn() {
    const parsed = parseLines(store, lines)
    if (!parsed.length) {
      ctx.notify(tr('Ajoutez au moins un article.', 'Add at least one item.'))
      return
    }
    if (ctx.closed(today) || !stockAvailable(ctx, parsed)) return
    const next = saveSalesDoc(store, { type: 'ticket', client, date: today, lines: parsed, origin: 'caisse', payment })
    const saved = next.salesDocs[next.salesDocs.length - 1]
    ctx.apply(next)
    ctx.audit('Recorded counter sale', `${saved.id} · ${money(docTotals(parsed, store.currency).ttc)}`)
    ctx.notify(tr(`Ticket ${saved.id} encaissé et comptabilisé dans le journal de caisse.`, `Ticket ${saved.id} cashed in and posted to the cash journal.`))
    setLines([emptyLine])
    setClient('')
  }

  return (
    <>
      <Panel title={tr('Vente comptoir', 'Counter sale')} subtitle={tr('L’encaissement sort le stock et alimente le journal de caisse', 'Cashing in moves stock and feeds the cash journal')}>
        <div className="sg-form">
          <label>{tr('Mode de règlement', 'Payment method')}<select value={payment} onChange={(event) => setPayment(event.target.value as Payment)}><option value="cash">{tr('Espèces', 'Cash')}</option><option value="card">{tr('Carte bancaire', 'Card')}</option></select></label>
          <label>{tr('Client (facultatif)', 'Customer (optional)')}<select value={client} onChange={(event) => setClient(event.target.value)}>
            <option value="">{tr('Client comptoir', 'Walk-in customer')}</option>
            {store.clients.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
          </select></label>
        </div>
        <LinesEditor ctx={ctx} lines={lines} onChange={setLines} />
        <SaveButton label={tr('Encaisser', 'Cash in')} onClick={cashIn} />
      </Panel>
      <Panel title={tr('Ventes de la journée', 'Today’s sales')} subtitle={ctx.day(today)}>
        <div className="sg-stats">
          <Stat label="Tickets" value={String(tickets.length)} />
          <Stat label={tr('Total TTC', 'Gross total')} value={money(total())} />
          <Stat label={tr('Espèces', 'Cash')} value={money(total('cash'))} />
          <Stat label={tr('Carte bancaire', 'Card')} value={money(total('card'))} />
        </div>
        {tickets.length > 0 && <div className="sg-list">
          {tickets.map((doc) => (
            <div key={doc.id}><strong>{doc.id} · {money(docTotals(doc.lines, store.currency).ttc)} · {doc.payment === 'card' ? tr('Carte', 'Card') : tr('Espèces', 'Cash')}</strong><span>{doc.lines.map((line) => `${line.qty} × ${line.ref}`).join(', ')}</span></div>
          ))}
        </div>}
      </Panel>
    </>
  )
}

function GroupView({ ctx }: ViewProps) {
  const { tr, store } = ctx
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const choices = sageModules.find((item) => item.id === 'caisse')!.groups.flatMap((group) => group.activities).filter((activity) => activity.id !== 'sc.groupe')

  function create() {
    if (!name.trim() || !selected.length || store.groups.some((group) => group.name === name.trim())) {
      ctx.notify(tr('Donnez un nom unique au groupe et choisissez au moins une commande.', 'Give the group a unique name and choose at least one command.'))
      return
    }
    ctx.apply({ ...store, groups: [...store.groups, { name: name.trim(), activities: selected }] })
    ctx.audit('Created command group', name.trim())
    ctx.notify(tr('Groupe ajouté en haut du module de caisse.', 'Group added at the top of the point-of-sale module.'))
    setName('')
    setSelected([])
  }

  return (
    <Panel title={tr('Nouveau groupe de commandes', 'New command group')} subtitle={tr('Facultatif : des raccourcis vers les commandes les plus utilisées au point de vente', 'Optional: shortcuts to the commands used most at the point of sale')}>
      <div className="sg-form"><label>{tr('Nom du groupe', 'Group name')}<input value={name} onChange={(event) => setName(event.target.value)} /></label></div>
      <div className="sg-checks">
        {choices.map((activity) => (
          <label key={activity.id}>
            <input type="checkbox" checked={selected.includes(activity.id)} onChange={() => setSelected(selected.includes(activity.id) ? selected.filter((id) => id !== activity.id) : [...selected, activity.id])} />
            {tr(activity.fr, activity.en)}<code>{activity.sage}</code>
          </label>
        ))}
      </div>
      <SaveButton label={tr('Créer le groupe', 'Create group')} onClick={create} />
      {store.groups.length > 0 && <div className="sg-list">
        {store.groups.map((group) => (
          <div className="sg-list-row" key={group.name}>
            <span><strong>{group.name}</strong><span>{group.activities.map((id) => choices.find((activity) => activity.id === id)?.sage).join(' · ')}</span></span>
            <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${group.name}`} onClick={() => ctx.apply({ ...store, groups: store.groups.filter((item) => item.name !== group.name) })}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>}
    </Panel>
  )
}

/* Comptabilité */

function AccountsView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const [number, setNumber] = useState('')
  const [label, setLabel] = useState('')

  function create() {
    if (!/^\d{3,8}$/.test(number) || !label.trim() || store.accounts.some((account) => account.number === number)) {
      ctx.notify(tr('Saisissez un numéro de compte inédit (3 à 8 chiffres) et un intitulé.', 'Enter a new account number (3 to 8 digits) and a label.'))
      return
    }
    ctx.apply({ ...store, accounts: [...store.accounts, { number, label: label.trim() }].sort((a, b) => a.number.localeCompare(b.number)) })
    ctx.audit('Created account', `${number} · ${label.trim()}`)
    ctx.notify(tr('Compte général créé.', 'General account created.'))
    setNumber('')
    setLabel('')
  }

  return (
    <>
      <Panel title={tr('Créer un compte général', 'Create a general account')}>
        <div className="sg-form">
          <label>{tr('Numéro de compte', 'Account number')}<input inputMode="numeric" value={number} onChange={(event) => setNumber(event.target.value.trim())} placeholder="606100" /></label>
          <label>{tr('Intitulé', 'Label')}<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        </div>
        <SaveButton label={tr('Créer le compte', 'Create account')} onClick={create} />
      </Panel>
      <Panel title={tr('Plan comptable', 'Chart of accounts')} subtitle={tr('Mouvements et soldes de chaque compte', 'Movements and balance of each account')}>
        <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>{tr('COMPTE', 'ACCOUNT')}</th><th>{tr('INTITULÉ', 'LABEL')}</th><th className="sg-num">{tr('DÉBIT', 'DEBIT')}</th><th className="sg-num">{tr('CRÉDIT', 'CREDIT')}</th><th className="sg-num">{tr('SOLDE', 'BALANCE')}</th></tr></thead>
            <tbody>
              {store.accounts.map((account) => {
                const entries = store.entries.filter((entry) => entry.account === account.number)
                const debit = sum(entries.map((entry) => entry.debit))
                const credit = sum(entries.map((entry) => entry.credit))
                return <tr key={account.number}><td><strong className="invoice-id">{account.number}</strong></td><td>{account.label}</td><td className="sg-num">{money(debit)}</td><td className="sg-num">{money(credit)}</td><td className="sg-num">{money(round2(debit - credit))}</td></tr>
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

function JournalsView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const types = { achats: tr('Achats', 'Purchases'), ventes: tr('Ventes', 'Sales'), tresorerie: tr('Trésorerie', 'Cash and bank'), general: tr('Général', 'General') }
  return (
    <Panel title={tr('Journaux de saisie', 'Entry journals')} subtitle={tr('Chaque journal doit être équilibré : total débit = total crédit', 'Every journal must balance: total debit = total credit')}>
      <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>CODE</th><th>{tr('INTITULÉ', 'LABEL')}</th><th>TYPE</th><th className="sg-num">{tr('PIÈCES', 'DOCUMENTS')}</th><th className="sg-num">{tr('DÉBIT', 'DEBIT')}</th><th className="sg-num">{tr('CRÉDIT', 'CREDIT')}</th><th>{tr('CONTRÔLE', 'CHECK')}</th></tr></thead>
          <tbody>
            {store.journals.map((journal) => {
              const entries = store.entries.filter((entry) => entry.journal === journal.code)
              const debit = sum(entries.map((entry) => entry.debit))
              const credit = sum(entries.map((entry) => entry.credit))
              return (
                <tr key={journal.code}>
                  <td><strong className="invoice-id">{journal.code}</strong></td><td>{journal.label}</td><td>{types[journal.type]}</td>
                  <td className="sg-num">{new Set(entries.map((entry) => entry.piece)).size}</td><td className="sg-num">{money(debit)}</td><td className="sg-num">{money(credit)}</td>
                  <td>{debit === credit ? <Badge tone="good">{tr('Équilibré', 'Balanced')}</Badge> : <Badge tone="warn">{tr('Déséquilibré', 'Unbalanced')}</Badge>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function GuidedPieceView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const [kind, setKind] = useState<'achat' | 'vente'>('achat')
  const [tiers, setTiers] = useState('')
  const [date, setDate] = useState(isoDate())
  const [reference, setReference] = useState('')
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState(String(store.defaultVat))
  const purchase = kind === 'achat'
  const ht = roundAmount(store, num(amount))
  const vat = roundAmount(store, ht * num(rate) / 100)
  const ttc = roundAmount(store, ht + vat)
  const due = addDays(date || isoDate(), 30)
  const lines: PieceLine[] = purchase
    ? [{ account, debit: ht, credit: 0 }, { account: accountsOf(store).vatDeductible, debit: vat, credit: 0 }, { account: accountsOf(store).suppliers, tiers, debit: 0, credit: ttc, due }]
    : [{ account: accountsOf(store).clients, tiers, debit: ttc, credit: 0, due }, { account, debit: 0, credit: ht }, { account: accountsOf(store).vatCollected, debit: 0, credit: vat }]

  function save() {
    if (!tiers || !account || !date || ht <= 0) {
      ctx.notify(tr('Renseignez le tiers, le compte, la date et le montant HT.', 'Enter the party, account, date and net amount.'))
      return
    }
    const label = `${reference.trim() || (purchase ? 'Facture fournisseur' : 'Facture client')} · ${tiersName(store, tiers)}`
    if (!postManual(ctx, purchase ? 'ACH' : 'VTE', date, label, lines)) return
    setReference('')
    setAmount('')
  }

  return (
    <Panel title={tr('Ajout d’une pièce', 'Add an accounting document')} subtitle={tr('Saisie guidée : la TVA et la contrepartie tiers sont calculées', 'Guided entry: VAT and the party counterpart are calculated')}>
      <Chips value={kind} onChange={(value) => { setKind(value); setTiers(''); setAccount('') }} options={[['achat', tr('Facture fournisseur', 'Supplier invoice')], ['vente', tr('Facture client', 'Customer invoice')]]} />
      <div className="sg-form">
        <label>{purchase ? tr('Fournisseur', 'Supplier') : tr('Client', 'Customer')}<select value={tiers} onChange={(event) => setTiers(event.target.value)}>
          <option value="">—</option>
          {(purchase ? store.suppliers : store.clients).map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
        </select></label>
        <label>{purchase ? tr('Compte de charge', 'Expense account') : tr('Compte de produit', 'Income account')}<select value={account} onChange={(event) => setAccount(event.target.value)}>
          <option value="">—</option>
          {store.accounts.filter((item) => item.number.startsWith(purchase ? '6' : '7')).map((item) => <option key={item.number} value={item.number}>{item.number} · {item.label}</option>)}
        </select></label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>{tr('Référence de la pièce', 'Document reference')}<input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <label>{tr('Montant HT', 'Net amount')}<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>{tr('Taux de TVA', 'VAT rate')}<select value={rate} onChange={(event) => setRate(event.target.value)}>{vatRates(store, rate).map((item) => <option key={item} value={item}>{item} %</option>)}</select></label>
      </div>
      <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>{tr('COMPTE', 'ACCOUNT')}</th><th>{tr('TIERS', 'PARTY')}</th><th className="sg-num">{tr('DÉBIT', 'DEBIT')}</th><th className="sg-num">{tr('CRÉDIT', 'CREDIT')}</th></tr></thead>
          <tbody>{lines.map((line, index) => <tr key={index}><td>{line.account || '—'}</td><td>{tiersName(store, line.tiers)}</td><td className="sg-num">{line.debit ? money(line.debit) : ''}</td><td className="sg-num">{line.credit ? money(line.credit) : ''}</td></tr>)}</tbody>
        </table>
      </div>
      <SaveButton label={tr('Enregistrer la pièce', 'Post document')} onClick={save} />
    </Panel>
  )
}

function BankOperationView({ ctx }: ViewProps) {
  const { tr, store } = ctx
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [date, setDate] = useState(isoDate())
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState<string>(accountsOf(store).clients)
  const [tiers, setTiers] = useState('')
  const parties = tiersOptions(store, account)

  function save() {
    const value = round2(num(amount))
    if (!date || !label.trim() || value <= 0 || (parties.length > 0 && !tiers)) {
      ctx.notify(tr('Renseignez la date, le libellé, le montant et le tiers.', 'Enter the date, label, amount and party.'))
      return
    }
    const counterpart = { account, tiers: tiers || undefined }
    const lines: PieceLine[] = direction === 'in'
      ? [{ account: accountsOf(store).bank, debit: value, credit: 0 }, { ...counterpart, debit: 0, credit: value }]
      : [{ ...counterpart, debit: value, credit: 0 }, { account: accountsOf(store).bank, debit: 0, credit: value }]
    if (!postManual(ctx, 'BQ', date, label.trim(), lines)) return
    setLabel('')
    setAmount('')
  }

  return (
    <>
      <Panel title={tr('Saisie des opérations bancaires', 'Bank operations')} subtitle={tr(`La contrepartie ${accountsOf(store).bank} Banque est générée automatiquement`, `The ${accountsOf(store).bank} Bank counterpart is generated automatically`)}>
        <Chips value={direction} onChange={setDirection} options={[['in', tr('Encaissement', 'Receipt')], ['out', tr('Décaissement', 'Payment')]]} />
        <div className="sg-form">
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>{tr('Libellé', 'Label')}<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label>{tr('Montant', 'Amount')}<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>{tr('Compte de contrepartie', 'Counterpart account')}<select value={account} onChange={(event) => { setAccount(event.target.value); setTiers('') }}>
            {store.accounts.filter((item) => item.number !== accountsOf(store).bank).map((item) => <option key={item.number} value={item.number}>{item.number} · {item.label}</option>)}
          </select></label>
          {parties.length > 0 && <label>{tr('Tiers', 'Party')}<select value={tiers} onChange={(event) => setTiers(event.target.value)}>
            <option value="">—</option>
            {parties.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
          </select></label>}
        </div>
        <SaveButton label={tr('Enregistrer l’opération', 'Post operation')} onClick={save} />
      </Panel>
      <Panel title={tr('Journal de banque', 'Bank journal')}><EntriesTable ctx={ctx} entries={store.entries.filter((entry) => entry.journal === 'BQ')} /></Panel>
    </>
  )
}

function FreeEntryView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const blankLine = { account: '', tiers: '', debit: '', credit: '' }
  const [journal, setJournal] = useState('OD')
  const [date, setDate] = useState(isoDate())
  const [label, setLabel] = useState('')
  const [lines, setLines] = useState([blankLine, blankLine])
  const update = (index: number, patch: Partial<typeof blankLine>) => setLines(lines.map((line, position) => position === index ? { ...line, ...patch } : line))
  const debit = sum(lines.map((line) => num(line.debit)))
  const credit = sum(lines.map((line) => num(line.credit)))
  const used = lines.filter((line) => num(line.debit) || num(line.credit))
  const complete = used.every((line) => line.account && (!isTiersAccount(line.account) || line.tiers))
  const balanced = debit > 0 && debit === credit

  function save() {
    if (!date || !label.trim() || !complete) {
      ctx.notify(tr('Renseignez la date, le libellé, et le compte (avec son tiers) de chaque ligne.', 'Enter the date, the label, and the account (with its party) of every line.'))
      return
    }
    const piece = used.map((line) => ({ account: line.account, tiers: line.tiers || undefined, debit: round2(num(line.debit)), credit: round2(num(line.credit)) }))
    if (!postManual(ctx, journal, date, label.trim(), piece)) return
    setLabel('')
    setLines([blankLine, blankLine])
  }

  return (
    <Panel title={tr('Saisie des écritures', 'Journal entry')} subtitle={tr('Saisie libre ligne par ligne ; la pièce doit être équilibrée', 'Free line-by-line entry; the document must balance')}>
      <div className="sg-form">
        <label>{tr('Journal', 'Journal')}<select value={journal} onChange={(event) => setJournal(event.target.value)}>{store.journals.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>{tr('Libellé', 'Label')}<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      </div>
      <div className="sg-lines">
        <div className="sg-line sg-entry-line sg-line-head"><span>{tr('Compte', 'Account')}</span><span>{tr('Tiers', 'Party')}</span><span>{tr('Débit', 'Debit')}</span><span>{tr('Crédit', 'Credit')}</span><span /></div>
        {lines.map((line, index) => {
          const parties = tiersOptions(store, line.account)
          return (
            <div className="sg-line sg-entry-line" key={index}>
              <select aria-label={tr('Compte', 'Account')} value={line.account} onChange={(event) => update(index, { account: event.target.value, tiers: '' })}>
                <option value="">—</option>
                {store.accounts.map((item) => <option key={item.number} value={item.number}>{item.number} · {item.label}</option>)}
              </select>
              <select aria-label={tr('Tiers', 'Party')} value={line.tiers} disabled={!parties.length} onChange={(event) => update(index, { tiers: event.target.value })}>
                <option value="">—</option>
                {parties.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
              </select>
              <input aria-label={tr('Débit', 'Debit')} type="number" min="0" step="0.01" value={line.debit} onChange={(event) => update(index, { debit: event.target.value, credit: '' })} />
              <input aria-label={tr('Crédit', 'Credit')} type="number" min="0" step="0.01" value={line.credit} onChange={(event) => update(index, { credit: event.target.value, debit: '' })} />
              <button className="reject-button" type="button" aria-label={tr('Supprimer la ligne', 'Remove line')} disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, position) => position !== index))}><Trash2 size={13} /></button>
            </div>
          )
        })}
        <div className="sg-lines-footer">
          <button className="upload-button" type="button" onClick={() => setLines([...lines, blankLine])}><Plus size={13} />{tr('Ajouter une ligne', 'Add line')}</button>
          <span>{tr('Débit', 'Debit')} <strong>{money(debit)}</strong></span><span>{tr('Crédit', 'Credit')} <strong>{money(credit)}</strong></span>
          {balanced ? <Badge tone="good">{tr('Équilibrée', 'Balanced')}</Badge> : <Badge tone="warn">{tr('Écart', 'Difference')} {money(round2(debit - credit))}</Badge>}
        </div>
      </div>
      <SaveButton label={tr('Enregistrer la pièce', 'Post document')} onClick={save} disabled={!balanced} />
    </Panel>
  )
}

function EntriesView({ ctx }: ViewProps) {
  const { tr, store } = ctx
  const [journal, setJournal] = useState('all')
  const [month, setMonth] = useState('all')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const entries = store.entries.filter((entry) => (journal === 'all' || entry.journal === journal) && (month === 'all' || period(entry.date) === month))
  const locked = (entry: Entry) => store.closedPeriods.includes(period(entry.date))
  // Pieces generated by a sales, purchase or counter document are corrected from that document, not here.
  const manual = (entry: Entry) => entry.piece.startsWith(`${entry.journal}-`)

  function saveLabel(entry: Entry) {
    if (!draft.trim()) return
    ctx.apply({ ...store, entries: store.entries.map((item) => item.id === entry.id ? { ...item, label: draft.trim() } : item) })
    ctx.audit('Edited entry', `${entry.piece} · ${entry.account}`)
    setEditing(null)
  }

  function remove(entry: Entry) {
    if (store.entries.some((item) => item.piece === entry.piece && item.letter)) {
      ctx.notify(tr('Cette pièce est lettrée et ne peut pas être supprimée.', 'This document is matched and cannot be deleted.'))
      return
    }
    if (!window.confirm(tr(`Supprimer la pièce ${entry.piece} ?`, `Delete document ${entry.piece}?`))) return
    ctx.apply({ ...store, entries: store.entries.filter((item) => item.piece !== entry.piece) })
    ctx.audit('Deleted accounting piece', entry.piece)
    ctx.notify(tr(`Pièce ${entry.piece} supprimée.`, `Document ${entry.piece} deleted.`))
  }

  return (
    <Panel title={tr('Visualisation et modification', 'View and edit entries')} subtitle={tr('Les périodes clôturées et les pièces issues des documents sont verrouillées', 'Closed periods and document-generated entries are locked')}>
      <div className="sg-form">
        <label>{tr('Journal', 'Journal')}<select value={journal} onChange={(event) => setJournal(event.target.value)}><option value="all">{tr('Tous', 'All')}</option>{store.journals.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
        <label>{tr('Période', 'Period')}<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="all">{tr('Toutes', 'All')}</option>{periodsOf(store).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <EntriesTable ctx={ctx} entries={entries}
        renderLabel={(entry) => editing === entry.id
          ? <input className="sg-cell-input wide" aria-label={tr('Libellé', 'Label')} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveLabel(entry); if (event.key === 'Escape') setEditing(null) }} />
          : entry.label}
        action={(entry) => locked(entry) ? <LockKeyhole size={13} aria-label={tr('Période clôturée', 'Closed period')} /> : (
          <div className="row-actions">
            {editing === entry.id
              ? <button className="approve-button" type="button" onClick={() => saveLabel(entry)}><Check size={12} />OK</button>
              : <button className="reject-button" type="button" aria-label={`${tr('Modifier le libellé', 'Edit label')} ${entry.piece}`} onClick={() => { setEditing(entry.id); setDraft(entry.label) }}><Pencil size={13} /></button>}
            {manual(entry) && <button className="reject-button" type="button" aria-label={`${tr('Supprimer la pièce', 'Delete document')} ${entry.piece}`} onClick={() => remove(entry)}><Trash2 size={13} /></button>}
          </div>
        )} />
    </Panel>
  )
}

function SearchView({ ctx }: ViewProps) {
  const { tr, store } = ctx
  const [text, setText] = useState('')
  const [account, setAccount] = useState('')
  const [journal, setJournal] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const needle = text.trim().toLowerCase()
  const results = store.entries.filter((entry) => {
    const amount = entry.debit || entry.credit
    return (!needle || `${entry.piece} ${entry.label} ${tiersName(store, entry.tiers)}`.toLowerCase().includes(needle))
      && (!account || entry.account === account) && (!journal || entry.journal === journal)
      && (!min || amount >= num(min)) && (!max || amount <= num(max))
  })

  return (
    <Panel title={tr('Recherche d’écritures', 'Entry search')} subtitle={`${results.length} ${tr('écriture(s) trouvée(s)', 'entries found')}`}>
      <div className="sg-form">
        <label>{tr('Pièce, libellé ou tiers', 'Document, label or party')}<input value={text} onChange={(event) => setText(event.target.value)} /></label>
        <label>{tr('Compte', 'Account')}<select value={account} onChange={(event) => setAccount(event.target.value)}><option value="">{tr('Tous', 'All')}</option>{store.accounts.map((item) => <option key={item.number} value={item.number}>{item.number} · {item.label}</option>)}</select></label>
        <label>{tr('Journal', 'Journal')}<select value={journal} onChange={(event) => setJournal(event.target.value)}><option value="">{tr('Tous', 'All')}</option>{store.journals.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
        <label>{tr('Montant minimum', 'Minimum amount')}<input type="number" min="0" step="0.01" value={min} onChange={(event) => setMin(event.target.value)} /></label>
        <label>{tr('Montant maximum', 'Maximum amount')}<input type="number" min="0" step="0.01" value={max} onChange={(event) => setMax(event.target.value)} /></label>
      </div>
      <EntriesTable ctx={ctx} entries={results} />
    </Panel>
  )
}

function TiersView({ ctx }: ViewProps) {
  const { tr, store, money, day } = ctx
  const [mode, setMode] = useState<'clients' | 'suppliers'>('clients')
  const today = isoDate()
  const account = mode === 'clients' ? accountsOf(store).clients : accountsOf(store).suppliers
  const open = store.entries
    .filter((entry) => entry.account === account && entry.tiers && !entry.letter && (mode === 'clients' ? entry.debit > 0 : entry.credit > 0))
    .sort((a, b) => (a.due ?? a.date).localeCompare(b.due ?? b.date))
  const amount = (entry: Entry) => entry.debit || entry.credit
  const overdue = open.filter((entry) => (entry.due ?? entry.date) < today)
  const lateDays = (entry: Entry) => Math.round((Date.parse(today) - Date.parse(entry.due ?? entry.date)) / 86_400_000)

  function remind(code: string) {
    const level = Math.min(3, (store.reminders[code] ?? 0) + 1)
    ctx.apply({ ...store, reminders: { ...store.reminders, [code]: level } })
    ctx.audit('Sent payment reminder', `${tiersName(store, code)} · level ${level}`)
    ctx.notify(tr(`Relance de niveau ${level} enregistrée pour ${tiersName(store, code)}.`, `Level ${level} reminder recorded for ${tiersName(store, code)}.`))
  }

  return (
    <Panel title={tr('Gestion et suivi des tiers', 'Party follow-up')} subtitle={tr('Échéances non lettrées et relances', 'Unmatched due items and reminders')}>
      <Chips value={mode} onChange={setMode} options={[['clients', tr('Clients', 'Customers')], ['suppliers', tr('Fournisseurs', 'Suppliers')]]} />
      <div className="sg-stats">
        <Stat label={tr('Échéances ouvertes', 'Open items')} value={money(sum(open.map(amount)))} />
        <Stat label={tr('Dont échues', 'Of which overdue')} value={money(sum(overdue.map(amount)))} />
        <Stat label={tr('Pièces échues', 'Overdue documents')} value={String(overdue.length)} />
      </div>
      {open.length ? <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>{tr('TIERS', 'PARTY')}</th><th>{tr('PIÈCE', 'DOC')}</th><th>DATE</th><th>{tr('ÉCHÉANCE', 'DUE DATE')}</th><th className="sg-num">{tr('MONTANT', 'AMOUNT')}</th><th>{tr('SITUATION', 'STATUS')}</th>{mode === 'clients' && <th>{tr('RELANCE', 'REMINDER')}</th>}</tr></thead>
          <tbody>
            {open.map((entry) => {
              const late = lateDays(entry)
              const level = store.reminders[entry.tiers!] ?? 0
              return (
                <tr key={entry.id}>
                  <td>{tiersName(store, entry.tiers)}</td><td><strong className="invoice-id">{entry.piece}</strong></td><td className="date-cell">{day(entry.date)}</td><td className="date-cell">{day(entry.due ?? entry.date)}</td>
                  <td className="sg-num">{money(amount(entry))}</td>
                  <td>{late > 0 ? <Badge tone="warn">{tr(`Échue depuis ${late} j`, `${late} days overdue`)}</Badge> : <Badge tone="good">{tr('À échoir', 'Not yet due')}</Badge>}</td>
                  {mode === 'clients' && <td><div className="row-actions">
                    {level > 0 && <Badge>{tr(`Niveau ${level}`, `Level ${level}`)}</Badge>}
                    {late > 0 && level < 3 && <button className="approve-button" type="button" onClick={() => remind(entry.tiers!)}>{tr('Relancer', 'Remind')}</button>}
                  </div></td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div> : <div className="empty-state"><CheckCircle2 size={17} />{tr('Aucune échéance ouverte.', 'No open items.')}</div>}
    </Panel>
  )
}

function AdvancedView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const pieces = Array.from(new Set(store.entries.map((entry) => entry.piece)))
  const [piece, setPiece] = useState('')
  const [reversalDate, setReversalDate] = useState(isoDate())
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(isoDate())
  const [targets, setTargets] = useState([{ account: '', share: '50' }, { account: '', share: '50' }])
  const shares = sum(targets.map((target) => num(target.share)))

  function reverse() {
    const original = store.entries.filter((entry) => entry.piece === piece)
    if (!original.length || !reversalDate) {
      ctx.notify(tr('Choisissez la pièce à extourner et la date.', 'Choose the document to reverse and the date.'))
      return
    }
    const lines = original.map((entry) => ({ account: entry.account, tiers: entry.tiers, debit: entry.credit, credit: entry.debit }))
    if (postManual(ctx, original[0].journal, reversalDate, `Extourne ${piece}`, lines)) setPiece('')
  }

  function distribute() {
    const total = round2(num(amount))
    if (!source || total <= 0 || shares !== 100 || targets.some((target) => !target.account)) {
      ctx.notify(tr('Renseignez le compte source, le montant et des comptes cibles totalisant 100 %.', 'Enter the source account, the amount and target accounts totalling 100%.'))
      return
    }
    let remaining = total
    const debits = targets.map((target, index) => {
      const value = index === targets.length - 1 ? round2(remaining) : round2(total * num(target.share) / 100)
      remaining -= value
      return { account: target.account, debit: value, credit: 0 }
    })
    if (postManual(ctx, 'OD', date, `Répartition ${source}`, [{ account: source, debit: 0, credit: total }, ...debits])) setAmount('')
  }

  return (
    <>
      <Panel title={tr('Rectification par extourne', 'Correction by reversal')} subtitle={tr('Génère la pièce inverse sans effacer l’écriture d’origine', 'Generates the opposite document without erasing the original entry')}>
        <div className="sg-form">
          <label>{tr('Pièce à extourner', 'Document to reverse')}<select value={piece} onChange={(event) => setPiece(event.target.value)}>
            <option value="">—</option>
            {pieces.map((item) => <option key={item} value={item}>{item} · {store.entries.find((entry) => entry.piece === item)?.label}</option>)}
          </select></label>
          <label>{tr('Date de l’extourne', 'Reversal date')}<input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} /></label>
        </div>
        <div className="sg-actions"><button className="primary-button" type="button" onClick={reverse}><Undo2 size={14} />{tr('Extourner la pièce', 'Reverse document')}</button></div>
      </Panel>
      <Panel title={tr('Répartition d’un montant', 'Amount distribution')} subtitle={tr('Ventile un montant d’un compte vers plusieurs comptes par pourcentage', 'Splits an amount from one account to several accounts by percentage')}>
        <div className="sg-form">
          <label>{tr('Compte source', 'Source account')}<select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">—</option>
            {store.accounts.map((item) => <option key={item.number} value={item.number}>{item.number} · {item.label}</option>)}
          </select></label>
          <label>{tr('Montant à répartir', 'Amount to distribute')}<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          {targets.map((target, index) => (
            <label key={index}>{tr('Compte cible', 'Target account')} {index + 1}
              <span className="sg-inline">
                <select value={target.account} onChange={(event) => setTargets(targets.map((item, position) => position === index ? { ...item, account: event.target.value } : item))}>
                  <option value="">—</option>
                  {store.accounts.filter((item) => item.number !== source).map((item) => <option key={item.number} value={item.number}>{item.number} · {item.label}</option>)}
                </select>
                <input aria-label="%" type="number" min="0" max="100" step="1" value={target.share} onChange={(event) => setTargets(targets.map((item, position) => position === index ? { ...item, share: event.target.value } : item))} />
              </span>
            </label>
          ))}
        </div>
        <div className="sg-actions">
          <Badge tone={shares === 100 ? 'good' : 'warn'}>{shares} %</Badge>
          {num(amount) > 0 && <span className="sg-hint">{money(num(amount))}</span>}
          <button className="upload-button" type="button" onClick={() => setTargets([...targets, { account: '', share: '0' }])}><Plus size={13} />{tr('Ajouter un compte cible', 'Add target account')}</button>
          <button className="primary-button" type="button" onClick={distribute}><Check size={14} />{tr('Générer la répartition', 'Post distribution')}</button>
        </div>
      </Panel>
    </>
  )
}

function PeriodicView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const tiersEntries = store.entries.filter((entry) => entry.tiers && isTiersAccount(entry.account))
  const unlettered = tiersEntries.filter((entry) => !entry.letter).length

  function letter() {
    const next = autoLetter(store)
    const count = next.entries.filter((entry) => entry.letter).length - store.entries.filter((entry) => entry.letter).length
    if (count) {
      ctx.apply(next)
      ctx.audit('Lettered entries', `${count} entries`)
    }
    ctx.notify(count ? tr(`${count} écritures lettrées.`, `${count} entries matched.`) : tr('Aucun rapprochement possible : les montants ne correspondent pas.', 'Nothing to match: amounts do not correspond.'))
  }

  function toggle(month: string) {
    const isClosed = store.closedPeriods.includes(month)
    ctx.apply({ ...store, closedPeriods: isClosed ? store.closedPeriods.filter((item) => item !== month) : [...store.closedPeriods, month] })
    ctx.audit(isClosed ? 'Reopened period' : 'Closed period', month)
    ctx.notify(isClosed ? tr(`Période ${month} rouverte.`, `Period ${month} reopened.`) : tr(`Période ${month} clôturée : plus aucune saisie possible.`, `Period ${month} closed: no further entries allowed.`))
  }

  return (
    <>
      <Panel title={tr('Lettrage automatique', 'Automatic matching')} subtitle={tr('Rapproche les factures et les règlements d’un même tiers', 'Matches invoices and payments of the same party')}
        action={<button className="primary-button" type="button" onClick={letter}><Link2 size={14} />{tr('Lancer le lettrage', 'Run matching')}</button>}>
        <div className="sg-stats">
          <Stat label={tr('Écritures de tiers', 'Party entries')} value={String(tiersEntries.length)} />
          <Stat label={tr('Lettrées', 'Matched')} value={String(tiersEntries.length - unlettered)} />
          <Stat label={tr('À lettrer', 'To match')} value={String(unlettered)} />
        </div>
        <EntriesTable ctx={ctx} entries={tiersEntries} />
      </Panel>
      <Panel title={tr('Clôture des périodes', 'Period closing')} subtitle={tr('Une période clôturée n’accepte plus ni saisie ni modification', 'A closed period accepts no further entry or change')}>
        <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>{tr('PÉRIODE', 'PERIOD')}</th><th className="sg-num">{tr('ÉCRITURES', 'ENTRIES')}</th><th className="sg-num">{tr('MOUVEMENTS', 'MOVEMENTS')}</th><th>{tr('ÉTAT', 'STATUS')}</th><th /></tr></thead>
            <tbody>
              {periodsOf(store).map((month) => {
                const entries = store.entries.filter((entry) => period(entry.date) === month)
                const isClosed = store.closedPeriods.includes(month)
                return (
                  <tr key={month}>
                    <td><strong className="invoice-id">{month}</strong></td><td className="sg-num">{entries.length}</td><td className="sg-num">{money(sum(entries.map((entry) => entry.debit)))}</td>
                    <td>{isClosed ? <Badge tone="good">{tr('Clôturée', 'Closed')}</Badge> : <Badge>{tr('Ouverte', 'Open')}</Badge>}</td>
                    <td><button className="approve-button" type="button" onClick={() => toggle(month)}>{isClosed ? <><LockKeyholeOpen size={12} />{tr('Rouvrir', 'Reopen')}</> : <><LockKeyhole size={12} />{tr('Clôturer', 'Close')}</>}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

function ReportsView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const [report, setReport] = useState<'balance' | 'ledger' | 'journal' | 'vat'>('balance')
  const [month, setMonth] = useState('all')
  const [account, setAccount] = useState<string>(accountsOf(store).clients)
  const [journal, setJournal] = useState('all')
  const entries = store.entries.filter((entry) => month === 'all' || period(entry.date) === month)
  const titles = { balance: tr('Balance des comptes', 'Trial balance'), ledger: tr('Grand livre', 'General ledger'), journal: tr('Journal', 'Journal'), vat: tr('Déclaration de TVA', 'VAT return') }
  const balance = store.accounts.map((item) => {
    const lines = entries.filter((entry) => entry.account === item.number)
    const debit = sum(lines.map((entry) => entry.debit))
    const credit = sum(lines.map((entry) => entry.credit))
    return { ...item, debit, credit, solde: round2(debit - credit) }
  }).filter((row) => row.debit || row.credit)
  const movement = (prefix: string, side: 1 | -1) => sum(entries.filter((entry) => entry.account.startsWith(prefix)).map((entry) => side * (entry.credit - entry.debit)))
  const { prefixes } = chartOf(store)
  const collected = movement(prefixes.vatCollected, 1)
  const deductible = movement(prefixes.vatDeductible, -1)
  const listed = report === 'ledger' ? entries.filter((entry) => entry.account === account) : entries.filter((entry) => journal === 'all' || entry.journal === journal)
  const fileName = `${titles[report]} ${month === 'all' ? '' : month}`.trim()

  function exportExcel() {
    const sheet: Sheet = report === 'balance'
      ? { name: titles.balance, rows: [['Compte', 'Intitulé', 'Débit', 'Crédit', 'Solde'], ...balance.map((row) => [row.number, row.label, row.debit, row.credit, row.solde])] }
      : report === 'vat'
        ? { name: titles.vat, rows: [['Rubrique', 'Montant'], ['Ventes HT', movement('7', 1)], ['TVA collectée', collected], ['Achats HT', movement('6', -1)], ['TVA déductible', deductible], ['TVA à payer', round2(collected - deductible)]] }
        : { name: titles[report], rows: entriesSheet(store, listed) }
    downloadXlsx(`${fileName}.xlsx`, [sheet])
  }

  return (
    <Panel className="sg-report" title={titles[report]} subtitle={`${store.company} · ${month === 'all' ? tr('Toutes périodes', 'All periods') : month}`}
      action={<div className="row-actions sg-noprint">
        <button className="approve-button" type="button" onClick={exportExcel}><FileSpreadsheet size={13} />Excel</button>
        {ctx.savePdf && <button className="approve-button" type="button" onClick={() => ctx.savePdf?.(fileName)}><FileDown size={13} />PDF</button>}
        <button className="primary-button" type="button" onClick={() => window.print()}><Printer size={14} />{tr('Imprimer', 'Print')}</button>
      </div>}>
      <Chips value={report} onChange={setReport} options={[['balance', tr('Balance', 'Trial balance')], ['ledger', tr('Grand livre', 'Ledger')], ['journal', tr('Journal', 'Journal')], ['vat', tr('TVA', 'VAT')]]} />
      <div className="sg-form sg-noprint">
        <label>{tr('Période', 'Period')}<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="all">{tr('Toutes', 'All')}</option>{periodsOf(store).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {report === 'ledger' && <label>{tr('Compte', 'Account')}<select value={account} onChange={(event) => setAccount(event.target.value)}>{store.accounts.map((item) => <option key={item.number} value={item.number}>{item.number} · {item.label}</option>)}</select></label>}
        {report === 'journal' && <label>{tr('Journal', 'Journal')}<select value={journal} onChange={(event) => setJournal(event.target.value)}><option value="all">{tr('Tous', 'All')}</option>{store.journals.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>}
      </div>
      {report === 'balance' && <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>{tr('COMPTE', 'ACCOUNT')}</th><th>{tr('INTITULÉ', 'LABEL')}</th><th className="sg-num">{tr('DÉBIT', 'DEBIT')}</th><th className="sg-num">{tr('CRÉDIT', 'CREDIT')}</th><th className="sg-num">{tr('SOLDE DÉBITEUR', 'DEBIT BALANCE')}</th><th className="sg-num">{tr('SOLDE CRÉDITEUR', 'CREDIT BALANCE')}</th></tr></thead>
          <tbody>{balance.map((row) => <tr key={row.number}><td><strong className="invoice-id">{row.number}</strong></td><td>{row.label}</td><td className="sg-num">{money(row.debit)}</td><td className="sg-num">{money(row.credit)}</td><td className="sg-num">{row.solde > 0 ? money(row.solde) : ''}</td><td className="sg-num">{row.solde < 0 ? money(-row.solde) : ''}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>{tr('Totaux', 'Totals')}</td><td className="sg-num">{money(sum(balance.map((row) => row.debit)))}</td><td className="sg-num">{money(sum(balance.map((row) => row.credit)))}</td><td className="sg-num">{money(sum(balance.map((row) => Math.max(row.solde, 0))))}</td><td className="sg-num">{money(sum(balance.map((row) => Math.max(-row.solde, 0))))}</td></tr></tfoot>
        </table>
      </div>}
      {(report === 'ledger' || report === 'journal') && <EntriesTable ctx={ctx} entries={listed} />}
      {report === 'vat' && <div className="sg-stats">
        <Stat label={tr('Ventes HT (classe 7)', 'Net sales (class 7)')} value={money(movement('7', 1))} />
        <Stat label={tr(`TVA collectée (${prefixes.vatCollected})`, `VAT collected (${prefixes.vatCollected})`)} value={money(collected)} />
        <Stat label={tr('Achats HT (classe 6)', 'Net purchases (class 6)')} value={money(movement('6', -1))} />
        <Stat label={tr(`TVA déductible (${prefixes.vatDeductible})`, `Deductible VAT (${prefixes.vatDeductible})`)} value={money(deductible)} />
        <Stat label={collected >= deductible ? tr('TVA à payer', 'VAT payable') : tr('Crédit de TVA', 'VAT credit')} value={money(Math.abs(round2(collected - deductible)))} />
      </div>}
    </Panel>
  )
}
