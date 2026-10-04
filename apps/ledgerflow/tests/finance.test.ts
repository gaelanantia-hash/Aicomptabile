import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addBankLines, approveSupplierInvoice, articleAnalysis, cashForecast, closeChecks, closeProgress, dataQuality, filterSupplierInvoices, matchBankLine, missingInvoiceFields, monthlySales,
  openItems, overview, parseBankCsv, postBankLine, rejectSupplierInvoice, saveSupplierInvoice, suggestBankMatch,
} from '../src/financeData.ts'
import { accountsOf, articleInUse, autoLetter, completeWorkOrder, createEmptyStore, createStore, isoDate, round2, saveSalesDoc, tiersBalance, tiersInUse } from '../src/sageData.ts'
import { fromSnapshot, toSnapshot } from '../src/sageSnapshot.ts'

// The sample company without a country, like these tests' companies, uses the French chart of accounts.
const ACCOUNTS = accountsOf({ chart: 'pcg' })

const today = isoDate()
const balanced = (store: ReturnType<typeof createStore>) => round2(store.entries.reduce((total, entry) => total + entry.debit - entry.credit, 0)) === 0

test('approving a supplier invoice posts expense, VAT and the supplier debt', () => {
  const store = createStore()
  const next = approveSupplierInvoice(store, 'FR00001')
  const posted = next.entries.slice(-3)
  assert.deepEqual(posted.map((entry) => [entry.journal, entry.account, entry.debit, entry.credit]), [
    ['ACH', '611200', 3566.67, 0], ['ACH', ACCOUNTS.vatDeductible, 713.33, 0], ['ACH', ACCOUNTS.suppliers, 0, 4280],
  ])
  assert.equal(posted[2].tiers, 'F0001')
  assert.deepEqual(next.supplierInvoices.find((invoice) => invoice.id === 'FR00001'), { ...store.supplierInvoices[0], status: 'approved', piece: posted[0].piece })
  assert.ok(balanced(next))
  assert.equal(approveSupplierInvoice(next, 'FR00001'), next)
})

test('an invoice without an expense account cannot be approved; an unknown supplier is created on approval', () => {
  const store = createStore()
  assert.deepEqual(missingInvoiceFields(store.supplierInvoices[2]), ['account'])
  assert.equal(approveSupplierInvoice(store, 'FR00003'), store)

  let next = saveSupplierInvoice(store, { number: 'N-1', supplier: 'Nouveau Fournisseur SARL', date: today, due: '', amount: 120, vat: 20, account: '606400' })
  const created = next.supplierInvoices.at(-1)!
  assert.deepEqual([created.id, created.status], ['FR00004', 'needs_review'])
  next = approveSupplierInvoice(next, created.id)
  const supplier = next.suppliers.at(-1)!
  assert.deepEqual([supplier.code, supplier.name], ['F0004', 'Nouveau Fournisseur SARL'])
  assert.equal(tiersBalance(next.entries, ACCOUNTS.suppliers, 'F0004'), 120)

  const edited = saveSupplierInvoice(store, { ...store.supplierInvoices[2], account: '623100' })
  assert.equal(edited.supplierInvoices.length, 3)
  assert.deepEqual(missingInvoiceFields(edited.supplierInvoices[2]), [])
  assert.equal(rejectSupplierInvoice(store, 'FR00002').supplierInvoices[1].status, 'rejected')
})

test('supplier invoice history filters all statuses by supplier and sorts newest first', () => {
  const store = createStore()
  const invoices = [
    { ...store.supplierInvoices[0], date: '2026-01-01' },
    { ...store.supplierInvoices[1], supplier: ' atelier nord ', date: '2026-02-01', status: 'approved' as const },
    { ...store.supplierInvoices[2], supplier: 'Bureau Central', date: '2026-03-01', status: 'rejected' as const },
  ]
  assert.deepEqual(filterSupplierInvoices(invoices, 'ATELIER NORD').map((invoice) => invoice.id), ['FR00002', 'FR00001'])
  assert.deepEqual(filterSupplierInvoices(invoices).map((invoice) => invoice.id), ['FR00003', 'FR00002', 'FR00001'])
})

