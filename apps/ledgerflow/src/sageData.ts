export type ModuleId = 'commercial' | 'caisse' | 'compta'
export type Origin = 'commercial' | 'caisse'
export type SalesDocType = 'devis' | 'commande' | 'livraison' | 'facture' | 'ticket'
export type PurchaseDocType = 'commande' | 'facture'
export type Payment = 'cash' | 'card'
export type JournalType = 'achats' | 'ventes' | 'tresorerie' | 'general'

export type Activity = { id: string; sage: string; fr: string; en: string; optional?: boolean }
export type ActivityGroup = { sage: string; fr: string; en: string; activities: Activity[] }
export type SageModule = { id: ModuleId; sage: string; fr: string; en: string; groups: ActivityGroup[] }

/** `taxId` (NIU or NIF) and `address` are printed on invoices; business customers must have them. */
export type Client = { code: string; name: string; city: string; email: string; taxId?: string; address?: string }
export type Supplier = { code: string; name: string; city: string }
export type Article = { ref: string; name: string; family: string; cost: number; price: number; vat: number; stock: number }
export type DocLine = { ref: string; qty: number; price: number; vat: number }
export type SupplierInvoiceLine = { date: string; supplierPart1: string; supplierPart2: string; item: string; quantity: number; unitPrice: number; total: number }
export type SalesDoc = { id: string; type: SalesDocType; client: string; date: string; lines: DocLine[]; origin: Origin; payment?: Payment; stockMoved?: boolean; posted?: boolean }
/** 
eference is the number printed on the supplier's own invoice, when there is one. */
export type PurchaseDoc = { id: string; type: PurchaseDocType; supplier: string; date: string; lines: DocLine[]; posted?: boolean; reference?: string }
export type Bom = { ref: string; components: { ref: string; qty: number }[] }
export type WorkOrder = { id: string; ref: string; qty: number; date: string; done: boolean }
export type Account = { number: string; label: string }
export type Journal = { code: string; label: string; type: JournalType }
/** `reverses` is set on the lines of a piece that cancels an earlier one: it holds that piece's number. */
/** Year-end pieces carry where they come from: they are never reversed by hand, and the result-closing one is left out of the income statement. */
export type EntryOrigin = 'depreciation' | 'inventory' | 'closing' | 'assignment'
export type Entry = { id: number; piece: string; journal: string; date: string; account: string; tiers?: string; label: string; debit: number; credit: number; due?: string; letter?: string; reverses?: string; origin?: EntryOrigin }
/** A fixed asset. `years` is the useful life; 0 means not depreciated (land). Amounts are net of recoverable VAT. */
export type FixedAsset = { id: string; label: string; account: string; acquired: string; cost: number; years: number }
/** Year-end steps already run for a financial year: the piece each one posted ('—' when there was nothing to post). */
export type YearEnd = { depreciation?: string; inventory?: string; closing?: string; assignment?: string; result?: number; closingStock?: number }
export type PieceLine = { account: string; tiers?: string; debit: number; credit: number; due?: string }
export type CommandGroup = { name: string; activities: string[] }
/** Supplier invoice received from outside (PDF, XML or typed in), waiting for approval before it is posted. `amount` includes VAT. */
export type SupplierInvoice = { id: string; number: string; supplier: string; date: string; due: string; amount: number; vat: number; account: string; status: 'needs_review' | 'approved' | 'rejected'; source?: string; piece?: string; lines?: SupplierInvoiceLine[] }
/** Line of a bank statement; `piece` is set once it has been posted to the bank journal. */
export type BankLine = { id: string; date: string; label: string; amount: number; piece?: string }

/**
 * Company details printed on invoices, as the tax codes of the OHADA states require them: tax identifier (NIU in
 * Cameroon and Congo, NIF elsewhere), trade register number (RCCM), tax regime and office, address and bank account.
 * `nationalId` is the DR Congo identification nationale.
 */
export type CompanyInfo = { address: string; city: string; phone: string; email: string; taxId: string; rccm: string; nationalId: string; taxRegime: string; taxOffice: string; bank: string }

export const emptyCompanyInfo: CompanyInfo = { address: '', city: '', phone: '', email: '', taxId: '', rccm: '', nationalId: '', taxRegime: '', taxOffice: '', bank: '' }

/** Chart of accounts: SYSCOHADA (OHADA states) or the French PCG, kept for companies created before SYSCOHADA support. */
export type ChartId = 'syscohada' | 'pcg'

export type Store = {
  company: string
  companyInfo: CompanyInfo
  /** ISO country code of the company (CM, GA, …); empty for companies outside the supported countries. */
  country: string
  chart: ChartId
  /** ISO currency code used to display every amount (EUR, XAF, …). */
  currency: string
  /** VAT rate, in percent, proposed for new items and documents; 0 when prices carry no VAT. */
  defaultVat: number
  clients: Client[]
  suppliers: Supplier[]
  articles: Article[]
  salesDocs: SalesDoc[]
  purchaseDocs: PurchaseDoc[]
  boms: Bom[]
  workOrders: WorkOrder[]
  accounts: Account[]
  journals: Journal[]
  entries: Entry[]
  closedPeriods: string[]
  reminders: Record<string, number>
  groups: CommandGroup[]
  supplierInvoices: SupplierInvoice[]
  bankLines: BankLine[]
  /** Manual month-end tasks ticked off, per period (YYYY-MM). */
  closeTasks: Record<string, string[]>
  assets: FixedAsset[]
  /** Year-end closing progress, per financial year (YYYY). */
  yearEnd: Record<string, YearEnd>
}

