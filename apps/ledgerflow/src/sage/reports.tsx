// Accounting and tax reports: trial balance, ledger, journal, monthly VAT return and SYSCOHADA financial statements.
import { useState } from 'react'
import { Check, FileDown, FileSpreadsheet, Printer } from 'lucide-react'
import { accountsOf, chartOf, isoDate, round2, type Store } from '../sageData'
import { balanceSheet, cashFlowStatement, incomeStatement, type StatementLine } from '../syscohada'
import { entriesSheet } from '../sageExport'
import { settleVat, unsettledBefore, vatReturn, type VatReturn } from '../vat'
import { downloadXlsx, type Sheet } from '../xlsx'
import { type Ctx, type ViewProps, period, periodsOf, sum } from './helpers'
import { Badge, Chips, EntriesTable, Panel, Stat } from './ui'

/**
 * One SYSCOHADA statement: reference, label, the year's amount and the previous year's, as the official forms show them.
 * Subtotals are in bold; detail lines empty in both years are left out.
 */
function StatementTable({ title, lines, previous, year, money }: { title: string; lines: StatementLine[]; previous: StatementLine[]; year: number; money: (amount: number) => string }) {
  const before = new Map(previous.map((line) => [line.ref, line.amount]))
  return (
    <div className="table-scroll">
      <table className="data-table sg-table">
        <thead><tr><th>{'RÉF.'}</th><th>{title}</th><th className="sg-num">{year}</th><th className="sg-num">{year - 1}</th></tr></thead>
        <tbody>{lines.filter((line) => line.total || line.amount || before.get(line.ref)).map((line) => {
          const cells = [line.ref, line.label, money(line.amount), money(before.get(line.ref) ?? 0)]
          return <tr key={line.ref}>{cells.map((cell, index) => <td key={index} className={index > 1 ? 'sg-num' : undefined}>{line.total ? <strong>{cell}</strong> : cell}</td>)}</tr>
        })}</tbody>
      </table>
    </div>
  )
}

/** The month's VAT return as rows: the same content on screen and in Excel. */
function vatRows(declaration: VatReturn, tr: Ctx['tr']): [string, number][] {
  return [
    ...declaration.sales.map((line): [string, number] => [tr(`Ventes à ${line.rate} % : base`, `Sales at ${line.rate}%: base`), line.base]),
    ...declaration.sales.filter((line) => line.rate).map((line): [string, number] => [tr(`TVA à ${line.rate} %`, `VAT at ${line.rate}%`), line.vat]),
    ...(declaration.otherSales.base || declaration.otherSales.vat ? [[tr('Autres opérations saisies : base', 'Other posted operations: base'), declaration.otherSales.base], [tr('Autres opérations saisies : TVA', 'Other posted operations: VAT'), declaration.otherSales.vat]] satisfies [string, number][] : []),
    [tr('Chiffre d’affaires HT (70)', 'Net revenue (70)'), declaration.salesBase],
    [tr('TVA collectée', 'VAT collected'), declaration.collected],
    ...declaration.deductibleByAccount.map((line): [string, number] => [`${tr('TVA déductible', 'Deductible VAT')} ${line.account} · ${line.label}`, line.amount]),
    [tr('Total TVA déductible', 'Total deductible VAT'), declaration.deductible],
    [tr('Crédit de TVA reporté du mois précédent', 'VAT credit carried from last month'), declaration.previousCredit],
    ...declaration.components.map((line): [string, number] => [line.label, line.amount]),
    [declaration.balance >= 0 ? tr('TVA nette à payer', 'Net VAT payable') : tr('Crédit de TVA à reporter', 'VAT credit carried forward'), Math.abs(declaration.balance)],
  ]
}

