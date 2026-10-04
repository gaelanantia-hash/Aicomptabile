import { round2, type Entry, type Store } from './sageData.ts'

/**
 * Financial statements of the revised SYSCOHADA (Système comptable OHADA, in force since 2018): balance sheet and income statement,
 * with the official line references (AD, BI, CJ, TA, XA, …). The financial year is the calendar year, as the Uniform Act requires.
 * Amounts come straight from the ledger; stock variations (603) are only included once they have been posted.
 */

export type StatementLine = { ref: string; label: string; amount: number; total?: boolean }

/** `side`: which balance of an account feeds the line ('debit' for assets, 'credit' for liabilities, 'any' for both signs). */
type Rule = { ref: string; label: string; prefixes: string[]; side: 'debit' | 'credit' | 'any' }

const assetRules: Rule[] = [
  { ref: 'AD', label: 'Immobilisations incorporelles', prefixes: ['21', '281', '291'], side: 'any' },
  { ref: 'AI', label: 'Immobilisations corporelles', prefixes: ['22', '23', '24', '282', '283', '284', '292', '293', '294'], side: 'any' },
  { ref: 'AP', label: 'Avances et acomptes versés sur immobilisations', prefixes: ['25'], side: 'any' },
  { ref: 'AQ', label: 'Immobilisations financières', prefixes: ['26', '27', '296', '297'], side: 'any' },
  { ref: 'BA', label: 'Actif circulant HAO', prefixes: ['485', '488'], side: 'debit' },
  { ref: 'BB', label: 'Stocks et encours', prefixes: ['3'], side: 'any' },
  { ref: 'BH', label: 'Fournisseurs, avances versées', prefixes: ['409'], side: 'debit' },
  { ref: 'BI', label: 'Clients', prefixes: ['41', '491'], side: 'debit' },
  { ref: 'BJ', label: 'Autres créances', prefixes: ['40', '42', '43', '44', '45', '46', '47', '48', '49'], side: 'debit' },
  { ref: 'BQ', label: 'Titres de placement', prefixes: ['50'], side: 'debit' },
  { ref: 'BR', label: 'Valeurs à encaisser', prefixes: ['51'], side: 'debit' },
  { ref: 'BS', label: 'Banques, chèques postaux, caisse et assimilés', prefixes: ['52', '53', '54', '55', '57', '58'], side: 'debit' },
]

const liabilityRules: Rule[] = [
  { ref: 'CA', label: 'Capital', prefixes: ['101', '102', '103', '104'], side: 'any' },
  { ref: 'CB', label: 'Apporteurs capital non appelé (−)', prefixes: ['109'], side: 'any' },
  { ref: 'CD', label: 'Primes liées au capital social', prefixes: ['105'], side: 'any' },
  { ref: 'CE', label: 'Écarts de réévaluation', prefixes: ['106'], side: 'any' },
  { ref: 'CF', label: 'Réserves indisponibles', prefixes: ['111', '112'], side: 'any' },
  { ref: 'CG', label: 'Réserves libres', prefixes: ['113', '118'], side: 'any' },
  { ref: 'CH', label: 'Report à nouveau (+ ou −)', prefixes: ['12'], side: 'any' },
  { ref: 'CJ', label: 'Résultat net de l’exercice (bénéfice + ou perte −)', prefixes: ['13'], side: 'any' },
  { ref: 'CL', label: 'Subventions d’investissement', prefixes: ['14'], side: 'any' },
  { ref: 'CM', label: 'Provisions réglementées', prefixes: ['15'], side: 'any' },
  { ref: 'DA', label: 'Emprunts et dettes financières diverses', prefixes: ['16', '18'], side: 'any' },
  { ref: 'DB', label: 'Dettes de location-acquisition', prefixes: ['17'], side: 'any' },
  { ref: 'DC', label: 'Provisions pour risques et charges', prefixes: ['19'], side: 'any' },
  { ref: 'DH', label: 'Dettes circulantes HAO', prefixes: ['481', '482', '484'], side: 'credit' },
  { ref: 'DI', label: 'Clients, avances reçues', prefixes: ['419', '41'], side: 'credit' },
  { ref: 'DJ', label: 'Fournisseurs d’exploitation', prefixes: ['40'], side: 'credit' },
  { ref: 'DK', label: 'Dettes fiscales et sociales', prefixes: ['42', '43', '44'], side: 'credit' },
  { ref: 'DM', label: 'Autres dettes', prefixes: ['45', '46', '47', '48'], side: 'credit' },
  { ref: 'DN', label: 'Provisions pour risques à court terme', prefixes: ['499'], side: 'credit' },
  { ref: 'DQ', label: 'Banques, crédits d’escompte', prefixes: ['565'], side: 'credit' },
  { ref: 'DR', label: 'Banques, établissements financiers et crédits de trésorerie', prefixes: ['52', '53', '56', '57', '58'], side: 'credit' },
]