// The three Sage 100 modules, in the order the data flows: commercial and cash documents end up in accounting.
export const sageModules: SageModule[] = [
  {
    id: 'commercial', sage: 'Sage 100 Gestion commerciale', fr: 'Gestion commerciale', en: 'Sales management',
    groups: [
      {
        sage: 'Gestion des ventes', fr: 'Gestion des ventes', en: 'Sales',
        activities: [
          { id: 'gc.clients', sage: 'Liste des clients', fr: 'Consulter et mettre à jour les clients', en: 'View and update customers' },
          { id: 'gc.documents', sage: 'Liste des documents', fr: 'Contrôler les documents de vente', en: 'Check sales documents' },
          { id: 'gc.saisie', sage: 'Saisir un document', fr: 'Saisir un document de vente', en: 'Enter a sales document' },
          { id: 'gc.commande', sage: 'Saisir une commande', fr: 'Enregistrer une commande client', en: 'Record a customer order' },
          { id: 'gc.interrogation', sage: 'Interrogation', fr: 'Interroger un client ou un article', en: 'Query a customer or item' },
        ],
      },
      {
        sage: 'Gestion des achats · articles · fabrications', fr: 'Autres domaines', en: 'Other areas',
        activities: [
          { id: 'gc.achats', sage: 'Gestion des achats', fr: 'Gérer commandes et factures fournisseurs', en: 'Manage supplier orders and invoices' },
          { id: 'gc.articles', sage: 'Gestion des articles', fr: 'Gérer les articles et les tarifs', en: 'Manage items and price lists' },
          { id: 'gc.fabrications', sage: 'Gestion des fabrications', fr: 'Gérer nomenclatures et ordres de fabrication', en: 'Manage bills of materials and production orders' },
          { id: 'gc.inventaire', sage: 'Inventaire', fr: 'Faire l’inventaire du stock', en: 'Run the stock count' },
        ],
      },
    ],
  },
  {
    id: 'caisse', sage: 'Sage 100 Saisie de caisse décentralisée', fr: 'Saisie de caisse', en: 'Point of sale',
    groups: [
      {
        sage: 'Gestion des ventes', fr: 'Gestion des ventes', en: 'Sales',
        activities: [
          { id: 'sc.clients', sage: 'Liste des clients', fr: 'Vérifier les clients du point de vente', en: 'Check point-of-sale customers' },
          { id: 'sc.documents', sage: 'Liste des documents de vente', fr: 'Consulter les documents de vente émis', en: 'View issued sales documents' },
          { id: 'sc.saisie', sage: 'Saisir un document de vente', fr: 'Émettre un document de vente', en: 'Issue a sales document' },
          { id: 'sc.commande', sage: 'Saisir une commande client', fr: 'Saisir une commande client', en: 'Enter a customer order' },
        ],
      },
      {
        sage: 'Ventes comptoir · Articles et stocks', fr: 'Comptoir et stock', en: 'Counter and stock',
        activities: [
          { id: 'sc.comptoir', sage: 'Ventes comptoir', fr: 'Enregistrer les ventes comptoir du jour', en: 'Record today’s counter sales' },
          { id: 'sc.stocks', sage: 'Gestion des articles et stocks', fr: 'Contrôler disponibilités et stocks', en: 'Check availability and stock' },
          { id: 'sc.groupe', sage: 'Nouveau groupe', fr: 'Créer un groupe de commandes personnalisé', en: 'Create a custom command group', optional: true },
        ],
      },
    ],
  },
  {
    id: 'compta', sage: 'Sage 100 Comptabilité', fr: 'Comptabilité', en: 'Accounting',
    groups: [
      {
        sage: 'Structure', fr: 'Structure', en: 'Setup',
        activities: [
          { id: 'cp.compte', sage: 'Créer un compte général', fr: 'Créer ou vérifier les comptes généraux', en: 'Create or check general accounts' },
          { id: 'cp.journaux', sage: 'Journaux de saisie', fr: 'Contrôler les journaux de saisie', en: 'Check the entry journals' },
        ],
      },
      {
        sage: 'Saisie des écritures', fr: 'Saisie des écritures', en: 'Entry posting',
        activities: [
          { id: 'cp.piece', sage: 'Ajout d’une pièce', fr: 'Ajouter une pièce comptable', en: 'Add an accounting document' },
          { id: 'cp.operations', sage: 'Saisie des opérations', fr: 'Saisir les opérations bancaires', en: 'Record bank operations' },
          { id: 'cp.ecritures', sage: 'Saisie des écritures', fr: 'Saisir les écritures comptables', en: 'Enter journal entries' },
          { id: 'cp.visualisation', sage: 'Visualisation/modification', fr: 'Visualiser et corriger les écritures', en: 'View and correct entries' },
          { id: 'cp.recherche', sage: 'Recherche d’écritures', fr: 'Rechercher une écriture', en: 'Search for an entry' },
        ],
      },
      {
        sage: 'Tiers · Traitements · États', fr: 'Contrôle et clôture', en: 'Control and closing',
        activities: [
          { id: 'cp.tiers', sage: 'Gestion et suivi des tiers', fr: 'Suivre échéances et relances des tiers', en: 'Track due dates and reminders' },
          { id: 'cp.avancees', sage: 'Fonctions avancées', fr: 'Utiliser les fonctions avancées', en: 'Use advanced functions' },
          { id: 'cp.periodiques', sage: 'Traitements périodiques', fr: 'Lancer les traitements périodiques', en: 'Run periodic processing' },
          { id: 'cp.etats', sage: 'États comptables et fiscaux', fr: 'Éditer les états comptables et fiscaux', en: 'Print accounting and tax reports' },
          { id: 'cp.immobilisations', sage: 'Immobilisations', fr: 'Gérer les immobilisations et les amortissements', en: 'Manage fixed assets and depreciation' },
          { id: 'cp.cloture', sage: 'Clôture de l’exercice', fr: 'Clôturer l’exercice et affecter le résultat', en: 'Close the financial year and assign the result' },
        ],
      },
    ],
  },
]

export type AccountRole = 'suppliers' | 'clients' | 'vatDeductible' | 'vatCollected' | 'bank' | 'cash' | 'purchases' | 'sales'
/** Accounts used by the sample company for its opening capital and typical expenses. */
type SampleRole = 'capital' | 'office' | 'subcontracting' | 'advertising' | 'bankFees'
/**
 * `prefixes` group the accounts read by reports: every VAT collected or deductible sub-account, every bank account,
 * and the accounts kept per customer or supplier (open items, lettrage, reminders).
 */
