import {
  accountsOf, addDays, autoLetter, isTiersAccount, nextNumber, postPiece, round2,
  type BankLine, type Entry, type Store, type SupplierInvoice,
} from './sageData.ts'

const period = (date: string) => date.slice(0, 7)
const sum = (values: number[]) => round2(values.reduce((total, value) => total + value, 0))
const balance = (entries: Entry[], prefix: string) => sum(entries.filter((entry) => entry.account.startsWith(prefix)).map((entry) => entry.debit - entry.credit))

/** Next unused lettrage code (AA, AB, …). */
function freeLetter(entries: Entry[]) {
  const used = new Set(entries.map((entry) => entry.letter))
  for (let index = 0; ; index += 1) {
    const code = String.fromCharCode(65 + Math.floor(index / 26) % 26) + String.fromCharCode(65 + index % 26)
    if (!used.has(code)) return code
  }
}

/* Supplier invoices */

export function filterSupplierInvoices(invoices: SupplierInvoice[], supplier?: string): SupplierInvoice[] {
  const selected = supplier?.trim().toLocaleLowerCase()
  return invoices
    .filter((invoice) => !selected || invoice.supplier.trim().toLocaleLowerCase() === selected)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export function saveSupplierInvoice(store: Store, invoice: Omit<SupplierInvoice, 'id' | 'status'> & { id?: string }): Store {
  if (invoice.id) return { ...store, supplierInvoices: store.supplierInvoices.map((item) => item.id === invoice.id ? { ...item, ...invoice, id: item.id } : item) }
  const id = nextNumber('FR', store.supplierInvoices.map((item) => item.id))
  return { ...store, supplierInvoices: [...store.supplierInvoices, { ...invoice, id, status: 'needs_review' }] }
}

/** What still prevents an invoice from being approved, as field names; empty when it is ready. */
export function missingInvoiceFields(invoice: SupplierInvoice) {
  return [
    !invoice.number.trim() && 'number', !invoice.supplier.trim() && 'supplier', !/^\d{4}-\d{2}-\d{2}$/.test(invoice.date) && 'date',
    !(invoice.amount > 0) && 'amount', !(invoice.vat >= 0 && invoice.vat < invoice.amount) && 'vat', !invoice.account && 'account',
  ].filter(Boolean) as string[]
}

/** Approval posts the invoice to the purchase journal: expense and deductible VAT against the supplier, created if unknown. */
export function approveSupplierInvoice(store: Store, id: string): Store {
  const invoice = store.supplierInvoices.find((item) => item.id === id)
  if (!invoice || invoice.status !== 'needs_review' || missingInvoiceFields(invoice).length) return store
  let next = store
  let supplier = next.suppliers.find((item) => item.name.trim().toLowerCase() === invoice.supplier.trim().toLowerCase())
  if (!supplier) {
    supplier = { code: nextNumber('F', next.suppliers.map((item) => item.code), 4), name: invoice.supplier.trim(), city: '' }
    next = { ...next, suppliers: [...next.suppliers, supplier] }
  }
  next = postPiece(next, 'ACH', invoice.date, `${invoice.number} · ${supplier.name}`, [
    { account: invoice.account, debit: round2(invoice.amount - invoice.vat), credit: 0 },
    { account: accountsOf(store).vatDeductible, debit: invoice.vat, credit: 0 },
    { account: accountsOf(store).suppliers, tiers: supplier.code, debit: 0, credit: invoice.amount, due: invoice.due || addDays(invoice.date, 30) },
  ])
  const piece = next.entries[next.entries.length - 1].piece
  return { ...next, supplierInvoices: next.supplierInvoices.map((item) => item.id === id ? { ...item, status: 'approved', piece } : item) }
}

export function rejectSupplierInvoice(store: Store, id: string): Store {
  return { ...store, supplierInvoices: store.supplierInvoices.map((item) => item.id === id && item.status === 'needs_review' ? { ...item, status: 'rejected' } : item) }
}

/* Bank reconciliation */

function parseAmount(raw: string) {
  const cleaned = raw.replace(/[^\d,.-]/g, '')
  if (!/\d/.test(cleaned)) return undefined
  const comma = cleaned.lastIndexOf(',')
  const dot = cleaned.lastIndexOf('.')
  // The last separator is the decimal one; the other, if any, groups thousands.
  const normalized = comma > dot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '')
  const value = Number(normalized)
  return Number.isFinite(value) ? round2(value) : undefined
}