/** Income statement lines: `sign` 1 for income (credit balance), −1 for expenses (debit balance). */
const incomeRules: { ref: string; label: string; prefixes: string[]; sign: 1 | -1 }[] = [
  { ref: 'TA', label: 'Ventes de marchandises', prefixes: ['701'], sign: 1 },
  { ref: 'RA', label: 'Achats de marchandises', prefixes: ['601'], sign: -1 },
  { ref: 'RB', label: 'Variation de stocks de marchandises', prefixes: ['6031'], sign: -1 },
  { ref: 'TB', label: 'Ventes de produits fabriqués', prefixes: ['702', '703', '704'], sign: 1 },
  { ref: 'TC', label: 'Travaux, services vendus', prefixes: ['705', '706'], sign: 1 },
  { ref: 'TD', label: 'Produits accessoires', prefixes: ['707'], sign: 1 },
  { ref: 'TE', label: 'Production stockée (ou déstockage)', prefixes: ['73'], sign: 1 },
  { ref: 'TF', label: 'Production immobilisée', prefixes: ['72'], sign: 1 },
  { ref: 'TG', label: 'Subventions d’exploitation', prefixes: ['71'], sign: 1 },
  { ref: 'TH', label: 'Autres produits', prefixes: ['75'], sign: 1 },
  { ref: 'TI', label: 'Transferts de charges d’exploitation', prefixes: ['781'], sign: 1 },
  { ref: 'RC', label: 'Achats de matières premières et fournitures liées', prefixes: ['602'], sign: -1 },
  { ref: 'RD', label: 'Variation de stocks de matières premières', prefixes: ['6032'], sign: -1 },
  { ref: 'RE', label: 'Autres achats', prefixes: ['604', '605', '608'], sign: -1 },
  { ref: 'RF', label: 'Variation de stocks d’autres approvisionnements', prefixes: ['6033'], sign: -1 },
  { ref: 'RG', label: 'Transports', prefixes: ['61'], sign: -1 },
  { ref: 'RH', label: 'Services extérieurs', prefixes: ['62', '63'], sign: -1 },
  { ref: 'RI', label: 'Impôts et taxes', prefixes: ['64'], sign: -1 },
  { ref: 'RJ', label: 'Autres charges', prefixes: ['65'], sign: -1 },
  { ref: 'RK', label: 'Charges de personnel', prefixes: ['66'], sign: -1 },
  { ref: 'TJ', label: 'Reprises d’amortissements, provisions et dépréciations', prefixes: ['791', '798', '799'], sign: 1 },
  { ref: 'RL', label: 'Dotations aux amortissements, provisions et dépréciations', prefixes: ['681', '691'], sign: -1 },
  { ref: 'TK', label: 'Revenus financiers et assimilés', prefixes: ['77'], sign: 1 },
  { ref: 'TL', label: 'Reprises de provisions et dépréciations financières', prefixes: ['797'], sign: 1 },
  { ref: 'TM', label: 'Transferts de charges financières', prefixes: ['787'], sign: 1 },
  { ref: 'RM', label: 'Frais financiers et charges assimilées', prefixes: ['67'], sign: -1 },
  { ref: 'RN', label: 'Dotations aux provisions et dépréciations financières', prefixes: ['697'], sign: -1 },
  { ref: 'TN', label: 'Produits des cessions d’immobilisations', prefixes: ['82'], sign: 1 },
  { ref: 'TO', label: 'Autres produits HAO', prefixes: ['84', '86', '88'], sign: 1 },
  { ref: 'RO', label: 'Valeurs comptables des cessions d’immobilisations', prefixes: ['81'], sign: -1 },
  { ref: 'RP', label: 'Autres charges HAO', prefixes: ['83', '85'], sign: -1 },
  { ref: 'RQ', label: 'Participation des travailleurs', prefixes: ['87'], sign: -1 },
  { ref: 'RS', label: 'Impôts sur le résultat', prefixes: ['89'], sign: -1 },
]