type Chart = { roles: Record<AccountRole, string>; prefixes: { vatCollected: string; vatDeductible: string; bank: string; clients: string[]; suppliers: string[] }; sample: Record<SampleRole, string>; accounts: Account[] }

export const charts: Record<ChartId, Chart> = {
  // Système comptable OHADA révisé (in force since 2018 in all OHADA member states).
  syscohada: {
    roles: { suppliers: '401100', clients: '411100', vatDeductible: '445200', vatCollected: '443100', bank: '521100', cash: '571100', purchases: '601100', sales: '701100' },
    // Class 40 and 41 hold every supplier and customer sub-account (4011, 408, 409, 416, 418, 419…); 481 are suppliers of fixed assets.
    prefixes: { vatCollected: '443', vatDeductible: '445', bank: '52', clients: ['41'], suppliers: ['40', '481'] },
    sample: { capital: '101300', office: '605500', subcontracting: '621000', advertising: '627000', bankFees: '631000' },
    accounts: [
      { number: '101300', label: 'Capital souscrit, appelé, versé, non amorti' },
      { number: '401100', label: 'Fournisseurs' },
      { number: '411100', label: 'Clients' },
      { number: '421000', label: 'Personnel, avances et acomptes' },
      { number: '431000', label: 'Sécurité sociale' },
      { number: '443100', label: 'TVA facturée sur ventes' },
      { number: '444100', label: 'État, TVA due' },
      { number: '445200', label: 'TVA récupérable sur achats' },
      { number: '445400', label: 'TVA récupérable sur services extérieurs' },
      { number: '521100', label: 'Banques locales' },
      { number: '571100', label: 'Caisse' },
      { number: '601100', label: 'Achats de marchandises' },
      { number: '605500', label: 'Fournitures de bureau non stockables' },
      { number: '621000', label: 'Sous-traitance générale' },
      { number: '622200', label: 'Locations de bâtiments' },
      { number: '627000', label: 'Publicité, publications, relations publiques' },
      { number: '628100', label: 'Frais de téléphone' },
      { number: '631000', label: 'Frais bancaires' },
      { number: '641000', label: 'Impôts et taxes directs' },
      { number: '661000', label: 'Rémunérations directes versées au personnel national' },
      { number: '701100', label: 'Ventes de marchandises' },
      { number: '706000', label: 'Services vendus' },
    ],
  },
  pcg: {
    roles: { suppliers: '401000', clients: '411000', vatDeductible: '445660', vatCollected: '445710', bank: '512000', cash: '531000', purchases: '607000', sales: '707000' },
    prefixes: { vatCollected: '4457', vatDeductible: '4456', bank: '512', clients: ['41'], suppliers: ['40'] },
    sample: { capital: '101300', office: '606400', subcontracting: '611200', advertising: '623100', bankFees: '627000' },
    accounts: [
      { number: '101300', label: 'Capital souscrit' },
      { number: '401000', label: 'Fournisseurs' },
      { number: '411000', label: 'Clients' },
      { number: '445660', label: 'TVA déductible sur biens et services' },
      { number: '445710', label: 'TVA collectée' },
      { number: '512000', label: 'Banque' },
      { number: '531000', label: 'Caisse' },
      { number: '606400', label: 'Fournitures administratives' },
      { number: '607000', label: 'Achats de marchandises' },
      { number: '611200', label: 'Sous-traitance' },
      { number: '623100', label: 'Publicité' },
      { number: '627000', label: 'Services bancaires' },
      { number: '707000', label: 'Ventes de marchandises' },
    ],
  },
}

/** The accounts a company posts to automatically: customers, suppliers, VAT, bank, cash, purchases and sales. */
export const chartOf = (store: Pick<Store, 'chart'>) => charts[store.chart in charts ? store.chart : 'pcg']
export const accountsOf = (store: Pick<Store, 'chart'>) => chartOf(store).roles

/** VAT rates offered for a company: those of its country, or the former fixed list for companies without one. */
export const vatRatesOf = (store: Pick<Store, 'country'>) => countries.find((country) => country.code === store.country)?.vat ?? [0, 5.5, 10, 18, 19.25, 20]

/**
 * `vatSurtax`: a tax included in the VAT rate and declared on its own line, as a percentage of the principal VAT
 * (Cameroon's 19.25 % is 17.5 % plus 10 % of it for the communes). `vatDueDay`: day of the next month by which the
 * monthly return is filed and paid.
 */
export type Country = { code: string; fr: string; en: string; currency: string; chart: ChartId; vat: number[]; defaultVat: number; cities: string[]; vatSurtax?: { label: string; rate: number }; vatDueDay?: number; taxIdLabel: string }

/**
 * Central African OHADA states. VAT rates and filing days are the usual ones and must be confirmed against each year's
 * finance law; any other rate can still be set per item.
 */
export const countries: Country[] = [
  { code: 'CM', fr: 'Cameroun', en: 'Cameroon', currency: 'XAF', chart: 'syscohada', vat: [0, 19.25], defaultVat: 19.25, cities: ['Douala', 'Yaoundé', 'Bafoussam'], vatSurtax: { label: 'Centimes additionnels communaux (CAC)', rate: 10 }, vatDueDay: 15, taxIdLabel: 'NIU' },
  { code: 'GA', fr: 'Gabon', en: 'Gabon', currency: 'XAF', chart: 'syscohada', vat: [0, 5, 10, 18], defaultVat: 18, cities: ['Libreville', 'Port-Gentil', 'Franceville'], vatDueDay: 20, taxIdLabel: 'NIF' },
  { code: 'CG', fr: 'Congo', en: 'Republic of the Congo', currency: 'XAF', chart: 'syscohada', vat: [0, 5, 18, 18.9], defaultVat: 18, cities: ['Brazzaville', 'Pointe-Noire', 'Dolisie'], taxIdLabel: 'NIU' },
  { code: 'TD', fr: 'Tchad', en: 'Chad', currency: 'XAF', chart: 'syscohada', vat: [0, 9, 18], defaultVat: 18, cities: ['N’Djaména', 'Moundou', 'Abéché'], taxIdLabel: 'NIF' },
  { code: 'CF', fr: 'Centrafrique', en: 'Central African Republic', currency: 'XAF', chart: 'syscohada', vat: [0, 5, 19], defaultVat: 19, cities: ['Bangui', 'Berbérati', 'Bambari'], taxIdLabel: 'NIF' },
  { code: 'GQ', fr: 'Guinée équatoriale', en: 'Equatorial Guinea', currency: 'XAF', chart: 'syscohada', vat: [0, 6, 15], defaultVat: 15, cities: ['Malabo', 'Bata', 'Ebebiyín'], taxIdLabel: 'NIF' },
  { code: 'CD', fr: 'RD Congo', en: 'DR Congo', currency: 'CDF', chart: 'syscohada', vat: [0, 8, 16], defaultVat: 16, cities: ['Kinshasa', 'Lubumbashi', 'Goma'], taxIdLabel: 'NIF' },
]

