import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileInput,
  FileSearch,
  FileText,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { readInvoiceDocument, type ImportedInvoiceDraft } from './invoiceImport'
import { CloudAccess, type CloudSession } from './CloudAccess'
import { cloudConfigured, cloudRequest, downloadCloudDocument, signOutAccount, type CloudInvoice } from './cloudClient'
import { DesktopApp } from './DesktopApp'
import { desktop } from './desktopApi'
import logoMark from './assets/aicom-mark.webp'
import { SageModules } from './SageModules'
import { createStore, type ModuleId } from './sageData'
import './App.css'

const appStartDate = new Date()

type Locale = 'en' | 'fr'
type Section = 'overview' | 'invoices' | 'bank' | 'close' | 'forecast' | 'data' | 'audit' | 'help' | ModuleId

const copy = {
  en: {
    workspace: 'Workspace', overview: 'Overview', invoices: 'Supplier invoices', bank: 'Bank matching',
    close: 'Month-end close', forecast: 'Cash forecast', data: 'Data quality', audit: 'Audit trail',
    help: 'Help & guidance', settings: 'Settings', entities: 'ENTITIES', company: 'Maison Lumière SAS',
    date: 'Tuesday, 24 September 2024', greeting: 'Good morning, Amélie', subhead: 'Here’s what needs your attention today.',
    ask: 'Ask Ledger', period: 'This month', revenue: 'Revenue', receivables: 'Open receivables',
    payables: 'Open payables', cash: 'Cash position', vsLast: 'vs last month', pending: 'Awaiting review',
    overdue: 'overdue', healthy: 'On track', trend: 'Cash flow outlook', next90: 'Next 90 days',
    actual: 'Actual', projected: 'Projected', assistant: 'Ledger assistant', online: 'Demo mode',
    assistantPrompt: 'Ask about your numbers or get help with a task.', question: 'Why did the margin fall in August?',
    askPlaceholder: 'Ask a question...', invoicesTitle: 'Invoices to review', viewAll: 'View all',
    invoice: 'INVOICE', supplier: 'SUPPLIER', dueDate: 'DUE DATE', amount: 'AMOUNT', suggestion: 'SUGGESTED ACCOUNT',
    confidence: 'AI CONFIDENCE', review: 'REVIEW', approve: 'Approve', reject: 'Reject',
    closeTitle: 'Month-end close', closeDue: 'Due in 6 days', checklist: 'of 8 tasks complete',
    reviewItems: 'Review checklist', anomaliesTitle: 'Needs a closer look', anomalies: '2 items flagged',
    duplicate: 'Possible duplicate invoice', duplicateMeta: 'Atelier Nord · €4,280.00', unusual: 'Unusual amount for supplier',
    unusualMeta: 'Bureau Central · 3.4× monthly average', inspect: 'Inspect', allClear: 'All caught up',
    reconciled: 'reconciled', match: 'Match', matched: 'Matched', bankFeed: 'BANK FEED',
    bankTitle: 'Unmatched transactions', bankSub: 'Suggested matches are ranked by reference, amount and counterparty.',
    confidenceShort: 'match confidence', matchedToast: 'Transaction matched and added to the audit trail.',
    invoiceToast: 'Invoice approved. The action was added to the audit trail.', rejectToast: 'Invoice sent back for review.',
    taskToast: 'Checklist updated.', assistantToast: 'Your question is ready for the Ledger assistant.',
    forecastTitle: 'Cash flow forecast', forecastText: 'Expected cash position over the next 90 days, based on open items and recent history.',
    forecastNote: 'Forecast is indicative and does not replace treasury review.',
    dataTitle: 'Master data health', dataText: 'Improve the records behind more reliable reporting and automation.',
    records: 'records checked', needsAttention: 'Needs attention', missingTax: 'Suppliers missing tax ID',
    duplicateVendor: 'Possible duplicate suppliers', incomplete: 'Incomplete cost centres', fix: 'Review records',
    auditTitle: 'Recent activity', auditText: 'A traceable record of decisions and approvals in this workspace.',
    who: 'USER', action: 'ACTION', record: 'RECORD', when: 'WHEN', by: 'by',
    guideTitle: 'What can I help with?', guideText: 'Get answers about your numbers or guidance for a finance workflow.',
    promptOne: 'How do I record a supplier credit note?', promptTwo: 'Explain the three-way match process',
    promptThree: 'What is still blocking month-end close?', periodLabel: 'PERIOD', account: 'ACCOUNT',
    open: 'Open', home: 'Finance workspace', notification: 'Notifications', profile: 'Amélie Martin',
    reviewPending: 'For your review', pendingCount: '3 invoices', flagged: 'Flagged',
    importTitle: 'Review imported documents', importDescription: 'Check the extracted details before adding invoices to the review queue.',
    chooseDocuments: 'Choose PDF or XML files', localProcessing: 'Files are processed in this browser and are not uploaded.',
    supplierName: 'Supplier name', invoiceNumberLabel: 'Invoice number', invoiceDateLabel: 'Invoice date',
    paymentDateLabel: 'Due date', totalAmountLabel: 'Total amount', vatAmountLabel: 'VAT amount', currencyLabel: 'Currency',
    extractedText: 'Extracted PDF text', addToReview: 'Add to review queue', cancelImport: 'Cancel', removeDocument: 'Remove document',
    processingFiles: 'Reading documents…', noDocuments: 'Choose up to 10 PDF or FatturaPA XML files.',
    maxFilesError: 'A maximum of 10 documents can be reviewed at a time.', requiredFields: 'Complete supplier, invoice number, date, amount and currency for each document.',
    importSuccess: 'Documents added to the review queue. Nothing has been posted.', invalidFields: 'Enter a valid amount and currency for each document.',
    manualReview: 'Manual review required', unclassified: 'Unclassified · choose account',
    cloudUploadError: 'The cloud upload could not be completed. You can retry safely.',
    downloadDocument: 'Download source document', mixedCurrencies: 'Multiple currencies',
    modules: 'Sage 100 modules', commercial: 'Sales management', caisse: 'Point of sale', compta: 'Accounting',
  },
  fr: {
    workspace: 'Espace de travail', overview: 'Vue d’ensemble', invoices: 'Factures fournisseurs', bank: 'Rapprochement bancaire',
    close: 'Clôture mensuelle', forecast: 'Prévision de trésorerie', data: 'Qualité des données', audit: 'Piste d’audit',
    help: 'Aide & conseils', settings: 'Paramètres', entities: 'ENTITÉS', company: 'Maison Lumière SAS',
    date: 'Mardi 24 septembre 2024', greeting: 'Bonjour Amélie', subhead: 'Voici les éléments à traiter aujourd’hui.',
    ask: 'Demander à Ledger', period: 'Ce mois-ci', revenue: 'Chiffre d’affaires', receivables: 'Créances ouvertes',
    payables: 'Dettes fournisseurs', cash: 'Trésorerie disponible', vsLast: 'vs mois dernier', pending: 'À valider',
    overdue: 'en retard', healthy: 'À jour', trend: 'Prévision de trésorerie', next90: '90 prochains jours',
    actual: 'Réel', projected: 'Prévisionnel', assistant: 'Assistant Ledger', online: 'Mode démo',
    assistantPrompt: 'Posez une question sur vos chiffres ou une opération.', question: 'Pourquoi la marge a-t-elle baissé en août ?',
    askPlaceholder: 'Poser une question...', invoicesTitle: 'Factures à valider', viewAll: 'Tout voir',
    invoice: 'FACTURE', supplier: 'FOURNISSEUR', dueDate: 'ÉCHÉANCE', amount: 'MONTANT', suggestion: 'COMPTE SUGGÉRÉ',
    confidence: 'CONFIANCE IA', review: 'VALIDATION', approve: 'Valider', reject: 'Refuser',
    closeTitle: 'Clôture mensuelle', closeDue: 'Échéance dans 6 jours', checklist: 'tâches terminées sur 8',
    reviewItems: 'Voir la checklist', anomaliesTitle: 'À vérifier', anomalies: '2 alertes',
    duplicate: 'Doublon potentiel', duplicateMeta: 'Atelier Nord · 4 280,00 €', unusual: 'Montant inhabituel',
    unusualMeta: 'Bureau Central · 3,4× la moyenne mensuelle', inspect: 'Examiner', allClear: 'Tout est à jour',
    reconciled: 'rapproché', match: 'Rapprocher', matched: 'Rapproché', bankFeed: 'FLUX BANCAIRE',
    bankTitle: 'Mouvements non rapprochés', bankSub: 'Les suggestions sont classées selon la référence, le montant et le tiers.',
    confidenceShort: 'de confiance', matchedToast: 'Mouvement rapproché et ajouté à la piste d’audit.',
    invoiceToast: 'Facture validée. Action ajoutée à la piste d’audit.', rejectToast: 'Facture renvoyée pour vérification.',
    taskToast: 'Checklist mise à jour.', assistantToast: 'Votre question est prête pour l’assistant Ledger.',
    forecastTitle: 'Prévision de trésorerie', forecastText: 'Trésorerie estimée à 90 jours selon les échéances et l’historique récent.',
    forecastNote: 'Cette prévision est indicative et ne remplace pas le contrôle de trésorerie.',
    dataTitle: 'Santé des données de référence', dataText: 'Des données fiables améliorent les rapports et l’automatisation.',
    records: 'fiches vérifiées', needsAttention: 'À traiter', missingTax: 'Fournisseurs sans identifiant fiscal',
    duplicateVendor: 'Doublons fournisseurs possibles', incomplete: 'Centres de coûts incomplets', fix: 'Vérifier les fiches',
    auditTitle: 'Activité récente', auditText: 'Historique traçable des décisions et validations de cet espace.',
    who: 'UTILISATEUR', action: 'ACTION', record: 'ÉLÉMENT', when: 'DATE', by: 'par',
    guideTitle: 'Comment puis-je vous aider ?', guideText: 'Posez vos questions sur les chiffres ou les opérations financières.',
    promptOne: 'Comment comptabiliser un avoir fournisseur ?', promptTwo: 'Expliquer le rapprochement à trois voies',
    promptThree: 'Qu’est-ce qui bloque encore la clôture ?', periodLabel: 'PÉRIODE', account: 'COMPTE',
    open: 'Ouvrir', home: 'Espace finance', notification: 'Notifications', profile: 'Amélie Martin',
    reviewPending: 'À valider', pendingCount: '3 factures', flagged: 'Signalé',
    importTitle: 'Vérifier les documents importés', importDescription: 'Contrôlez les informations extraites avant d’ajouter les factures à la file de validation.',
    chooseDocuments: 'Choisir des fichiers PDF ou XML', localProcessing: 'Les fichiers sont traités dans ce navigateur et ne sont pas envoyés.',
    supplierName: 'Nom du fournisseur', invoiceNumberLabel: 'Numéro de facture', invoiceDateLabel: 'Date de facture',
    paymentDateLabel: 'Date d’échéance', totalAmountLabel: 'Montant total', vatAmountLabel: 'Montant de TVA', currencyLabel: 'Devise',
    extractedText: 'Texte extrait du PDF', addToReview: 'Ajouter à la file de validation', cancelImport: 'Annuler', removeDocument: 'Supprimer le document',
    processingFiles: 'Lecture des documents…', noDocuments: 'Choisissez jusqu’à 10 fichiers PDF ou XML FatturaPA.',
    maxFilesError: 'Vous pouvez vérifier jusqu’à 10 documents à la fois.', requiredFields: 'Renseignez le fournisseur, le numéro, la date, le montant et la devise pour chaque document.',
    importSuccess: 'Documents ajoutés à la file de validation. Aucune écriture n’a été publiée.', invalidFields: 'Saisissez un montant et une devise valides pour chaque document.',
    manualReview: 'Vérification manuelle requise', unclassified: 'À classer · choisir un compte',
    cloudUploadError: 'Le transfert cloud a échoué. Vous pouvez réessayer sans renvoyer le document déjà reçu.',
    downloadDocument: 'Télécharger le document source', mixedCurrencies: 'Devises multiples',
    modules: 'Modules Sage 100', commercial: 'Gestion commerciale', caisse: 'Saisie de caisse', compta: 'Comptabilité',
  },
} as const