test('bank statements are read from the usual CSV layouts', () => {
  assert.deepEqual(parseBankCsv('Date;Libellé;Montant\n30/09/2026;VIR RECU CLIENT;1 360,80\n01/10/2026;"FRAIS; TENUE";-12,50\n;;\n'), [
    { date: '2026-09-30', label: 'VIR RECU CLIENT', amount: 1360.8 }, { date: '2026-10-01', label: 'FRAIS; TENUE', amount: -12.5 },
  ])
  assert.deepEqual(parseBankCsv('date,label,debit,credit\n2026-10-01,Card payment,45.90,\n2026-10-02,Transfer in,,"1,200.00"'), [
    { date: '2026-10-01', label: 'Card payment', amount: -45.9 }, { date: '2026-10-02', label: 'Transfer in', amount: 1200 },
  ])
  assert.deepEqual(parseBankCsv('﻿Date\tValeur\tLibellé\tMontant\n02.10.2026\t03.10.2026\tPRLV EDF\t-1.234,56 €'), [{ date: '2026-10-02', label: 'PRLV EDF', amount: -1234.56 }])
  assert.deepEqual(parseBankCsv('no data here'), [])
})

test('importing the same statement twice does not duplicate lines', () => {
  const lines = parseBankCsv('01/10/2026;A;10\n01/10/2026;B;-5')
  const once = addBankLines(createEmptyStore('X'), lines)
  assert.deepEqual(once.bankLines.map((line) => line.id), ['BK00001', 'BK00002'])
  assert.equal(addBankLines(once, lines).bankLines.length, 2)
})

test('a bank receipt is matched to the open customer invoice of the same amount, posted and lettered', () => {
  const store = createStore()
  const line = store.bankLines[0]
  const match = suggestBankMatch(store, line)!
  assert.deepEqual([match.piece, match.account, match.debit], ['FA00002', ACCOUNTS.clients, 1360.8])
  const next = matchBankLine(store, line.id, match.id)
  assert.equal(tiersBalance(next.entries, ACCOUNTS.clients, 'C0002'), 0)
  const lettered = next.entries.filter((entry) => entry.letter)
  assert.deepEqual(lettered.map((entry) => [entry.piece, entry.account]), [['FA00002', ACCOUNTS.clients], [next.bankLines[0].piece, ACCOUNTS.clients]])
  assert.equal(new Set(lettered.map((entry) => entry.letter)).size, 1)
  assert.ok(balanced(next))
  assert.equal(matchBankLine(next, line.id, match.id), next)
  assert.equal(suggestBankMatch(next, next.bankLines[0]), undefined)
  // A later automatic lettrage must not reuse the code already given.
  assert.equal(new Set(autoLetter(next).entries.filter((entry) => entry.letter).map((entry) => `${entry.letter}${entry.tiers}`)).size, 2)
})

test('a supplier payment is matched to the supplier invoice; a fee is posted to an expense account', () => {
  let store = createStore()
  const payment = store.bankLines[1]
  const match = suggestBankMatch(store, payment)!
  assert.deepEqual([match.piece, match.credit], ['FF00001', 1296])
  store = matchBankLine(store, payment.id, match.id)
  assert.equal(tiersBalance(store.entries, ACCOUNTS.suppliers, 'F0001'), 0)

  const fee = store.bankLines[2]
  assert.equal(suggestBankMatch(store, fee), undefined)
  assert.equal(postBankLine(store, fee.id, ''), store)
  assert.equal(postBankLine(store, fee.id, ACCOUNTS.clients), store)
  store = postBankLine(store, fee.id, '627000')
  assert.deepEqual(store.entries.slice(-2).map((entry) => [entry.account, entry.debit, entry.credit]), [['627000', 12.5, 0], [ACCOUNTS.bank, 0, 12.5]])
  assert.ok(balanced(store))
})