/** The rule whose prefix matches the account most precisely, among those that accept this balance. */
function match<T extends { prefixes: string[] }>(rules: T[], account: string, accept: (rule: T) => boolean = () => true) {
  let best: T | undefined
  let length = 0
  for (const rule of rules) {
    if (!accept(rule)) continue
    for (const prefix of rule.prefixes) if (account.startsWith(prefix) && prefix.length > length) [best, length] = [rule, prefix.length]
  }
  return best
}

const balances = (entries: Entry[]) => {
  const result = new Map<string, number>()
  for (const entry of entries) result.set(entry.account, (result.get(entry.account) ?? 0) + entry.debit - entry.credit)
  return result
}

const isResultAccount = (account: string) => /^[678]/.test(account)
const yearOf = (entry: Entry) => Number(entry.date.slice(0, 4))

export function incomeStatement(store: Pick<Store, 'entries'>, year: number) {
  // Debit minus credit, per line.
  const amounts = new Map<string, number>()
  for (const [account, balance] of balances(store.entries.filter((entry) => yearOf(entry) === year))) {
    if (!isResultAccount(account)) continue
    // An account outside the official lines still counts, under "other" charges or income, so the result stays complete.
    const ref = match(incomeRules, account)?.ref ?? (account.startsWith('6') ? 'RJ' : account.startsWith('7') ? 'TH' : balance > 0 ? 'RP' : 'TO')
    amounts.set(ref, (amounts.get(ref) ?? 0) + balance)
  }
  // Income lines show credit balances as positive, expense lines debit balances.
  const value = (ref: string) => round2(-(amounts.get(ref) ?? 0) * incomeRules.find((item) => item.ref === ref)!.sign)
  const v = (refs: string) => refs.split(' ').map(value)
  const sum = (values: number[]) => round2(values.reduce((total, item) => total + item, 0))
  const [ta, ra, rb] = v('TA RA RB')
  const xa = round2(ta - ra - rb)
  const xb = sum(v('TA TB TC TD'))
  const xc = round2(xa + sum(v('TB TC TD TE TF TG TH TI')) - sum(v('RC RD RE RF RG RH RI RJ')))
  const xd = round2(xc - value('RK'))
  const xe = round2(xd + value('TJ') - value('RL'))
  const xf = round2(sum(v('TK TL TM')) - sum(v('RM RN')))
  const xg = round2(xe + xf)
  const xh = round2(sum(v('TN TO')) - sum(v('RO RP')))
  const xi = round2(xg + xh - value('RQ') - value('RS'))
  const line = (ref: string): StatementLine => ({ ref, label: incomeRules.find((item) => item.ref === ref)!.label, amount: value(ref) })
  const total = (ref: string, label: string, amount: number): StatementLine => ({ ref, label, amount, total: true })
  const lines: StatementLine[] = [
    line('TA'), line('RA'), line('RB'), total('XA', 'MARGE COMMERCIALE', xa),
    line('TB'), line('TC'), line('TD'), total('XB', 'CHIFFRE D’AFFAIRES', xb),
    line('TE'), line('TF'), line('TG'), line('TH'), line('TI'),
    line('RC'), line('RD'), line('RE'), line('RF'), line('RG'), line('RH'), line('RI'), line('RJ'), total('XC', 'VALEUR AJOUTÉE', xc),
    line('RK'), total('XD', 'EXCÉDENT BRUT D’EXPLOITATION', xd),
    line('TJ'), line('RL'), total('XE', 'RÉSULTAT D’EXPLOITATION', xe),
    line('TK'), line('TL'), line('TM'), line('RM'), line('RN'), total('XF', 'RÉSULTAT FINANCIER', xf),
    total('XG', 'RÉSULTAT DES ACTIVITÉS ORDINAIRES', xg),
    line('TN'), line('TO'), line('RO'), line('RP'), total('XH', 'RÉSULTAT HORS ACTIVITÉS ORDINAIRES', xh),
    line('RQ'), line('RS'), total('XI', 'RÉSULTAT NET', xi),
  ]
  return { lines, result: xi }
}