const navItems = [
  { id: 'overview', icon: LayoutDashboard, key: 'overview' },
  { id: 'invoices', icon: FileInput, key: 'invoices' },
  { id: 'bank', icon: ArrowDownLeft, key: 'bank' },
  { id: 'close', icon: ClipboardCheck, key: 'close' },
  { id: 'forecast', icon: Wallet, key: 'forecast' },
  { id: 'data', icon: FileSearch, key: 'data' },
  { id: 'audit', icon: ShieldCheck, key: 'audit' },
  { id: 'help', icon: CircleHelp, key: 'help' },
] as const

const moduleNavItems = [
  { id: 'commercial', icon: ShoppingCart, key: 'commercial' },
  { id: 'caisse', icon: Store, key: 'caisse' },
  { id: 'compta', icon: BookOpen, key: 'compta' },
] as const

const invoicesSeed = [
  { id: 'FAC-2026-0892', vendor: 'Atelier Nord', initials: 'AN', color: 'coral', date: '2026-10-08', amount: 4280, account: '611200', label: 'Subcontracting', frenchLabel: 'Sous-traitance', confidence: 98 },
  { id: 'INV-78419', vendor: 'Bureau Central', initials: 'BC', color: 'blue', date: '2026-10-10', amount: 1164.5, account: '606400', label: 'Office supplies', frenchLabel: 'Fournitures de bureau', confidence: 94 },
  { id: 'FAC-2026-1906', vendor: 'Studio Rivage', initials: 'SR', color: 'green', date: '2026-10-12', amount: 8640, account: '623100', label: 'Marketing', frenchLabel: 'Publicité', confidence: 76 },
]