const digitsCache = new Map<string, number>()
/** Decimals used by a currency: 0 for the CFA francs, 2 for most others. */
export function currencyDigits(currency: string) {
  let digits = digitsCache.get(currency)
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
    } catch {
      digits = 2
    }
    digitsCache.set(currency, digits)
  }
  return digits
}

export const salesTypes: Record<SalesDocType, { prefix: string; fr: string; en: string }> = {
  devis: { prefix: 'DE', fr: 'Devis', en: 'Quote' },
  commande: { prefix: 'BC', fr: 'Bon de commande', en: 'Order' },
  livraison: { prefix: 'BL', fr: 'Bon de livraison', en: 'Delivery note' },
  facture: { prefix: 'FA', fr: 'Facture', en: 'Invoice' },
  ticket: { prefix: 'TK', fr: 'Ticket comptoir', en: 'Counter ticket' },
}

export const purchaseTypes: Record<PurchaseDocType, { prefix: string; fr: string; en: string }> = {
  commande: { prefix: 'CF', fr: 'Commande fournisseur', en: 'Purchase order' },
  facture: { prefix: 'FF', fr: 'Facture fournisseur', en: 'Supplier invoice' },
}

const salesChain: SalesDocType[] = ['devis', 'commande', 'livraison', 'facture']

export const roundTo = (value: number, digits: number) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits
export const round2 = (value: number) => roundTo(value, 2)
/** Rounds an amount to what the company's currency can actually carry (whole francs in FCFA). */
export const roundAmount = (store: Pick<Store, 'currency'>, value: number) => roundTo(value, currencyDigits(store.currency))
export const movesStock = (type: SalesDocType) => type === 'livraison' || type === 'facture' || type === 'ticket'
export type TiersKind = 'clients' | 'suppliers'
/** Whether an account is kept per customer, per supplier, or neither, according to the company's chart. */
export function tiersKind(store: Pick<Store, 'chart'>, account: string): TiersKind | undefined {
  const { clients, suppliers } = chartOf(store).prefixes
  if (clients.some((prefix) => account.startsWith(prefix))) return 'clients'
  if (suppliers.some((prefix) => account.startsWith(prefix))) return 'suppliers'
}
export const isTiersAccount = (store: Pick<Store, 'chart'>, account: string) => tiersKind(store, account) !== undefined
export const nextSalesType = (type: SalesDocType): SalesDocType | undefined => salesChain[salesChain.indexOf(type) + 1 || salesChain.length]

export function isoDate(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  return isoDate(new Date(year, month - 1, day + days))
}

export function nextNumber(prefix: string, existing: string[], width = 5) {
  const last = existing.filter((id) => id.startsWith(prefix)).reduce((max, id) => Math.max(max, Number(id.slice(prefix.length)) || 0), 0)
  return `${prefix}${String(last + 1).padStart(width, '0')}`
}

/** Net, VAT and gross totals, rounded to the currency's decimals: these are the amounts printed and posted. */
export function docTotals(lines: DocLine[], currency = 'EUR') {
  const digits = currencyDigits(currency)
  const ht = roundTo(lines.reduce((sum, line) => sum + line.qty * line.price, 0), digits)
  const vat = roundTo(lines.reduce((sum, line) => sum + line.qty * line.price * line.vat / 100, 0), digits)
  return { ht, vat, ttc: roundTo(ht + vat, digits) }
}

export function tiersName(store: Store, code?: string) {
  if (!code) return ''
  return store.clients.find((client) => client.code === code)?.name ?? store.suppliers.find((supplier) => supplier.code === code)?.name ?? code
}

// Balance of a third party on its collective account: positive means the customer owes us / we owe the supplier.
export function tiersBalance(entries: Entry[], account: string, tiers: string) {
  const balance = entries.filter((entry) => entry.account === account && entry.tiers === tiers).reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
  return round2(account.startsWith('40') || account.startsWith('48') ? -balance : balance)
}

/** An item that appears in a document, a bill of materials or a production order cannot be deleted without breaking them. */
export function articleInUse(store: Store, ref: string) {
  return [...store.salesDocs, ...store.purchaseDocs].some((doc) => doc.lines.some((line) => line.ref === ref))
    || store.boms.some((bom) => bom.ref === ref || bom.components.some((component) => component.ref === ref))
    || store.workOrders.some((order) => order.ref === ref)
}

/** A customer or supplier with documents or accounting entries must be kept. */
export function tiersInUse(store: Store, code: string) {
  return store.salesDocs.some((doc) => doc.client === code) || store.purchaseDocs.some((doc) => doc.supplier === code) || store.entries.some((entry) => entry.tiers === code)
}

export function shortage(store: Store, lines: DocLine[]) {
  return store.articles.find((article) => lines.filter((line) => line.ref === article.ref).reduce((sum, line) => sum + line.qty, 0) > article.stock)?.ref
}

