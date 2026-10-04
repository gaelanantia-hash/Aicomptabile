import { accountsOf, currencyDigits, nextNumber, postPiece, roundTo, type Account, type Entry, type EntryOrigin, type FixedAsset, type PieceLine, type Store, type YearEnd } from './sageData.ts'

/**
 * Year-end closing under SYSCOHADA, in the order an accountant runs it:
 *   1. depreciation of fixed assets (681 / 28), straight-line and pro rata temporis;
 *   2. stock count: variation of goods for resale (6031 / 311) between opening and closing stock;
 *   3. result: classes 6, 7 and 8 are closed into 131 (profit) or 139 (loss), and every month of the year is locked;
 *   4. the next year, once the shareholders have decided, the result moves to retained earnings (121 / 129).
 * Each step posts one piece dated 31 December (the assignment excepted), recorded in `store.yearEnd` so it never runs twice.
 */


export const YEAR_END_ACCOUNTS = {
  goods: '311000', stockVariation: '603100', intangibleDepreciation: '681200', tangibleDepreciation: '681300',
  profit: '131000', loss: '139000', retainedProfit: '121000', retainedLoss: '129000', investmentSuppliers: '481200',
}

/** Accounts the closing steps may post to, added to the company's chart when first needed. */
const yearEndAccounts: Account[] = [
  { number: '121000', label: 'Report à nouveau créditeur' },
  { number: '129000', label: 'Report à nouveau débiteur' },
  { number: '131000', label: 'Résultat net : bénéfice' },
  { number: '139000', label: 'Résultat net : perte' },
  { number: '311000', label: 'Marchandises' },
  { number: '481200', label: 'Fournisseurs d’investissements, immobilisations corporelles' },
  { number: '603100', label: 'Variations des stocks de marchandises' },
  { number: '681200', label: 'Dotations aux amortissements des immobilisations incorporelles' },
  { number: '681300', label: 'Dotations aux amortissements des immobilisations corporelles' },
]

/** Fixed-asset accounts offered when registering an asset. */
export const assetAccounts: Account[] = [
  { number: '213000', label: 'Logiciels et sites internet' },
  { number: '223000', label: 'Terrains bâtis' },
  { number: '231000', label: 'Bâtiments sur sol propre' },
  { number: '241000', label: 'Matériel et outillage industriel et commercial' },
  { number: '244100', label: 'Matériel de bureau' },
  { number: '244200', label: 'Matériel informatique' },
  { number: '244400', label: 'Mobilier de bureau' },
  { number: '245000', label: 'Matériel de transport' },
]

/** SYSCOHADA keeps each depreciation in the 28 account mirroring the asset: 2442 → 2844. Land (22) is not depreciated. */
export const depreciationAccount = (account: string) => `28${account.slice(1, 3)}00`
export const isDepreciable = (asset: FixedAsset) => asset.years > 0 && !asset.account.startsWith('22')

function withAccounts(store: Store, accounts: Account[]): Store {
  const missing = accounts.filter((account) => !store.accounts.some((item) => item.number === account.number))
  return missing.length ? { ...store, accounts: [...store.accounts, ...missing].sort((a, b) => a.number.localeCompare(b.number)) } : store
}

function withJournal(store: Store): Store {
  return store.journals.some((journal) => journal.code === 'CL') ? store : { ...store, journals: [...store.journals, { code: 'CL', label: 'Clôture et affectation du résultat', type: 'general' }] }
}

/** Posts a year-end piece and marks its lines with where they come from, so they are never reversed by hand nor counted twice. */
function postYearEnd(store: Store, journal: string, date: string, label: string, lines: PieceLine[], origin: EntryOrigin) {
  const next = postPiece(store, journal, date, label, lines)
  const piece = next.entries[next.entries.length - 1].piece
  return { store: { ...next, entries: next.entries.map((entry) => entry.piece === piece ? { ...entry, origin } : entry) }, piece }
}

const yearEndOf = (store: Store, year: number): YearEnd => store.yearEnd[String(year)] ?? {}
const setYearEnd = (store: Store, year: number, change: YearEnd): Store => ({ ...store, yearEnd: { ...store.yearEnd, [String(year)]: { ...yearEndOf(store, year), ...change } } })
const lastDay = (year: number) => `${year}-12-31`
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000
const daysInYear = (year: number) => dayNumber(`${year + 1}-01-01`) - dayNumber(`${year}-01-01`)

