import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countries, createEmptyStore, ledgerViolation, postPiece, saveSalesDoc, setupFor, type Store } from '../src/sageData.ts'
import { settleVat, unsettledBefore, vatReturn } from '../src/vat.ts'

const country = (code: string) => countries.find((item) => item.code === code)!

function company(code: string): Store {
  return { ...createEmptyStore('Ets Test', setupFor(country(code))), clients: [{ code: 'C0001', name: 'Client', city: '', email: '' }] }
}

const sell = (store: Store, date: string, lines: { price: number; vat: number }[]) =>
  saveSalesDoc(store, { type: 'facture', client: 'C0001', date, lines: lines.map((line, index) => ({ ref: `A${index}`, qty: 1, price: line.price, vat: line.vat })), origin: 'commercial' })

const buy = (store: Store, date: string, base: number, vat: number) =>
  postPiece(store, 'ACH', date, 'Achat', [{ account: '601100', debit: base, credit: 0 }, { account: '445200', debit: vat, credit: 0 }, { account: '401100', tiers: 'F1', debit: 0, credit: base + vat }])

test('Cameroon: sales by rate, deductible VAT, and the amount due split between principal VAT and the communes’ surtax', () => {
  let store = sell(company('CM'), '2026-10-05', [{ price: 100_000, vat: 19.25 }, { price: 50_000, vat: 0 }])
  store = buy(store, '2026-10-08', 40_000, 7_700)
  // A sale posted by hand, without a document.
  store = postPiece(store, 'OD', '2026-10-20', 'Vente diverse', [{ account: '571100', debit: 11_925, credit: 0 }, { account: '706000', debit: 0, credit: 10_000 }, { account: '443100', debit: 0, credit: 1_925 }])
  const declaration = vatReturn(store, '2026-10')
  assert.deepEqual(declaration.sales, [{ rate: 19.25, base: 100_000, vat: 19_250 }, { rate: 0, base: 50_000, vat: 0 }])
  assert.deepEqual(declaration.otherSales, { base: 10_000, vat: 1_925 })
  assert.deepEqual([declaration.salesBase, declaration.collected, declaration.deductible, declaration.previousCredit, declaration.balance], [160_000, 21_175, 7_700, 0, 13_475])
  assert.deepEqual(declaration.deductibleByAccount.map((line) => [line.account, line.amount]), [['445200', 7_700]])
  // 13 475 = 12 250 of principal VAT (17.5 %) + 1 225 of CAC (10 % of the principal).
  assert.deepEqual(declaration.components.map((line) => line.amount), [12_250, 1_225])
  assert.equal(declaration.due, '2026-11-15')
})

test('Gabon: no surtax; a month with more deductible VAT carries a credit to the next one', () => {
  let store = buy(company('GA'), '2026-09-10', 1_000_000, 180_000)
  store = sell(store, '2026-09-20', [{ price: 500_000, vat: 18 }])
  store = sell(store, '2026-10-05', [{ price: 800_000, vat: 18 }])
  const september = vatReturn(store, '2026-09')
  assert.deepEqual([september.collected, september.deductible, september.balance, september.components.length], [90_000, 180_000, -90_000, 0])
  const october = vatReturn(store, '2026-10')
  assert.deepEqual([october.previousCredit, october.collected, october.balance, october.due], [90_000, 144_000, 54_000, '2026-11-20'])
})

test('settling VAT clears the month’s VAT accounts, carries the credit, and is done once, month after month', () => {
  let store = buy(company('GA'), '2026-09-10', 1_000_000, 180_000)
  store = sell(store, '2026-09-20', [{ price: 500_000, vat: 18 }])
  store = sell(store, '2026-10-05', [{ price: 800_000, vat: 18 }])
  // October cannot be settled before September.
  assert.equal(unsettledBefore(store, '2026-10'), '2026-09')
  assert.equal(settleVat(store, '2026-10'), store)

  const september = settleVat(store, '2026-09')
  assert.equal(ledgerViolation(store, september), undefined)
  const piece = september.entries.at(-1)!.piece
  assert.deepEqual(september.entries.filter((entry) => entry.piece === piece).map((entry) => [entry.date, entry.account, entry.debit, entry.credit]), [
    ['2026-09-30', '445200', 0, 180_000], ['2026-09-30', '443100', 90_000, 0], ['2026-09-30', '444900', 90_000, 0],
  ])
  assert.ok(september.accounts.some((account) => account.number === '444900'))
  assert.equal(vatReturn(september, '2026-09').settled, piece)
  assert.equal(settleVat(september, '2026-09'), september)
  // The settlement itself is not VAT collected or deductible: September's return is unchanged.
  assert.equal(vatReturn(september, '2026-09').balance, -90_000)

  const october = settleVat(september, '2026-10')
  assert.equal(ledgerViolation(september, october), undefined)
  const lines = october.entries.filter((entry) => entry.piece === october.entries.at(-1)!.piece)
  assert.deepEqual(lines.map((entry) => [entry.account, entry.debit, entry.credit]), [['443100', 144_000, 0], ['444100', 0, 54_000], ['444900', 0, 90_000]])
  const balanceOf = (account: string) => october.entries.filter((entry) => entry.account === account).reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
  assert.deepEqual(['443100', '445200', '444900', '444100'].map(balanceOf), [0, 0, 0, -54_000])
})
