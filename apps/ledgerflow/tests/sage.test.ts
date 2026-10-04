import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crc32 } from 'node:zlib'
import {
  accountsOf, advancePurchaseDoc, advanceSalesDoc, autoLetter, completeWorkOrder, createEmptyStore, createStore, docTotals, missingComponent,
  isReversed, postPiece, registerSupplierInvoice, reversePiece, round2, sageModules, saveSalesDoc, shortage, supplierStockAnalysis, tiersBalance,
} from '../src/sageData.ts'
import { fromSnapshot, toSnapshot } from '../src/sageSnapshot.ts'
import { buildXlsx } from '../src/xlsx.ts'

// The sample company without a country, like these tests' companies, uses the French chart of accounts.
const ACCOUNTS = accountsOf({ chart: 'pcg' })

const stock = (store: ReturnType<typeof createStore>, ref: string) => store.articles.find((article) => article.ref === ref)!.stock
const pieceBalances = (store: ReturnType<typeof createStore>) => {
  const balances = new Map<string, number>()
  for (const entry of store.entries) balances.set(entry.piece, round2((balances.get(entry.piece) ?? 0) + entry.debit - entry.credit))
  return [...balances.values()]
}

test('the three modules expose the 27 activities of the checklist', () => {
  assert.deepEqual(sageModules.map((module) => module.groups.reduce((count, group) => count + group.activities.length, 0)), [9, 7, 11])
  const ids = sageModules.flatMap((module) => module.groups.flatMap((group) => group.activities.map((activity) => activity.id)))
  assert.equal(new Set(ids).size, 27)
})

test('every accounting document of the sample company balances', () => {
  assert.ok(pieceBalances(createStore()).every((balance) => balance === 0))
})

test('a sales invoice moves stock once and posts receivable, revenue and VAT', () => {
  const store = createStore()
  const next = saveSalesDoc(store, { type: 'facture', client: 'C0003', date: '2026-10-01', lines: [{ ref: 'SUSP-LIN', qty: 2, price: 189, vat: 20 }], origin: 'commercial' })
  const invoice = next.salesDocs.at(-1)!
  assert.equal(stock(next, 'SUSP-LIN'), stock(store, 'SUSP-LIN') - 2)
  const posted = next.entries.filter((entry) => entry.piece === invoice.id)
  assert.deepEqual(posted.map((entry) => [entry.journal, entry.account, entry.debit, entry.credit]), [
    ['VTE', ACCOUNTS.clients, 453.6, 0], ['VTE', ACCOUNTS.sales, 0, 378], ['VTE', ACCOUNTS.vatCollected, 0, 75.6],
  ])
  assert.equal(tiersBalance(next.entries, ACCOUNTS.clients, 'C0003'), 453.6)
})

test('quote → order → delivery → invoice: stock leaves at delivery, accounting posts at invoice', () => {
  let store = createStore()
  const before = stock(store, 'SUSP-LIN')
  const entries = store.entries.length
  store = advanceSalesDoc(store, 'DE00001', '2026-10-01')
  assert.equal(store.salesDocs.some((doc) => doc.id === 'DE00001'), false)
  const order = store.salesDocs.find((doc) => doc.type === 'commande' && doc.client === 'C0001')!
  assert.equal(stock(store, 'SUSP-LIN'), before)
  store = advanceSalesDoc(store, order.id, '2026-10-01')
  const delivery = store.salesDocs.find((doc) => doc.type === 'livraison' && doc.client === 'C0001')!
  assert.equal(stock(store, 'SUSP-LIN'), before - 3)
  assert.equal(store.entries.length, entries)
  store = advanceSalesDoc(store, delivery.id, '2026-10-01')
  assert.equal(stock(store, 'SUSP-LIN'), before - 3)
  assert.equal(store.entries.length, entries + 3)
  assert.ok(pieceBalances(store).every((balance) => balance === 0))
})

