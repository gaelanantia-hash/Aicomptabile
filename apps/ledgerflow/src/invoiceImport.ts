export type ImportedInvoiceDraft = {
  key: string
  sourceFile: File
  remoteDocumentId?: string
  fileName: string
  fileType: 'PDF' | 'XML' | 'CSV'
  supplier: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  amount: string
  vatAmount: string
  currency: string
  textPreview: string
  note: string
  lines?: ImportedInvoiceLine[]
}

export type ImportedInvoiceLine = {
  date: string
  supplierPart1: string
  supplierPart2: string
  supplier: string
  item: string
  quantity: number
  unitPrice: number
  total: number
}

const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_XML_BYTES = 5 * 1024 * 1024

export async function readInvoiceDocument(file: File): Promise<ImportedInvoiceDraft> {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'xml') {
    if (file.size > MAX_XML_BYTES) throw new Error('XML file exceeds the 5 MB limit.')
    return readFatturaPa(file)
  }

  if (extension === 'pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('PDF file exceeds the 20 MB limit.')
    return readPdf(file)
  }

  if (extension === 'csv' || extension === 'tsv') return readDelimitedInvoice(file, extension === 'tsv' ? '\t' : undefined)

  throw new Error('Choose a PDF, FatturaPA XML, CSV or TSV file.')
}

async function readDelimitedInvoice(file: File, forcedDelimiter?: string): Promise<ImportedInvoiceDraft> {
  const source = (await file.text()).replace(/^\uFEFF/, '')
  const rows = source.split(/\r?\n/).map((line) => splitDelimitedLine(line, forcedDelimiter)).filter((row) => row.some((cell) => cell.trim()))
  if (!rows.length) throw new Error('The CSV/TSV file is empty.')

  const firstRow = rows[0].map((cell) => cell.toLowerCase().trim())
  const hasHeader = firstRow.some((cell) => /date|data|supplier|fornitore|article|articolo|quantity|quantit|unit|price|prezzo|total|totale/.test(cell))
  const dataRows = hasHeader ? rows.slice(1) : rows
  const lines: ImportedInvoiceLine[] = []
  const errors: string[] = []

  dataRows.forEach((row, index) => {
    if (row.length < 7) {
      errors.push(`row ${index + (hasHeader ? 2 : 1)} has fewer than 7 columns`)
      return
    }
    const quantity = parseTableNumber(row[4])
    const unitPrice = parseTableNumber(row[5])
    const total = parseTableNumber(row[6])
    if (!quantity || quantity < 0 || unitPrice === undefined || unitPrice < 0 || total === undefined || total < 0) {
      errors.push(`row ${index + (hasHeader ? 2 : 1)} has invalid quantity or price`)
      return
    }
    if (Math.abs(quantity * unitPrice - total) > 0.02) {
      errors.push(`row ${index + (hasHeader ? 2 : 1)} total does not match quantity × unit price`)
      return
    }
    lines.push({ date: normalizeTableDate(row[0]), supplierPart1: row[1].trim(), supplierPart2: row[2].trim(), supplier: [row[1], row[2]].map((value) => value.trim()).filter(Boolean).join(' '), item: row[3].trim(), quantity, unitPrice, total })
  })

  if (!lines.length) throw new Error(errors.join('; ') || 'No valid invoice rows found.')
  if (errors.length) throw new Error(`${errors.join('; ')}. Fix the file and import it again.`)

  const supplier = lines[0].supplier
  return {
    key: crypto.randomUUID(), sourceFile: file, fileName: file.name, fileType: 'CSV', supplier,
    invoiceNumber: file.name.replace(/\.[^.]+$/, ''), invoiceDate: lines[0].date, dueDate: '',
    amount: lines.reduce((sum, line) => sum + line.total, 0).toFixed(2), vatAmount: '', currency: 'EUR',
    textPreview: lines.map((line) => `${line.date} | ${line.supplier} | ${line.item} | ${line.quantity} × ${line.unitPrice.toFixed(2)} = ${line.total.toFixed(2)}`).join('\n'),
    note: `${lines.length} article line(s) read from columns 1–7.`, lines,
  }
}

function splitDelimitedLine(line: string, forcedDelimiter?: string) {
  const delimiter = forcedDelimiter || (line.includes(';') ? ';' : ',')
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') quoted = !quoted
    else if (character === delimiter && !quoted) { cells.push(cell.trim()); cell = '' }
    else cell += character
  }
  return [...cells, cell.trim()]
}

function parseTableNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d,.-]/g, '')
  if (!cleaned) return undefined
  const comma = cleaned.lastIndexOf(',')
  const dot = cleaned.lastIndexOf('.')
  const normalized = comma > dot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '')
  const value = Number(normalized)
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined
}