type InvoiceRecord = {
  id: string
  invoiceNumber?: string
  vendor: string
  initials: string
  color: string
  date: string
  amount: number
  currency?: string
  vatAmount?: number
  documentId?: string
  account: string
  label: string
  frenchLabel: string
  confidence: number
  sourceName?: string
}

const bankSeed = [
  { id: 'TX-40218', date: '30 Sep', details: 'SEPA TRANSFER · FACT 0892', account: 'Atelier Nord', amount: -4280, confidence: 99 },
  { id: 'TX-40215', date: '30 Sep', details: 'CB *BUREAU CENTR…', account: 'Bureau Central', amount: -1164.5, confidence: 93 },
  { id: 'TX-40192', date: '29 Sep', details: 'VIR RECU CLIENT 0481', account: 'Les Jardins SAS', amount: 6400, confidence: 87 },
]

const closeTasks = [
  'Reconcile all bank accounts', 'Review open supplier invoices', 'Post recurring accruals', 'Validate prepaid expenses',
  'Review intercompany balances', 'Check revenue cut-off', 'Approve payroll journal', 'Lock accounting period',
]

const auditRowsSeed: [string, string, string, string][] = [
  ['Amélie Martin', 'Approved invoice', 'FAC-2024-0865 · Atelier Nord', '10:42'],
  ['Ledger AI', 'Suggested account', 'INV-78419 · 606400', '10:18'],
  ['Thomas Leroy', 'Matched transaction', 'TX-40201 · Les Jardins SAS', '09:56'],
  ['Amélie Martin', 'Updated supplier', 'SUP-00184 · Bureau Central', 'Yesterday'],
]

function App() {
  // Installed desktop app: licence, Google account and data in the customer's own Drive.
  if (desktop) return <DesktopApp api={desktop} />
  if (!cloudConfigured) return <Dashboard />
  return <CloudAccess>{(session) => <Dashboard cloudSession={session} />}</CloudAccess>
}