export function registerAsset(store: Store, asset: Omit<FixedAsset, 'id'>, counterpart?: 'bank' | 'cash' | 'supplier'): Store {
  const id = nextNumber('IM', store.assets.map((item) => item.id), 4)
  const account = assetAccounts.find((item) => item.number === asset.account)
  let next = withAccounts(store, [...(account ? [account] : []), ...yearEndAccounts])
  next = { ...next, assets: [...next.assets, { ...asset, id }] }
  if (!counterpart) return next
  const credit = counterpart === 'supplier' ? YEAR_END_ACCOUNTS.investmentSuppliers : accountsOf(store)[counterpart]
  return postPiece(next, 'OD', asset.acquired, `Acquisition ${id} · ${asset.label}`, [{ account: asset.account, debit: asset.cost, credit: 0 }, { account: credit, debit: 0, credit: asset.cost }])
}

/**
 * Depreciation per financial year: cost / useful life, the first year pro rata from the acquisition date (actual days),
 * each year rounded to the currency, the last year taking whatever remains so the total equals the cost exactly.
 */
export function depreciationSchedule(asset: FixedAsset, currency: string): { year: number; amount: number; accumulated: number }[] {
  if (!isDepreciable(asset) || !(asset.cost > 0)) return []
  const digits = currencyDigits(currency)
  const annual = asset.cost / asset.years
  const schedule: { year: number; amount: number; accumulated: number }[] = []
  let accumulated = 0
  for (let year = Number(asset.acquired.slice(0, 4)); accumulated < asset.cost; year += 1) {
    const start = Math.max(dayNumber(asset.acquired), dayNumber(`${year}-01-01`))
    const share = (dayNumber(`${year + 1}-01-01`) - start) / daysInYear(year)
    const amount = Math.min(roundTo(annual * share, digits), roundTo(asset.cost - accumulated, digits))
    accumulated = roundTo(accumulated + amount, digits)
    schedule.push({ year, amount, accumulated })
    if (schedule.length > asset.years + 1) break
  }
  return schedule
}

export const depreciationFor = (store: Store, year: number) => store.assets
  .map((asset) => ({ asset, amount: depreciationSchedule(asset, store.currency).find((line) => line.year === year)?.amount ?? 0 }))
  .filter((line) => line.amount > 0)

/** Step 1: one piece with every asset's depreciation for the year. */
export function postDepreciation(store: Store, year: number): Store {
  const lines = depreciationFor(store, year)
  if (yearEndOf(store, year).depreciation || !lines.length) return store
  let next = withAccounts(store, [
    ...yearEndAccounts,
    ...lines.map(({ asset }) => ({ number: depreciationAccount(asset.account), label: `Amortissements · ${store.accounts.find((item) => item.number === asset.account)?.label ?? asset.account}` })),
  ])
  const posted = postYearEnd(next, 'OD', lastDay(year), `Dotations aux amortissements ${year}`, lines.flatMap(({ asset, amount }) => [
    { account: asset.account.startsWith('21') ? YEAR_END_ACCOUNTS.intangibleDepreciation : YEAR_END_ACCOUNTS.tangibleDepreciation, debit: amount, credit: 0 },
    { account: depreciationAccount(asset.account), debit: 0, credit: amount },
  ]), 'depreciation')
  next = setYearEnd(posted.store, year, { depreciation: posted.piece })
  return next
}

const balanceAt = (entries: Entry[], prefix: string, date: string) => entries.filter((entry) => entry.account.startsWith(prefix) && entry.date <= date).reduce((total, entry) => total + entry.debit - entry.credit, 0)

/** Goods for resale as recorded in the books at year end (account 31), before the stock-count entry. */
export const openingStock = (store: Store, year: number) => roundTo(balanceAt(store.entries, '31', lastDay(year)), currencyDigits(store.currency))

/** What the items list is worth at cost today: the default proposed for the stock count. */
export const stockValuation = (store: Store) => roundTo(store.articles.reduce((total, article) => total + Math.max(article.stock, 0) * article.cost, 0), currencyDigits(store.currency))