test('a counter sale posts to the cash journal, to cash or bank by payment method', () => {
  const store = createStore()
  const line = { ref: 'AMP-E27', qty: 10, price: 7.9, vat: 20 }
  const cash = saveSalesDoc(store, { type: 'ticket', client: '', date: '2026-10-01', lines: [line], origin: 'caisse', payment: 'cash' })
  const card = saveSalesDoc(store, { type: 'ticket', client: '', date: '2026-10-01', lines: [line], origin: 'caisse', payment: 'card' })
  assert.deepEqual(cash.entries.slice(-3).map((entry) => [entry.journal, entry.account]), [['CAI', ACCOUNTS.cash], ['CAI', ACCOUNTS.sales], ['CAI', ACCOUNTS.vatCollected]])
  assert.equal(card.entries.at(-3)!.account, ACCOUNTS.bank)
  assert.equal(cash.entries.at(-3)!.debit, docTotals([line]).ttc)
})

test('receiving a purchase order adds stock and posts the supplier invoice', () => {
  const store = createStore()
  const next = advancePurchaseDoc(store, 'CF00001', '2026-10-01')
  assert.equal(stock(next, 'KIT-ELEC'), stock(store, 'KIT-ELEC') + 50)
  assert.equal(tiersBalance(next.entries, ACCOUNTS.suppliers, 'F0001'), round2(tiersBalance(store.entries, ACCOUNTS.suppliers, 'F0001') + 270))
})

test('warehouse analysis compares received supplier invoices with sales that actually moved stock', () => {
  const store = createStore()
  const row = (source: typeof store, ref: string) => supplierStockAnalysis(source).find((item) => item.ref === ref)!
  assert.deepEqual([row(store, 'ABAT-LIN').received, row(store, 'ABAT-LIN').sold, row(store, 'ABAT-LIN').balance, row(store, 'ABAT-LIN').stock], [40, 0, 40, 60])
  assert.deepEqual([row(store, 'LAMP-OPAL').received, row(store, 'LAMP-OPAL').sold, row(store, 'LAMP-OPAL').balance, row(store, 'LAMP-OPAL').stock], [0, 13, -13, 29])
})

test('insufficient stock is detected before a delivery', () => {
  const store = createStore()
  assert.equal(shortage(store, [{ ref: 'SUSP-LIN', qty: 999, price: 1, vat: 20 }]), 'SUSP-LIN')
  assert.equal(shortage(store, [{ ref: 'SUSP-LIN', qty: 1, price: 1, vat: 20 }]), undefined)
})

test('a production order consumes its components and adds the finished product', () => {
  const store = createStore()
  assert.equal(missingComponent(store, store.workOrders[0]), undefined)
  const next = completeWorkOrder(store, 'OF00001')
  assert.deepEqual(['LAMP-OPAL', 'ABAT-LIN', 'PIED-CHENE', 'KIT-ELEC'].map((ref) => stock(next, ref) - stock(store, ref)), [10, -10, -10, -10])
  assert.equal(completeWorkOrder(next, 'OF00001'), next)
  assert.equal(missingComponent(store, { ...store.workOrders[0], qty: 1000 }), 'ABAT-LIN')
})

test('lettrage matches an invoice with its payment and leaves unpaid invoices open', () => {
  const lettered = autoLetter(createStore())
  assert.deepEqual(lettered.entries.filter((entry) => entry.letter).map((entry) => entry.piece).sort(), ['BQ-0001', 'FA00001'])
  assert.equal(lettered.entries.find((entry) => entry.piece === 'FA00002' && entry.account === ACCOUNTS.clients)!.letter, undefined)
  assert.equal(autoLetter(lettered), lettered)
})

test('manual documents are numbered per journal', () => {
  const store = createStore()
  const line = [{ account: ACCOUNTS.bank, debit: 10, credit: 0 }, { account: '627000', debit: 0, credit: 10 }]
  const next = postPiece(postPiece(store, 'OD', '2026-10-01', 'a', line), 'OD', '2026-10-01', 'b', line)
  assert.deepEqual([...new Set(next.entries.slice(-4).map((entry) => entry.piece))], ['OD-0002', 'OD-0003'])
})

