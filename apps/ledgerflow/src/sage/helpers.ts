// Types and helpers shared by the screens of the three Sage 100 modules.
import { countries, vatRatesOf, isoDate, tiersKind, postPiece, round2, shortage, type DocLine, type PieceLine, type Store } from '../sageData'

export type Locale = 'en' | 'fr'
export type Ctx = {
  tr: (fr: string, en: string) => string
  store: Store
  apply: (next: Store) => void
  money: (amount: number) => string
  day: (date: string) => string
  notify: (message: string) => void
  audit: (action: string, record: string) => void
  closed: (date: string) => boolean
  /** Administrators alone may reopen a closed period. */
  admin: boolean
  savePdf?: (name: string) => void
}
export type ViewProps = { ctx: Ctx }
export type DraftLine = { ref: string; qty: string; price: string }

export const emptyLine: DraftLine = { ref: '', qty: '1', price: '' }
export const period = (date: string) => date.slice(0, 7)
export const sum = (values: number[]) => round2(values.reduce((total, value) => total + value, 0))

export function num(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseLines(store: Store, lines: DraftLine[]): DocLine[] {
  return lines.filter((line) => line.ref && num(line.qty) > 0).map((line) => ({
    ref: line.ref, qty: num(line.qty), price: num(line.price), vat: store.articles.find((article) => article.ref === line.ref)?.vat ?? store.defaultVat,
  }))
}

/** Rates offered in VAT lists: the usual ones, the company's own, and whatever the record already carries. */
export function vatRates(store: Store, current: string) {
  return Array.from(new Set([...vatRatesOf(store).map(String), String(store.defaultVat), current])).filter(Boolean).sort((a, b) => Number(a) - Number(b))
}

export function periodsOf(store: Store) {
  return Array.from(new Set([...store.entries.map((entry) => period(entry.date)), period(isoDate())])).sort()
}

export function tiersOptions(store: Store, account: string) {
  const kind = tiersKind(store, account)
  return kind ? store[kind] : []
}

export function stockAvailable(ctx: Ctx, lines: DocLine[]) {
  const missing = shortage(ctx.store, lines)
  if (missing) ctx.notify(ctx.tr(`Stock insuffisant pour ${missing}.`, `Not enough stock for ${missing}.`))
  return !missing
}

/** Asks before deleting; refuses, with the reason, when other records depend on this one. */
export function confirmDelete(ctx: Ctx, label: string, blocked: string | false) {
  if (blocked) {
    ctx.notify(blocked)
    return false
  }
  return window.confirm(ctx.tr(`Supprimer ${label} ?`, `Delete ${label}?`))
}

export function postManual(ctx: Ctx, journal: string, date: string, label: string, lines: PieceLine[]) {
  if (ctx.closed(date)) return false
  const next = postPiece(ctx.store, journal, date, label, lines)
  const piece = next.entries[next.entries.length - 1].piece
  ctx.apply(next)
  ctx.audit('Posted accounting piece', `${piece} · ${label}`)
  ctx.notify(ctx.tr(`Pièce ${piece} enregistrée dans le journal ${journal}.`, `Document ${piece} posted to journal ${journal}.`))
  return true
}

export const taxIdLabelOf = (store: Store) => countries.find((country) => country.code === store.country)?.taxIdLabel ?? 'NIF'