function Dashboard({ cloudSession }: { cloudSession?: CloudSession }) {
  const [locale, setLocale] = useState<Locale>('fr')
  const [section, setSection] = useState<Section>('overview')
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(cloudSession ? [] : invoicesSeed)
  const [matched, setMatched] = useState<string[]>([])
  const [completed, setCompleted] = useState<number[]>([0, 1, 2, 3, 4])
  const [auditRows, setAuditRows] = useState<[string, string, string, string][]>(cloudSession ? [] : auditRowsSeed)
  const [toast, setToast] = useState('')
  const [question, setQuestion] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importDrafts, setImportDrafts] = useState<ImportedInvoiceDraft[]>([])
  const [importError, setImportError] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [sageStore, setSageStore] = useState(createStore)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const t = copy[locale]

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = locale === 'fr' ? 'AICOM | Espace finance' : 'AICOM | Finance workspace'
  }, [locale])

  useEffect(() => {
    if (!cloudSession) return
    let active = true
    const workspaceId = encodeURIComponent(cloudSession.workspace.id)
    Promise.all([
      cloudRequest<{ invoices: CloudInvoice[] }>(cloudSession.user, `/api/invoices?workspaceId=${workspaceId}`),
      cloudRequest<{ events: { user_uid: string; action: string; entity_id: string; created_at: string }[] }>(cloudSession.user, `/api/audit?workspaceId=${workspaceId}`),
    ]).then(([invoiceResult, auditResult]) => {
      if (!active) return
      setInvoices(invoiceResult.invoices.filter((invoice) => invoice.status === 'needs_review').map((invoice, index) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        vendor: invoice.supplier,
        initials: invoice.supplier.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
        color: ['coral', 'blue', 'green'][index % 3],
        date: invoice.due_date || invoice.invoice_date,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        vatAmount: invoice.vat_amount ? Number(invoice.vat_amount) : undefined,
        account: invoice.account_code || (locale === 'fr' ? 'À classer' : 'Unclassified'),
        label: invoice.account_code || '',
        frenchLabel: invoice.account_code || '',
        confidence: 0,
        sourceName: invoice.source_name || undefined,
        documentId: invoice.document_id || undefined,
      })))
      setAuditRows(auditResult.events.map((event) => [
        event.user_uid === cloudSession.user.uid ? (cloudSession.user.displayName || cloudSession.user.email || 'You') : event.user_uid.slice(0, 10),
        event.action,
        event.entity_id,
        new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.created_at)),
      ]))
    }).catch(() => { if (active) notify(locale === 'fr' ? 'Impossible de synchroniser les données cloud.' : 'Cloud data could not be synchronized.') })
    return () => { active = false }
  }, [cloudSession, locale])

  const today = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(appStartDate)
  const currency = (amount: number, currencyCode = 'EUR') => new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-IE', { style: 'currency', currency: currencyCode }).format(amount)
  const dueDate = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day))
  }

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  async function decideInvoice(id: string, approved: boolean) {
    const invoice = invoices.find((item) => item.id === id)
    if (cloudSession) {
      try {
        await cloudRequest(cloudSession.user, `/api/invoices/${encodeURIComponent(id)}/review`, {
          method: 'PATCH',
          body: JSON.stringify({ workspaceId: cloudSession.workspace.id, status: approved ? 'approved' : 'rejected' }),
        })
      } catch (error) {
        notify(error instanceof Error ? error.message : t.invoiceToast)
        return
      }
    }
    setInvoices((current) => current.filter((invoice) => invoice.id !== id))
    if (invoice) setAuditRows((current) => [[cloudSession?.user.displayName || cloudSession?.user.email || 'Amélie Martin', approved ? 'Approved invoice' : 'Rejected invoice', `${invoice.invoiceNumber || id} · ${invoice.vendor}`, 'Now'], ...current])
    notify(approved ? t.invoiceToast : t.rejectToast)
  }

  async function handleImportFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? [])
    if (!files.length) return
    if (files.length + importDrafts.length > 10) {
      setImportError(t.maxFilesError)
      return
    }

    setIsImporting(true)
    setImportError('')
    const parsed: ImportedInvoiceDraft[] = []
    const failures: string[] = []

    for (const file of files) {
      try {
        parsed.push(await readInvoiceDocument(file))
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Could not read this file.'}`)
      }
    }

    setImportDrafts((current) => [...current, ...parsed])
    setImportError(failures.join(' '))
    setIsImporting(false)
  }

  function updateImportDraft(key: string, field: 'supplier' | 'invoiceNumber' | 'invoiceDate' | 'dueDate' | 'amount' | 'vatAmount' | 'currency', value: string) {
    setImportDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, [field]: value } : draft))
  }

  async function addImportedInvoices() {
    if (!importDrafts.length) return
    const requiredFieldsComplete = importDrafts.every((draft) => draft.supplier.trim() && draft.invoiceNumber.trim() && draft.invoiceDate && draft.amount && draft.currency)
    if (!requiredFieldsComplete) {
      setImportError(t.requiredFields)
      return
    }

    const amounts = importDrafts.map((draft) => Number(draft.amount.replace(',', '.')))
    if (amounts.some((amount) => !Number.isFinite(amount))) {
      setImportError(t.invalidFields)
      return
    }

    if (cloudSession) {
      setIsImporting(true)
      setImportError('')
      try {
        for (const draft of importDrafts) {
          let documentId = draft.remoteDocumentId
          if (!documentId) {
            const contentType = draft.fileType === 'PDF' ? 'application/pdf' : 'application/xml'
            const uploaded = await cloudRequest<{ id: string }>(cloudSession.user, `/api/documents?workspaceId=${encodeURIComponent(cloudSession.workspace.id)}`, {
              method: 'POST',
              headers: { 'Content-Type': contentType, 'X-File-Name': draft.fileName },
              body: draft.sourceFile,
            })
            documentId = uploaded.id
            setImportDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, remoteDocumentId: documentId } : item))
          }

          const saved = await cloudRequest<{ id: string }>(cloudSession.user, '/api/invoices', {
            method: 'POST',
            body: JSON.stringify({
              workspaceId: cloudSession.workspace.id,
              documentId,
              invoiceNumber: draft.invoiceNumber.trim(),
              supplier: draft.supplier.trim(),
              invoiceDate: draft.invoiceDate,
              dueDate: draft.dueDate || null,
              amount: Number(draft.amount.replace(',', '.')),
              vatAmount: draft.vatAmount ? Number(draft.vatAmount.replace(',', '.')) : null,
              currency: draft.currency,
            }),
          })
          const invoice: InvoiceRecord = {
            id: saved.id,
            invoiceNumber: draft.invoiceNumber.trim(),
            vendor: draft.supplier.trim(),
            initials: draft.supplier.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
            color: 'blue',
            date: draft.dueDate || draft.invoiceDate,
            amount: Number(draft.amount.replace(',', '.')),
            currency: draft.currency,
            vatAmount: draft.vatAmount ? Number(draft.vatAmount.replace(',', '.')) : undefined,
            account: t.unclassified,
            label: draft.fileType,
            frenchLabel: draft.fileType,
            confidence: 0,
            sourceName: draft.fileName,
            documentId,
          }
          setInvoices((current) => [invoice, ...current])
          setAuditRows((current) => [[cloudSession.user.displayName || cloudSession.user.email || 'You', 'Imported document', `${invoice.invoiceNumber} · ${draft.fileName}`, 'Now'], ...current])
          setImportDrafts((current) => current.filter((item) => item.key !== draft.key))
        }
        setImportOpen(false)
        notify(t.importSuccess)
      } catch (error) {
        setImportError(error instanceof Error ? error.message : t.cloudUploadError)
      } finally {
        setIsImporting(false)
      }
      return
    }

    const imported: InvoiceRecord[] = importDrafts.map((draft, index) => ({
      id: `LOCAL-${Date.now()}-${index}`,
      invoiceNumber: draft.invoiceNumber.trim(),
      vendor: draft.supplier.trim(),
      initials: draft.supplier.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
      color: ['coral', 'blue', 'green'][index % 3],
      date: draft.dueDate,
      amount: Number(draft.amount.replace(',', '.')),
      currency: draft.currency,
      vatAmount: draft.vatAmount ? Number(draft.vatAmount.replace(',', '.')) : undefined,
      account: t.unclassified,
      label: draft.fileType,
      frenchLabel: draft.fileType,
      confidence: 0,
      sourceName: draft.fileName,
    }))

    setInvoices((current) => [...imported, ...current])
    setAuditRows((current) => [...imported.map((invoice) => ['Amélie Martin', 'Imported document', `${invoice.invoiceNumber} · ${invoice.sourceName}`, 'Now'] as [string, string, string, string]), ...current])
    setImportDrafts([])
    setImportOpen(false)
    setImportError('')
    setSection('invoices')
    notify(t.importSuccess)
  }

  function toggleTask(index: number) {
    setCompleted((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])
    notify(t.taskToast)
  }

  const activeModule = moduleNavItems.find((item) => item.id === section)
  const activeNav = activeModule ?? navItems.find((item) => item.id === section)
  const sectionTitle = activeNav ? t[activeNav.key] : t.overview
  const completedLabel = locale === 'fr' ? 'terminées sur 8' : 'of 8 tasks complete'
  const reviewCurrencies = Array.from(new Set(invoices.map((invoice) => invoice.currency || 'EUR')))
  const reviewAmount = reviewCurrencies.length > 1
    ? t.mixedCurrencies
    : currency(invoices.reduce((sum, invoice) => sum + invoice.amount, 0), reviewCurrencies[0] || 'EUR')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setSection('overview')} aria-label="AICOM home">
          <img className="brand-mark" src={logoMark} alt="" />
          <span className="brand-name">AICOM</span>
        </a>
        <button className="entity-select" type="button" aria-label={t.company}>
          <span className="entity-icon"><Building2 size={17} /></span>
          <span className="entity-copy"><strong>{cloudSession?.workspace.name || t.company}</strong><small>{cloudSession ? (locale === 'fr' ? 'Espace cloud AICOM' : 'AICOM cloud workspace') : 'France · EUR'}</small></span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-caption">{t.workspace}</div>
        <nav className="main-nav" aria-label={t.workspace}>
          {navItems.filter(({ id }) => !cloudSession || ['overview', 'invoices', 'audit'].includes(id)).map(({ id, icon: Icon, key }) => (
              <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} aria-label={t[key]} title={t[key]} onClick={() => setSection(id as Section)} type="button">
              <Icon size={17} strokeWidth={1.8} /><span>{t[key]}</span>
              {id === 'invoices' && <span className="nav-count">{invoices.length}</span>}
            </button>
          ))}
        </nav>
        {!cloudSession && <>
          <div className="nav-caption module-caption">{t.modules}</div>
          <nav className="main-nav" aria-label={t.modules}>
            {moduleNavItems.map(({ id, icon: Icon, key }) => (
              <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} aria-label={t[key]} title={t[key]} onClick={() => setSection(id)} type="button">
                <Icon size={17} strokeWidth={1.8} /><span>{t[key]}</span>
              </button>
            ))}
          </nav>
        </>}
        <div className="sidebar-bottom">
          <div className="pilot-card"><span className="pilot-icon"><Sparkles size={15} /></span><div><strong>{cloudSession ? 'Google Cloud' : 'Ledger AI'}</strong><small>{cloudSession ? `${(Number(cloudSession.workspace.storage_used_bytes) / 1024 ** 3).toFixed(1)} / ${(Number(cloudSession.workspace.storage_quota_bytes) / 1024 ** 3).toFixed(0)} GB` : (locale === 'fr' ? 'Données démo · assisté' : 'Sample data · assisted')}</small></div><span className="status-dot" /></div>
          <button className="nav-item settings-link" onClick={() => notify(locale === 'fr' ? 'Les paramètres seront disponibles dans votre espace administrateur.' : 'Settings are available in your admin workspace.')} type="button"><MoreHorizontal size={17} /><span>{t.settings}</span></button>
          {cloudSession && <button className="nav-item settings-link" onClick={() => { void signOutAccount() }} type="button"><LogOut size={17} /><span>{locale === 'fr' ? 'Se déconnecter' : 'Sign out'}</span></button>}
          <div className="profile-row"><div className="avatar profile-avatar">{cloudSession ? (cloudSession.user.displayName || cloudSession.user.email || 'AC').slice(0, 2).toUpperCase() : 'AM'}</div><div className="profile-copy"><strong>{cloudSession?.user.displayName || cloudSession?.user.email || t.profile}</strong><small>{cloudSession ? (locale === 'fr' ? 'Compte vérifié' : 'Verified account') : 'Finance · Admin'}</small></div><MoreHorizontal size={17} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>{t.home}</span><span className="crumb-slash">/</span><strong>{sectionTitle}</strong></div>
          <div className="topbar-actions">
            <div className="search-box"><Search size={15} /><span>{locale === 'fr' ? 'Rechercher partout…' : 'Search everything…'}</span><kbd>⌘ K</kbd></div>
            <button className="language-toggle" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')} type="button" aria-label="Switch language">{locale === 'fr' ? 'FR' : 'EN'}<ChevronDown size={13} /></button>
            <button className="icon-button notification-button" aria-label={t.notification} onClick={() => notify(locale === 'fr' ? 'Aucune nouvelle notification.' : 'No new notifications.')} type="button"><Bell size={17} /><i /></button>
            <div className="avatar top-avatar">AM</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div><div className="eyebrow"><CalendarDays size={13} />{today}</div><h1>{section === 'overview' ? t.greeting : sectionTitle}</h1><p>{section === 'overview' ? t.subhead : sectionDescription(section, locale)}</p></div>
            {!cloudSession && <button className="primary-button" onClick={() => setSection('help')} type="button"><Sparkles size={16} />{t.ask}<ArrowRight size={15} /></button>}
          </section>

          {!cloudSession && activeModule && <SageModules module={activeModule.id} admin locale={locale} store={sageStore} setStore={setSageStore} money={(amount) => currency(amount)} notify={notify} audit={(action, record) => setAuditRows((current) => [['Amélie Martin', action, record, 'Now'], ...current])} onModule={setSection} />}

          {!cloudSession && !activeModule && <section className="metrics-grid" aria-label={locale === 'fr' ? 'Indicateurs financiers' : 'Financial overview'}>
            <Metric title={t.revenue} value={currency(284650)} delta="+12.8%" icon={<ArrowUpRight size={16} />} kind="positive" period={t.vsLast} />
            <Metric title={t.receivables} value={currency(86420)} delta="12" icon={<FileCheck2 size={16} />} kind="neutral" period={locale === 'fr' ? 'factures ouvertes' : 'open invoices'} />
            <Metric title={t.payables} value={currency(32180)} delta={t.pendingCount} icon={<Clock3 size={16} />} kind="attention" period={t.pending} />
            <Metric title={t.cash} value={currency(142890)} delta="+8.2%" icon={<Wallet size={16} />} kind="positive" period={t.vsLast} />
          </section>}
          {cloudSession && <section className="metrics-grid" aria-label={locale === 'fr' ? 'Aperçu cloud' : 'Cloud overview'}>
            <Metric title={locale === 'fr' ? 'Factures à valider' : 'Invoices in review'} value={String(invoices.length)} delta="" icon={<FileCheck2 size={16} />} kind="neutral" period={locale === 'fr' ? 'dans cet espace' : 'in this workspace'} />
            <Metric title={locale === 'fr' ? 'Montant à valider' : 'Review amount'} value={reviewAmount} delta="" icon={<Clock3 size={16} />} kind="attention" period={locale === 'fr' ? 'file actuelle' : 'current queue'} />
            <Metric title={locale === 'fr' ? 'Stockage utilisé' : 'Storage used'} value={`${(Number(cloudSession.workspace.storage_used_bytes) / 1024 ** 3).toFixed(2)} GB`} delta="" icon={<Wallet size={16} />} kind="positive" period={`${locale === 'fr' ? 'quota' : 'quota'} ${(Number(cloudSession.workspace.storage_quota_bytes) / 1024 ** 3).toFixed(0)} GB`} />
            <Metric title={locale === 'fr' ? 'État du cloud' : 'Cloud status'} value={locale === 'fr' ? 'Connecté' : 'Connected'} delta="" icon={<ShieldCheck size={16} />} kind="positive" period={locale === 'fr' ? 'compte vérifié' : 'verified account'} />
          </section>}

          {!cloudSession && (section === 'overview' || section === 'forecast') && <section className="overview-grid">
            <div className="panel chart-panel">
              <div className="panel-heading"><div><div className="panel-title">{t.trend}</div><div className="panel-subtitle">{locale === 'fr' ? 'Encaissements et décaissements estimés' : 'Estimated inflows and outflows'}</div></div><button className="select-button" type="button">{t.next90}<ChevronDown size={14} /></button></div>
              <div className="chart-summary"><strong>{currency(186240)}</strong><span className="trend-positive"><ArrowUpRight size={14} /> 14.2%</span><small>{locale === 'fr' ? 'solde estimé au 29 déc.' : 'projected balance on Dec 29'}</small></div>
              <div className="chart-wrap"><div className="chart-y-labels"><span>€200k</span><span>€150k</span><span>€100k</span><span>€50k</span><span>€0</span></div><div className="chart-area"><div className="chart-gridlines"><i /><i /><i /><i /><i /></div><div className="chart-bars">{[54, 66, 58, 78, 64, 82, 71, 94, 74, 86, 68, 96].map((height, index) => <div className={`bar-group ${index > 5 ? 'forecast-bar' : ''}`} key={index}><span className="bar income" style={{ height: `${height}%` }} /><span className="bar expense" style={{ height: `${Math.max(22, height - 28)}%` }} /></div>)}</div><div className="chart-x-labels"><span>Sep 30</span><span>Oct 14</span><span>Oct 28</span><span>Nov 11</span><span>Nov 25</span><span>Dec 09</span><span>Dec 23</span></div></div></div>
              <div className="chart-legend"><span><i className="legend-income" />{t.actual}</span><span><i className="legend-expense" />{t.projected}</span><span className="chart-disclaimer">{t.forecastNote}</span></div>
            </div>

            <div className="panel assistant-card">
              <div className="panel-heading"><div className="assistant-heading"><span className="assistant-icon"><Bot size={18} /></span><div><div className="panel-title">{t.assistant}</div><div className="assistant-status"><i />{t.online}</div></div></div><button className="icon-button subtle" aria-label={t.open} type="button" onClick={() => setSection('help')}><ArrowRight size={16} /></button></div>
              <div className="assistant-body"><div className="assistant-greeting"><Sparkles size={15} /><span>{t.assistantPrompt}</span></div><button className="suggested-question" type="button" onClick={() => { setQuestion(t.question); setSection('help') }}><span>{t.question}</span><ArrowUpRight size={14} /></button></div>
              <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); if (question.trim()) { notify(t.assistantToast); setQuestion('') } }}><input aria-label={t.askPlaceholder} placeholder={t.askPlaceholder} value={question} onChange={(event) => setQuestion(event.target.value)} /><button aria-label={t.ask} type="submit"><Send size={15} /></button></form>
              <div className="human-review"><LockKeyhole size={12} />{locale === 'fr' ? 'Les réponses IA sont vérifiées par votre équipe' : 'AI answers are reviewed by your team'}</div>
            </div>
          </section>}

          {(section === 'overview' || section === 'invoices') && <section className="panel invoice-panel">
            <div className="panel-heading invoice-heading"><div><div className="panel-title">{t.invoicesTitle}<span className="title-count">{invoices.length}</span></div><div className="panel-subtitle">{locale === 'fr' ? 'Suggestions de comptabilisation à valider' : 'Suggested coding awaiting your approval'}</div></div><button className="text-button" onClick={() => setSection('invoices')} type="button">{t.viewAll}<ArrowRight size={14} /></button></div>
            {invoices.length > 0 ? <div className="table-scroll"><table className="data-table invoice-table"><thead><tr><th>{t.invoice}</th><th>{t.supplier}</th><th>{t.dueDate}</th><th>{t.amount}</th><th>{t.suggestion}</th><th>{t.confidence}</th><th>{t.review}</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><strong className="invoice-id">{invoice.invoiceNumber || invoice.id}</strong>{invoice.sourceName && (cloudSession && invoice.documentId ? <button className="document-download" type="button" aria-label={`${t.downloadDocument}: ${invoice.sourceName}`} onClick={() => { void downloadCloudDocument(cloudSession.user, cloudSession.workspace.id, invoice.documentId!, invoice.sourceName!).catch((error: unknown) => notify(error instanceof Error ? error.message : t.cloudUploadError)) }}><Download size={12} />{invoice.sourceName}</button> : <small className="source-file">{invoice.sourceName}</small>)}</td><td><div className="vendor-cell"><span className={`vendor-avatar ${invoice.color}`}>{invoice.initials}</span><span>{invoice.vendor}</span></div></td><td className="date-cell">{invoice.date ? dueDate(invoice.date) : '—'}</td><td className="amount-cell">{currency(invoice.amount, invoice.currency)}</td><td><span className="account-suggestion">{invoice.sourceName ? (locale === 'fr' ? 'À classer' : 'Unclassified') : `${invoice.account} · ${locale === 'fr' ? invoice.frenchLabel : invoice.label}`}</span></td><td>{invoice.sourceName ? <span className="manual-review-badge"><FileSearch size={12} />{t.manualReview}</span> : <div className="confidence-cell"><span className={`confidence-track ${invoice.confidence < 80 ? 'medium' : ''}`}><i style={{ width: `${invoice.confidence}%` }} /></span><span>{invoice.confidence}%</span></div>}</td><td><div className="row-actions"><button className="approve-button" onClick={() => { void decideInvoice(invoice.id, true) }} type="button" aria-label={`${t.approve} ${invoice.invoiceNumber || invoice.id}`}><Check size={14} />{t.approve}</button><button className="reject-button" onClick={() => { void decideInvoice(invoice.id, false) }} type="button" aria-label={`${t.reject} ${invoice.invoiceNumber || invoice.id}`}><X size={14} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><CheckCircle2 size={19} />{t.allClear}</div>}
            <div className="invoice-footer"><span><ShieldCheck size={13} />{locale === 'fr' ? 'Aucune écriture n’est publiée sans validation' : 'No entries are posted without approval'}</span><button type="button" className="upload-button" onClick={() => { setImportError(''); setImportOpen(true); fileInputRef.current?.click() }}><Plus size={14} />{locale === 'fr' ? 'Importer des factures' : 'Import invoices'}</button></div>
          </section>}

          {!cloudSession && (section === 'overview' || section === 'close') && <section className="lower-grid">
            <div className="panel close-panel"><div className="panel-heading"><div><div className="panel-title">{t.closeTitle}</div><div className="panel-subtitle">{t.closeDue}</div></div><span className="close-progress-count">{completed.length}/8</span></div><div className="progress-track"><i style={{ width: `${completed.length * 12.5}%` }} /></div><div className="close-caption"><span>{completed.length} {completedLabel}</span><button className="text-button" type="button" onClick={() => setSection('close')}>{t.reviewItems}<ArrowRight size={14} /></button></div><div className="task-list">{closeTasks.slice(0, section === 'close' ? 8 : 4).map((task, index) => <button className={`task-row ${completed.includes(index) ? 'task-done' : ''}`} key={task} onClick={() => toggleTask(index)} type="button"><span className="task-check">{completed.includes(index) && <Check size={12} />}</span><span>{localizeTask(task, locale)}</span>{index === 5 && <span className="task-owner">{locale === 'fr' ? 'À valider' : 'Review'}</span>}</button>)}</div></div>
            <div className="panel anomaly-panel"><div className="panel-heading"><div><div className="panel-title">{t.anomaliesTitle}<span className="alert-count">2</span></div><div className="panel-subtitle">{t.anomalies}</div></div><button className="icon-button subtle" aria-label={t.open} type="button" onClick={() => setSection('invoices')}><ArrowRight size={16} /></button></div><div className="anomaly-item"><span className="anomaly-icon duplicate-icon"><FileSearch size={16} /></span><div className="anomaly-copy"><strong>{t.duplicate}</strong><small>{t.duplicateMeta}</small></div><span className="severity-dot" /></div><div className="anomaly-item"><span className="anomaly-icon unusual-icon"><ShieldAlert size={16} /></span><div className="anomaly-copy"><strong>{t.unusual}</strong><small>{t.unusualMeta}</small></div><span className="severity-dot" /></div><button className="anomaly-link" onClick={() => setSection('invoices')} type="button">{t.inspect}<ArrowRight size={14} /></button></div>
          </section>}

          {section === 'bank' && <section className="panel workflow-panel"><div className="panel-heading"><div><div className="panel-title">{t.bankTitle}</div><div className="panel-subtitle">{t.bankSub}</div></div><span className="feed-badge"><i />{t.bankFeed} · 30 SEP</span></div><div className="bank-summary"><span><strong>{currency(11844.5)}</strong><small>{locale === 'fr' ? '3 mouvements à rapprocher' : '3 transactions to match'}</small></span><span className="reconciled-pill"><BadgeCheck size={14} />82% {t.reconciled}</span></div><div className="bank-list">{bankSeed.map((item) => <div className={`bank-row ${matched.includes(item.id) ? 'bank-row-matched' : ''}`} key={item.id}><span className="bank-date">{item.date}</span><span className="bank-description"><strong>{item.details}</strong><small>{item.id} · {item.account}</small></span><span className="bank-amount">{currency(item.amount)}</span><span className="bank-confidence"><CheckCircle2 size={14} />{item.confidence}% <small>{t.confidenceShort}</small></span><button className="match-button" type="button" disabled={matched.includes(item.id)} onClick={() => { setMatched((current) => [...current, item.id]); setAuditRows((current) => [['Amélie Martin', 'Matched transaction', `${item.id} · ${item.account}`, 'Now'], ...current]); notify(t.matchedToast) }}>{matched.includes(item.id) ? <><Check size={14} />{t.matched}</> : <>{t.match}<ArrowRight size={13} /></>}</button></div>)}</div></section>}

          {section === 'forecast' && <section className="panel forecast-detail"><div className="panel-heading"><div><div className="panel-title">{t.forecastTitle}</div><div className="panel-subtitle">{t.forecastText}</div></div><span className="forecast-confidence"><Sparkles size={14} />{locale === 'fr' ? 'Confiance moyenne' : 'Medium confidence'}</span></div><div className="forecast-breakdown"><div><ArrowDownLeft size={16} /><span>{locale === 'fr' ? 'Encaissements attendus' : 'Expected inflows'}</span><strong>{currency(94200)}</strong></div><div><ArrowUpRight size={16} /><span>{locale === 'fr' ? 'Décaissements attendus' : 'Expected outflows'}</span><strong>{currency(51860)}</strong></div><div><Wallet size={16} /><span>{locale === 'fr' ? 'Solde prévisionnel' : 'Projected balance'}</span><strong>{currency(186240)}</strong></div></div></section>}

          {section === 'data' && <section className="panel data-panel"><div className="panel-heading"><div><div className="panel-title">{t.dataTitle}</div><div className="panel-subtitle">{t.dataText}</div></div><div className="data-score"><strong>94</strong><span>/ 100</span><small>{t.records}</small></div></div><div className="data-progress"><i /></div><div className="data-issues"><DataIssue title={t.missingTax} meta={locale === 'fr' ? '12 fiches fournisseurs' : '12 supplier records'} /><DataIssue title={t.duplicateVendor} meta={locale === 'fr' ? '4 paires à vérifier' : '4 pairs to review'} /><DataIssue title={t.incomplete} meta={locale === 'fr' ? '3 centres sans responsable' : '3 centres without an owner'} /></div><button className="upload-button data-review" onClick={() => notify(locale === 'fr' ? 'La revue des fiches a été ajoutée à votre espace de travail.' : 'Record review added to your workspace.')} type="button"><FileSearch size={15} />{t.fix}<ArrowRight size={14} /></button></section>}

          {section === 'audit' && <section className="panel workflow-panel"><div className="panel-heading"><div><div className="panel-title">{t.auditTitle}</div><div className="panel-subtitle">{t.auditText}</div></div><span className="audit-protected"><LockKeyhole size={13} />{locale === 'fr' ? 'Journal de démo' : 'Demo log'}</span></div><div className="table-scroll"><table className="data-table audit-table"><thead><tr><th>{t.who}</th><th>{t.action}</th><th>{t.record}</th><th>{t.when}</th></tr></thead><tbody>{auditRows.map(([user, action, record, time], index) => <tr key={`${record}-${index}`}><td><div className="audit-user"><span className={`avatar audit-avatar ${user === 'Ledger AI' ? 'ai-avatar' : ''}`}>{user === 'Ledger AI' ? <Bot size={15} /> : user.split(' ').map((part) => part[0]).join('')}</span>{user}</div></td><td>{localizeAction(action, locale)}</td><td className="audit-record">{record}</td><td className="date-cell">{time === 'Now' && locale === 'fr' ? 'À l’instant' : time}</td></tr>)}</tbody></table></div><div className="audit-footnote"><ShieldCheck size={14} />{locale === 'fr' ? 'Chaque suggestion et validation IA est horodatée et attribuée.' : 'Every AI suggestion and approval is timestamped and attributed.'}</div></section>}

          {section === 'help' && <section className="panel help-panel"><div className="help-hero"><span className="help-orbit"><Bot size={25} /></span><div><div className="panel-title">{t.guideTitle}</div><p>{t.guideText}</p></div></div><div className="help-prompts">{[t.promptOne, t.promptTwo, t.promptThree].map((prompt) => <button key={prompt} type="button" onClick={() => { setQuestion(prompt); notify(t.assistantToast) }}><span><Sparkles size={14} />{prompt}</span><ArrowUpRight size={15} /></button>)}</div><form className="help-input" onSubmit={(event) => { event.preventDefault(); if (question.trim()) { notify(t.assistantToast); setQuestion('') } }}><input aria-label={t.askPlaceholder} placeholder={t.askPlaceholder} value={question} onChange={(event) => setQuestion(event.target.value)} /><button type="submit"><Send size={15} />{t.ask}</button></form><div className="human-review"><LockKeyhole size={12} />{locale === 'fr' ? 'Les réponses IA sont indicatives et ne publient aucune écriture.' : 'AI responses are guidance only and never post entries.'}</div></section>}

          <footer className="page-footer"><span><ShieldCheck size={13} />{locale === 'fr' ? 'Prototype local · données de démonstration' : 'Local prototype · sample data'}</span><span>AICOM · v0.1 pilot</span></footer>
        </div>
      </main>
      <input ref={fileInputRef} className="hidden-file-input" type="file" accept=".pdf,.xml,application/pdf,text/xml,application/xml" multiple onChange={(event) => { void handleImportFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
      {importOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isImporting) setImportOpen(false) }}><section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="import-dialog-header"><div><span className="import-dialog-icon"><FileText size={18} /></span><div><h2 id="import-title">{t.importTitle}</h2><p>{t.importDescription}</p></div></div><button className="icon-button" type="button" aria-label={t.cancelImport} disabled={isImporting} onClick={() => setImportOpen(false)}><X size={16} /></button></div><div className="local-processing-note"><LockKeyhole size={14} />{t.localProcessing}</div><button className="file-picker-button" type="button" disabled={isImporting || importDrafts.length >= 10} onClick={() => fileInputRef.current?.click()}>{isImporting ? <LoaderCircle className="spin-icon" size={16} /> : <Plus size={16} />}{isImporting ? t.processingFiles : t.chooseDocuments}</button><p className="file-limit-note">{t.noDocuments}</p>{importError && <p className="import-error" role="alert">{importError}</p>}{importDrafts.length > 0 && <div className="import-draft-list">{importDrafts.map((draft) => <article className="import-draft" key={draft.key}><div className="draft-file-heading"><span className="draft-file-icon"><FileText size={15} /></span><span className="draft-file-name"><strong>{draft.fileName}</strong><small>{draft.fileType} · {draft.note}</small></span><button className="reject-button" type="button" aria-label={`${t.removeDocument} ${draft.fileName}`} onClick={() => setImportDrafts((current) => current.filter((item) => item.key !== draft.key))}><Trash2 size={14} /></button></div><div className="draft-fields"><label>{t.supplierName}<input value={draft.supplier} onChange={(event) => updateImportDraft(draft.key, 'supplier', event.target.value)} /></label><label>{t.invoiceNumberLabel}<input value={draft.invoiceNumber} onChange={(event) => updateImportDraft(draft.key, 'invoiceNumber', event.target.value)} /></label><label>{t.invoiceDateLabel}<input type="date" value={draft.invoiceDate} onChange={(event) => updateImportDraft(draft.key, 'invoiceDate', event.target.value)} /></label><label>{t.paymentDateLabel}<input type="date" value={draft.dueDate} onChange={(event) => updateImportDraft(draft.key, 'dueDate', event.target.value)} /></label><label>{t.totalAmountLabel}<input type="number" step="0.01" value={draft.amount} onChange={(event) => updateImportDraft(draft.key, 'amount', event.target.value)} /></label><label>{t.vatAmountLabel}<input type="number" step="0.01" value={draft.vatAmount} onChange={(event) => updateImportDraft(draft.key, 'vatAmount', event.target.value)} /></label><label>{t.currencyLabel}<select value={draft.currency} onChange={(event) => updateImportDraft(draft.key, 'currency', event.target.value)}><option value="">—</option>{['EUR', 'USD', 'GBP', 'CHF', 'CAD'].map((currencyCode) => <option key={currencyCode} value={currencyCode}>{currencyCode}</option>)}</select></label></div>{draft.textPreview && <details className="extracted-preview"><summary>{t.extractedText}</summary><pre>{draft.textPreview}</pre></details>}</article>)}</div>}<div className="import-dialog-footer"><button className="cancel-button" type="button" disabled={isImporting} onClick={() => setImportOpen(false)}>{t.cancelImport}</button><button className="primary-button" type="button" disabled={isImporting || !importDrafts.length} onClick={addImportedInvoices}><Check size={15} />{t.addToReview}</button></div></section></div>}
      {toast && <div className="toast-message" role="status"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  )
}

