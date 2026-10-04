import { useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, Check, CheckCircle2, Clock3, FileCheck2, FileSearch, FileSpreadsheet, ListChecks, LoaderCircle, LockKeyhole,
  Pencil, Plus, Search, ShieldAlert, Trash2, Upload, Wallet, X,
} from 'lucide-react'
import {
  addBankLines, approveSupplierInvoice, articleAnalysis, cashForecast, closeChecks, closeProgress, dataQuality, manualCloseTasks, matchBankLine, missingInvoiceFields,
  filterSupplierInvoices, monthlySales, openItems, overview, parseBankCsv, postBankLine, rejectSupplierInvoice, saveSupplierInvoice, suggestBankMatch, type ForecastWeek, type QualityIssue,
} from './financeData'
import { readInvoiceDocument } from './invoiceImport'
import { chartOf, isoDate, isTiersAccount, round2, sageModules, tiersName, type ModuleId, type Store, type SupplierInvoice } from './sageData'
import { downloadXlsx, type Sheet } from './xlsx'
import './FinanceSections.css'

export type FinanceSection = 'overview' | 'invoices' | 'bank' | 'close' | 'forecast' | 'analysis' | 'data' | 'help'
export type FinanceProps = {
  store: Store
  apply: (next: Store) => void
  tr: (fr: string, en: string) => string
  money: (amount: number) => string
  day: (date: string) => string
  notify: (message: string) => void
  audit: (action: string, record: string) => void
  go: (section: FinanceSection | ModuleId | 'audit', activity?: string) => void
  savePdf?: (name: string) => Promise<string | null>
  /** Administrators alone may reopen a closed period. */
  admin?: boolean
}