function parseDate(raw: string) {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const european = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(raw)
  return european ? `${european[3]}-${european[2].padStart(2, '0')}-${european[1].padStart(2, '0')}` : undefined
}

function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else cell += character
  }
  return [...cells, cell.trim()]
}

/**
 * Reads a bank statement exported as CSV. Accepts `;`, `,` or tab as separator, dates as DD/MM/YYYY or YYYY-MM-DD,
 * and either one signed amount column or separate debit and credit columns. Lines without a date and an amount are skipped.
 */
export function parseBankCsv(text: string): Omit<BankLine, 'id'>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []
  const delimiter = [';', '\t', ','].map((candidate) => ({ candidate, count: lines[0].split(candidate).length })).sort((a, b) => b.count - a.count)[0].candidate
  const header = splitCsvLine(lines[0], delimiter).map((cell) => cell.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
  const debitColumn = header.findIndex((cell) => /^debit/.test(cell))
  const creditColumn = header.findIndex((cell) => /^credit/.test(cell))

  const result: Omit<BankLine, 'id'>[] = []
  for (const line of lines) {
    const cells = splitCsvLine(line, delimiter)
    const dateIndex = cells.findIndex((cell) => parseDate(cell))
    if (dateIndex < 0) continue
    let amount: number | undefined
    const used = new Set([dateIndex])
    if (debitColumn >= 0 && creditColumn >= 0) {
      amount = round2(Math.abs(parseAmount(cells[creditColumn] ?? '') ?? 0) - Math.abs(parseAmount(cells[debitColumn] ?? '') ?? 0))
      used.add(debitColumn).add(creditColumn)
    } else {
      for (let index = cells.length - 1; index >= 0 && amount === undefined; index -= 1) {
        if (index !== dateIndex && !parseDate(cells[index]) && /^[-+]?[\d\s., ]+(€|eur)?$/i.test(cells[index])) {
          amount = parseAmount(cells[index])
          used.add(index)
        }
      }
    }
    if (!amount) continue
    const label = cells.filter((cell, index) => !used.has(index) && cell && !parseDate(cell)).sort((a, b) => b.length - a.length)[0] ?? ''
    result.push({ date: parseDate(cells[dateIndex])!, label, amount })
  }
  return result
}

export function addBankLines(store: Store, lines: Omit<BankLine, 'id'>[]): Store {
  let bankLines = store.bankLines
  for (const line of lines) {
    // The same statement imported twice must not double the lines.
    if (bankLines.some((item) => item.date === line.date && item.label === line.label && item.amount === line.amount)) continue
    bankLines = [...bankLines, { ...line, id: nextNumber('BK', bankLines.map((item) => item.id)) }]
  }
  return { ...store, bankLines }
}

/** The open customer or supplier item a bank line most likely settles: same amount, preferring the one whose number is in the label. */
export function suggestBankMatch(store: Store, line: BankLine): Entry | undefined {
  const value = Math.abs(line.amount)
  const candidates = store.entries.filter((entry) => entry.tiers && !entry.letter && (line.amount > 0
    ? entry.account.startsWith('411') && entry.debit === value
    : entry.account.startsWith('401') && entry.credit === value))
  const label = line.label.toUpperCase()
  return candidates.find((entry) => label.includes(entry.piece.toUpperCase())) ?? candidates[0]
}

