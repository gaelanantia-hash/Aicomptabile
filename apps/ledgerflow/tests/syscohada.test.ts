import assert from 'node:assert/strict'
import { test } from 'node:test'
import { approveSupplierInvoice, cashForecast } from '../src/financeData.ts'
import { accountsOf, countries, createEmptyStore, createStore, docTotals, saveSalesDoc, setupFor, tiersBalance } from '../src/sageData.ts'
import { fromSnapshot, toSnapshot } from '../src/sageSnapshot.ts'
import { balanceSheet, incomeStatement, type StatementLine } from '../src/syscohada.ts'

const cameroon = countries.find((country) => country.code === 'CM')!

test('a company in a Central African state starts on SYSCOHADA in its currency and VAT rate', () => {
  const store = createEmptyStore('Ets Mbarga', setupFor(cameroon))
  assert.deepEqual([store.country, store.chart, store.currency, store.defaultVat], ['CM', 'syscohada', 'XAF', 19.25])
  const numbers = store.accounts.map((account) => account.number)
  for (const account of Object.values(accountsOf(store))) assert.ok(numbers.includes(account), account)
  assert.ok(numbers.includes('521100') && numbers.includes('571100') && numbers.includes('443100') && numbers.includes('445200'))
  assert.ok(countries.every((country) => country.chart === 'syscohada' && country.vat.includes(country.defaultVat)))
})

test('FCFA amounts are whole francs: VAT is rounded and the posting balances', () => {
  const store = { ...createEmptyStore('Ets Mbarga', setupFor(cameroon)), clients: [{ code: 'C0001', name: 'Client', city: 'Douala', email: '' }] }
  const lines = [{ ref: 'X', qty: 1, price: 1000, vat: 19.25 }]
  assert.deepEqual(docTotals(lines, 'XAF'), { ht: 1000, vat: 193, ttc: 1193 })
  assert.deepEqual(docTotals(lines, 'EUR'), { ht: 1000, vat: 192.5, ttc: 1192.5 })
  const next = saveSalesDoc(store, { type: 'facture', client: 'C0001', date: '2026-10-01', lines, origin: 'commercial' })
  assert.deepEqual(next.entries.map((entry) => [entry.account, entry.debit, entry.credit]), [['411100', 1193, 0], ['701100', 0, 1000], ['443100', 0, 193]])
  assert.equal(tiersBalance(next.entries, '411100', 'C0001'), 1193)
})

test('the sample company of every country is balanced, in whole local amounts, on accounts of its chart', () => {
  for (const country of countries) {
    const store = createStore('Démo', country)
    const known = new Set(store.accounts.map((account) => account.number))
    const pieces = new Map<string, number>()
    for (const entry of store.entries) {
      assert.ok(known.has(entry.account), `${country.code} ${entry.account}`)
      pieces.set(entry.piece, (pieces.get(entry.piece) ?? 0) + entry.debit - entry.credit)
      if (country.currency === 'XAF') assert.ok(Number.isInteger(entry.debit) && Number.isInteger(entry.credit), `${country.code} ${entry.piece}`)
    }
    assert.ok([...pieces.values()].every((balance) => Math.abs(balance) < 1e-9), country.code)
    // The bank statement still settles the customer invoice exactly, so reconciliation works on the sample.
    const invoice = store.entries.find((entry) => entry.piece === 'FA00002' && entry.account === accountsOf(store).clients)!
    assert.equal(store.bankLines[0].amount, invoice.debit)
    assert.ok(cashForecast(store, '2026-10-01').length > 0)
  }
})

test('approving a supplier invoice posts to SYSCOHADA VAT and supplier accounts', () => {
  const store = createStore('Démo', cameroon)
  const next = approveSupplierInvoice(store, 'FR00001')
  assert.deepEqual(next.entries.slice(-3).map((entry) => entry.account), ['621000', '445200', '401100'])
})

test('chart and country survive saving; data saved before them open on the French chart', () => {
  const store = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(createEmptyStore('X', setupFor(cameroon))))))
  assert.deepEqual([store.chart, store.country, store.currency], ['syscohada', 'CM', 'XAF'])
  const before = toSnapshot(createEmptyStore('Ancienne'))
  delete before.settings.chart
  delete before.settings.country
  assert.deepEqual([fromSnapshot(before).chart, fromSnapshot(before).country], ['pcg', ''])
})

const total = (lines: StatementLine[], ref: string) => lines.find((line) => line.ref === ref)!.amount

test('the SYSCOHADA balance sheet balances and carries the income statement result', () => {
  for (const country of countries) {
    const store = createStore('Démo', country)
    const year = Number(store.entries[0].date.slice(0, 4))
    const { assets, liabilities } = balanceSheet(store, year)
    assert.equal(total(assets, 'BZ'), total(liabilities, 'DZ'), country.code)
    assert.ok(total(assets, 'BZ') > 0)
    const income = incomeStatement(store, year)
    assert.equal(total(liabilities, 'CJ') + total(liabilities, 'CH'), income.result)
  }
})

test('income statement: commercial margin, value added and net result follow the SYSCOHADA cascade', () => {
  const entry = (account: string, debit: number, credit: number, date = '2026-03-01') => ({ id: 0, piece: 'X', journal: 'OD', date, account, label: '', debit, credit })
  const entries = [
    entry('701100', 0, 1000), entry('601100', 600, 0), entry('706000', 0, 200), entry('627000', 50, 0), entry('631000', 10, 0),
    entry('661000', 100, 0), entry('671000', 20, 0), entry('891000', 30, 0), entry('701100', 0, 999, '2025-12-31'),
  ]
  const { lines, result } = incomeStatement({ entries }, 2026)
  assert.deepEqual(['TA', 'RA', 'XA', 'XB', 'RH', 'XC', 'XD', 'XE', 'XF', 'XI'].map((ref) => total(lines, ref)), [1000, 600, 400, 1200, 60, 540, 440, 440, -20, 390])
  assert.equal(result, 390)
})

test('balances end up on the right side: bank overdraft and customer advances are liabilities', () => {
  const entry = (account: string, debit: number, credit: number) => ({ id: 0, piece: 'X', journal: 'OD', date: '2026-03-01', account, label: '', debit, credit })
  const { assets, liabilities } = balanceSheet({ entries: [entry('521100', 0, 500), entry('411100', 0, 300), entry('571100', 800, 0)] }, 2026)
  assert.deepEqual([total(liabilities, 'DR'), total(liabilities, 'DI'), total(assets, 'BS')], [500, 300, 800])
  assert.equal(total(assets, 'BZ'), total(liabilities, 'DZ'))
})