function VatDeclaration({ ctx, period }: ViewProps & { period: string }) {
  const { tr, store, money, day } = ctx
  const declaration = vatReturn(store, period)
  const waiting = unsettledBefore(store, period)

  function settle() {
    if (waiting) {
      ctx.notify(tr(`Liquidez d’abord la TVA de ${waiting} : les mois se liquident dans l’ordre.`, `Settle the VAT of ${waiting} first: months are settled in order.`))
      return
    }
    if (ctx.closed(`${period}-01`)) return
    const next = settleVat(store, period)
    if (next === store) return
    const piece = next.entries[next.entries.length - 1].piece
    ctx.apply(next)
    ctx.audit('Settled VAT', `${period} · ${piece}`)
    ctx.notify(tr(`TVA de ${period} liquidée par la pièce ${piece}.`, `VAT for ${period} settled by document ${piece}.`))
  }

  return (
    <>
      <div className="sg-stats">
        <Stat label={tr('TVA collectée', 'VAT collected')} value={money(declaration.collected)} />
        <Stat label={tr('TVA déductible', 'Deductible VAT')} value={money(declaration.deductible)} />
        <Stat label={tr('Crédit reporté', 'Credit carried in')} value={money(declaration.previousCredit)} />
        <Stat label={declaration.balance >= 0 ? tr('TVA nette à payer', 'Net VAT payable') : tr('Crédit à reporter', 'Credit carried forward')} value={money(Math.abs(declaration.balance))} />
      </div>
      <div className="table-scroll">
        <table className="data-table sg-table">
          <thead><tr><th>{tr('RUBRIQUE', 'ITEM')}</th><th className="sg-num">{tr('MONTANT', 'AMOUNT')}</th></tr></thead>
          <tbody>{vatRows(declaration, tr).map(([label, amount]) => <tr key={label}><td>{label}</td><td className="sg-num">{money(amount)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="dk-note">
        {declaration.due && tr(`Échéance habituelle de dépôt et de paiement : ${day(declaration.due)}. `, `Usual filing and payment deadline: ${day(declaration.due)}. `)}
        {tr('Taux et échéances à vérifier chaque année avec la loi de finances. Les retenues de TVA à la source ne sont pas encore prises en compte.', 'Rates and deadlines must be checked each year against the finance law. VAT withheld at source is not handled yet.')}
      </p>
      <div className="sg-actions sg-noprint">
        {declaration.settled
          ? <Badge tone="good">{tr(`Liquidée · ${declaration.settled}`, `Settled · ${declaration.settled}`)}</Badge>
          : <button className="primary-button" type="button" disabled={!declaration.collected && !declaration.deductible} onClick={settle}><Check size={14} />{tr('Comptabiliser la liquidation', 'Post the VAT settlement')}</button>}
      </div>
    </>
  )
}

/** Every SYSCOHADA statement of a financial year, each with the previous year beside it, as they are filed together. */
function financialStatements(store: Store, year: number) {
  const [now, before] = [year, year - 1].map((item) => ({ position: balanceSheet(store, item), income: incomeStatement(store, item), flows: cashFlowStatement(store, item) }))
  return {
    assets: { lines: now.position.assets, previous: before.position.assets },
    liabilities: { lines: now.position.liabilities, previous: before.position.liabilities },
    income: { lines: now.income.lines, previous: before.income.lines },
    flows: { lines: now.flows.lines, previous: before.flows.lines, gap: now.flows.gap },
  }
}

export function ReportsView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const [report, setReport] = useState<'balance' | 'ledger' | 'journal' | 'vat' | 'bilan' | 'resultat' | 'flux' | 'etats'>('balance')
  const [month, setMonth] = useState('all')
  const [account, setAccount] = useState<string>(accountsOf(store).clients)
  const [journal, setJournal] = useState('all')
  // Financial statements cover a financial year, which OHADA sets to the calendar year.
  const years = Array.from(new Set([...store.entries.map((entry) => entry.date.slice(0, 4)), isoDate().slice(0, 4)])).sort().reverse()
  const [year, setYear] = useState(years[0])
  const statement = report === 'bilan' || report === 'resultat' || report === 'flux' || report === 'etats'
  const statements = statement ? financialStatements(store, Number(year)) : undefined
  const entries = store.entries.filter((entry) => month === 'all' || period(entry.date) === month)
  const titles = {
    balance: tr('Balance des comptes', 'Trial balance'), ledger: tr('Grand livre', 'General ledger'), journal: tr('Journal', 'Journal'), vat: tr('Déclaration de TVA', 'VAT return'),
    bilan: tr('Bilan SYSCOHADA', 'SYSCOHADA balance sheet'), resultat: tr('Compte de résultat SYSCOHADA', 'SYSCOHADA income statement'),
    flux: tr('Tableau des flux de trésorerie', 'Cash flow statement'), etats: tr('États financiers SYSCOHADA', 'SYSCOHADA financial statements'),
  }
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
  const fileName = `${titles[report]} ${statement ? year : month === 'all' ? '' : month}`.trim()
  const statementSheet = (name: string, { lines, previous }: { lines: StatementLine[]; previous: StatementLine[] }): Sheet => {
    const before = new Map(previous.map((line) => [line.ref, line.amount]))
    return { name, rows: [['Réf.', name, `Exercice ${year}`, `Exercice ${Number(year) - 1}`], ...lines.map((line) => [line.ref, line.label, line.amount, before.get(line.ref) ?? 0])] }
  }

  function exportExcel() {
    // Any statement exports the whole set, in one workbook, as it is handed to the tax office.
    if (statements) {
      downloadXlsx(`${titles.etats} ${year}.xlsx`, [
        statementSheet('Bilan actif', statements.assets), statementSheet('Bilan passif', statements.liabilities),
        statementSheet('Compte de résultat', statements.income), statementSheet('Flux de trésorerie', statements.flows),
      ])
      return
    }
    const sheet: Sheet = report === 'balance'
      ? { name: titles.balance, rows: [['Compte', 'Intitulé', 'Débit', 'Crédit', 'Solde'], ...balance.map((row) => [row.number, row.label, row.debit, row.credit, row.solde])] }
      : report === 'vat' && month !== 'all'
        ? { name: titles.vat, rows: [['Rubrique', 'Montant'], ...vatRows(vatReturn(store, month), tr)] }
        : report === 'vat'
        ? { name: titles.vat, rows: [['Rubrique', 'Montant'], ['Ventes HT', movement('7', 1)], ['TVA collectée', collected], ['Achats HT', movement('6', -1)], ['TVA déductible', deductible], ['TVA à payer', round2(collected - deductible)]] }
        : { name: titles[report], rows: entriesSheet(store, listed) }
    downloadXlsx(`${fileName}.xlsx`, [sheet])
  }

  return (
    <Panel className="sg-report" title={titles[report]} subtitle={`${store.company} · ${statement ? `${tr('Exercice', 'Financial year')} ${year}` : month === 'all' ? tr('Toutes périodes', 'All periods') : month}`}
      action={<div className="row-actions sg-noprint">
        <button className="approve-button" type="button" onClick={exportExcel}><FileSpreadsheet size={13} />Excel</button>
        {ctx.savePdf && <button className="approve-button" type="button" onClick={() => ctx.savePdf?.(fileName)}><FileDown size={13} />PDF</button>}
        <button className="primary-button" type="button" onClick={() => window.print()}><Printer size={14} />{tr('Imprimer', 'Print')}</button>
      </div>}>
      <Chips value={report} onChange={setReport} options={[
        ['balance', tr('Balance', 'Trial balance')], ['ledger', tr('Grand livre', 'Ledger')], ['journal', tr('Journal', 'Journal')], ['vat', tr('TVA', 'VAT')],
        ...(store.chart === 'syscohada' ? [['bilan', tr('Bilan', 'Balance sheet')], ['resultat', tr('Compte de résultat', 'Income statement')], ['flux', tr('Flux de trésorerie', 'Cash flows')], ['etats', tr('États financiers', 'Financial statements')]] satisfies [typeof report, string][] : []),
      ]} />
      <div className="sg-form sg-noprint">
        {statement && <label>{tr('Exercice', 'Financial year')}<select value={year} onChange={(event) => setYear(event.target.value)}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
        {!statement && <label>{tr('Période', 'Period')}<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="all">{tr('Toutes', 'All')}</option>{periodsOf(store).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
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
      {report === 'vat' && month !== 'all' && <VatDeclaration ctx={ctx} period={month} />}
      {report === 'vat' && month === 'all' && <p className="dk-note">{tr('Choisissez un mois pour obtenir la déclaration mensuelle et comptabiliser la liquidation.', 'Choose a month to get the monthly return and post the settlement.')}</p>}
      {report === 'vat' && month === 'all' && <div className="sg-stats">
        <Stat label={tr('Ventes HT (classe 7)', 'Net sales (class 7)')} value={money(movement('7', 1))} />
        <Stat label={tr(`TVA collectée (${prefixes.vatCollected})`, `VAT collected (${prefixes.vatCollected})`)} value={money(collected)} />
        <Stat label={tr('Achats HT (classe 6)', 'Net purchases (class 6)')} value={money(movement('6', -1))} />
        <Stat label={tr(`TVA déductible (${prefixes.vatDeductible})`, `Deductible VAT (${prefixes.vatDeductible})`)} value={money(deductible)} />
        <Stat label={collected >= deductible ? tr('TVA à payer', 'VAT payable') : tr('Crédit de TVA', 'VAT credit')} value={money(Math.abs(round2(collected - deductible)))} />
      </div>}
      {statements && (report === 'bilan' || report === 'etats') && <>
        <StatementTable title={tr('ACTIF', 'ASSETS')} {...statements.assets} year={Number(year)} money={money} />
        <StatementTable title={tr('PASSIF', 'LIABILITIES AND EQUITY')} {...statements.liabilities} year={Number(year)} money={money} />
      </>}
      {statements && (report === 'resultat' || report === 'etats') && <StatementTable title={tr('COMPTE DE RÉSULTAT', 'INCOME STATEMENT')} {...statements.income} year={Number(year)} money={money} />}
      {statements && (report === 'flux' || report === 'etats') && <>
        <StatementTable title={tr('TABLEAU DES FLUX DE TRÉSORERIE', 'CASH FLOW STATEMENT')} {...statements.flows} year={Number(year)} money={money} />
        {statements.flows.gap !== 0 && <p className="dk-note">{tr(`Écart de ${money(statements.flows.gap)} entre la trésorerie du bilan et celle du tableau : une écriture inhabituelle (virement entre comptes d’immobilisations, par exemple) est à analyser.`, `${money(statements.flows.gap)} difference between the balance-sheet cash and the statement’s: an unusual entry (a transfer between fixed-asset accounts, for instance) needs checking.`)}</p>}
      </>}
      {statement && <p className="dk-note">{tr('Montants tirés des écritures de l’exercice. Les variations de stocks (603) et les amortissements n’apparaissent qu’une fois comptabilisés : faites valider les états par votre expert-comptable avant dépôt.', 'Amounts come from the year’s entries. Stock variations (603) and depreciation only appear once posted: have your accountant check the statements before filing.')}</p>}
    </Panel>
  )
}