export function postPiece(store: Store, journal: string, date: string, label: string, lines: PieceLine[], piece = nextNumber(`${journal}-`, store.entries.map((entry) => entry.piece), 4)): Store {
  const firstId = store.entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
  const entries = lines.filter((line) => line.debit || line.credit).map((line, index) => ({ ...line, id: firstId + index, piece, journal, date, label }))
  return { ...store, entries: [...store.entries, ...entries] }
}

export const isReversed = (store: Store, piece: string) => store.entries.some((entry) => entry.reverses === piece)

/**
 * Cancels a posted piece as the OHADA Uniform Act on accounting requires: the original stays as it is and a new piece,
 * dated `date`, carries the same lines with debit and credit swapped. A piece already cancelled, or itself a cancellation, is left alone.
 */
export function reversePiece(store: Store, piece: string, date: string): Store {
  const lines = store.entries.filter((entry) => entry.piece === piece)
  if (!lines.length || lines.some((entry) => entry.reverses) || isReversed(store, piece)) return store
  const next = postPiece(store, lines[0].journal, date, `Annulation ${piece} · ${lines[0].label}`, lines.map((entry) => ({ account: entry.account, tiers: entry.tiers, debit: entry.credit, credit: entry.debit })))
  const reversal = next.entries[next.entries.length - 1].piece
  return {
    ...next,
    entries: next.entries.map((entry) => entry.piece === reversal ? { ...entry, reverses: piece } : entry),
    // A bank line posted through the cancelled piece goes back to the lines waiting to be posted.
    bankLines: next.bankLines.map((line) => line.piece === piece ? { ...line, piece: undefined } : line),
  }
}

export type LedgerViolation =
  | { kind: 'changed' | 'removed' | 'unbalanced'; piece: string }
  | { kind: 'closedPeriod' | 'closedYear'; period: string }

/** Fields of a posted line that stay as they were: only the lettering code may be added or removed afterwards. */
const frozenFields = ['piece', 'journal', 'date', 'account', 'tiers', 'label', 'debit', 'credit', 'due', 'reverses'] as const

/**
 * The OHADA rules on posted entries, checked on every change before it is kept: a line already posted is never changed
 * nor removed (it is cancelled by a reversing piece), every new piece balances, nothing is posted into a locked month,
 * and a month of a financial year closed at year end cannot be reopened.
 */
export function ledgerViolation(before: Store, after: Store): LedgerViolation | undefined {
  const kept = new Map(after.entries.map((entry) => [entry.id, entry]))
  for (const entry of before.entries) {
    const now = kept.get(entry.id)
    if (!now) return { kind: 'removed', piece: entry.piece }
    if (frozenFields.some((field) => now[field] !== entry[field])) return { kind: 'changed', piece: entry.piece }
  }
  const known = new Set(before.entries.map((entry) => entry.id))
  const added = after.entries.filter((entry) => !known.has(entry.id))
  const closed = new Set(before.closedPeriods)
  const locked = added.find((entry) => closed.has(entry.date.slice(0, 7)))
  if (locked) return { kind: 'closedPeriod', period: locked.date.slice(0, 7) }
  const pieces = new Map<string, number>()
  for (const entry of added) pieces.set(entry.piece, (pieces.get(entry.piece) ?? 0) + entry.debit - entry.credit)
  const tolerance = 10 ** -currencyDigits(after.currency) / 2
  for (const [piece, balance] of pieces) if (Math.abs(balance) >= tolerance) return { kind: 'unbalanced', piece }
  const reopened = before.closedPeriods.find((month) => !after.closedPeriods.includes(month) && before.yearEnd[month.slice(0, 4)]?.closing)
  if (reopened) return { kind: 'closedYear', period: reopened }
}

/**
 * Breaks in the numbering of pieces: for each series (a journal's manual pieces, invoices, tickets…), the numbers missing
 * between the first and the last one. Each number is the series prefix followed by digits, as `nextNumber` makes them.
 */
export function numberingGaps(store: Store): string[] {
  const series = new Map<string, { width: number; numbers: Set<number> }>()
  for (const piece of new Set(store.entries.map((entry) => entry.piece))) {
    const match = /^(.*?)(\d+)$/.exec(piece)
    if (!match) continue
    const item = series.get(match[1]) ?? { width: match[2].length, numbers: new Set<number>() }
    item.numbers.add(Number(match[2]))
    series.set(match[1], item)
  }
  const gaps: string[] = []
  for (const [prefix, { width, numbers }] of series) {
    const sorted = [...numbers].sort((a, b) => a - b)
    for (let number = sorted[0] + 1; number < sorted[sorted.length - 1]; number += 1) if (!numbers.has(number)) gaps.push(`${prefix}${String(number).padStart(width, '0')}`)
  }
  return gaps
}

function moveStock(articles: Article[], lines: DocLine[], direction: 1 | -1) {
  return articles.map((article) => {
    const qty = lines.filter((line) => line.ref === article.ref).reduce((sum, line) => sum + line.qty, 0)
    return qty ? { ...article, stock: article.stock + direction * qty } : article
  })
}

// Applies the stock movement and the accounting posting a sales document is due, once each.
function settleSalesDoc(store: Store, doc: SalesDoc, replaces = doc.id): Store {
  let next = store
  let settled = doc
  if (movesStock(settled.type) && !settled.stockMoved) {
    next = { ...next, articles: moveStock(next.articles, settled.lines, -1) }
    settled = { ...settled, stockMoved: true }
  }
  if ((settled.type === 'facture' || settled.type === 'ticket') && !settled.posted) {
    const { ht, vat, ttc } = docTotals(settled.lines, next.currency)
    const accounts = accountsOf(next)
    const revenue = [{ account: accounts.sales, debit: 0, credit: ht }, { account: accounts.vatCollected, debit: 0, credit: vat }]
    next = settled.type === 'facture'
      ? postPiece(next, 'VTE', settled.date, `${settled.id} · ${tiersName(next, settled.client)}`, [{ account: accounts.clients, tiers: settled.client, debit: ttc, credit: 0, due: addDays(settled.date, 30) }, ...revenue], settled.id)
      : postPiece(next, 'CAI', settled.date, `${settled.id} · Vente comptoir`, [{ account: settled.payment === 'card' ? accounts.bank : accounts.cash, debit: ttc, credit: 0 }, ...revenue], settled.id)
    settled = { ...settled, posted: true }
  }
  const exists = next.salesDocs.some((item) => item.id === replaces)
  return { ...next, salesDocs: exists ? next.salesDocs.map((item) => item.id === replaces ? settled : item) : [...next.salesDocs, settled] }
}

