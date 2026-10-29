import { countries, currencyDigits, docTotals, roundTo, salesTypes, type Client, type SalesDoc, type Store } from './sageData.ts'

/**
 * A sales document as it is printed, with the mentions the OHADA states' tax codes require on an invoice: seller's and
 * buyer's identity and tax identifiers, sequential number and date, lines with unit price and VAT rate, totals per rate,
 * and the amount in words (« Arrêtée la présente facture à la somme de … »), customary in Central Africa.
 */

const units = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const tens = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante']

/** 0–99 in words. `final`: nothing follows, so "quatre-vingts" takes its s. */
function belowHundred(value: number, final: boolean): string {
  if (value <= 16) return units[value]
  if (value < 20) return `dix-${units[value - 10]}`
  const ten = Math.floor(value / 10)
  const unit = value % 10
  // 70–79 and 90–99 count on from soixante and quatre-vingt.
  if (ten === 7 || ten === 9) {
    const base = ten === 7 ? 'soixante' : 'quatre-vingt'
    return ten === 7 && unit === 1 ? 'soixante et onze' : `${base}-${belowHundred(10 + unit, false)}`
  }
  if (ten === 8) return unit ? `quatre-vingt-${units[unit]}` : final ? 'quatre-vingts' : 'quatre-vingt'
  if (!unit) return tens[ten]
  return unit === 1 ? `${tens[ten]} et un` : `${tens[ten]}-${units[unit]}`
}

/** 0–999 in words. */
function belowThousand(value: number, final: boolean): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const restWords = rest ? belowHundred(rest, final) : ''
  if (!hundreds) return restWords
  const hundred = hundreds === 1 ? 'cent' : `${units[hundreds]} ${!rest && final ? 'cents' : 'cent'}`
  return rest ? `${hundred} ${restWords}` : hundred
}

/** A whole number in French words, in the traditional spelling (vingt et un, quatre-vingts, deux cents, mille). */
export function numberInWords(value: number): string {
  value = Math.floor(Math.abs(value))
  if (!value) return units[0]
  const parts: string[] = []
  const billions = Math.floor(value / 1e9)
  const millions = Math.floor(value / 1e6) % 1000
  const thousands = Math.floor(value / 1000) % 1000
  const rest = value % 1000
  // Million and milliard are nouns: the number before them keeps its plural s, and they take one themselves.
  if (billions) parts.push(`${numberInWords(billions)} ${billions > 1 ? 'milliards' : 'milliard'}`)
  if (millions) parts.push(`${belowThousand(millions, true)} ${millions > 1 ? 'millions' : 'million'}`)
  // Mille is invariable and is never preceded by "un".
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${belowThousand(thousands, false)} mille`)
  if (rest) parts.push(belowThousand(rest, true))
  return parts.join(' ')
}

const currencyNames: Record<string, [string, string]> = {
  XAF: ['franc CFA', 'francs CFA'], XOF: ['franc CFA', 'francs CFA'], CDF: ['franc congolais', 'francs congolais'],
  EUR: ['euro', 'euros'], USD: ['dollar américain', 'dollars américains'],
}

/** An amount in words with its currency, cents included for currencies that have them. */
export function amountInWords(amount: number, currency: string): string {
  const digits = currencyDigits(currency)
  const rounded = roundTo(Math.abs(amount), digits)
  const whole = Math.floor(rounded)
  const cents = Math.round((rounded - whole) * 10 ** digits)
  const [one, many] = currencyNames[currency] ?? [currency, currency]
  // "un million de francs": de after million and milliard when nothing follows them.
  const words = numberInWords(whole)
  const of = /(million|milliard)s?$/.test(words) ? ' de' : ''
  const main = `${words}${of} ${whole > 1 ? many : one}`
  return cents ? `${main} et ${numberInWords(cents)} ${cents > 1 ? 'centimes' : 'centime'}` : main
}

export type InvoiceRate = { rate: number; base: number; vat: number }

export function invoiceSheet(store: Store, doc: SalesDoc) {
  const country = countries.find((item) => item.code === store.country)
  const client: Client | undefined = store.clients.find((item) => item.code === doc.client)
  const totals = docTotals(doc.lines, store.currency)
  const rates: InvoiceRate[] = Array.from(new Set(doc.lines.map((line) => line.vat))).sort((a, b) => b - a)
    .map((rate) => {
      const { ht, vat } = docTotals(doc.lines.filter((line) => line.vat === rate), store.currency)
      return { rate, base: ht, vat }
    })
  // Cameroon's 19.25 % shows as principal VAT and the communes' surtax, as on the tax return.
  const surtax = country?.vatSurtax
  const digits = currencyDigits(store.currency)
  const vatParts = surtax && totals.vat
    ? (() => {
      const principal = roundTo(totals.vat / (1 + surtax.rate / 100), digits)
      return [{ label: 'TVA principal', amount: principal }, { label: surtax.label, amount: roundTo(totals.vat - principal, digits) }]
    })()
    : []
  const lines = doc.lines.map((line) => ({
    ...line,
    name: store.articles.find((article) => article.ref === line.ref)?.name ?? line.ref,
    total: roundTo(line.qty * line.price, digits),
  }))
  return {
    title: salesTypes[doc.type].fr,
    taxIdLabel: country?.taxIdLabel ?? 'NIF',
    client,
    lines,
    totals,
    rates,
    vatParts,
    words: amountInWords(totals.ttc, store.currency),
  }
}

/** Mentions an invoice cannot leave out, still missing from the company or customer record. */
export function missingMentions(store: Store, doc: SalesDoc): string[] {
  const info = store.companyInfo
  const taxIdLabel = countries.find((item) => item.code === store.country)?.taxIdLabel ?? 'NIF'
  const missing: string[] = []
  if (!info.address.trim()) missing.push('Adresse de l’entreprise')
  if (!info.taxId.trim()) missing.push(`${taxIdLabel} de l’entreprise`)
  if (!info.rccm.trim()) missing.push('RCCM de l’entreprise')
  if (doc.type === 'facture') {
    const client = store.clients.find((item) => item.code === doc.client)
    if (client && !client.taxId?.trim()) missing.push(`${taxIdLabel} du client`)
  }
  return missing
}