/** Posts the bank line against the open item and letters the two together. */
export function matchBankLine(store: Store, lineId: string, entryId: number): Store {
  const line = store.bankLines.find((item) => item.id === lineId)
  const open = store.entries.find((entry) => entry.id === entryId)
  if (!line || line.piece || !open?.tiers || open.letter) return store
  const value = Math.abs(line.amount)
  const counterpart = { account: open.account, tiers: open.tiers }
  const next = postPiece(store, 'BQ', line.date, line.label, line.amount > 0
    ? [{ account: accountsOf(store).bank, debit: value, credit: 0 }, { ...counterpart, debit: 0, credit: value }]
    : [{ ...counterpart, debit: value, credit: 0 }, { account: accountsOf(store).bank, debit: 0, credit: value }])
  const piece = next.entries[next.entries.length - 1].piece
  const settled = (open.debit || open.credit) === value
  const letter = freeLetter(next.entries)
  return {
    ...next,
    entries: settled ? next.entries.map((entry) => entry.id === open.id || (entry.piece === piece && entry.account === open.account) ? { ...entry, letter } : entry) : next.entries,
    bankLines: next.bankLines.map((item) => item.id === lineId ? { ...item, piece } : item),
  }
}

/** Posts a bank line that settles no invoice (fees, interest, transfers) against the chosen account. */
export function postBankLine(store: Store, lineId: string, account: string, tiers?: string): Store {
  const line = store.bankLines.find((item) => item.id === lineId)
  if (!line || line.piece || !account || (isTiersAccount(account) && !tiers)) return store
  const value = Math.abs(line.amount)
  const counterpart = { account, tiers }
  const next = postPiece(store, 'BQ', line.date, line.label, line.amount > 0
    ? [{ account: accountsOf(store).bank, debit: value, credit: 0 }, { ...counterpart, debit: 0, credit: value }]
    : [{ ...counterpart, debit: value, credit: 0 }, { account: accountsOf(store).bank, debit: 0, credit: value }])
  return { ...next, bankLines: next.bankLines.map((item) => item.id === lineId ? { ...item, piece: next.entries[next.entries.length - 1].piece } : item) }
}

/* Figures */

export type OpenItem = { entry: Entry; amount: number; due: string }

/**
 * Unpaid customer invoices ('411') or supplier invoices ('401'), oldest due date first, with what is left to pay.
 * Payments not yet lettered are deducted from the same party's oldest invoices, so the result does not depend on lettrage being up to date.
 */
export function openItems(store: Store, account: '411' | '401'): OpenItem[] {
  const unlettered = store.entries.filter((entry) => entry.account.startsWith(account) && entry.tiers && !entry.letter)
  const invoiced = (entry: Entry) => account === '411' ? entry.debit : entry.credit
  const paid = new Map<string, number>()
  for (const entry of unlettered) paid.set(entry.tiers!, round2((paid.get(entry.tiers!) ?? 0) + (account === '411' ? entry.credit : entry.debit)))
  const items: OpenItem[] = []
  for (const entry of unlettered.filter((item) => invoiced(item) > 0).sort((a, b) => (a.due ?? a.date).localeCompare(b.due ?? b.date))) {
    const settled = Math.min(paid.get(entry.tiers!) ?? 0, invoiced(entry))
    paid.set(entry.tiers!, round2((paid.get(entry.tiers!) ?? 0) - settled))
    const amount = round2(invoiced(entry) - settled)
    if (amount > 0) items.push({ entry, amount, due: entry.due ?? entry.date })
  }
  return items
}

export function overview(store: Store, today: string) {
  const month = period(today)
  const previous = period(addDays(`${month}-01`, -1))
  const revenue = (target: string) => -balance(store.entries.filter((entry) => period(entry.date) === target), '7')
  const receivables = openItems(store, '411')
  const payables = openItems(store, '401')
  return {
    revenue: revenue(month),
    previousRevenue: revenue(previous),
    receivables: sum(receivables.map((item) => item.amount)),
    receivablesCount: receivables.length,
    overdueReceivables: receivables.filter((item) => item.due < today).length,
    payables: sum(payables.map((item) => item.amount)),
    payablesCount: payables.length,
    cash: balance(store.entries, '5'),
    invoicesToReview: store.supplierInvoices.filter((invoice) => invoice.status === 'needs_review').length,
    bankToMatch: store.bankLines.filter((line) => !line.piece).length,
  }
}

