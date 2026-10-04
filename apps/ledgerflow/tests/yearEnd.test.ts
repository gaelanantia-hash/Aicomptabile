import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countries, createEmptyStore, createStore, postPiece, setupFor, type Store } from '../src/sageData.ts'
import { fromSnapshot, toSnapshot } from '../src/sageSnapshot.ts'
import { balanceSheet, incomeStatement, type StatementLine } from '../src/syscohada.ts'
import {
  assignResult, closeYear, depreciationAccount, depreciationSchedule, openingStock, postDepreciation, postInventory, registerAsset, yearEndStatus,
} from '../src/yearEnd.ts'

const cameroon = countries.find((country) => country.code === 'CM')!
const total = (lines: StatementLine[], ref: string) => lines.find((line) => line.ref === ref)!.amount
const balance = (store: Store, prefix: string) => store.entries.filter((entry) => entry.account.startsWith(prefix)).reduce((sum, entry) => sum + entry.debit - entry.credit, 0)

function company() {
  let store = createEmptyStore('Ets Mbarga', setupFor(cameroon))
  store = postPiece(store, 'OD', '2026-01-02', 'Apport', [{ account: '521100', debit: 10_000_000, credit: 0 }, { account: '101300', debit: 0, credit: 10_000_000 }])
  store = postPiece(store, 'VTE', '2026-05-10', 'Ventes', [{ account: '521100', debit: 3_000_000, credit: 0 }, { account: '701100', debit: 0, credit: 3_000_000 }])
  store = postPiece(store, 'ACH', '2026-05-12', 'Achats', [{ account: '601100', debit: 1_800_000, credit: 0 }, { account: '521100', debit: 0, credit: 1_800_000 }])
  return store
}

test('straight-line depreciation is pro rata from the acquisition day and adds up to the cost in whole francs', () => {
  const asset = { id: 'IM0001', label: 'Ordinateur', account: '244200', acquired: '2026-07-01', cost: 1_000_000, years: 3 }
  const schedule = depreciationSchedule(asset, 'XAF')
  assert.deepEqual(schedule.map((line) => line.year), [2026, 2027, 2028, 2029])
  // 184 days of 365 in the first year.
  assert.equal(schedule[0].amount, Math.round(1_000_000 / 3 * 184 / 365))
  assert.equal(schedule[1].amount, 333_333)
  assert.equal(schedule.at(-1)!.accumulated, 1_000_000)
  assert.ok(schedule.every((line) => Number.isInteger(line.amount)))
  assert.deepEqual(depreciationSchedule({ ...asset, account: '223000' }, 'XAF'), [])
  assert.equal(depreciationAccount('244200'), '284400')
})

test('registering an asset can post its acquisition; the year-end depreciation is posted once', () => {
  let store = registerAsset(company(), { label: 'Ordinateur', account: '244200', acquired: '2026-07-01', cost: 1_000_000, years: 3 }, 'bank')
  assert.equal(store.assets.length, 1)
  assert.equal(balance(store, '2442'), 1_000_000)
  store = postDepreciation(store, 2026)
  const expected = depreciationSchedule(store.assets[0], 'XAF')[0].amount
  assert.deepEqual(store.entries.slice(-2).map((entry) => [entry.account, entry.debit, entry.credit, entry.date, entry.origin]), [
    ['681300', expected, 0, '2026-12-31', 'depreciation'], ['284400', 0, expected, '2026-12-31', 'depreciation'],
  ])
  assert.ok(store.accounts.some((account) => account.number === '284400'))
  assert.equal(postDepreciation(store, 2026), store)
  // The balance sheet shows the asset net of depreciation.
  assert.equal(total(balanceSheet(store, 2026).assets, 'AI'), 1_000_000 - expected)
})