test('a supplier invoice typed as on paper creates supplier and items, receives stock and posts the debt', () => {
  // The paper invoice used as the reference example: 11 lines, 285 pieces, 3 160 000 in total, no VAT.
  const paper: [string, number, number][] = [
    ['C300 Kids', 15, 24500], ['C400 Kids', 15, 24500], ['C500 Kids', 15, 24500], ['I 17 Pro Max', 20, 35000], ['i17 Pro', 20, 22000], ['C5609', 50, 3500],
    ['C455', 25, 5500], ['ROUND XR', 50, 3500], ['C9920', 25, 6000], ['C8700', 25, 5500], ['MAX18 Pro', 25, 5700],
  ]
  const lines = paper.map(([article, qty, price]) => ({ article, qty, price }))
  // The supplier was already owed 10 548 200 before this invoice.
  let store = createEmptyStore('El Pacha', { currency: 'XAF', defaultVat: 0 })
  store = registerSupplierInvoice(store, { date: '2026-09-01', supplier: 'Tatang CALUS', lines: [{ article: 'Solde antérieur', qty: 1, price: 10548200 }] })
  assert.equal(tiersBalance(store.entries, ACCOUNTS.suppliers, 'F0001'), 10548200)

  const next = registerSupplierInvoice(store, { date: '2026-09-25', supplier: ' tatang  calus ', reference: 'N° 12', lines })
  assert.deepEqual(next.suppliers.map((supplier) => [supplier.code, supplier.name]), [['F0001', 'Tatang CALUS']])
  const invoice = next.purchaseDocs.at(-1)!
  assert.deepEqual([invoice.type, invoice.supplier, invoice.date, invoice.reference, invoice.posted, invoice.lines.length], ['facture', 'F0001', '2026-09-25', 'N° 12', true, 11])
  assert.deepEqual(docTotals(invoice.lines), { ht: 3160000, vat: 0, ttc: 3160000 })
  assert.equal(invoice.lines.reduce((total, line) => total + line.qty, 0), 285)
  assert.equal(tiersBalance(next.entries, ACCOUNTS.suppliers, 'F0001'), 13708200)

  const item = (name: string) => next.articles.find((article) => article.name === name)!
  assert.deepEqual([item('I 17 Pro Max').ref, item('i17 Pro').ref, item('ROUND XR').ref], ['I-17-PRO-MAX', 'I17-PRO', 'ROUND-XR'])
  assert.deepEqual([item('C5609').stock, item('C5609').cost, item('C5609').price, item('C5609').vat], [50, 3500, 3500, 0])
  // No VAT: the posting has two lines only, purchase against supplier, and balances.
  const posted = next.entries.filter((entry) => entry.piece === invoice.id)
  assert.deepEqual(posted.map((entry) => [entry.journal, entry.account, entry.debit, entry.credit, entry.label]), [
    ['ACH', ACCOUNTS.purchases, 3160000, 0, `${invoice.id} · N° 12 · Tatang CALUS`], ['ACH', ACCOUNTS.suppliers, 0, 3160000, `${invoice.id} · N° 12 · Tatang CALUS`],
  ])

  // A second delivery of a known item adds to its stock and updates its cost; nothing is duplicated.
  const again = registerSupplierInvoice(next, { date: '2026-09-26', supplier: 'Tatang CALUS', lines: [{ article: 'c5609', qty: 10, price: 3600 }, { article: '', qty: 5, price: 1 }, { article: 'Sans quantité', qty: 0, price: 1 }] })
  assert.equal(again.articles.length, next.articles.length)
  const restocked = again.articles.find((article) => article.name === 'C5609')!
  assert.deepEqual([restocked.stock, restocked.cost, restocked.price], [60, 3600, 3500])
  assert.equal(registerSupplierInvoice(next, { date: '2026-09-26', supplier: '', lines }), next)
  assert.deepEqual(fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(next)))).purchaseDocs.at(-1), invoice)
})

test('currency and default VAT belong to the company and survive saving', () => {
  const store = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(createEmptyStore('X', { currency: 'XAF', defaultVat: 0 })))))
  assert.deepEqual([store.currency, store.defaultVat], ['XAF', 0])
  assert.deepEqual([fromSnapshot({}).currency, fromSnapshot({}).defaultVat], ['EUR', 20])
})