export function saveSalesDoc(store: Store, draft: Omit<SalesDoc, 'id' | 'stockMoved' | 'posted'>): Store {
  const id = nextNumber(salesTypes[draft.type].prefix, store.salesDocs.map((doc) => doc.id))
  return settleSalesDoc(store, { ...draft, id })
}

// Transforms a document into the next one of the chain (quote → order → delivery note → invoice).
export function advanceSalesDoc(store: Store, id: string, date: string): Store {
  const doc = store.salesDocs.find((item) => item.id === id)
  const type = doc && nextSalesType(doc.type)
  if (!doc || !type) return store
  const newId = nextNumber(salesTypes[type].prefix, store.salesDocs.map((item) => item.id))
  return settleSalesDoc(store, { ...doc, id: newId, type, date }, id)
}

function settlePurchaseDoc(store: Store, doc: PurchaseDoc, replaces = doc.id): Store {
  let next = store
  let settled = doc
  if (settled.type === 'facture' && !settled.posted) {
    const { ht, vat, ttc } = docTotals(settled.lines, next.currency)
    const accounts = accountsOf(next)
    next = { ...next, articles: moveStock(next.articles, settled.lines, 1) }
    next = postPiece(next, 'ACH', settled.date, [settled.id, settled.reference, tiersName(next, settled.supplier)].filter(Boolean).join(' · '), [
      { account: accounts.purchases, debit: ht, credit: 0 },
      { account: accounts.vatDeductible, debit: vat, credit: 0 },
      { account: accounts.suppliers, tiers: settled.supplier, debit: 0, credit: ttc, due: addDays(settled.date, 30) },
    ], settled.id)
    settled = { ...settled, posted: true }
  }
  const exists = next.purchaseDocs.some((item) => item.id === replaces)
  return { ...next, purchaseDocs: exists ? next.purchaseDocs.map((item) => item.id === replaces ? settled : item) : [...next.purchaseDocs, settled] }
}

export function savePurchaseDoc(store: Store, draft: Omit<PurchaseDoc, 'id' | 'posted'>): Store {
  const id = nextNumber(purchaseTypes[draft.type].prefix, store.purchaseDocs.map((doc) => doc.id))
  return settlePurchaseDoc(store, { ...draft, id })
}

export function advancePurchaseDoc(store: Store, id: string, date: string): Store {
  const doc = store.purchaseDocs.find((item) => item.id === id)
  if (!doc || doc.type !== 'commande') return store
  const newId = nextNumber(purchaseTypes.facture.prefix, store.purchaseDocs.map((item) => item.id))
  return settlePurchaseDoc(store, { ...doc, id: newId, type: 'facture', date }, id)
}

// Components a production order still lacks, as the first missing article reference.
export function missingComponent(store: Store, order: WorkOrder) {
  const bom = store.boms.find((item) => item.ref === order.ref)
  return bom?.components.find((component) => (store.articles.find((article) => article.ref === component.ref)?.stock ?? 0) < component.qty * order.qty)?.ref
}

export function completeWorkOrder(store: Store, id: string): Store {
  const order = store.workOrders.find((item) => item.id === id)
  const bom = order && store.boms.find((item) => item.ref === order.ref)
  if (!order || !bom || order.done) return store
  const consumed = bom.components.map((component) => ({ ref: component.ref, qty: component.qty * order.qty, price: 0, vat: 0 }))
  const articles = moveStock(moveStock(store.articles, consumed, -1), [{ ref: order.ref, qty: order.qty, price: 0, vat: 0 }], 1)
  return { ...store, articles, workOrders: store.workOrders.map((item) => item.id === id ? { ...item, done: true } : item) }
}

