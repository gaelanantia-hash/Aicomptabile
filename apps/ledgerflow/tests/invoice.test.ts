import assert from 'node:assert/strict'
import { test } from 'node:test'
import { amountInWords, invoiceSheet, missingMentions, numberInWords } from '../src/invoice.ts'
import { countries, createEmptyStore, saveSalesDoc, setupFor } from '../src/sageData.ts'
import { fromSnapshot, toSnapshot } from '../src/sageSnapshot.ts'

const cameroon = countries.find((country) => country.code === 'CM')!

test('numbers are written out in French, with the traditional agreement rules', () => {
  const cases: [number, string][] = [
    [0, 'zéro'], [1, 'un'], [16, 'seize'], [17, 'dix-sept'], [21, 'vingt et un'], [22, 'vingt-deux'], [71, 'soixante et onze'], [77, 'soixante-dix-sept'],
    [80, 'quatre-vingts'], [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf'], [100, 'cent'], [101, 'cent un'],
    [200, 'deux cents'], [280, 'deux cent quatre-vingts'], [1000, 'mille'], [1080, 'mille quatre-vingts'], [2000, 'deux mille'], [80_000, 'quatre-vingt mille'],
    [200_000, 'deux cent mille'], [1_000_000, 'un million'], [2_500_000, 'deux millions cinq cent mille'], [80_000_000, 'quatre-vingts millions'],
    [1_192_500, 'un million cent quatre-vingt-douze mille cinq cents'], [3_000_000_000, 'trois milliards'],
  ]
  for (const [value, words] of cases) assert.equal(numberInWords(value), words, String(value))
})

test('amounts carry their currency, cents when the currency has them, and "de" after a round million', () => {
  assert.equal(amountInWords(1_192_500, 'XAF'), 'un million cent quatre-vingt-douze mille cinq cents francs CFA')
  assert.equal(amountInWords(1, 'XAF'), 'un franc CFA')
  assert.equal(amountInWords(2_000_000, 'XAF'), 'deux millions de francs CFA')
  assert.equal(amountInWords(1250.5, 'EUR'), 'mille deux cent cinquante euros et cinquante centimes')
})

test('a Cameroon invoice shows totals per rate, VAT split into principal and CAC, and the amount in words', () => {
  let store = createEmptyStore('Ets Mbarga', setupFor(cameroon))
  store = { ...store, clients: [{ code: 'C0001', name: 'Société Alpha', city: 'Douala', email: '', taxId: 'M012345678901A', address: 'Akwa' }], articles: [{ ref: 'CIM', name: 'Ciment 50 kg', family: '', cost: 4000, price: 5000, vat: 19.25, stock: 100 }] }
  store = saveSalesDoc(store, { type: 'facture', client: 'C0001', date: '2026-10-05', lines: [{ ref: 'CIM', qty: 20, price: 5000, vat: 19.25 }, { ref: 'TRANSPORT', qty: 1, price: 15_000, vat: 0 }], origin: 'commercial' })
  const doc = store.salesDocs[0]
  const sheet = invoiceSheet(store, doc)
  assert.equal(sheet.title, 'Facture')
  assert.equal(sheet.taxIdLabel, 'NIU')
  assert.deepEqual(sheet.lines.map((line) => [line.name, line.total]), [['Ciment 50 kg', 100_000], ['TRANSPORT', 15_000]])
  assert.deepEqual(sheet.rates, [{ rate: 19.25, base: 100_000, vat: 19_250 }, { rate: 0, base: 15_000, vat: 0 }])
  assert.deepEqual(sheet.vatParts.map((part) => part.amount), [17_500, 1_750])
  assert.equal(sheet.totals.ttc, 134_250)
  assert.equal(sheet.words, 'cent trente-quatre mille deux cent cinquante francs CFA')

  assert.deepEqual(missingMentions(store, doc), ['Adresse de l’entreprise', 'NIU de l’entreprise', 'RCCM de l’entreprise'])
  store = { ...store, companyInfo: { ...store.companyInfo, address: 'Bonanjo, Douala', taxId: 'P098765432109Z', rccm: 'RC/DLA/2020/B/1234' } }
  assert.deepEqual(missingMentions(store, doc), [])
  // Company details survive saving.
  assert.equal(fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(store)))).companyInfo.rccm, 'RC/DLA/2020/B/1234')
})