function Metric({ title, value, delta, icon, kind, period }: { title: string; value: string; delta: string; icon: React.ReactNode; kind: string; period: string }) {
  return <article className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${kind}`}>{icon}</span></div><strong className="metric-value">{value}</strong><div className="metric-bottom"><span className={`metric-delta ${kind}`}>{delta}</span><span>{period}</span></div></article>
}

function DataIssue({ title, meta }: { title: string; meta: string }) {
  return <div className="data-issue"><span className="data-issue-icon"><ListChecks size={16} /></span><span><strong>{title}</strong><small>{meta}</small></span><span className="issue-count">{meta.split(' ')[0]}</span><ArrowRight size={14} /></div>
}

function sectionDescription(section: Section, locale: Locale) {
  const descriptions: Record<Section, [string, string]> = {
    overview: ['', ''],
    invoices: ['Vérifiez les écritures suggérées avant validation.', 'Review suggested entries before approval.'],
    bank: ['Rapprochez vos mouvements bancaires avec les factures ouvertes.', 'Match bank transactions to open items.'],
    close: ['Suivez les tâches et validations de fin de période.', 'Track tasks and approvals for this period.'],
    forecast: ['Anticipez vos entrées et sorties de trésorerie.', 'Plan ahead for expected cash inflows and outflows.'],
    data: ['Repérez les fiches à corriger avant de lancer l’automatisation.', 'Find records to fix before enabling automation.'],
    audit: ['Consultez les actions attribuées et horodatées.', 'Review attributed and timestamped activity.'],
    help: ['Obtenez des conseils et explorez vos données en langage naturel.', 'Get guidance and explore your data in natural language.'],
    commercial: ['Ventes, achats, articles et fabrication.', 'Sales, purchases, items and production.'],
    caisse: ['Ventes comptoir du point de vente.', 'Counter sales at the point of sale.'],
    compta: ['Écritures, tiers, clôtures et états fiscaux.', 'Entries, parties, closings and tax reports.'],
  }
  return descriptions[section][locale === 'fr' ? 0 : 1]
}

function localizeTask(task: string, locale: Locale) {
  if (locale === 'en') return task
  const translations: Record<string, string> = {
    'Reconcile all bank accounts': 'Rapprocher tous les comptes bancaires',
    'Review open supplier invoices': 'Vérifier les factures fournisseurs ouvertes',
    'Post recurring accruals': 'Comptabiliser les charges à payer',
    'Validate prepaid expenses': 'Valider les charges constatées d’avance',
    'Review intercompany balances': 'Vérifier les soldes intersociétés',
    'Check revenue cut-off': 'Contrôler la séparation des exercices',
    'Approve payroll journal': 'Valider l’écriture de paie',
    'Lock accounting period': 'Verrouiller la période comptable',
  }
  return translations[task]
}

function localizeAction(action: string, locale: Locale) {
  const translations: Record<string, Record<string, string>> = {
    en: {
      'invoice.created': 'Created invoice', 'invoice.approved': 'Approved invoice', 'invoice.rejected': 'Rejected invoice',
      'document.uploaded': 'Uploaded document', 'document.downloaded': 'Downloaded document',
      'workspace.created': 'Created workspace', 'workspace.quota_changed': 'Changed storage quota',
    },
    fr: {
      'Approved invoice': 'Facture validée', 'Suggested account': 'Compte suggéré', 'Matched transaction': 'Mouvement rapproché',
      'Updated supplier': 'Fournisseur mis à jour', 'Rejected invoice': 'Facture renvoyée', 'Imported document': 'Document importé',
      'invoice.created': 'Facture importée', 'invoice.approved': 'Facture validée', 'invoice.rejected': 'Facture refusée',
      'document.uploaded': 'Document téléversé', 'document.downloaded': 'Document téléchargé',
      'workspace.created': 'Espace créé', 'workspace.quota_changed': 'Quota de stockage modifié',
      'Saved customer': 'Client enregistré', 'Created sales document': 'Document de vente créé', 'Transformed sales document': 'Document de vente transformé',
      'Created purchase document': 'Document d’achat créé', 'Transformed purchase document': 'Document d’achat transformé', 'Saved item': 'Article enregistré',
      'Created production order': 'Ordre de fabrication créé', 'Completed production order': 'Ordre de fabrication clôturé', 'Saved bill of materials': 'Nomenclature enregistrée',
      'Validated inventory': 'Inventaire validé', 'Recorded counter sale': 'Vente comptoir encaissée', 'Created command group': 'Groupe de commandes créé',
      'Created account': 'Compte créé', 'Posted accounting piece': 'Pièce comptabilisée', 'Edited entry': 'Écriture modifiée', 'Deleted accounting piece': 'Pièce supprimée',
      'Sent payment reminder': 'Relance envoyée', 'Lettered entries': 'Écritures lettrées', 'Closed period': 'Période clôturée', 'Reopened period': 'Période rouverte',
    },
  }
  return translations[locale][action] ?? action
}

export default App