export type ForecastWeek = { start: string; inflow: number; outflow: number; balance: number }

/** Cash position week by week: today's cash, plus customer invoices and minus supplier invoices at their due date. Overdue items fall in the first week. */
export function cashForecast(store: Store, today: string, weeks = 13): ForecastWeek[] {
  const receivables = openItems(store, '411')
  const payables = openItems(store, '401')
  let running = balance(store.entries, '5')
  return Array.from({ length: weeks }, (_, index) => {
    const start = addDays(today, index * 7)
    const end = addDays(start, 6)
    const inWeek = (item: OpenItem) => item.due <= end && (index === 0 || item.due >= start)
    const inflow = sum(receivables.filter(inWeek).map((item) => item.amount))
    const outflow = sum(payables.filter(inWeek).map((item) => item.amount))
    running = round2(running + inflow - outflow)
    return { start, inflow, outflow, balance: running }
  })
}

export type QualityIssue = { key: 'clientEmail' | 'clientCity' | 'supplierCity' | 'duplicateClient' | 'duplicateSupplier' | 'articleFamily' | 'articleCost' | 'articleMargin' | 'articleStock'; area: 'clients' | 'suppliers' | 'articles'; records: string[] }

/** Master-data checks. The score is the share of checks passed. */
export function dataQuality(store: Store): { score: number; checked: number; issues: QualityIssue[] } {
  const duplicates = (items: { name: string; label: string }[]) => {
    const seen = new Map<string, string[]>()
    for (const item of items) {
      const key = item.name.toLowerCase().replace(/\b(sas|sarl|sa|eurl|srl|spa)\b|[^a-z0-9]/g, '')
      if (key) seen.set(key, [...(seen.get(key) ?? []), item.label])
    }
    return [...seen.values()].filter((group) => group.length > 1).flat()
  }
  const client = (item: Store['clients'][number]) => `${item.code} · ${item.name}`
  const supplier = (item: Store['suppliers'][number]) => `${item.code} · ${item.name}`
  const article = (item: Store['articles'][number]) => `${item.ref} · ${item.name}`
  const issues: QualityIssue[] = [
    { key: 'clientEmail', area: 'clients', records: store.clients.filter((item) => !/^\S+@\S+\.\S+$/.test(item.email)).map(client) },
    { key: 'clientCity', area: 'clients', records: store.clients.filter((item) => !item.city.trim()).map(client) },
    { key: 'duplicateClient', area: 'clients', records: duplicates(store.clients.map((item) => ({ name: item.name, label: client(item) }))) },
    { key: 'supplierCity', area: 'suppliers', records: store.suppliers.filter((item) => !item.city.trim()).map(supplier) },
    { key: 'duplicateSupplier', area: 'suppliers', records: duplicates(store.suppliers.map((item) => ({ name: item.name, label: supplier(item) }))) },
    { key: 'articleFamily', area: 'articles', records: store.articles.filter((item) => !item.family.trim()).map(article) },
    { key: 'articleCost', area: 'articles', records: store.articles.filter((item) => !(item.cost > 0)).map(article) },
    { key: 'articleMargin', area: 'articles', records: store.articles.filter((item) => item.cost > 0 && item.price < item.cost).map(article) },
    { key: 'articleStock', area: 'articles', records: store.articles.filter((item) => item.stock < 0).map(article) },
  ]
  const checked = store.clients.length * 3 + store.suppliers.length * 2 + store.articles.length * 4
  const failed = issues.reduce((count, issue) => count + issue.records.length, 0)
  return { score: checked ? Math.max(0, Math.round(100 * (1 - failed / checked))) : 100, checked, issues: issues.filter((issue) => issue.records.length) }
}