test('company data survive the split into stored records and back', () => {
  const store = { ...autoLetter(createStore()), closedPeriods: ['2026-08'], reminders: { C0002: 2 }, groups: [{ name: 'Matin', activities: ['sc.comptoir'] }] }
  const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(store))))
  const sort = <T>(list: T[], key: keyof T) => [...list].sort((a, b) => String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true }))
  assert.deepEqual(restored.entries, store.entries)
  assert.deepEqual(restored.salesDocs, sort(store.salesDocs, 'id'))
  assert.deepEqual(restored.articles, sort(store.articles, 'ref'))
  assert.deepEqual([restored.company, restored.closedPeriods, restored.reminders, restored.groups], [store.company, store.closedPeriods, store.reminders, store.groups])
  assert.deepEqual(toSnapshot(restored), toSnapshot(store))
})

test('a new company starts with the chart of accounts and journals, and nothing else', () => {
  const store = fromSnapshot(toSnapshot(createEmptyStore('ACME SARL')))
  assert.equal(store.company, 'ACME SARL')
  assert.deepEqual([store.clients.length, store.entries.length, store.accounts.length, store.journals.length], [0, 0, 13, 5])
  assert.deepEqual(fromSnapshot({}).journals, [])
})

test('the Excel export is a valid archive with one sheet per list', () => {
  const archive = Buffer.from(buildXlsx([{ name: 'Clients', rows: [['Code', 'Solde'], ['C0001', 1360.8], ['Été & <Cie>', 0]] }, { name: 'Écritures', rows: [['Date']] }]))
  const end = archive.length - 22
  assert.equal(archive.readUInt32LE(end), 0x06054b50)
  const count = archive.readUInt16LE(end + 10)
  assert.equal(count, 7)
  const files = new Map<string, string>()
  let position = archive.readUInt32LE(end + 16)
  for (let index = 0; index < count; index += 1) {
    assert.equal(archive.readUInt32LE(position), 0x02014b50)
    const size = archive.readUInt32LE(position + 24)
    const nameLength = archive.readUInt16LE(position + 28)
    const name = archive.toString('utf8', position + 46, position + 46 + nameLength)
    const local = archive.readUInt32LE(position + 42)
    assert.equal(archive.readUInt32LE(local), 0x04034b50)
    const data = archive.subarray(local + 30 + nameLength, local + 30 + nameLength + size)
    assert.equal(crc32(data), archive.readUInt32LE(position + 16), name)
    files.set(name, data.toString('utf8'))
    position += 46 + nameLength
  }
  assert.ok(files.has('[Content_Types].xml') && files.has('xl/workbook.xml') && files.has('xl/worksheets/sheet2.xml'))
  const sheet = files.get('xl/worksheets/sheet1.xml')!
  assert.match(sheet, /<c r="B2"><v>1360\.8<\/v><\/c>/)
  assert.match(sheet, /Été &amp; &lt;Cie&gt;/)
  assert.match(files.get('xl/workbook.xml')!, /<sheet name="Écritures" sheetId="2"/)
})

test('a posted piece is cancelled by a reversing piece, never deleted', () => {
  let store = createStore()
  store = postPiece(store, 'OD', '2026-09-10', 'Erreur de saisie', [{ account: '627000', debit: 40, credit: 0 }, { account: ACCOUNTS.bank, debit: 0, credit: 40 }])
  const piece = store.entries.at(-1)!.piece
  const before = store.entries.length
  const reversed = reversePiece(store, piece, '2026-10-02')
  assert.equal(reversed.entries.length, before + 2)
  assert.deepEqual(reversed.entries.slice(0, before), store.entries)
  assert.deepEqual(reversed.entries.slice(-2).map((entry) => [entry.account, entry.debit, entry.credit, entry.date, entry.reverses]), [['627000', 0, 40, '2026-10-02', piece], [ACCOUNTS.bank, 40, 0, '2026-10-02', piece]])
  assert.equal(isReversed(reversed, piece), true)
  // Neither the cancelled piece nor its cancellation can be reversed again.
  assert.equal(reversePiece(reversed, piece, '2026-10-02'), reversed)
  assert.equal(reversePiece(reversed, reversed.entries.at(-1)!.piece, '2026-10-02'), reversed)
})
