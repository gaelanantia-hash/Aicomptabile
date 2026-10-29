// Sage 100 Comptabilité, entry and control: accounts, journals, entries, search, parties and lettrage.
import { useState } from 'react'
import { Check, CheckCircle2, Link2, LockKeyhole, LockKeyholeOpen, Plus, Trash2, Undo2 } from 'lucide-react'
import { accountsOf, addDays, isReversed, reversePiece, roundAmount, autoLetter, isTiersAccount, isoDate, round2, tiersName, type Entry, type PieceLine } from '../sageData'
import { type ViewProps, num, period, periodsOf, postManual, sum, tiersOptions, vatRates } from './helpers'
import { Badge, Chips, EntriesTable, Panel, SaveButton, Stat } from './ui'

export function AccountsView({ ctx }: ViewProps) {
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

export function JournalsView({ ctx }: ViewProps) {
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

export function GuidedPieceView({ ctx }: ViewProps) {
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

export function BankOperationView({ ctx }: ViewProps) {
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

export function FreeEntryView({ ctx }: ViewProps) {
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
  const complete = used.every((line) => line.account && (!isTiersAccount(store, line.account) || line.tiers))
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

export function EntriesView({ ctx }: ViewProps) {
  const { tr, store } = ctx
  const [journal, setJournal] = useState('all')
  const [month, setMonth] = useState('all')
  const entries = store.entries.filter((entry) => (journal === 'all' || entry.journal === journal) && (month === 'all' || period(entry.date) === month))
  const locked = (entry: Entry) => store.closedPeriods.includes(period(entry.date))
  // Pieces generated by a sales, purchase or counter document are corrected from that document, not here.
  const manual = (entry: Entry) => entry.piece.startsWith(`${entry.journal}-`)
  const reversible = (entry: Entry) => manual(entry) && !entry.reverses && !entry.origin && !isReversed(store, entry.piece)

  // A posted entry is never edited or deleted: a reversing piece dated today cancels it, and both stay in the books.
  function reverse(entry: Entry) {
    if (store.entries.some((item) => item.piece === entry.piece && item.letter)) {
      ctx.notify(tr('Cette pièce est lettrée : délettrez-la avant de la contre-passer.', 'This document is matched: unmatch it before reversing it.'))
      return
    }
    const today = isoDate()
    if (ctx.closed(today)) return
    if (!window.confirm(tr(`Contre-passer la pièce ${entry.piece} ? Une pièce d’annulation datée d’aujourd’hui sera enregistrée.`, `Reverse document ${entry.piece}? A cancelling document dated today will be posted.`))) return
    const next = reversePiece(store, entry.piece, today)
    const reversal = next.entries[next.entries.length - 1].piece
    ctx.apply(next)
    ctx.audit('Reversed accounting piece', `${entry.piece} → ${reversal}`)
    ctx.notify(tr(`Pièce ${entry.piece} annulée par la pièce ${reversal}.`, `Document ${entry.piece} cancelled by document ${reversal}.`))
  }

  return (
    <Panel title={tr('Visualisation et modification', 'View and edit entries')} subtitle={tr('Les périodes clôturées et les pièces issues des documents sont verrouillées', 'Closed periods and document-generated entries are locked')}>
      <div className="sg-form">
        <label>{tr('Journal', 'Journal')}<select value={journal} onChange={(event) => setJournal(event.target.value)}><option value="all">{tr('Tous', 'All')}</option>{store.journals.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
        <label>{tr('Période', 'Period')}<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="all">{tr('Toutes', 'All')}</option>{periodsOf(store).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <EntriesTable ctx={ctx} entries={entries}
        renderLabel={(entry) => <>{entry.label}{isReversed(store, entry.piece) && <> <Badge>{tr('Annulée', 'Cancelled')}</Badge></>}</>}
        action={(entry) => locked(entry) ? <LockKeyhole size={13} aria-label={tr('Période clôturée', 'Closed period')} />
          : reversible(entry) ? <button className="reject-button" type="button" title={tr('Contre-passer', 'Reverse')} aria-label={`${tr('Contre-passer la pièce', 'Reverse document')} ${entry.piece}`} onClick={() => reverse(entry)}><Undo2 size={13} /></button>
            : null} />
    </Panel>
  )
}

export function SearchView({ ctx }: ViewProps) {
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

export function TiersView({ ctx }: ViewProps) {
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

export function AdvancedView({ ctx }: ViewProps) {
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

export function PeriodicView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const tiersEntries = store.entries.filter((entry) => entry.tiers && isTiersAccount(store, entry.account))
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
    if (isClosed && !ctx.admin) {
      ctx.notify(tr('Seul un administrateur peut rouvrir une période clôturée.', 'Only an administrator can reopen a closed period.'))
      return
    }
    if (isClosed && store.yearEnd[month.slice(0, 4)]?.closing) {
      ctx.notify(tr(`L’exercice ${month.slice(0, 4)} est clôturé définitivement : ce mois ne peut pas être rouvert.`, `Financial year ${month.slice(0, 4)} is closed for good: this month cannot be reopened.`))
      return
    }
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