export type ArticleAnalysis = { ref: string; name: string; family: string; registered: number; sold: number; consumed: number; remaining: number; revenue: number; stockValue: number }

/**
 * Per item: how many were registered, how many were sold, how many remain.
 * "Registered" is everything that ever entered stock (opening stock, purchases, production, stock-count gains), derived as
 * remaining + sold + consumed in production. With a month, `sold` and `revenue` cover that month only; the rest is to date.
 */
export function articleAnalysis(store: Store, month?: string): ArticleAnalysis[] {
  const shipped = store.salesDocs.filter((doc) => doc.stockMoved)
  const quantity = (docs: typeof shipped, ref: string) => docs.reduce((total, doc) => total + doc.lines.filter((line) => line.ref === ref).reduce((count, line) => count + line.qty, 0), 0)
  const inPeriod = month ? shipped.filter((doc) => period(doc.date) === month) : shipped
  return store.articles.map((article) => {
    const consumed = store.workOrders.filter((order) => order.done).reduce((total, order) =>
      total + (store.boms.find((bom) => bom.ref === order.ref)?.components.find((component) => component.ref === article.ref)?.qty ?? 0) * order.qty, 0)
    const revenue = sum(inPeriod.filter((doc) => doc.posted).flatMap((doc) => doc.lines.filter((line) => line.ref === article.ref).map((line) => line.qty * line.price)))
    return {
      ref: article.ref, name: article.name, family: article.family,
      registered: article.stock + quantity(shipped, article.ref) + consumed,
      sold: quantity(inPeriod, article.ref), consumed, remaining: article.stock, revenue, stockValue: round2(article.stock * article.cost),
    }
  })
}

/** Sales of one month (invoices and counter tickets): per day, in total, and per item, best seller first. */
export function monthlySales(store: Store, month: string) {
  const docs = store.salesDocs.filter((doc) => doc.posted && period(doc.date) === month)
  const [year, monthNumber] = month.split('-').map(Number)
  const days = Array.from({ length: new Date(year, monthNumber, 0).getDate() }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`
    const lines = docs.filter((doc) => doc.date === date).flatMap((doc) => doc.lines)
    return { date, revenue: sum(lines.map((line) => line.qty * line.price)), quantity: lines.reduce((total, line) => total + line.qty, 0) }
  })
  const articles = store.articles.map((article) => {
    const lines = docs.flatMap((doc) => doc.lines).filter((line) => line.ref === article.ref)
    return { ref: article.ref, name: article.name, quantity: lines.reduce((total, line) => total + line.qty, 0), revenue: sum(lines.map((line) => line.qty * line.price)), remaining: article.stock }
  }).filter((article) => article.quantity > 0).sort((a, b) => b.quantity - a.quantity)
  return { days, articles, documents: docs.length, revenue: sum(days.map((item) => item.revenue)), quantity: days.reduce((total, item) => total + item.quantity, 0) }
}

export const manualCloseTasks =['accruals', 'prepaid', 'payroll', 'cutoff'] as const

/** Month-end checks the software can verify by itself for a period (YYYY-MM). */
export function closeChecks(store: Store, month: string) {
  const entries = store.entries.filter((entry) => period(entry.date) === month)
  return {
    bank: store.bankLines.filter((line) => !line.piece && period(line.date) <= month).length === 0,
    invoices: store.supplierInvoices.filter((invoice) => invoice.status === 'needs_review' && period(invoice.date) <= month).length === 0,
    balanced: sum(entries.map((entry) => entry.debit)) === sum(entries.map((entry) => entry.credit)),
    lettering: autoLetter(store) === store,
  }
}

export function closeProgress(store: Store, month: string) {
  const checks = Object.values(closeChecks(store, month))
  const manual = (store.closeTasks[month] ?? []).filter((task) => (manualCloseTasks as readonly string[]).includes(task)).length
  return { done: checks.filter(Boolean).length + manual, total: checks.length + manualCloseTasks.length }
}