function normalizeTableDate(raw: string): string {
  const iso = raw.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const european = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})$/)
  return european ? `${european[3]}-${european[2].padStart(2, '0')}-${european[1].padStart(2, '0')}` : raw
}

async function readFatturaPa(file: File): Promise<ImportedInvoiceDraft> {
  const xmlText = await file.text()
  if (/<!DOCTYPE/i.test(xmlText)) throw new Error('XML files with a DOCTYPE declaration are not supported.')

  const xml = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('The XML file is not valid.')

  const supplierNode = firstElement(xml, 'CedentePrestatore')
  const supplierName = textWithin(supplierNode, 'Denominazione') || [
    textWithin(supplierNode, 'Nome'),
    textWithin(supplierNode, 'Cognome'),
  ].filter(Boolean).join(' ')
  const documentNode = firstElement(xml, 'DatiGeneraliDocumento')
  const paymentDate = firstElement(xml, 'DataScadenzaPagamento')
  const taxAmounts = Array.from(xml.getElementsByTagNameNS('*', 'Imposta'))
    .map((element) => Number(element.textContent?.trim().replace(',', '.')))
    .filter(Number.isFinite)
  const totalVat = taxAmounts.length ? taxAmounts.reduce((sum, value) => sum + value, 0) : undefined
  const textPreview = [
    `Supplier: ${supplierName || 'Not found'}`,
    `Invoice: ${textWithin(documentNode, 'Numero') || 'Not found'}`,
    `Total: ${textWithin(documentNode, 'ImportoTotaleDocumento') || 'Not found'}`,
  ].join('\n')

  return {
    key: crypto.randomUUID(),
    sourceFile: file,
    fileName: file.name,
    fileType: 'XML',
    supplier: supplierName,
    invoiceNumber: textWithin(documentNode, 'Numero'),
    invoiceDate: textWithin(documentNode, 'Data'),
    dueDate: paymentDate?.textContent?.trim() ?? '',
    amount: textWithin(documentNode, 'ImportoTotaleDocumento'),
    vatAmount: totalVat === undefined ? '' : totalVat.toFixed(2),
    currency: textWithin(documentNode, 'Divisa') || 'EUR',
    textPreview,
    note: 'Extracted from FatturaPA XML. Review all fields before approval.',
  }
}

async function readPdf(file: File): Promise<ImportedInvoiceDraft> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pageTexts: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }

  const text = pageTexts.join('\n').replace(/\s+/g, ' ').trim()
  const invoiceNumber = text.match(/(?:invoice|facture)\s*(?:number|no\.?|n[°ºo]?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i)?.[1] ?? ''
  const amountMatch = text.match(/(?:net\s*[àa]\s*payer|total\s*(?:ttc|due)|montant\s*total\s*ttc|amount\s*due|grand\s*total)[^\d]{0,24}([\d][\d\s.,]*\d)/i)?.[1]
  const currency = /\bUSD\b|\$/.test(text) ? 'USD' : /\bGBP\b|£/.test(text) ? 'GBP' : /\bEUR\b|€/.test(text) ? 'EUR' : ''

  return {
    key: crypto.randomUUID(),
    sourceFile: file,
    fileName: file.name,
    fileType: 'PDF',
    supplier: '',
    invoiceNumber,
    invoiceDate: findDate(text),
    dueDate: '',
    amount: amountMatch ? normalizeAmount(amountMatch) : '',
    vatAmount: '',
    currency,
    textPreview: text ? text.slice(0, 900) : '',
    note: text
      ? 'Text extracted from PDF. Check the supplier, dates and totals against the original.'
      : 'No selectable text found. This may be a scanned PDF; enter the fields manually.',
  }
}

function firstElement(root: Document | Element, localName: string): Element | null {
  return root.getElementsByTagNameNS('*', localName).item(0)
}

function textWithin(root: Element | null, localName: string): string {
  return root?.getElementsByTagNameNS('*', localName).item(0)?.textContent?.trim() ?? ''
}

function normalizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^\d,.-]/g, '')
  const comma = cleaned.lastIndexOf(',')
  const dot = cleaned.lastIndexOf('.')
  let normalized = cleaned

  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? ',' : '.'
    normalized = cleaned.replace(/[,.]/g, (separator, offset) => separator === decimalSeparator && offset === Math.max(comma, dot) ? '.' : '')
  } else if (comma >= 0) {
    normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '')
  } else if (/\.\d{3}$/.test(cleaned)) {
    normalized = cleaned.replace('.', '')
  }

  const value = Number(normalized)
  return Number.isFinite(value) ? value.toFixed(2) : ''
}

function findDate(text: string): string {
  const yearFirst = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (yearFirst) return `${yearFirst[1]}-${yearFirst[2].padStart(2, '0')}-${yearFirst[3].padStart(2, '0')}`

  const dayFirst = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/)
  if (!dayFirst) return ''
  return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`
}