/** Step 2: brings account 31 to the counted closing stock; the difference goes to 6031 (variation of goods). */
export function postInventory(store: Store, year: number, closingStock: number): Store {
  if (yearEndOf(store, year).inventory || !(closingStock >= 0)) return store
  const difference = roundTo(closingStock - openingStock(store, year), currencyDigits(store.currency))
  const next = withJournal(withAccounts(store, yearEndAccounts))
  if (!difference) return setYearEnd(next, year, { inventory: '—', closingStock })
  const { goods, stockVariation } = YEAR_END_ACCOUNTS
  const posted = postYearEnd(next, 'OD', lastDay(year), `Variation des stocks de marchandises ${year}`, difference > 0
    ? [{ account: goods, debit: difference, credit: 0 }, { account: stockVariation, debit: 0, credit: difference }]
    : [{ account: stockVariation, debit: -difference, credit: 0 }, { account: goods, debit: 0, credit: -difference }], 'inventory')
  return setYearEnd(posted.store, year, { inventory: posted.piece, closingStock })
}

const isResultAccount = (account: string) => /^[678]/.test(account)

/** Step 3: closes every income and expense account of the year into 131 or 139 and locks the twelve months. */
export function closeYear(store: Store, year: number): Store {
  if (yearEndOf(store, year).closing) return store
  const balances = new Map<string, number>()
  for (const entry of store.entries) {
    if (Number(entry.date.slice(0, 4)) === year && isResultAccount(entry.account)) balances.set(entry.account, (balances.get(entry.account) ?? 0) + entry.debit - entry.credit)
  }
  const digits = currencyDigits(store.currency)
  const lines: PieceLine[] = [...balances].map(([account, balance]) => [account, roundTo(balance, digits)] as const)
    .filter(([, balance]) => balance !== 0)
    .map(([account, balance]) => ({ account, debit: balance < 0 ? -balance : 0, credit: balance > 0 ? balance : 0 }))
  const result = roundTo(-[...balances.values()].reduce((total, balance) => total + balance, 0), digits)
  const { profit, loss } = YEAR_END_ACCOUNTS
  let next = withJournal(withAccounts(store, yearEndAccounts))
  let piece = '—'
  if (lines.length) {
    const posted = postYearEnd(next, 'CL', lastDay(year), `Détermination du résultat ${year}`, [
      ...lines, result >= 0 ? { account: profit, debit: 0, credit: result } : { account: loss, debit: -result, credit: 0 },
    ], 'closing')
    next = posted.store
    piece = posted.piece
  }
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  next = { ...next, closedPeriods: Array.from(new Set([...next.closedPeriods, ...months])).sort() }
  return setYearEnd(next, year, { closing: piece, result })
}

/** Step 4: after the shareholders' decision, moves the closed year's result to retained earnings (121 profit, 129 loss). */
export function assignResult(store: Store, year: number, date: string): Store {
  const state = yearEndOf(store, year)
  if (!state.closing || state.assignment || state.result === undefined || date <= lastDay(year)) return store
  if (!state.result) return setYearEnd(store, year, { assignment: '—' })
  const { profit, loss, retainedProfit, retainedLoss } = YEAR_END_ACCOUNTS
  const posted = postYearEnd(withJournal(withAccounts(store, yearEndAccounts)), 'CL', date, `Affectation du résultat ${year} en report à nouveau`, state.result > 0
    ? [{ account: profit, debit: state.result, credit: 0 }, { account: retainedProfit, debit: 0, credit: state.result }]
    : [{ account: retainedLoss, debit: -state.result, credit: 0 }, { account: loss, debit: 0, credit: -state.result }], 'assignment')
  return setYearEnd(posted.store, year, { assignment: posted.piece })
}

/** Where a year stands: what is done, what is still to do. */
export function yearEndStatus(store: Store, year: number) {
  const state = yearEndOf(store, year)
  return {
    ...state,
    needsDepreciation: depreciationFor(store, year).length > 0,
    previousOpen: store.entries.some((entry) => Number(entry.date.slice(0, 4)) === year - 1) && !yearEndOf(store, year - 1).closing,
  }
}