test('the stock count posts the variation of goods between book and counted stock', () => {
  let store = postInventory(company(), 2026, 450_000)
  assert.deepEqual(store.entries.slice(-2).map((entry) => [entry.account, entry.debit, entry.credit]), [['311000', 450_000, 0], ['603100', 0, 450_000]])
  assert.equal(total(incomeStatement(store, 2026).lines, 'XA'), 3_000_000 - 1_800_000 + 450_000)
  // Next year, a smaller stock: the decrease is charged to 6031.
  store = postPiece(store, 'VTE', '2027-02-01', 'Ventes', [{ account: '521100', debit: 100_000, credit: 0 }, { account: '701100', debit: 0, credit: 100_000 }])
  assert.equal(openingStock(store, 2027), 450_000)
  store = postInventory(store, 2027, 300_000)
  assert.deepEqual(store.entries.slice(-2).map((entry) => [entry.account, entry.debit, entry.credit]), [['603100', 150_000, 0], ['311000', 0, 150_000]])
})

test('closing determines the result into 131, locks the year, and the statements still show it', () => {
  let store = postInventory(company(), 2026, 0)
  const before = incomeStatement(store, 2026).result
  store = closeYear(store, 2026)
  assert.equal(before, 1_200_000)
  assert.equal(store.yearEnd['2026'].result, 1_200_000)
  assert.equal(balance(store, '6') + balance(store, '7'), 0)
  assert.equal(balance(store, '131'), -1_200_000)
  assert.equal(store.closedPeriods.filter((month) => month.startsWith('2026-')).length, 12)
  assert.equal(incomeStatement(store, 2026).result, 1_200_000)
  const sheet = balanceSheet(store, 2026)
  assert.equal(total(sheet.liabilities, 'CJ'), 1_200_000)
  assert.equal(total(sheet.assets, 'BZ'), total(sheet.liabilities, 'DZ'))
  assert.equal(closeYear(store, 2026), store)
})

test('a loss closes into 139 and is carried to 129 after the shareholders’ decision', () => {
  let store = postPiece(createEmptyStore('X', setupFor(cameroon)), 'ACH', '2026-03-01', 'Loyer', [{ account: '622200', debit: 500_000, credit: 0 }, { account: '521100', debit: 0, credit: 500_000 }])
  store = closeYear(store, 2026)
  assert.equal(balance(store, '139'), 500_000)
  assert.equal(assignResult(store, 2026, '2026-12-31'), store, 'the assignment comes after the year end')
  store = assignResult(store, 2026, '2027-06-30')
  assert.deepEqual([balance(store, '139'), balance(store, '129')], [0, 500_000])
  const sheet = balanceSheet(store, 2027)
  assert.deepEqual([total(sheet.liabilities, 'CH'), total(sheet.liabilities, 'CJ')], [-500_000, 0])
  assert.equal(total(sheet.assets, 'BZ'), total(sheet.liabilities, 'DZ'))
})

test('the whole closing of the sample company keeps the books balanced, and survives saving', () => {
  const year = new Date().getFullYear()
  let store = createStore('Démo', cameroon)
  store = registerAsset(store, { label: 'Véhicule', account: '245000', acquired: `${year}-03-15`, cost: 6_000_000, years: 5 }, 'supplier')
  store = closeYear(postInventory(postDepreciation(store, year), year, 2_500_000), year)
  const pieces = new Map<string, number>()
  for (const entry of store.entries) pieces.set(entry.piece, (pieces.get(entry.piece) ?? 0) + entry.debit - entry.credit)
  assert.ok([...pieces.values()].every((value) => Math.abs(value) < 1e-6))
  const sheet = balanceSheet(store, year)
  assert.equal(total(sheet.assets, 'BZ'), total(sheet.liabilities, 'DZ'))
  const status = yearEndStatus(store, year)
  assert.ok(status.depreciation && status.inventory && status.closing)
  const reloaded = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(store))))
  assert.deepEqual([reloaded.assets, reloaded.yearEnd], [store.assets, store.yearEnd])
})