const period = (date: string) => date.slice(0, 7)
const num = (value: string) => {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function Panel({ title, subtitle, action, className = 'workflow-panel', children }: { title: ReactNode; subtitle?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel sg-panel ${className}`}>
      <div className="panel-heading"><div><div className="panel-title">{title}</div>{subtitle && <div className="panel-subtitle">{subtitle}</div>}</div>{action}</div>
      {children}
    </section>
  )
}

function Metric({ title, value, delta, period: caption, icon, kind }: { title: string; value: string; delta: string; period: string; icon: ReactNode; kind: 'positive' | 'neutral' | 'attention' }) {
  return <article className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${kind}`}>{icon}</span></div><strong className="metric-value">{value}</strong><div className="metric-bottom"><span className={`metric-delta ${kind}`}>{delta}</span><span>{caption}</span></div></article>
}

function ForecastChart({ weeks, money, day }: { weeks: ForecastWeek[]; money: FinanceProps['money']; day: FinanceProps['day'] }) {
  const top = Math.max(1, ...weeks.map((week) => week.balance))
  return (
    <div className="chart-wrap">
      <div className="chart-y-labels"><span>{money(top)}</span><span>{money(top / 2)}</span><span>{money(0)}</span></div>
      <div className="chart-area">
        <div className="chart-gridlines"><i /><i /><i /></div>
        <div className="chart-bars">{weeks.map((week) => (
          <div className="bar-group fin-bar" key={week.start} title={`${day(week.start)} · ${money(week.balance)}`}>
            <span className={`bar ${week.balance < 0 ? 'expense' : 'income'}`} style={{ height: `${Math.max(2, Math.abs(week.balance) / top * 100)}%` }} />
          </div>
        ))}</div>
        <div className="chart-x-labels">{weeks.filter((_, index) => index % 3 === 0).map((week) => <span key={week.start}>{day(week.start).slice(0, 5)}</span>)}</div>
      </div>
    </div>
  )
}

function OverviewSection({ store, tr, money, day, go }: FinanceProps) {
  const today = isoDate()
  const figures = overview(store, today)
  const weeks = cashForecast(store, today)
  const quality = dataQuality(store)
  const close = closeProgress(store, period(today))
  const growth = figures.previousRevenue ? `${figures.revenue >= figures.previousRevenue ? '+' : ''}${(100 * (figures.revenue - figures.previousRevenue) / figures.previousRevenue).toFixed(1)} %` : '—'
  const todo: { icon: ReactNode; title: string; meta: string; count: number; target: Parameters<FinanceProps['go']> }[] = [
    { icon: <FileCheck2 size={16} />, title: tr('Factures fournisseurs à valider', 'Supplier invoices to approve'), meta: tr('Rien n’est comptabilisé sans validation', 'Nothing is posted without approval'), count: figures.invoicesToReview, target: ['invoices'] },
    { icon: <ArrowDownLeft size={16} />, title: tr('Mouvements bancaires à rapprocher', 'Bank lines to reconcile'), meta: tr('Relevé importé, non encore comptabilisé', 'Statement imported, not yet posted'), count: figures.bankToMatch, target: ['bank'] },
    { icon: <Clock3 size={16} />, title: tr('Factures clients échues', 'Overdue customer invoices'), meta: tr('À relancer dans le suivi des tiers', 'To chase in party follow-up'), count: figures.overdueReceivables, target: ['compta', 'cp.tiers'] },
    { icon: <ListChecks size={16} />, title: tr('Fiches à compléter', 'Records to complete'), meta: tr(`Qualité des données : ${quality.score} / 100`, `Data quality: ${quality.score} / 100`), count: quality.issues.reduce((count, issue) => count + issue.records.length, 0), target: ['data'] },
  ]

  return (
    <>
      <section className="metrics-grid">
        <Metric title={tr('Chiffre d’affaires du mois', 'Revenue this month')} value={money(figures.revenue)} delta={growth} period={tr('vs mois dernier', 'vs last month')} icon={<ArrowUpRight size={16} />} kind="positive" />
        <Metric title={tr('Créances clients', 'Customer receivables')} value={money(figures.receivables)} delta={String(figures.receivablesCount)} period={tr('factures ouvertes', 'open invoices')} icon={<FileCheck2 size={16} />} kind="neutral" />
        <Metric title={tr('Dettes fournisseurs', 'Supplier payables')} value={money(figures.payables)} delta={String(figures.payablesCount)} period={tr('factures à payer', 'invoices to pay')} icon={<Clock3 size={16} />} kind="attention" />
        <Metric title={tr('Trésorerie', 'Cash position')} value={money(figures.cash)} delta="" period={tr('banque et caisse', 'bank and cash')} icon={<Wallet size={16} />} kind="positive" />
      </section>
      <section className="overview-grid">
        <div className="panel chart-panel">
          <div className="panel-heading"><div><div className="panel-title">{tr('Prévision de trésorerie', 'Cash forecast')}</div><div className="panel-subtitle">{tr('Solde projeté sur 13 semaines, selon les échéances ouvertes', 'Projected balance over 13 weeks, from open due dates')}</div></div><button className="text-button" type="button" onClick={() => go('forecast')}>{tr('Détail', 'Details')}<ArrowRight size={14} /></button></div>
          <div className="chart-summary"><strong>{money(weeks.at(-1)!.balance)}</strong><small>{tr('solde estimé au', 'projected balance on')} {day(weeks.at(-1)!.start)}</small></div>
          <ForecastChart weeks={weeks} money={money} day={day} />
        </div>
        <div className="panel close-panel">
          <div className="panel-heading"><div><div className="panel-title">{tr('À traiter', 'To do')}</div><div className="panel-subtitle">{tr('Calculé sur vos données', 'Computed from your data')}</div></div></div>
          <div className="fin-todo">
            {todo.map((item) => (
              <button className="data-issue" key={item.title} type="button" onClick={() => go(...item.target)}>
                <span className="data-issue-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.meta}</small></span>
                <span className={`sg-badge ${item.count ? 'warn' : 'good'}`}>{item.count || <Check size={11} />}</span><ArrowRight size={14} />
              </button>
            ))}
            <button className="data-issue" type="button" onClick={() => go('close')}>
              <span className="data-issue-icon"><LockKeyhole size={16} /></span><span><strong>{tr('Clôture du mois', 'Month-end close')}</strong><small>{period(today)}</small></span>
              <span className={`sg-badge ${close.done === close.total ? 'good' : ''}`}>{close.done}/{close.total}</span><ArrowRight size={14} />
            </button>
          </div>
        </div>
      </section>
    </>
  )
}

function InvoicesSection({ store, apply, tr, money, day, notify, audit, savePdf }: FinanceProps) {
  const blank = { id: '', number: '', supplier: '', date: isoDate(), due: '', amount: '', vat: '', account: '', source: '' }
  const [form, setForm] = useState(blank)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [supplier, setSupplier] = useState('')
  const [manualSupplier, setManualSupplier] = useState(false)
  const waiting = store.supplierInvoices.filter((invoice) => invoice.status === 'needs_review')
  const supplierNames = Array.from(new Set([
    ...store.suppliers.map((item) => item.name.trim()),
    ...store.supplierInvoices.map((invoice) => invoice.supplier.trim()),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const filteredInvoices = filterSupplierInvoices(store.supplierInvoices, supplier)
  const pending = filteredInvoices.filter((invoice) => invoice.status === 'needs_review')
  const expenseAccounts = store.accounts.filter((account) => account.number.startsWith('6'))
  const fieldNames: Record<string, string> = { number: tr('numéro', 'number'), supplier: tr('fournisseur', 'supplier'), date: 'date', amount: tr('montant', 'amount'), vat: tr('TVA', 'VAT'), account: tr('compte', 'account') }
  const statusName = (status: SupplierInvoice['status']) => status === 'approved' ? tr('Validée', 'Approved') : status === 'rejected' ? tr('Refusée', 'Rejected') : tr('À valider', 'Needs review')
  const reportName = `AICOM-fournisseurs-${supplier || 'tous'}-${isoDate()}`.replace(/[\\/:*?"<>|]/g, '-')
  const invoiceRows = filteredInvoices.map((invoice) => [
    invoice.id, invoice.number, invoice.supplier, invoice.date, invoice.due, invoice.amount, invoice.vat,
    invoice.account, statusName(invoice.status), invoice.piece ?? '', invoice.source ?? '',
  ])
  const itemRows = filteredInvoices.flatMap((invoice) => (invoice.lines ?? []).map((line) => [
    invoice.number, invoice.supplier, line.date, line.supplierPart1, line.supplierPart2, line.item,
    line.quantity, line.unitPrice, line.total,
  ]))
  const reportSheets: Sheet[] = [
    { name: 'Factures fournisseurs', rows: [[tr('Identifiant', 'ID'), tr('N° facture', 'Invoice no.'), tr('Fournisseur', 'Supplier'), tr('Date', 'Date'), tr('Échéance', 'Due date'), tr('Montant TTC', 'Gross amount'), tr('TVA', 'VAT'), tr('Compte', 'Account'), tr('Statut', 'Status'), tr('Pièce comptable', 'Entry'), tr('Fichier source', 'Source file')], ...invoiceRows] },
    { name: tr('Articles', 'Items'), rows: [[tr('N° facture', 'Invoice no.'), tr('Fournisseur', 'Supplier'), tr('Date', 'Date'), tr('Fournisseur 1', 'Supplier part 1'), tr('Fournisseur 2', 'Supplier part 2'), tr('Article', 'Item'), tr('Quantité', 'Quantity'), tr('Prix unitaire', 'Unit price'), tr('Total', 'Total')], ...itemRows] },
  ]

  async function exportPdf() {
    if (!filteredInvoices.length) return
    document.body.classList.add('print-supplier-report')
    try {
      if (savePdf) {
        const file = await savePdf(reportName)
        if (file) notify(tr(`PDF enregistré : ${file}`, `PDF saved: ${file}`))
      } else {
        window.print()
      }
    } finally {
      document.body.classList.remove('print-supplier-report')
    }
  }

  function save() {
    if (!form.supplier.trim() || !form.number.trim() || num(form.amount) <= 0) {
      notify(tr('Renseignez le fournisseur, le numéro et le montant TTC.', 'Enter the supplier, the number and the gross amount.'))
      return
    }
    apply(saveSupplierInvoice(store, { id: form.id || undefined, number: form.number.trim(), supplier: form.supplier.trim(), date: form.date, due: form.due, amount: round2(num(form.amount)), vat: round2(num(form.vat)), account: form.account, source: form.source || undefined }))
    audit(form.id ? 'Edited supplier invoice' : 'Added supplier invoice', `${form.number.trim()} · ${form.supplier.trim()}`)
    setForm(blank)
    setManualSupplier(false)
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return
    setImporting(true)
    let next = store
    const failures: string[] = []
    for (const file of Array.from(files).slice(0, 10)) {
      try {
        const draft = await readInvoiceDocument(file)
        next = saveSupplierInvoice(next, { number: draft.invoiceNumber, supplier: draft.supplier, date: draft.invoiceDate, due: draft.dueDate, amount: round2(num(draft.amount)), vat: round2(num(draft.vatAmount)), account: '', source: file.name, lines: draft.lines?.map((line) => ({ date: line.date, supplierPart1: line.supplierPart1, supplierPart2: line.supplierPart2, item: line.item, quantity: line.quantity, unitPrice: line.unitPrice, total: line.total })) })
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : ''}`)
      }
    }
    if (next !== store) {
      apply(next)
      audit('Imported supplier invoices', `${next.supplierInvoices.length - store.supplierInvoices.length} document(s)`)
    }
    setImporting(false)
    notify(failures.length ? failures.join(' ') : tr('Documents ajoutés à la file. Vérifiez les champs avant de valider.', 'Documents added to the queue. Check the fields before approving.'))
  }

  function approve(invoice: SupplierInvoice) {
    if (store.closedPeriods.includes(period(invoice.date))) {
      notify(tr(`La période ${period(invoice.date)} est clôturée.`, `Period ${period(invoice.date)} is closed.`))
      return
    }
    apply(approveSupplierInvoice(store, invoice.id))
    audit('Approved supplier invoice', `${invoice.number} · ${invoice.supplier}`)
    notify(tr('Facture validée et comptabilisée dans le journal des achats.', 'Invoice approved and posted to the purchase journal.'))
  }

  return (
    <>
      <Panel title={<>{tr('Factures à valider', 'Invoices to approve')}<span className="title-count">{waiting.length}</span></>} subtitle={tr('La validation crée l’écriture d’achat ; rien n’est comptabilisé avant', 'Approval creates the purchase entry; nothing is posted before')}
        action={<button className="primary-button" type="button" disabled={importing} onClick={() => fileInput.current?.click()}>{importing ? <LoaderCircle className="spin-icon" size={14} /> : <Upload size={14} />}{tr('Importer PDF, XML ou tableau', 'Import PDF, XML or table')}</button>}>
        <input ref={fileInput} className="hidden-file-input" type="file" accept=".pdf,.xml,.csv,.tsv,application/pdf,text/xml,application/xml,text/csv,text/tab-separated-values" multiple onChange={(event) => { void importFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
        <label className="fin-supplier-filter">{tr('Fournisseur', 'Supplier')}
          <select className="fin-cell-select" value={supplier} onChange={(event) => setSupplier(event.target.value)}>
            <option value="">{tr('Tous les fournisseurs', 'All suppliers')}</option>
            {supplierNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        {pending.length ? <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>{tr('FACTURE', 'INVOICE')}</th><th>{tr('FOURNISSEUR', 'SUPPLIER')}</th><th>DATE</th><th>{tr('ÉCHÉANCE', 'DUE DATE')}</th><th className="sg-num">{tr('MONTANT TTC', 'GROSS')}</th><th className="sg-num">{tr('TVA', 'VAT')}</th><th>{tr('COMPTE DE CHARGE', 'EXPENSE ACCOUNT')}</th><th /></tr></thead>
            <tbody>
              {pending.map((invoice) => {
                const missing = missingInvoiceFields(invoice)
                return (
                  <tr key={invoice.id}>
                    <td><strong className="invoice-id">{invoice.number || '—'}</strong>{invoice.source && <small className="source-file">{invoice.source}</small>}</td>
                    <td>{invoice.supplier || '—'}</td><td className="date-cell">{invoice.date ? day(invoice.date) : '—'}</td><td className="date-cell">{invoice.due ? day(invoice.due) : '—'}</td>
                    <td className="sg-num">{money(invoice.amount)}</td><td className="sg-num">{money(invoice.vat)}</td>
                    <td><select className="fin-cell-select" aria-label={`${tr('Compte de charge', 'Expense account')} ${invoice.number}`} value={invoice.account} onChange={(event) => apply(saveSupplierInvoice(store, { ...invoice, account: event.target.value }))}>
                      <option value="">{tr('À classer…', 'Choose…')}</option>
                      {expenseAccounts.map((account) => <option key={account.number} value={account.number}>{account.number} · {account.label}</option>)}
                    </select>{missing.length > 0 && <small className="fin-missing">{tr('Manque', 'Missing')} : {missing.map((field) => fieldNames[field]).join(', ')}</small>}</td>
                    <td><div className="row-actions">
                      <button className="approve-button" type="button" disabled={missing.length > 0} onClick={() => approve(invoice)}><Check size={13} />{tr('Valider', 'Approve')}</button>
                      <button className="reject-button" type="button" aria-label={`${tr('Modifier', 'Edit')} ${invoice.number}`} onClick={() => {
                        setForm({ id: invoice.id, number: invoice.number, supplier: invoice.supplier, date: invoice.date, due: invoice.due, amount: String(invoice.amount || ''), vat: String(invoice.vat || ''), account: invoice.account, source: invoice.source ?? '' })
                        setManualSupplier(!supplierNames.some((name) => name.toLocaleLowerCase() === invoice.supplier.trim().toLocaleLowerCase()))
                      }}><Pencil size={13} /></button>
                      <button className="reject-button" type="button" aria-label={`${tr('Refuser', 'Reject')} ${invoice.number}`} onClick={() => { apply(rejectSupplierInvoice(store, invoice.id)); audit('Rejected supplier invoice', `${invoice.number} · ${invoice.supplier}`) }}><X size={13} /></button>
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div> : <div className="empty-state"><CheckCircle2 size={18} />{tr('Aucune facture en attente.', 'No invoice waiting.')}</div>}
      </Panel>

      <Panel title={form.id ? `${tr('Corriger', 'Correct')} ${form.number}` : tr('Saisir une facture reçue', 'Enter a received invoice')} subtitle={tr('Pour les factures papier ou pour corriger un document importé', 'For paper invoices or to correct an imported document')}>
        <div className="sg-form">
          <label>{tr('Fournisseur', 'Supplier')}<select value={manualSupplier ? '__new__' : form.supplier} onChange={(event) => {
            const value = event.target.value
            setManualSupplier(value === '__new__')
            setForm({ ...form, supplier: value === '__new__' ? '' : value })
          }}>
            <option value="">{tr('Choisir un fournisseur…', 'Choose a supplier…')}</option>
            {store.suppliers.map((item) => <option key={item.code} value={item.name}>{item.name}</option>)}
            <option value="__new__">{tr('Ajouter un nouveau fournisseur…', 'Add a new supplier…')}</option>
          </select></label>
          {manualSupplier && <label>{tr('Nom du nouveau fournisseur', 'New supplier name')}<input value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} /></label>}
          <label>{tr('Numéro de facture', 'Invoice number')}<input value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label>
          <label>{tr('Date de facture', 'Invoice date')}<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
          <label>{tr('Échéance', 'Due date')}<input type="date" value={form.due} onChange={(event) => setForm({ ...form, due: event.target.value })} /></label>
          <label>{tr('Montant TTC', 'Gross amount')}<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
          <label>{tr('Dont TVA', 'Of which VAT')}<input type="number" min="0" step="0.01" value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })} /></label>
          <label>{tr('Compte de charge', 'Expense account')}<select value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })}>
            <option value="">—</option>
            {expenseAccounts.map((account) => <option key={account.number} value={account.number}>{account.number} · {account.label}</option>)}
          </select></label>
        </div>
        <div className="sg-actions">
          {form.id && <button className="cancel-button" type="button" onClick={() => setForm(blank)}>{tr('Annuler', 'Cancel')}</button>}
          <button className="primary-button" type="button" onClick={save}><Plus size={14} />{form.id ? tr('Enregistrer la correction', 'Save correction') : tr('Ajouter à la file', 'Add to the queue')}</button>
        </div>
      </Panel>

      <Panel title={<>{tr('Historique des factures fournisseurs', 'Supplier invoice history')}<span className="title-count">{filteredInvoices.length}</span></>} subtitle={supplier || tr('Tous les fournisseurs', 'All suppliers')}
        action={<div className="row-actions">
          <button className="approve-button" type="button" disabled={!filteredInvoices.length} onClick={() => downloadXlsx(`${reportName}.xlsx`, reportSheets)}><FileSpreadsheet size={13} />Excel</button>
          <button className="approve-button" type="button" disabled={!filteredInvoices.length} onClick={() => { void exportPdf() }}><FileSearch size={13} />PDF</button>
        </div>}>
        {filteredInvoices.length ? <div className="table-scroll"><table className="data-table sg-table">
          <thead><tr><th>{tr('FACTURE', 'INVOICE')}</th><th>{tr('FOURNISSEUR', 'SUPPLIER')}</th><th>{tr('DATE', 'DATE')}</th><th>{tr('ÉCHÉANCE', 'DUE DATE')}</th><th className="sg-num">{tr('MONTANT TTC', 'GROSS')}</th><th className="sg-num">{tr('TVA', 'VAT')}</th><th>{tr('STATUT', 'STATUS')}</th><th>{tr('PIÈCE', 'ENTRY')}</th></tr></thead>
          <tbody>{filteredInvoices.map((invoice) => <tr key={invoice.id}>
            <td><strong className="invoice-id">{invoice.number || invoice.id}</strong></td><td>{invoice.supplier || '—'}</td><td className="date-cell">{invoice.date ? day(invoice.date) : '—'}</td><td className="date-cell">{invoice.due ? day(invoice.due) : '—'}</td>
            <td className="sg-num">{money(invoice.amount)}</td><td className="sg-num">{money(invoice.vat)}</td>
            <td><span className={`sg-badge ${invoice.status === 'approved' ? 'good' : invoice.status === 'rejected' ? 'warn' : ''}`}>{statusName(invoice.status)}</span></td><td>{invoice.piece ?? '—'}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">{supplier ? tr('Nessuna fattura registrata per questo fornitore.', 'No invoices recorded for this supplier.') : tr('Nessuna fattura fornitore registrata.', 'No supplier invoices recorded.')}</div>}
      </Panel>
      <section className="fin-supplier-print" aria-hidden="true">
        <h1>{store.company}</h1>
        <h2>{tr('Storico fatture fornitori', 'Supplier invoice history')}{supplier ? ` · ${supplier}` : ''}</h2>
        <p>{tr('Data di esportazione', 'Export date')}: {day(isoDate())}</p>
        <table><thead><tr><th>{tr('N° fattura', 'Invoice no.')}</th><th>{tr('Fornitore', 'Supplier')}</th><th>{tr('Data', 'Date')}</th><th>{tr('Scadenza', 'Due date')}</th><th>{tr('Importo TTC', 'Gross amount')}</th><th>{tr('TVA', 'VAT')}</th><th>{tr('Stato', 'Status')}</th><th>{tr('Pièce', 'Entry')}</th></tr></thead>
          <tbody>{filteredInvoices.map((invoice) => <tr key={invoice.id}><td>{invoice.number || invoice.id}</td><td>{invoice.supplier || '—'}</td><td>{invoice.date ? day(invoice.date) : '—'}</td><td>{invoice.due ? day(invoice.due) : '—'}</td><td>{money(invoice.amount)}</td><td>{money(invoice.vat)}</td><td>{statusName(invoice.status)}</td><td>{invoice.piece ?? '—'}</td></tr>)}</tbody>
        </table>
        <p>{tr('Totale TTC', 'Gross total')}: {money(filteredInvoices.reduce((total, invoice) => total + invoice.amount, 0))}</p>
        {itemRows.length > 0 && <><h2>{tr('Dettaglio articoli importati', 'Imported item details')}</h2><table><thead><tr><th>{tr('Facture', 'Invoice')}</th><th>{tr('Fournisseur', 'Supplier')}</th><th>{tr('Date', 'Date')}</th><th>{tr('Article', 'Item')}</th><th>{tr('Quantité', 'Quantity')}</th><th>{tr('Prix unitaire', 'Unit price')}</th><th>{tr('Total', 'Total')}</th></tr></thead><tbody>{filteredInvoices.flatMap((invoice) => (invoice.lines ?? []).map((line, index) => <tr key={`${invoice.id}-${index}`}><td>{invoice.number}</td><td>{invoice.supplier}</td><td>{day(line.date)}</td><td>{line.item}</td><td>{line.quantity}</td><td>{money(line.unitPrice)}</td><td>{money(line.total)}</td></tr>))}</tbody></table></>}
      </section>
    </>
  )
}

function BankSection({ store, apply, tr, money, day, notify, audit }: FinanceProps) {
  const [choice, setChoice] = useState<Record<string, { account: string; tiers: string }>>({})
  const [form, setForm] = useState({ date: isoDate(), label: '', amount: '' })
  const fileInput = useRef<HTMLInputElement>(null)
  const open = store.bankLines.filter((line) => !line.piece).sort((a, b) => a.date.localeCompare(b.date))
  const done = store.bankLines.filter((line) => line.piece).slice(-8).reverse()
  const share = store.bankLines.length ? Math.round(100 * (store.bankLines.length - open.length) / store.bankLines.length) : 100
  const closed = (date: string) => {
    if (!store.closedPeriods.includes(period(date))) return false
    notify(tr(`La période ${period(date)} est clôturée.`, `Period ${period(date)} is closed.`))
    return true
  }

  async function importCsv(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const lines = parseBankCsv(await file.text())
    const next = addBankLines(store, lines)
    const added = next.bankLines.length - store.bankLines.length
    if (added) {
      apply(next)
      audit('Imported bank statement', `${file.name} · ${added} line(s)`)
    }
    notify(lines.length
      ? tr(`${added} mouvement(s) ajouté(s), ${lines.length - added} déjà présent(s).`, `${added} line(s) added, ${lines.length - added} already present.`)
      : tr('Aucun mouvement lisible dans ce fichier. Colonnes attendues : date, libellé, montant.', 'No readable line in this file. Expected columns: date, label, amount.'))
  }

  function addLine() {
    if (!form.label.trim() || !num(form.amount)) {
      notify(tr('Renseignez le libellé et le montant (négatif pour une sortie).', 'Enter the label and the amount (negative for money out).'))
      return
    }
    apply(addBankLines(store, [{ date: form.date, label: form.label.trim(), amount: round2(num(form.amount)) }]))
    setForm({ ...form, label: '', amount: '' })
  }

  return (
    <>
      <Panel title={tr('Mouvements à rapprocher', 'Lines to reconcile')} subtitle={tr('Suggestions selon le montant et la référence de la pièce', 'Suggestions by amount and document reference')}
        action={<button className="primary-button" type="button" onClick={() => fileInput.current?.click()}><Upload size={14} />{tr('Importer un relevé CSV', 'Import a CSV statement')}</button>}>
        <input ref={fileInput} className="hidden-file-input" type="file" accept=".csv,.txt,text/csv" onChange={(event) => { void importCsv(event.currentTarget.files); event.currentTarget.value = '' }} />
        <div className="bank-summary"><span><strong>{money(open.reduce((total, line) => total + Math.abs(line.amount), 0))}</strong><small>{open.length} {tr('mouvement(s) à rapprocher', 'line(s) to reconcile')}</small></span><span className="reconciled-pill"><BadgeCheck size={14} />{share}% {tr('rapproché', 'reconciled')}</span></div>
        {open.length ? <div className="bank-list">
          {open.map((line) => {
            const match = suggestBankMatch(store, line)
            const picked = choice[line.id] ?? { account: '', tiers: '' }
            const parties = picked.account.startsWith('411') ? store.clients : picked.account.startsWith('401') ? store.suppliers : []
            return (
              <div className="bank-row fin-bank-row" key={line.id}>
                <span className="bank-date">{day(line.date)}</span>
                <span className="bank-description"><strong>{line.label}</strong><small>{line.id}</small></span>
                <span className="bank-amount">{money(line.amount)}</span>
                {match ? <>
                  <span className="bank-confidence"><CheckCircle2 size={14} />{match.piece} · {tiersName(store, match.tiers)}</span>
                  <button className="match-button" type="button" onClick={() => {
                    if (closed(line.date)) return
                    apply(matchBankLine(store, line.id, match.id))
                    audit('Matched bank line', `${line.id} · ${match.piece}`)
                    notify(tr('Mouvement rapproché, comptabilisé et lettré.', 'Line reconciled, posted and matched.'))
                  }}>{tr('Rapprocher', 'Reconcile')}<ArrowRight size={13} /></button>
                </> : <>
                  <span className="fin-pick">
                    <select aria-label={`${tr('Compte', 'Account')} ${line.id}`} value={picked.account} onChange={(event) => setChoice({ ...choice, [line.id]: { account: event.target.value, tiers: '' } })}>
                      <option value="">{tr('Compte…', 'Account…')}</option>
                      {store.accounts.filter((account) => !account.number.startsWith(chartOf(store).prefixes.bank)).map((account) => <option key={account.number} value={account.number}>{account.number} · {account.label}</option>)}
                    </select>
                    {parties.length > 0 && <select aria-label={`${tr('Tiers', 'Party')} ${line.id}`} value={picked.tiers} onChange={(event) => setChoice({ ...choice, [line.id]: { ...picked, tiers: event.target.value } })}>
                      <option value="">{tr('Tiers…', 'Party…')}</option>
                      {parties.map((party) => <option key={party.code} value={party.code}>{party.name}</option>)}
                    </select>}
                  </span>
                  <button className="match-button" type="button" disabled={!picked.account || (isTiersAccount(picked.account) && !picked.tiers)} onClick={() => {
                    if (closed(line.date)) return
                    apply(postBankLine(store, line.id, picked.account, picked.tiers || undefined))
                    audit('Posted bank line', `${line.id} · ${picked.account}`)
                    notify(tr('Mouvement comptabilisé dans le journal de banque.', 'Line posted to the bank journal.'))
                  }}>{tr('Comptabiliser', 'Post')}</button>
                </>}
                <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${line.id}`} onClick={() => apply({ ...store, bankLines: store.bankLines.filter((item) => item.id !== line.id) })}><Trash2 size={13} /></button>
              </div>
            )
          })}
        </div> : <div className="empty-state"><CheckCircle2 size={18} />{tr('Tous les mouvements sont rapprochés.', 'Every line is reconciled.')}</div>}
      </Panel>

      <Panel title={tr('Ajouter un mouvement à la main', 'Add a line by hand')}>
        <div className="sg-form">
          <label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
          <label>{tr('Libellé du relevé', 'Statement label')}<input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
          <label>{tr('Montant (négatif = sortie)', 'Amount (negative = out)')}<input type="number" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
        </div>
        <div className="sg-actions"><button className="primary-button" type="button" onClick={addLine}><Plus size={14} />{tr('Ajouter', 'Add')}</button></div>
      </Panel>

      {done.length > 0 && <Panel title={tr('Derniers mouvements rapprochés', 'Latest reconciled lines')}>
        <div className="table-scroll"><table className="data-table sg-table">
          <thead><tr><th>DATE</th><th>{tr('LIBELLÉ', 'LABEL')}</th><th className="sg-num">{tr('MONTANT', 'AMOUNT')}</th><th>{tr('PIÈCE', 'DOC')}</th></tr></thead>
          <tbody>{done.map((line) => <tr key={line.id}><td className="date-cell">{day(line.date)}</td><td>{line.label}</td><td className="sg-num">{money(line.amount)}</td><td><strong className="invoice-id">{line.piece}</strong></td></tr>)}</tbody>
        </table></div>
      </Panel>}
    </>
  )
}

function CloseSection({ store, apply, tr, money, day, notify, audit, go, admin = false }: FinanceProps) {
  const months = Array.from(new Set([...store.entries.map((entry) => period(entry.date)), period(isoDate())])).sort().reverse()
  const [month, setMonth] = useState(months[0])
  const checks = closeChecks(store, month)
  const progress = closeProgress(store, month)
  const ticked = store.closeTasks[month] ?? []
  const locked = store.closedPeriods.includes(month)
  const entries = store.entries.filter((entry) => period(entry.date) === month)
  const automatic: { key: keyof typeof checks; label: string; target: Parameters<FinanceProps['go']> }[] = [
    { key: 'bank', label: tr('Tous les mouvements bancaires sont rapprochés', 'Every bank line is reconciled'), target: ['bank'] },
    { key: 'invoices', label: tr('Aucune facture fournisseur en attente de validation', 'No supplier invoice waiting for approval'), target: ['invoices'] },
    { key: 'lettering', label: tr('Le lettrage des comptes de tiers est à jour', 'Party accounts are fully matched'), target: ['compta', 'cp.periodiques'] },
    { key: 'balanced', label: tr('Les écritures de la période sont équilibrées', 'The entries of the period balance'), target: ['compta', 'cp.etats'] },
  ]
  const manual: Record<typeof manualCloseTasks[number], string> = {
    accruals: tr('Charges à payer et factures non parvenues comptabilisées', 'Accruals and invoices not yet received are posted'),
    prepaid: tr('Charges constatées d’avance contrôlées', 'Prepaid expenses reviewed'),
    payroll: tr('Écriture de paie validée', 'Payroll entry approved'),
    cutoff: tr('Séparation des exercices contrôlée (ventes et achats)', 'Revenue and purchase cut-off checked'),
  }

  function toggle(task: string) {
    apply({ ...store, closeTasks: { ...store.closeTasks, [month]: ticked.includes(task) ? ticked.filter((item) => item !== task) : [...ticked, task] } })
  }

  function lock() {
    if (locked && !admin) {
      notify(tr('Seul un administrateur peut rouvrir une période verrouillée.', 'Only an administrator can reopen a locked period.'))
      return
    }
    if (!locked && progress.done < progress.total && !window.confirm(tr('Toutes les tâches ne sont pas terminées. Verrouiller quand même la période ?', 'Not every task is done. Lock the period anyway?'))) return
    apply({ ...store, closedPeriods: locked ? store.closedPeriods.filter((item) => item !== month) : [...store.closedPeriods, month] })
    audit(locked ? 'Reopened period' : 'Closed period', month)
    notify(locked ? tr(`Période ${month} rouverte.`, `Period ${month} reopened.`) : tr(`Période ${month} verrouillée : plus aucune saisie possible.`, `Period ${month} locked: no further entries allowed.`))
  }

  const sales = monthlySales(store, month)
  const peak = Math.max(1, ...sales.days.map((item) => item.revenue))

  return (
    <>
    <Panel title={`${tr('Ventes de la période', 'Sales of the period')} ${month}`} subtitle={tr('Factures et tickets comptabilisés, hors taxes', 'Posted invoices and tickets, net of tax')}>
      <div className="sg-stats">
        <div className="sg-stat"><span>{tr('Chiffre d’affaires HT', 'Net revenue')}</span><strong>{money(sales.revenue)}</strong></div>
        <div className="sg-stat"><span>{tr('Articles vendus', 'Items sold')}</span><strong>{sales.quantity}</strong></div>
        <div className="sg-stat"><span>{tr('Références différentes', 'Different items')}</span><strong>{sales.articles.length}</strong></div>
        <div className="sg-stat"><span>{tr('Factures et tickets', 'Invoices and tickets')}</span><strong>{sales.documents}</strong></div>
      </div>
      {sales.documents ? <>
        <div className="fin-chart">
          <div className="chart-wrap">
            <div className="chart-y-labels"><span>{money(peak)}</span><span>{money(peak / 2)}</span><span>{money(0)}</span></div>
            <div className="chart-area">
              <div className="chart-gridlines"><i /><i /><i /></div>
              <div className="chart-bars fin-days">{sales.days.map((item) => (
                <div className="bar-group fin-day" key={item.date} title={`${day(item.date)} · ${money(item.revenue)} · ${item.quantity} ${tr('article(s)', 'item(s)')}`}>
                  {item.revenue > 0 && <span className="bar income" style={{ height: `${Math.max(3, item.revenue / peak * 100)}%` }} />}
                </div>
              ))}</div>
              <div className="chart-x-labels">{sales.days.filter((_, index) => index % 5 === 0).map((item) => <span key={item.date}>{item.date.slice(8)}</span>)}</div>
            </div>
          </div>
        </div>
        <div className="table-scroll"><table className="data-table sg-table">
          <thead><tr><th>{tr('ARTICLE', 'ITEM')}</th><th>{tr('DÉSIGNATION', 'DESCRIPTION')}</th><th className="sg-num">{tr('QUANTITÉ VENDUE', 'QUANTITY SOLD')}</th><th className="sg-num">{tr('CHIFFRE D’AFFAIRES HT', 'NET REVENUE')}</th><th className="sg-num">{tr('RESTE EN STOCK', 'LEFT IN STOCK')}</th></tr></thead>
          <tbody>{sales.articles.map((article) => <tr key={article.ref}><td><strong className="invoice-id">{article.ref}</strong></td><td>{article.name}</td><td className="sg-num">{article.quantity}</td><td className="sg-num">{money(article.revenue)}</td><td className="sg-num">{article.remaining}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>{tr('Totaux', 'Totals')}</td><td className="sg-num">{sales.quantity}</td><td className="sg-num">{money(sales.revenue)}</td><td /></tr></tfoot>
        </table></div>
        <div className="sg-actions"><button className="text-button" type="button" onClick={() => go('analysis')}>{tr('Analyse complète des articles', 'Full item analysis')}<ArrowRight size={14} /></button></div>
      </> : <div className="empty-state">{tr('Aucune vente comptabilisée sur cette période.', 'No sales posted in this period.')}</div>}
    </Panel>
    <Panel className="close-panel fin-close" title={tr('Clôture mensuelle', 'Month-end close')} subtitle={`${entries.length} ${tr('écritures', 'entries')} · ${money(entries.reduce((total, entry) => total + entry.debit, 0))}`}
      action={<span className="close-progress-count">{progress.done}/{progress.total}</span>}>
      <div className="sg-form"><label>{tr('Période', 'Period')}<select value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((item) => <option key={item} value={item}>{item}{store.closedPeriods.includes(item) ? ` · ${tr('verrouillée', 'locked')}` : ''}</option>)}</select></label></div>
      <div className="progress-track"><i style={{ width: `${100 * progress.done / progress.total}%` }} /></div>
      <div className="task-list">
        {automatic.map((item) => (
          <button className={`task-row ${checks[item.key] ? 'task-done' : ''}`} key={item.key} type="button" onClick={() => go(...item.target)}>
            <span className="task-check">{checks[item.key] && <Check size={12} />}</span><span>{item.label}</span><span className="task-owner">{checks[item.key] ? tr('Contrôlé', 'Checked') : tr('À traiter', 'To do')}</span>
          </button>
        ))}
        {manualCloseTasks.map((task) => (
          <button className={`task-row ${ticked.includes(task) ? 'task-done' : ''}`} key={task} type="button" disabled={locked} onClick={() => toggle(task)}>
            <span className="task-check">{ticked.includes(task) && <Check size={12} />}</span><span>{manual[task]}</span>
          </button>
        ))}
      </div>
      <div className="sg-actions"><button className="primary-button" type="button" onClick={lock}><LockKeyhole size={14} />{locked ? tr('Rouvrir la période', 'Reopen the period') : tr('Verrouiller la période', 'Lock the period')}</button></div>
    </Panel>
    </>
  )
}

function AnalysisSection({ store, tr, money }: FinanceProps) {
  const months = Array.from(new Set([...store.salesDocs.map((doc) => period(doc.date)), period(isoDate())])).sort().reverse()
  const [month, setMonth] = useState('')
  const [family, setFamily] = useState('')
  const families = Array.from(new Set(store.articles.map((article) => article.family).filter(Boolean))).sort()
  const rows = articleAnalysis(store, month || undefined).filter((row) => !family || row.family === family)
  const total = (pick: (row: typeof rows[number]) => number) => round2(rows.reduce((value, row) => value + pick(row), 0))
  const share = (part: number, whole: number) => whole > 0 ? `${Math.min(100, Math.max(0, 100 * part / whole))}%` : '0%'

  function exportExcel() {
    downloadXlsx(`Analyse articles ${month || isoDate()}.xlsx`, [{
      name: 'Analyse',
      rows: [['Référence', 'Désignation', 'Famille', 'Enregistrés', 'Vendus', 'Consommés en fabrication', 'Reste en stock', 'CA HT', 'Valeur du stock'],
        ...rows.map((row) => [row.ref, row.name, row.family, row.registered, row.sold, row.consumed, row.remaining, row.revenue, row.stockValue])],
    }])
  }

  return (
    <Panel title={tr('Articles enregistrés, vendus et restants', 'Items registered, sold and remaining')}
      subtitle={month ? tr(`Ventes de ${month} ; enregistrés et reste à ce jour`, `Sales of ${month}; registered and remaining to date`) : tr('Depuis le début', 'Since the beginning')}
      action={<button className="approve-button" type="button" onClick={exportExcel}><FileSpreadsheet size={13} />Excel</button>}>
      <div className="sg-form">
        <label>{tr('Ventes de la période', 'Sales period')}<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">{tr('Depuis le début', 'Since the beginning')}</option>{months.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>{tr('Famille', 'Family')}<select value={family} onChange={(event) => setFamily(event.target.value)}><option value="">{tr('Toutes', 'All')}</option>{families.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div className="sg-stats">
        <div className="sg-stat"><span>{tr('Articles enregistrés', 'Items registered')}</span><strong>{total((row) => row.registered)}</strong></div>
        <div className="sg-stat"><span>{tr('Articles vendus', 'Items sold')}</span><strong>{total((row) => row.sold)}</strong></div>
        <div className="sg-stat"><span>{tr('Reste en stock', 'Left in stock')}</span><strong>{total((row) => row.remaining)}</strong></div>
        <div className="sg-stat"><span>{tr('Chiffre d’affaires HT', 'Net revenue')}</span><strong>{money(total((row) => row.revenue))}</strong></div>
        <div className="sg-stat"><span>{tr('Valeur du stock restant', 'Value of remaining stock')}</span><strong>{money(total((row) => row.stockValue))}</strong></div>
      </div>
      {rows.length ? <div className="table-scroll"><table className="data-table sg-table">
        <thead><tr><th>{tr('ARTICLE', 'ITEM')}</th><th>{tr('DÉSIGNATION', 'DESCRIPTION')}</th><th className="sg-num">{tr('ENREGISTRÉS', 'REGISTERED')}</th><th className="sg-num">{tr('VENDUS', 'SOLD')}</th><th className="sg-num">{tr('FABRICATION', 'PRODUCTION')}</th><th className="sg-num">{tr('RESTE', 'REMAINING')}</th><th>{tr('VENDU / RESTE', 'SOLD / REMAINING')}</th><th className="sg-num">{tr('CA HT', 'NET REVENUE')}</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ref}>
              <td><strong className="invoice-id">{row.ref}</strong></td><td>{row.name}</td>
              <td className="sg-num">{row.registered}</td><td className="sg-num">{row.sold}</td><td className="sg-num">{row.consumed || ''}</td>
              <td className="sg-num">{row.remaining <= 0 ? <span className="sg-badge warn">{row.remaining}</span> : <strong>{row.remaining}</strong>}</td>
              <td><span className="fin-meter" title={`${row.sold} / ${row.registered}`}><i style={{ width: share(row.sold, row.registered) }} /><b style={{ width: share(row.consumed, row.registered) }} /></span></td>
              <td className="sg-num">{money(row.revenue)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>{tr('Totaux', 'Totals')}</td><td className="sg-num">{total((row) => row.registered)}</td><td className="sg-num">{total((row) => row.sold)}</td><td className="sg-num">{total((row) => row.consumed) || ''}</td><td className="sg-num">{total((row) => row.remaining)}</td><td /><td className="sg-num">{money(total((row) => row.revenue))}</td></tr></tfoot>
      </table></div> : <div className="empty-state">{tr('Aucun article enregistré.', 'No item registered.')}</div>}
      <div className="fin-open"><span><i className="fin-key sold" />{tr('Vendu', 'Sold')}</span><span><i className="fin-key used" />{tr('Consommé en fabrication', 'Used in production')}</span><span><i className="fin-key left" />{tr('Reste', 'Remaining')}</span><span>{tr('« Enregistrés » = tout ce qui est entré en stock : stock initial, achats, fabrication, inventaire.', '“Registered” = everything that entered stock: opening stock, purchases, production, stock counts.')}</span></div>
    </Panel>
  )
}

function ForecastSection({ store, tr, money, day }: FinanceProps) {
  const today = isoDate()
  const weeks = cashForecast(store, today)
  const inflow = weeks.reduce((total, week) => total + week.inflow, 0)
  const outflow = weeks.reduce((total, week) => total + week.outflow, 0)
  const lowest = weeks.reduce((low, week) => week.balance < low.balance ? week : low)
  return (
    <>
      <section className="panel forecast-detail">
        <div className="panel-heading"><div><div className="panel-title">{tr('Prévision de trésorerie', 'Cash forecast')}</div><div className="panel-subtitle">{tr('Trésorerie actuelle, plus les factures clients et moins les factures fournisseurs à leur échéance', 'Current cash, plus customer invoices and minus supplier invoices at their due date')}</div></div></div>
        <div className="forecast-breakdown">
          <div><ArrowDownLeft size={16} /><span>{tr('Encaissements attendus', 'Expected inflows')}</span><strong>{money(inflow)}</strong></div>
          <div><ArrowUpRight size={16} /><span>{tr('Décaissements attendus', 'Expected outflows')}</span><strong>{money(outflow)}</strong></div>
          <div><Wallet size={16} /><span>{tr('Solde prévisionnel', 'Projected balance')}</span><strong>{money(weeks.at(-1)!.balance)}</strong></div>
        </div>
        <div className="fin-chart"><ForecastChart weeks={weeks} money={money} day={day} /></div>
        {lowest.balance < 0 && <div className="dk-banner warn fin-inline"><ShieldAlert size={15} /><span>{tr(`Solde négatif prévu la semaine du ${day(lowest.start)} : ${money(lowest.balance)}.`, `Negative balance expected in the week of ${day(lowest.start)}: ${money(lowest.balance)}.`)}</span></div>}
      </section>
      <Panel title={tr('Détail par semaine', 'Week by week')} subtitle={tr('Indicatif : ne tient compte que des factures déjà enregistrées. Les échéances dépassées sont placées dans la première semaine.', 'Indicative: only invoices already recorded are counted. Overdue items are placed in the first week.')}>
        <div className="table-scroll"><table className="data-table sg-table">
          <thead><tr><th>{tr('SEMAINE DU', 'WEEK OF')}</th><th className="sg-num">{tr('ENCAISSEMENTS', 'INFLOWS')}</th><th className="sg-num">{tr('DÉCAISSEMENTS', 'OUTFLOWS')}</th><th className="sg-num">{tr('SOLDE', 'BALANCE')}</th></tr></thead>
          <tbody>{weeks.map((week) => <tr key={week.start}><td className="date-cell">{day(week.start)}</td><td className="sg-num">{week.inflow ? money(week.inflow) : ''}</td><td className="sg-num">{week.outflow ? money(week.outflow) : ''}</td><td className="sg-num"><strong>{money(week.balance)}</strong></td></tr>)}</tbody>
        </table></div>
        <div className="fin-open">
          <span>{tr('Factures clients ouvertes', 'Open customer invoices')} : <strong>{openItems(store, '411').length}</strong></span>
          <span>{tr('Factures fournisseurs ouvertes', 'Open supplier invoices')} : <strong>{openItems(store, '401').length}</strong></span>
        </div>
      </Panel>
    </>
  )
}

function DataSection({ store, tr, go }: FinanceProps) {
  const report = dataQuality(store)
  const labels: Record<QualityIssue['key'], [string, string]> = {
    clientEmail: ['Clients sans e-mail valide', 'Customers without a valid e-mail'], clientCity: ['Clients sans ville', 'Customers without a city'],
    duplicateClient: ['Doublons clients possibles', 'Possible duplicate customers'], supplierCity: ['Fournisseurs sans ville', 'Suppliers without a city'],
    duplicateSupplier: ['Doublons fournisseurs possibles', 'Possible duplicate suppliers'], articleFamily: ['Articles sans famille', 'Items without a family'],
    articleCost: ['Articles sans prix d’achat', 'Items without a cost'], articleMargin: ['Articles vendus sous le prix d’achat', 'Items sold below cost'],
    articleStock: ['Articles en stock négatif', 'Items with negative stock'],
  }
  const targets: Record<QualityIssue['area'], [ModuleId, string]> = { clients: ['commercial', 'gc.clients'], suppliers: ['commercial', 'gc.achats'], articles: ['commercial', 'gc.articles'] }
  return (
    <section className="panel data-panel">
      <div className="panel-heading"><div><div className="panel-title">{tr('Santé des données de référence', 'Master data health')}</div><div className="panel-subtitle">{tr('Clients, fournisseurs et articles contrôlés à chaque ouverture', 'Customers, suppliers and items checked every time')}</div></div><div className="data-score"><strong>{report.score}</strong><span>/ 100</span><small>{report.checked} {tr('contrôles', 'checks')}</small></div></div>
      <div className="data-progress"><i style={{ width: `${report.score}%` }} /></div>
      {report.issues.length ? <div className="data-issues">
        {report.issues.map((issue) => (
          <details className="fin-issue" key={issue.key}>
            <summary className="data-issue"><span className="data-issue-icon"><ListChecks size={16} /></span><span><strong>{tr(...labels[issue.key])}</strong><small>{issue.records.slice(0, 2).join(' · ')}{issue.records.length > 2 ? '…' : ''}</small></span><span className="issue-count">{issue.records.length}</span></summary>
            <ul>{issue.records.map((record) => <li key={record}>{record}</li>)}</ul>
            <button className="upload-button" type="button" onClick={() => go(...targets[issue.area])}><FileSearch size={14} />{tr('Ouvrir les fiches', 'Open the records')}<ArrowRight size={13} /></button>
          </details>
        ))}
      </div> : <div className="empty-state"><CheckCircle2 size={18} />{tr('Aucune anomalie dans les fiches.', 'No issue in the records.')}</div>}
    </section>
  )
}

function HelpSection({ tr, go }: FinanceProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const questions: [string, string][] = [
    [tr('Comment comptabiliser une facture fournisseur ?', 'How do I post a supplier invoice?'), tr('Dans « Factures fournisseurs », importez le PDF ou saisissez la facture, choisissez le compte de charge puis « Valider ». L’écriture est créée dans le journal des achats et le fournisseur apparaît dans le suivi des tiers.', 'In “Supplier invoices”, import the PDF or type the invoice in, choose the expense account, then “Approve”. The entry is created in the purchase journal and the supplier appears in party follow-up.')],
    [tr('Comment enregistrer un avoir fournisseur ?', 'How do I record a supplier credit note?'), tr('Dans Comptabilité › « Saisir les écritures comptables » : journal ACH, débit du compte 401 du fournisseur, crédit du compte de charge et de la TVA déductible.', 'In Accounting › “Enter journal entries”: journal ACH, debit the supplier’s 401 account, credit the expense account and deductible VAT.')],
    [tr('Comment rapprocher la banque ?', 'How do I reconcile the bank?'), tr('Exportez le relevé de votre banque en CSV, puis « Rapprochement bancaire » › « Importer un relevé CSV ». Les règlements dont le montant correspond à une facture ouverte sont proposés ; les autres se comptabilisent sur le compte de votre choix.', 'Export your bank statement as CSV, then “Bank matching” › “Import a CSV statement”. Payments whose amount matches an open invoice are suggested; the others are posted to the account you choose.')],
    [tr('Que se passe-t-il quand je valide une facture de vente ?', 'What happens when I create a sales invoice?'), tr('Le stock des articles diminue et l’écriture est créée dans le journal des ventes : client au débit, ventes et TVA collectée au crédit.', 'Item stock decreases and the entry is created in the sales journal: customer debited, sales and collected VAT credited.')],
    [tr('Comment clôturer un mois ?', 'How do I close a month?'), tr('« Clôture mensuelle » liste les contrôles. Une fois la période verrouillée, plus aucune écriture ne peut y être ajoutée ou modifiée ; vous pouvez la rouvrir.', '“Month-end close” lists the checks. Once the period is locked, no entry can be added or changed in it; you can reopen it.')],
    [tr('Où sont enregistrées mes données ?', 'Where are my data saved?'), tr('Sur ce PC et dans votre Google Drive, dossier AICOM. L’indicateur en bas à gauche montre l’état de l’enregistrement.', 'On this PC and in your Google Drive, AICOM folder. The indicator at the bottom left shows the saving status.')],
    [tr('Comment revenir en arrière après une erreur ?', 'How do I undo a mistake?'), tr('Le « Journal d’activité » montre la valeur avant et après chaque modification. Pour une écriture, utilisez l’extourne (Comptabilité › Fonctions avancées). Pour tout restaurer : Paramètres › Sauvegardes.', 'The “Activity log” shows the value before and after every change. For an entry, use a reversal (Accounting › Advanced functions). To restore everything: Settings › Backups.')],
  ]
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle)
  const shownQuestions = questions.filter(([question, answer]) => matches(question) || matches(answer))

  return (
    <>
      <section className="panel help-panel fin-help">
        <div className="help-hero"><span className="help-orbit"><Search size={22} /></span><div><div className="panel-title">{tr('Comment puis-je vous aider ?', 'What can I help with?')}</div><p>{tr('Cherchez une opération ou une question. Ce guide est intégré au logiciel : il ne s’agit pas d’un assistant IA.', 'Search for a task or a question. This guide is built into the software: it is not an AI assistant.')}</p></div></div>
        <div className="help-input"><input aria-label={tr('Rechercher', 'Search')} placeholder={tr('Ex. : avoir, lettrage, inventaire, TVA…', 'E.g. credit note, matching, stock count, VAT…')} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="fin-faq">
          {shownQuestions.map(([question, answer]) => <details key={question} open={Boolean(needle)}><summary>{question}</summary><p>{answer}</p></details>)}
        </div>
      </section>
      {sageModules.map((module) => {
        const activities = module.groups.flatMap((group) => group.activities).filter((activity) => matches(`${activity.fr} ${activity.en} ${activity.sage}`))
        return activities.length > 0 && (
          <Panel key={module.id} title={tr(module.fr, module.en)} subtitle={module.sage}>
            <div className="help-prompts fin-activities">
              {activities.map((activity) => <button key={activity.id} type="button" onClick={() => go(module.id, activity.id)}><span>{tr(activity.fr, activity.en)}</span><code>{activity.sage}</code><ArrowRight size={14} /></button>)}
            </div>
          </Panel>
        )
      })}
      {needle && !shownQuestions.length && !sageModules.some((module) => module.groups.some((group) => group.activities.some((activity) => matches(`${activity.fr} ${activity.en} ${activity.sage}`)))) && <div className="empty-state">{tr('Aucun résultat.', 'No result.')}</div>}
    </>
  )
}

export function FinanceView({ section, ...props }: FinanceProps & { section: FinanceSection }) {
  switch (section) {
    case 'overview': return <OverviewSection {...props} />
    case 'invoices': return <InvoicesSection {...props} />
    case 'bank': return <BankSection {...props} />
    case 'close': return <CloseSection {...props} />
    case 'forecast': return <ForecastSection {...props} />
    case 'analysis': return <AnalysisSection {...props} />
    case 'data': return <DataSection {...props} />
    case 'help': return <HelpSection {...props} />
  }
}
