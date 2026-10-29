import assert from 'node:assert/strict'
import { test } from 'node:test'
import { approveSupplierInvoice, matchBankLine, suggestBankMatch } from '../src/financeData.ts'
import { autoLetter, countries, createStore, ledgerViolation, numberingGaps, postPiece, reversePiece, saveSalesDoc } from '../src/sageData.ts'
import { assignResult, closeYear } from '../src/yearEnd.ts'

const cameroon = countries.find((country) => country.code === 'CM')!

test('the everyday flows keep every OHADA rule on posted entries', () => {
  let store = createStore('Démo', cameroon)
  const steps = [
    (current: typeof store) => saveSalesDoc(current, { type: 'facture', client: current.clients[0].code, date: '2026-10-05', lines: [{ ref: current.articles[0].ref, qty: 1, price: 10000, vat: 19.25 }], origin: 'commercial' }),
    (current: typeof store) => approveSupplierInvoice(current, 'FR00001'),
    (current: typeof store) => matchBankLine(current, current.bankLines[0].id, suggestBankMatch(current, current.bankLines[0])!.id),
    (current: typeof store) => postPiece(current, 'OD', '2026-10-06', 'Frais', [{ account: '631000', debit: 500, credit: 0 }, { account: '521100', debit: 0, credit: 500 }]),
    (current: typeof store) => reversePiece(current, 'OD-0001', '2026-10-07'),
    autoLetter,
  ]
  for (const step of steps) {
    const next = step(store)
    assert.equal(ledgerViolation(store, next), undefined)
    store = next
  }
  assert.deepEqual(numberingGaps(store), [])
})

test('a posted line cannot be changed or removed; lettering it is allowed', () => {
  const store = createStore('Démo', cameroon)
  const [first] = store.entries
  assert.deepEqual(ledgerViolation(store, { ...store, entries: store.entries.slice(1) }), { kind: 'removed', piece: first.piece })
  assert.deepEqual(ledgerViolation(store, { ...store, entries: store.entries.map((entry) => entry.id === first.id ? { ...entry, debit: entry.debit + 1 } : entry) }), { kind: 'changed', piece: first.piece })
  assert.deepEqual(ledgerViolation(store, { ...store, entries: store.entries.map((entry) => entry.id === first.id ? { ...entry, date: '2020-01-01' } : entry) }), { kind: 'changed', piece: first.piece })
  assert.equal(ledgerViolation(store, { ...store, entries: store.entries.map((entry) => entry.id === first.id ? { ...entry, letter: 'ZZ' } : entry) }), undefined)
})

test('an unbalanced piece and a piece in a locked month are refused', () => {
  const store = { ...createStore('Démo', cameroon), closedPeriods: ['2026-09'] }
  const unbalanced = postPiece(store, 'OD', '2026-10-01', 'Erreur', [{ account: '631000', debit: 500, credit: 0 }, { account: '521100', debit: 0, credit: 499 }])
  assert.deepEqual(ledgerViolation(store, unbalanced), { kind: 'unbalanced', piece: unbalanced.entries.at(-1)!.piece })
  const locked = postPiece(store, 'OD', '2026-09-15', 'Tardive', [{ account: '631000', debit: 500, credit: 0 }, { account: '521100', debit: 0, credit: 500 }])
  assert.deepEqual(ledgerViolation(store, locked), { kind: 'closedPeriod', period: '2026-09' })
})

test('a month can be reopened until the year is closed; after the year-end closing it stays locked', () => {
  const store = createStore('Démo', cameroon)
  const year = Number(store.entries[0].date.slice(0, 4))
  const lockedMonth = { ...store, closedPeriods: [`${year}-03`] }
  assert.equal(ledgerViolation(lockedMonth, { ...lockedMonth, closedPeriods: [] }), undefined)
  const closed = closeYear(store, year)
  assert.equal(ledgerViolation(store, closed), undefined)
  assert.deepEqual(ledgerViolation(closed, { ...closed, closedPeriods: closed.closedPeriods.filter((month) => month !== `${year}-12`) }), { kind: 'closedYear', period: `${year}-12` })
  // The assignment of the result is posted the next year, so it is still allowed.
  assert.equal(ledgerViolation(closed, assignResult(closed, year, `${year + 1}-06-30`)), undefined)
})

test('numbering gaps are found in every series of pieces', () => {
  let store = createStore('Démo', cameroon)
  for (const day of ['01', '02', '03']) store = postPiece(store, 'OD', `2026-10-${day}`, 'Frais', [{ account: '631000', debit: 1, credit: 0 }, { account: '521100', debit: 0, credit: 1 }])
  assert.deepEqual(numberingGaps(store), [])
  const withHole = { ...store, entries: store.entries.filter((entry) => entry.piece !== 'OD-0002') }
  assert.deepEqual(numberingGaps(withHole), ['OD-0002'])
})
