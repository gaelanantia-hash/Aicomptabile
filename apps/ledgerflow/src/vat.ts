import { chartOf, countries, currencyDigits, docTotals, postPiece, roundTo, type Account, type ChartId, type Entry, type Store } from './sageData.ts'

/**
 * Monthly VAT return, built from the ledger so it always agrees with the accounts: VAT collected on 443 (4457), VAT
 * deductible on 445 (4456), the credit carried from earlier months, and what is left to pay. The detail by rate comes
 * from the sales documents; whatever was posted by hand appears on its own line so the totals still match the ledger.
 */

/** Where the monthly settlement puts the balance: VAT to pay, or the credit carried to the next month. */
const settlementAccounts: Record<ChartId, { payable: Account; credit: Account }> = {
  syscohada: { payable: { number: '444100', label: 'État, TVA due' }, credit: { number: '444900', label: 'État, crédit de TVA à reporter' } },
  pcg: { payable: { number: '445510', label: 'TVA à décaisser' }, credit: { number: '445670', label: 'Crédit de TVA à reporter' } },
}
const settlementOf = (store: Pick<Store, 'chart'>) => settlementAccounts[store.chart in settlementAccounts ? store.chart : 'pcg']

export type VatRateLine = { rate: number; base: number; vat: number }
export type VatReturn = {
  period: string
  sales: VatRateLine[]
  /** Sales posted without a document (manual entries): their base and VAT, so the detail adds up to the ledger. */
  otherSales: { base: number; vat: number }
  salesBase: number
  collected: number
  /** Deductible VAT per account (goods, services, fixed assets…). */
  deductibleByAccount: { account: string; label: string; amount: number }[]
  deductible: number
  previousCredit: number
  /** Positive: VAT to pay. Negative: credit carried to next month. */
  balance: number
  /** How the amount to pay splits between the State and the surtaxes included in the rate (Cameroon's CAC), when the country has any. */
  components: { label: string; amount: number }[]
  /** Last day to file and pay, as the country's usual rule gives it; to be checked against the year's finance law. */
  due?: string
  /** Piece that settled this month's VAT, once posted. */
  settled?: string
}

const month = (entry: Entry) => entry.date.slice(0, 7)
const nextMonth = (period: string) => {
  const [year, monthOfYear] = period.split('-').map(Number)
  return monthOfYear === 12 ? `${year + 1}-01` : `${year}-${String(monthOfYear + 1).padStart(2, '0')}`
}

/** Pieces that settle a month's VAT: they move VAT between accounts and must not count as VAT collected or deductible. */
function settlementPieces(store: Pick<Store, 'chart' | 'entries'>) {
  const { payable, credit } = settlementOf(store)
  return new Set(store.entries.filter((entry) => entry.account === payable.number || entry.account === credit.number).map((entry) => entry.piece))
}

function monthMovements(store: Pick<Store, 'chart' | 'entries'>, period: string, excluded: Set<string>) {
  const { prefixes } = chartOf(store)
  const lines = store.entries.filter((entry) => month(entry) === period && !excluded.has(entry.piece))
  const sum = (accept: (entry: Entry) => boolean, value: (entry: Entry) => number) => lines.filter(accept).reduce((total, entry) => total + value(entry), 0)
  return {
    lines,
    collected: sum((entry) => entry.account.startsWith(prefixes.vatCollected), (entry) => entry.credit - entry.debit),
    deductible: sum((entry) => entry.account.startsWith(prefixes.vatDeductible), (entry) => entry.debit - entry.credit),
    salesBase: sum((entry) => entry.account.startsWith('70'), (entry) => entry.credit - entry.debit),
  }
}

/** Credit left over from the months before `period`, each month's credit carried to the next. */
function creditBefore(store: Pick<Store, 'chart' | 'entries'>, period: string, excluded: Set<string>, digits: number) {
  const months = Array.from(new Set(store.entries.map(month))).filter((item) => item < period).sort()
  let credit = 0
  if (!months.length) return 0
  for (let current = months[0]; current < period; current = nextMonth(current)) {
    const { collected, deductible } = monthMovements(store, current, excluded)
    credit = Math.max(roundTo(deductible + credit - collected, digits), 0)
  }
  return credit
}

/** The first month before `period` with VAT that was never settled: months are settled in order, so the carried credit stays right. */
export function unsettledBefore(store: Store, period: string) {
  const excluded = settlementPieces(store)
  const settled = new Set(store.entries.filter((entry) => excluded.has(entry.piece)).map(month))
  const months = Array.from(new Set(store.entries.map(month))).filter((item) => item < period && !settled.has(item)).sort()
  return months.find((item) => {
    const { collected, deductible } = monthMovements(store, item, excluded)
    return Math.abs(collected) >= 0.005 || Math.abs(deductible) >= 0.005
  })
}