test('overview figures come from the ledger', () => {
  const store = createStore()
  const figures = overview(store, today)
  assert.equal(figures.receivables, 1360.8)
  assert.equal(figures.payables, 1296)
  assert.deepEqual([figures.invoicesToReview, figures.bankToMatch, figures.receivablesCount], [3, 3, 1])
  const cash = round2(store.entries.filter((entry) => entry.account.startsWith('5')).reduce((total, entry) => total + entry.debit - entry.credit, 0))
  assert.equal(figures.cash, cash)
  assert.equal(overview(createEmptyStore('X'), today).cash, 0)
})

test('the cash forecast adds receivables and subtracts payables at their due date, overdue ones in the first week', () => {
  const store = createStore()
  const weeks = cashForecast(store, today)
  assert.equal(weeks.length, 13)
  const cash = overview(store, today).cash
  // Both sample items are overdue (invoices dated more than 30 days ago).
  assert.deepEqual([weeks[0].inflow, weeks[0].outflow, weeks[0].balance], [1360.8, 1296, round2(cash + 1360.8 - 1296)])
  assert.equal(weeks.at(-1)!.balance, weeks[0].balance)
  const later = approveSupplierInvoice(store, 'FR00001')
  const index = cashForecast(later, today).findIndex((week, position) => position > 0 && week.outflow === 4280)
  assert.equal(index, 3)
  assert.equal(openItems(later, '401').length, 2)
})

test('data quality lists incomplete and duplicate records', () => {
  assert.deepEqual(dataQuality(createStore()), { score: 100, checked: 3 * 3 + 3 * 2 + 7 * 4, issues: [] })
  const store = createStore()
  const messy = {
    ...store,
    clients: [...store.clients, { code: 'C0004', name: 'les jardins', city: '', email: 'pas-un-email' }],
    articles: store.articles.map((article, index) => index === 0 ? { ...article, family: '', price: 10, stock: -2 } : article),
  }
  const report = dataQuality(messy)
  assert.deepEqual(report.issues.map((issue) => [issue.key, issue.records.length]), [['clientEmail', 1], ['clientCity', 1], ['duplicateClient', 2], ['articleFamily', 1], ['articleMargin', 1], ['articleStock', 1]])
  assert.ok(report.score < 100)
  assert.equal(dataQuality(createEmptyStore('X')).score, 100)
})

test('month-end checks follow the state of the books', () => {
  const month = today.slice(0, 7)
  let store = createStore()
  assert.deepEqual(closeChecks(store, month), { bank: false, invoices: false, balanced: true, lettering: false })
  for (const line of store.bankLines.slice(0, 2)) store = matchBankLine(store, line.id, suggestBankMatch(store, line)!.id)
  store = postBankLine(store, 'BK00003', '627000')
  store = approveSupplierInvoice(approveSupplierInvoice(store, 'FR00001'), 'FR00002')
  store = rejectSupplierInvoice(store, 'FR00003')
  store = autoLetter(store)
  assert.deepEqual(closeChecks(store, month), { bank: true, invoices: true, balanced: true, lettering: true })
  assert.deepEqual(closeProgress(store, month), { done: 4, total: 8 })
  assert.deepEqual(closeProgress({ ...store, closeTasks: { [month]: ['accruals', 'payroll', 'unknown'] } }, month), { done: 6, total: 8 })
})