/**
 * Balance sheet at 31 December of `year`. The year's result appears in CJ; results of earlier years that were never carried
 * forward by a closing entry appear in CH (report à nouveau), so the sheet balances either way.
 */
export function balanceSheet(store: Pick<Store, 'entries'>, year: number) {
  const entries = store.entries.filter((entry) => yearOf(entry) <= year)
  const assets = new Map<string, number>()
  const liabilities = new Map<string, number>()
  const add = (target: Map<string, number>, ref: string, amount: number) => target.set(ref, (target.get(ref) ?? 0) + amount)
  let earlierResults = 0
  for (const [account, balance] of balances(entries)) {
    if (Math.abs(balance) < 1e-9 || isResultAccount(account)) continue
    const side = balance > 0 ? 'debit' : 'credit'
    // Asset lines show debit balances as positive; liability lines show credit balances as positive.
    const asset = match(assetRules, account, (rule) => rule.side === 'any' || rule.side === side)
    const liability = match(liabilityRules, account, (rule) => rule.side === 'any' || rule.side === side)
    const assetLength = asset ? Math.max(...asset.prefixes.filter((prefix) => account.startsWith(prefix)).map((prefix) => prefix.length)) : 0
    const liabilityLength = liability ? Math.max(...liability.prefixes.filter((prefix) => account.startsWith(prefix)).map((prefix) => prefix.length)) : 0
    if (asset && (assetLength > liabilityLength || (assetLength === liabilityLength && side === 'debit'))) add(assets, asset.ref, balance)
    else if (liability) add(liabilities, liability.ref, -balance)
    else if (side === 'debit') add(assets, 'BJ', balance)
    else add(liabilities, 'DM', -balance)
  }
  for (const [account, balance] of balances(entries.filter((entry) => yearOf(entry) < year))) if (isResultAccount(account)) earlierResults -= balance
  add(liabilities, 'CH', earlierResults)
  add(liabilities, 'CJ', incomeStatement(store, year).result)

  const value = (map: Map<string, number>, ref: string) => round2(map.get(ref) ?? 0)
  const lines = (rules: Rule[], map: Map<string, number>, refs: string) => refs.split(' ').map((ref): StatementLine => ({ ref, label: rules.find((rule) => rule.ref === ref)!.label, amount: value(map, ref) }))
  const sum = (map: Map<string, number>, refs: string) => round2(refs.split(' ').reduce((total, ref) => total + value(map, ref), 0))
  const total = (ref: string, label: string, amount: number): StatementLine => ({ ref, label, amount, total: true })

  const az = sum(assets, 'AD AI AP AQ')
  const bk = sum(assets, 'BA BB BH BI BJ')
  const bt = sum(assets, 'BQ BR BS')
  const cp = sum(liabilities, 'CA CB CD CE CF CG CH CJ CL CM')
  const dd = sum(liabilities, 'DA DB DC')
  const dp = sum(liabilities, 'DH DI DJ DK DM DN')
  const dt = sum(liabilities, 'DQ DR')
  return {
    assets: [
      ...lines(assetRules, assets, 'AD AI AP AQ'), total('AZ', 'TOTAL ACTIF IMMOBILISÉ', az),
      ...lines(assetRules, assets, 'BA BB BH BI BJ'), total('BK', 'TOTAL ACTIF CIRCULANT', bk),
      ...lines(assetRules, assets, 'BQ BR BS'), total('BT', 'TOTAL TRÉSORERIE-ACTIF', bt),
      total('BZ', 'TOTAL GÉNÉRAL', round2(az + bk + bt)),
    ],
    liabilities: [
      ...lines(liabilityRules, liabilities, 'CA CB CD CE CF CG CH CJ CL CM'), total('CP', 'TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES', cp),
      ...lines(liabilityRules, liabilities, 'DA DB DC'), total('DD', 'TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES', dd),
      total('DF', 'TOTAL RESSOURCES STABLES', round2(cp + dd)),
      ...lines(liabilityRules, liabilities, 'DH DI DJ DK DM DN'), total('DP', 'TOTAL PASSIF CIRCULANT', dp),
      ...lines(liabilityRules, liabilities, 'DQ DR'), total('DT', 'TOTAL TRÉSORERIE-PASSIF', dt),
      total('DZ', 'TOTAL GÉNÉRAL', round2(cp + dd + dp + dt)),
    ],
  }
}