export function vatReturn(store: Store, period: string): VatReturn {
  const digits = currencyDigits(store.currency)
  const round = (value: number) => roundTo(value, digits)
  const excluded = settlementPieces(store)
  const { lines, collected, deductible, salesBase } = monthMovements(store, period, excluded)

  const byRate = new Map<number, VatRateLine>()
  for (const doc of store.salesDocs.filter((item) => item.posted && (item.type === 'facture' || item.type === 'ticket') && item.date.startsWith(period))) {
    for (const rate of new Set(doc.lines.map((line) => line.vat))) {
      const { ht, vat } = docTotals(doc.lines.filter((line) => line.vat === rate), store.currency)
      const line = byRate.get(rate) ?? { rate, base: 0, vat: 0 }
      byRate.set(rate, { rate, base: round(line.base + ht), vat: round(line.vat + vat) })
    }
  }
  const sales = [...byRate.values()].sort((a, b) => b.rate - a.rate)
  const documented = sales.reduce((total, line) => ({ base: total.base + line.base, vat: total.vat + line.vat }), { base: 0, vat: 0 })

  const { prefixes } = chartOf(store)
  const byAccount = new Map<string, number>()
  for (const entry of lines.filter((item) => item.account.startsWith(prefixes.vatDeductible))) byAccount.set(entry.account, (byAccount.get(entry.account) ?? 0) + entry.debit - entry.credit)
  const deductibleByAccount = [...byAccount].filter(([, amount]) => round(amount) !== 0).sort(([a], [b]) => a.localeCompare(b))
    .map(([account, amount]) => ({ account, label: store.accounts.find((item) => item.number === account)?.label ?? account, amount: round(amount) }))

  const previousCredit = creditBefore(store, period, excluded, digits)
  const balance = round(collected - deductible - previousCredit)
  const country = countries.find((item) => item.code === store.country)
  const surtax = country?.vatSurtax
  const principal = surtax ? round(balance / (1 + surtax.rate / 100)) : balance
  const components = surtax && balance > 0 ? [{ label: 'TVA principal', amount: principal }, { label: surtax.label, amount: round(balance - principal) }] : []
  const settled = store.entries.find((entry) => excluded.has(entry.piece) && entry.date.startsWith(period))?.piece
  return {
    period, sales, otherSales: { base: round(salesBase - documented.base), vat: round(collected - documented.vat) }, salesBase: round(salesBase), collected: round(collected),
    deductibleByAccount, deductible: round(deductible), previousCredit, balance, components,
    due: country?.vatDueDay ? `${nextMonth(period)}-${String(country.vatDueDay).padStart(2, '0')}` : undefined,
    settled,
  }
}

/**
 * Posts the month's VAT settlement on its last day: collected and deductible VAT are cleared into VAT to pay (4441 /
 * 44551) or into the credit carried forward (4449 / 44567). Once posted, the month is marked settled and not posted again.
 */
export function settleVat(store: Store, period: string): Store {
  const declaration = vatReturn(store, period)
  if (declaration.settled || (!declaration.collected && !declaration.deductible) || unsettledBefore(store, period)) return store
  const { prefixes } = chartOf(store)
  const { payable, credit } = settlementOf(store)
  const excluded = settlementPieces(store)
  const perAccount = new Map<string, number>()
  for (const entry of store.entries.filter((item) => month(item) === period && !excluded.has(item.piece) && (item.account.startsWith(prefixes.vatCollected) || item.account.startsWith(prefixes.vatDeductible)))) {
    perAccount.set(entry.account, (perAccount.get(entry.account) ?? 0) + entry.debit - entry.credit)
  }
  const digits = currencyDigits(store.currency)
  // Each VAT account is brought back to zero for the month; the difference goes to the State or to the carried credit.
  const lines = [...perAccount].map(([account, balance]) => ({ account, debit: balance < 0 ? roundTo(-balance, digits) : 0, credit: balance > 0 ? roundTo(balance, digits) : 0 }))
    .filter((line) => line.debit || line.credit)
  const newCredit = Math.max(-declaration.balance, 0)
  const creditChange = roundTo(newCredit - declaration.previousCredit, digits)
  if (declaration.balance > 0) lines.push({ account: payable.number, debit: 0, credit: declaration.balance })
  if (creditChange) lines.push({ account: credit.number, debit: Math.max(creditChange, 0), credit: Math.max(-creditChange, 0) })
  const missing = [payable, credit].filter((account) => !store.accounts.some((item) => item.number === account.number))
  const withAccounts = missing.length ? { ...store, accounts: [...store.accounts, ...missing].sort((a, b) => a.number.localeCompare(b.number)) } : store
  const [year, monthOfYear] = period.split('-').map(Number)
  const lastDay = `${period}-${String(new Date(year, monthOfYear, 0).getDate()).padStart(2, '0')}`
  return postPiece(withAccounts, 'OD', lastDay, `Liquidation de la TVA ${period}`, lines)
}