// Lettrage: matches invoices and payments of the same third party, first by equal amount, then as a balanced group.
export function autoLetter(store: Store): Store {
  const used = new Set<string>()
  for (const entry of store.entries) if (entry.letter) used.add(entry.letter)
  let counter = 0
  const nextLetter = () => {
    let code = ''
    do {
      code = String.fromCharCode(65 + Math.floor(counter / 26) % 26) + String.fromCharCode(65 + counter % 26)
      counter += 1
    } while (used.has(code))
    used.add(code)
    return code
  }

  const groups = new Map<string, Entry[]>()
  for (const entry of store.entries) {
    if (entry.letter || !entry.tiers || !isTiersAccount(store, entry.account)) continue
    const key = `${entry.account}|${entry.tiers}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }

  const assigned = new Map<number, string>()
  for (const group of groups.values()) {
    const credits = group.filter((entry) => entry.credit > 0)
    for (const debit of group.filter((entry) => entry.debit > 0)) {
      const match = credits.find((credit) => !assigned.has(credit.id) && credit.credit === debit.debit)
      if (!match) continue
      const code = nextLetter()
      assigned.set(debit.id, code)
      assigned.set(match.id, code)
    }
    const rest = group.filter((entry) => !assigned.has(entry.id))
    if (rest.length > 1 && round2(rest.reduce((sum, entry) => sum + entry.debit - entry.credit, 0)) === 0) {
      const code = nextLetter()
      for (const entry of rest) assigned.set(entry.id, code)
    }
  }

  if (!assigned.size) return store
  return { ...store, entries: store.entries.map((entry) => assigned.has(entry.id) ? { ...entry, letter: assigned.get(entry.id) } : entry) }
}

export type SupplierInvoiceInput = { date: string; supplier: string; reference?: string; lines: { article: string; qty: number; price: number }[] }

export type SupplierStockAnalysis = { ref: string; name: string; family: string; received: number; sold: number; balance: number; stock: number }

/** Compares received supplier invoices with shipped sales; current stock also includes opening stock and other movements. */
export function supplierStockAnalysis(store: Store): SupplierStockAnalysis[] {
  const received = new Map<string, number>()
  for (const doc of store.purchaseDocs) {
    if (doc.type !== 'facture' || !doc.posted) continue
    for (const line of doc.lines) received.set(line.ref, (received.get(line.ref) ?? 0) + line.qty)
  }

  const sold = new Map<string, number>()
  for (const doc of store.salesDocs) {
    if (!doc.stockMoved) continue
    for (const line of doc.lines) sold.set(line.ref, (sold.get(line.ref) ?? 0) + line.qty)
  }

  return store.articles.map((article) => {
    const purchasedQuantity = received.get(article.ref) ?? 0
    const soldQuantity = sold.get(article.ref) ?? 0
    return {
      ref: article.ref, name: article.name, family: article.family,
      received: round2(purchasedQuantity), sold: round2(soldQuantity),
      balance: round2(purchasedQuantity - soldQuantity), stock: article.stock,
    }
  })
}

function articleReference(name: string, taken: string[]) {
  const base = name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'ART'
  let reference = base
  for (let suffix = 2; taken.includes(reference); suffix += 1) reference = `${base}-${suffix}`
  return reference
}

/**
 * Records a supplier invoice the way it is written on paper: a date, a supplier name and lines of item, quantity and unit price.
 * A supplier or item not yet known is created on the fly; the goods enter stock, the item's cost becomes the price just paid,
 * and the invoice is posted to the purchase journal against the supplier.
 */
export function registerSupplierInvoice(store: Store, input: SupplierInvoiceInput): Store {
  const lines = input.lines.filter((line) => line.article.trim() && line.qty > 0 && line.price >= 0)
  const supplierName = input.supplier.trim().replace(/\s+/g, ' ')
  if (!supplierName || !lines.length || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return store
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

  let next = store
  let supplier = next.suppliers.find((item) => same(item.name, supplierName) || same(item.code, supplierName))
  if (!supplier) {
    supplier = { code: nextNumber('F', next.suppliers.map((item) => item.code), 4), name: supplierName, city: '' }
    next = { ...next, suppliers: [...next.suppliers, supplier] }
  }

  const docLines: DocLine[] = []
  for (const line of lines) {
    const name = line.article.trim().replace(/\s+/g, ' ')
    const price = round2(line.price)
    const known = next.articles.find((item) => same(item.ref, name) || same(item.name, name))
    // A new item starts with its sales price equal to its cost: the margin is set later, in the item list.
    const article = known ? { ...known, cost: price } : { ref: articleReference(name, next.articles.map((item) => item.ref)), name, family: '', cost: price, price, vat: next.defaultVat, stock: 0 }
    next = { ...next, articles: known ? next.articles.map((item) => item.ref === article.ref ? article : item) : [...next.articles, article] }
    docLines.push({ ref: article.ref, qty: line.qty, price, vat: article.vat })
  }
  return savePurchaseDoc(next, { type: 'facture', supplier: supplier.code, date: input.date, lines: docLines, reference: input.reference?.trim() || undefined })
}

export type CompanySetup = { currency?: string; defaultVat?: number; chart?: ChartId; country?: string }

/** A new company: no customers, items or entries yet, only the base chart of accounts and the journals. */
export function createEmptyStore(company: string, { currency = 'EUR', defaultVat = 20, chart = 'pcg', country = '' }: CompanySetup = {}): Store {
  return {
    company,
    companyInfo: { ...emptyCompanyInfo },
    country,
    chart,
    currency,
    defaultVat,
    clients: [],
    suppliers: [],
    articles: [],
    salesDocs: [],
    purchaseDocs: [],
    boms: [],
    workOrders: [],
    accounts: charts[chart].accounts.map((account) => ({ ...account })),
    journals: [
      { code: 'ACH', label: 'Achats', type: 'achats' },
      { code: 'VTE', label: 'Ventes', type: 'ventes' },
      { code: 'BQ', label: 'Banque', type: 'tresorerie' },
      { code: 'CAI', label: 'Caisse', type: 'tresorerie' },
      { code: 'OD', label: 'Opérations diverses', type: 'general' },
    ],
    entries: [],
    closedPeriods: [],
    reminders: {},
    groups: [],
    supplierInvoices: [],
    bankLines: [],
    closeTasks: {},
    assets: [],
    yearEnd: {},
  }
}

/** Settings of a new company in one of the supported countries: its currency, VAT rate and SYSCOHADA. */
export const setupFor = (country: Country): CompanySetup => ({ currency: country.currency, defaultVat: country.defaultVat, chart: country.chart, country: country.code })

// Rough euro value of each currency, only to turn the sample prices into believable local amounts.
const sampleRates: Record<string, number> = { XAF: 656, XOF: 656, CDF: 3300 }

/**
 * Sample company used by the demo and offered at first start. Without a country it is the original French one (EUR, PCG);
 * with one, the same business in the country's currency, VAT rate, cities and SYSCOHADA accounts.
 */
export function createStore(company = 'Maison Lumière SAS', country?: Country): Store {
  const today = isoDate()
  const day = (offset: number) => addDays(today, offset)
  const base = createEmptyStore(company, country ? setupFor(country) : {})
  const rate = sampleRates[base.currency] ?? 1
  const digits = currencyDigits(base.currency)
  // Local prices end in round figures: 50 FCFA steps rather than 1 573,44.
  const money = (euros: number) => rate === 1 ? euros : Math.max(50, Math.round(euros * rate / 50) * 50)
  const vat = base.defaultVat
  const cities = country?.cities ?? ['Lyon', 'Annecy', 'Paris']
  const supplierCities = country?.cities ?? ['Lille', 'Paris', 'Nantes']
  const sample = charts[base.chart].sample
  const accounts = accountsOf(base)

  const articles: Article[] = [
    { ref: 'LAMP-OPAL', name: 'Lampe de table Opale', family: 'Luminaires', cost: money(58), price: money(129), vat, stock: 42 },
    { ref: 'SUSP-LIN', name: 'Suspension Lin', family: 'Luminaires', cost: money(84), price: money(189), vat, stock: 18 },
    { ref: 'APPL-LAITON', name: 'Applique Laiton', family: 'Luminaires', cost: money(41), price: money(96), vat, stock: 27 },
    { ref: 'AMP-E27', name: 'Ampoule LED E27', family: 'Accessoires', cost: money(2.4), price: money(7.9), vat, stock: 320 },
    { ref: 'ABAT-LIN', name: 'Abat-jour lin', family: 'Composants', cost: money(12), price: money(34), vat, stock: 20 },
    { ref: 'PIED-CHENE', name: 'Pied en chêne', family: 'Composants', cost: money(15), price: money(28), vat, stock: 8 },
    { ref: 'KIT-ELEC', name: 'Kit électrique E27', family: 'Composants', cost: money(4.5), price: money(9), vat, stock: 80 },
  ]
  const line = (ref: string, qty: number, atCost = false): DocLine => {
    const article = articles.find((item) => item.ref === ref)!
    return { ref, qty, price: atCost ? article.cost : article.price, vat: article.vat }
  }
  // Supplier invoices awaiting approval, given by their net amount; VAT follows the company's rate.
  const received = (id: string, number: string, supplier: string, offset: number, net: number, account: string): SupplierInvoice => {
    const ht = money(net)
    const amount = roundTo(ht * (1 + vat / 100), digits)
    return { id, number, supplier, date: day(offset), due: day(offset + 30), amount, vat: roundTo(amount - ht, digits), account, status: 'needs_review' }
  }

  const firstInvoice = [line('LAMP-OPAL', 12), line('AMP-E27', 40)]
  const firstPurchase = [line('ABAT-LIN', 40, true), line('PIED-CHENE', 40, true)]
  const secondInvoice = [line('SUSP-LIN', 6)]
  let store: Store = {
    ...base,
    clients: [
      { code: 'C0001', name: 'Les Jardins SAS', city: cities[0], email: 'compta@lesjardins.example' },
      { code: 'C0002', name: 'Hôtel Belvédère', city: cities[1], email: 'achats@belvedere.example' },
      { code: 'C0003', name: 'Café des Arts', city: cities[2], email: 'contact@cafedesarts.example' },
    ],
    suppliers: [
      { code: 'F0001', name: 'Atelier Nord', city: supplierCities[0] },
      { code: 'F0002', name: 'Bureau Central', city: supplierCities[1] },
      { code: 'F0003', name: 'Studio Rivage', city: supplierCities[2] },
    ],
    articles,
    boms: [{ ref: 'LAMP-OPAL', components: [{ ref: 'ABAT-LIN', qty: 1 }, { ref: 'PIED-CHENE', qty: 1 }, { ref: 'KIT-ELEC', qty: 1 }] }],
    workOrders: [{ id: 'OF00001', ref: 'LAMP-OPAL', qty: 10, date: day(2), done: false }],
    supplierInvoices: [
      received('FR00001', 'FAC-0892', 'Atelier Nord', -4, 3566.67, sample.subcontracting),
      received('FR00002', 'INV-78419', 'Bureau Central', -3, 970.42, sample.office),
      received('FR00003', 'FAC-1906', 'Studio Rivage', -2, 7200, ''),
    ],
    bankLines: [
      { id: 'BK00001', date: day(-2), label: 'VIR RECU HOTEL BELVEDERE FA00002', amount: docTotals(secondInvoice, base.currency).ttc },
      { id: 'BK00002', date: day(-1), label: 'PRLV ATELIER NORD FF00001', amount: -docTotals(firstPurchase, base.currency).ttc },
      { id: 'BK00003', date: day(-1), label: 'FRAIS TENUE DE COMPTE', amount: -money(12.5) },
    ],
  }

  store = postPiece(store, 'OD', day(-60), 'Apport en capital', [{ account: accounts.bank, debit: money(50000), credit: 0 }, { account: sample.capital, debit: 0, credit: money(50000) }])
  store = savePurchaseDoc(store, { type: 'facture', supplier: 'F0001', date: day(-50), lines: firstPurchase })
  store = saveSalesDoc(store, { type: 'facture', client: 'C0001', date: day(-45), lines: firstInvoice, origin: 'commercial' })
  store = saveSalesDoc(store, { type: 'facture', client: 'C0002', date: day(-38), lines: secondInvoice, origin: 'commercial' })
  store = postPiece(store, 'BQ', day(-20), 'Règlement FA00001 · Les Jardins SAS', [
    { account: accounts.bank, debit: docTotals(firstInvoice, base.currency).ttc, credit: 0 },
    { account: accounts.clients, tiers: 'C0001', debit: 0, credit: docTotals(firstInvoice, base.currency).ttc },
  ])
  store = saveSalesDoc(store, { type: 'livraison', client: 'C0003', date: day(-6), lines: [line('APPL-LAITON', 4), line('AMP-E27', 12)], origin: 'commercial' })
  store = saveSalesDoc(store, { type: 'commande', client: 'C0002', date: day(-3), lines: [line('LAMP-OPAL', 8)], origin: 'commercial' })
  store = saveSalesDoc(store, { type: 'devis', client: 'C0001', date: day(-1), lines: [line('SUSP-LIN', 3), line('APPL-LAITON', 6)], origin: 'commercial' })
  store = savePurchaseDoc(store, { type: 'commande', supplier: 'F0001', date: day(-2), lines: [line('KIT-ELEC', 50, true)] })
  store = saveSalesDoc(store, { type: 'commande', client: 'C0003', date: day(-1), lines: [line('LAMP-OPAL', 2)], origin: 'caisse' })
  store = saveSalesDoc(store, { type: 'ticket', client: '', date: today, lines: [line('AMP-E27', 6)], origin: 'caisse', payment: 'cash' })
  store = saveSalesDoc(store, { type: 'ticket', client: '', date: today, lines: [line('LAMP-OPAL', 1), line('AMP-E27', 2)], origin: 'caisse', payment: 'card' })
  return store
}