test('item analysis: registered = sold + used in production + remaining', () => {
  const store = createStore()
  const row = (source: ReturnType<typeof createStore>, ref: string, month?: string) => articleAnalysis(source, month).find((item) => item.ref === ref)!
  assert.deepEqual([row(store, 'LAMP-OPAL').registered, row(store, 'LAMP-OPAL').sold, row(store, 'LAMP-OPAL').remaining, row(store, 'LAMP-OPAL').revenue], [42, 13, 29, 1677])
  assert.deepEqual([row(store, 'AMP-E27').registered, row(store, 'AMP-E27').sold, row(store, 'AMP-E27').remaining], [320, 60, 260])
  // Bought, never sold: 20 in opening stock plus 40 purchased.
  assert.deepEqual([row(store, 'ABAT-LIN').registered, row(store, 'ABAT-LIN').sold, row(store, 'ABAT-LIN').remaining], [60, 0, 60])
  // Delivered but not yet invoiced counts as sold (it left the stock) with no revenue yet.
  assert.deepEqual([row(store, 'APPL-LAITON').sold, row(store, 'APPL-LAITON').revenue], [4, 0])

  const produced = completeWorkOrder(store, 'OF00001')
  assert.deepEqual([row(produced, 'ABAT-LIN').registered, row(produced, 'ABAT-LIN').consumed, row(produced, 'ABAT-LIN').remaining], [60, 10, 50])
  assert.deepEqual([row(produced, 'LAMP-OPAL').registered, row(produced, 'LAMP-OPAL').remaining], [52, 39])
  for (const item of articleAnalysis(produced)) assert.equal(item.registered, item.sold + item.consumed + item.remaining, item.ref)

  assert.deepEqual([row(store, 'LAMP-OPAL', '2000-01').sold, row(store, 'LAMP-OPAL', '2000-01').registered, row(store, 'LAMP-OPAL', '2000-01').revenue], [0, 42, 0])
})

test('monthly sales: per day, in total and per item, best seller first', () => {
  let store = { ...createEmptyStore('X'), articles: [
    { ref: 'A', name: 'Article A', family: '', cost: 1, price: 10, vat: 20, stock: 50 },
    { ref: 'B', name: 'Article B', family: '', cost: 1, price: 4, vat: 20, stock: 50 },
  ] }
  const ticket = (date: string, ref: string, qty: number, price: number) => saveSalesDoc(store, { type: 'ticket', client: '', date, lines: [{ ref, qty, price, vat: 20 }], origin: 'caisse', payment: 'cash' })
  store = ticket('2026-02-03', 'A', 2, 10)
  store = ticket('2026-02-03', 'B', 7, 4)
  store = ticket('2026-02-28', 'A', 1, 10)
  store = ticket('2026-03-01', 'A', 5, 10)
  store = saveSalesDoc(store, { type: 'commande', client: 'C1', date: '2026-02-10', lines: [{ ref: 'A', qty: 9, price: 10, vat: 20 }], origin: 'commercial' })
  const sales = monthlySales(store, '2026-02')
  assert.equal(sales.days.length, 28)
  assert.deepEqual(sales.days[2], { date: '2026-02-03', revenue: 48, quantity: 9 })
  assert.deepEqual([sales.documents, sales.revenue, sales.quantity], [3, 58, 10])
  assert.deepEqual(sales.articles, [{ ref: 'B', name: 'Article B', quantity: 7, revenue: 28, remaining: 43 }, { ref: 'A', name: 'Article A', quantity: 3, revenue: 30, remaining: 42 }])
  assert.deepEqual([monthlySales(store, '2026-04').documents, monthlySales(store, '2024-02').days.length], [0, 29])
})

test('records that others depend on are protected from deletion', () => {
  const store = createStore()
  assert.deepEqual(['LAMP-OPAL', 'KIT-ELEC', 'AMP-E27'].map((ref) => articleInUse(store, ref)), [true, true, true])
  assert.equal(articleInUse({ ...store, articles: [...store.articles, { ref: 'NEW', name: 'Nouveau', family: '', cost: 1, price: 2, vat: 20, stock: 0 }] }, 'NEW'), false)
  assert.deepEqual(['C0001', 'F0001', 'F0003'].map((code) => tiersInUse(store, code)), [true, true, false])
})

test('invoices to review, bank lines and month-end ticks are saved with the company data', () => {
  const store = { ...createStore(), closeTasks: { '2026-09': ['accruals'] } }
  const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(store))))
  assert.deepEqual([restored.supplierInvoices, restored.bankLines, restored.closeTasks], [store.supplierInvoices, store.bankLines, store.closeTasks])
  assert.deepEqual([fromSnapshot({}).supplierInvoices, fromSnapshot({}).closeTasks], [[], {}])
})
