// Sage 100 Gestion commerciale: customers, sales documents, purchases, items, production and stock count.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, FileDown, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { accountsOf, advancePurchaseDoc, advanceSalesDoc, articleInUse, registerSupplierInvoice, completeWorkOrder, docTotals, isoDate, tiersInUse, missingComponent, movesStock, nextNumber, nextSalesType, purchaseTypes, round2, salesTypes, saveSalesDoc, savePurchaseDoc, supplierStockAnalysis, tiersBalance, tiersName, type Article, type Client, type Origin, type PurchaseDoc, type PurchaseDocType, type SalesDoc, type SalesDocType, type Supplier } from '../sageData'
import { invoiceSheet, missingMentions } from '../invoice'
import { type DraftLine, type ViewProps, confirmDelete, emptyLine, num, parseLines, stockAvailable, sum, taxIdLabelOf, vatRates } from './helpers'
import { Badge, Chips, LinesEditor, Panel, SaveButton, Stat } from './ui'

/** A sales document laid out for printing on A4, with the mentions an invoice must carry. Only the sheet is printed. */
function InvoiceSheet({ ctx, doc, onClose }: ViewProps & { doc: SalesDoc; onClose: () => void }) {
  const { tr, store, money, day } = ctx
  const sheet = invoiceSheet(store, doc)
  const missing = missingMentions(store, doc)
  const info = store.companyInfo
  const due = store.entries.find((entry) => entry.piece === doc.id && entry.due)?.due
  // The sheet is a French document: rates are written 19,25 %.
  const rate = (value: number) => `${new Intl.NumberFormat('fr-FR').format(value)} %`
  const identity = [info.taxId && `${sheet.taxIdLabel} : ${info.taxId}`, info.rccm && `RCCM : ${info.rccm}`, info.nationalId && `Id. nat. : ${info.nationalId}`].filter(Boolean).join(' · ')
  // Mounted on <body>, so printing can hide the rest of the app entirely.
  return createPortal(
    <div className="modal-backdrop sg-invoice-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="sg-invoice-frame" role="dialog" aria-modal="true" aria-label={`${sheet.title} ${doc.id}`}>
        <div className="sg-invoice-toolbar sg-noprint">
          {missing.length > 0 && <span className="sg-invoice-missing">{tr('Mentions manquantes', 'Missing mentions')} : {missing.join(', ')}</span>}
          <div className="row-actions">
            {ctx.savePdf && <button className="approve-button" type="button" onClick={() => ctx.savePdf?.(`${sheet.title} ${doc.id}`)}><FileDown size={13} />PDF</button>}
            <button className="primary-button" type="button" onClick={() => window.print()}><Printer size={14} />{tr('Imprimer', 'Print')}</button>
            <button className="approve-button" type="button" onClick={onClose}>{tr('Fermer', 'Close')}</button>
          </div>
        </div>
        <article className="sg-invoice">
          <header className="sg-invoice-head">
            <div>
              <strong className="sg-invoice-company">{store.company}</strong>
              {info.address && <span>{info.address}{info.city && `, ${info.city}`}</span>}
              {(info.phone || info.email) && <span>{[info.phone, info.email].filter(Boolean).join(' · ')}</span>}
              {identity && <span>{identity}</span>}
              {(info.taxRegime || info.taxOffice) && <span>{[info.taxRegime && `${tr('Régime', 'Regime')} : ${info.taxRegime}`, info.taxOffice && `${tr('Centre des impôts', 'Tax office')} : ${info.taxOffice}`].filter(Boolean).join(' · ')}</span>}
            </div>
            <div className="sg-invoice-title">
              <strong>{sheet.title}</strong>
              <span>N° {doc.id}</span>
              <span>{tr('Date', 'Date')} : {day(doc.date)}</span>
              {due && doc.type === 'facture' && <span>{tr('Échéance', 'Due')} : {day(due)}</span>}
            </div>
          </header>
          <div className="sg-invoice-client">
            <small>{tr('Client', 'Customer')}</small>
            <strong>{sheet.client?.name ?? tr('Client comptoir', 'Walk-in customer')}</strong>
            {sheet.client && [sheet.client.address, sheet.client.city].filter(Boolean).length > 0 && <span>{[sheet.client.address, sheet.client.city].filter(Boolean).join(', ')}</span>}
            {sheet.client?.taxId && <span>{sheet.taxIdLabel} : {sheet.client.taxId}</span>}
          </div>
          <table className="sg-invoice-lines">
            <thead><tr><th>{tr('Réf.', 'Ref.')}</th><th>{tr('Désignation', 'Description')}</th><th className="sg-num">{tr('Qté', 'Qty')}</th><th className="sg-num">{tr('P.U. HT', 'Unit price')}</th><th className="sg-num">{tr('TVA', 'VAT')}</th><th className="sg-num">{tr('Montant HT', 'Net amount')}</th></tr></thead>
            <tbody>{sheet.lines.map((line, index) => <tr key={index}><td>{line.ref}</td><td>{line.name}</td><td className="sg-num">{line.qty}</td><td className="sg-num">{money(line.price)}</td><td className="sg-num">{rate(line.vat)}</td><td className="sg-num">{money(line.total)}</td></tr>)}</tbody>
          </table>
          <div className="sg-invoice-totals">
            <table>
              <tbody>
                {sheet.rates.map((line) => <tr key={line.rate}><td>{tr(`Base HT à ${rate(line.rate)}`, `Net at ${line.rate}%`)}</td><td className="sg-num">{money(line.base)}</td></tr>)}
                <tr><td>{tr('Total HT', 'Total net')}</td><td className="sg-num">{money(sheet.totals.ht)}</td></tr>
                {sheet.vatParts.length
                  ? sheet.vatParts.map((part) => <tr key={part.label}><td>{part.label}</td><td className="sg-num">{money(part.amount)}</td></tr>)
                  : <tr><td>{tr('Total TVA', 'Total VAT')}</td><td className="sg-num">{money(sheet.totals.vat)}</td></tr>}
                <tr className="sg-invoice-grand"><td>{tr('Net à payer TTC', 'Total due')}</td><td className="sg-num">{money(sheet.totals.ttc)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="sg-invoice-words">{tr(`Arrêté${doc.type === 'facture' ? 'e la présente facture' : ' le présent document'} à la somme de : `, 'Amount in words: ')}<strong>{sheet.words}</strong>.</p>
          {doc.type === 'ticket' && <p className="sg-invoice-words">{tr('Payé', 'Paid')} : {doc.payment === 'card' ? tr('carte', 'card') : tr('espèces', 'cash')}</p>}
          {info.bank && <p className="sg-invoice-words">{tr('Règlement par virement', 'Payment by transfer')} : {info.bank}</p>}
        </article>
      </section>
    </div>,
    document.body,
  )
}

export function ClientsView({ ctx, origin }: ViewProps & { origin: Origin }) {
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
          <label>{tr('Adresse', 'Address')}<input value={form.address ?? ''} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
          <label>{taxIdLabelOf(store)}<input value={form.taxId ?? ''} onChange={(event) => setForm({ ...form, taxId: event.target.value })} /></label>
        </div>
        <SaveButton label={tr('Enregistrer le client', 'Save customer')} onClick={save} />
      </Panel>
    </>
  )
}

export function SalesDocsView({ ctx, origin }: ViewProps & { origin: Origin }) {
  const { tr, store, money, day } = ctx
  const [filter, setFilter] = useState<SalesDocType | 'all'>('all')
  const [printing, setPrinting] = useState<SalesDoc | null>(null)
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
    <>
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
                    <button className="reject-button" type="button" title={tr('Imprimer', 'Print')} aria-label={`${tr('Imprimer', 'Print')} ${doc.id}`} onClick={() => setPrinting(doc)}><Printer size={13} /></button>
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
    {printing && <InvoiceSheet ctx={ctx} doc={printing} onClose={() => setPrinting(null)} />}
    </>
  )
}

export function SalesDocForm({ ctx, origin, fixedType }: ViewProps & { origin: Origin; fixedType?: SalesDocType }) {
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

export function InterrogationView({ ctx }: ViewProps) {
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

export function PurchasesView({ ctx }: ViewProps) {
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

export function ArticlesView({ ctx, editable }: ViewProps & { editable?: boolean }) {
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

export function FabricationView({ ctx }: ViewProps) {
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

export function InventoryView({ ctx }: ViewProps) {
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
