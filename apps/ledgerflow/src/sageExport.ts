import { accountsOf, docTotals, isoDate, purchaseTypes, salesTypes, tiersBalance, tiersName, type DocLine, type Entry, type Store } from './sageData'
import { downloadXlsx, type Sheet } from './xlsx'

export const entriesSheet = (store: Store, entries: Entry[]): Sheet['rows'] => [
  ['Date', 'Journal', 'Pièce', 'Compte', 'Tiers', 'Libellé', 'Débit', 'Crédit', 'Lettrage'],
  ...entries.map((entry) => [entry.date, entry.journal, entry.piece, entry.account, tiersName(store, entry.tiers), entry.label, entry.debit, entry.credit, entry.letter ?? '']),
]

/** Workbook with the main records of the company, one sheet per list. */
export function exportWorkbook(store: Store) {
  const totals = (lines: DocLine[]) => {
    const { ht, vat, ttc } = docTotals(lines, store.currency)
    return [ht, vat, ttc]
  }
  downloadXlsx(`AICOM ${store.company} ${isoDate()}.xlsx`.replace(/[\\/:*?"<>|]/g, ' '), [
    { name: 'Clients', rows: [['Code', 'Nom', 'Ville', 'E-mail', 'Solde'], ...store.clients.map((client) => [client.code, client.name, client.city, client.email, tiersBalance(store.entries, accountsOf(store).clients, client.code)])] },
    { name: 'Fournisseurs', rows: [['Code', 'Nom', 'Ville', 'Solde'], ...store.suppliers.map((supplier) => [supplier.code, supplier.name, supplier.city, tiersBalance(store.entries, accountsOf(store).suppliers, supplier.code)])] },
    { name: 'Articles', rows: [['Référence', 'Désignation', 'Famille', 'Prix achat', 'Prix vente HT', 'TVA %', 'Stock'], ...store.articles.map((article) => [article.ref, article.name, article.family, article.cost, article.price, article.vat, article.stock])] },
    { name: 'Documents de vente', rows: [['N°', 'Type', 'Client', 'Date', 'Total HT', 'TVA', 'Total TTC'], ...store.salesDocs.map((doc) => [doc.id, salesTypes[doc.type].fr, tiersName(store, doc.client), doc.date, ...totals(doc.lines)])] },
    { name: 'Documents achat', rows: [['N°', 'Type', 'Fournisseur', 'Date', 'Total HT', 'TVA', 'Total TTC'], ...store.purchaseDocs.map((doc) => [doc.id, purchaseTypes[doc.type].fr, tiersName(store, doc.supplier), doc.date, ...totals(doc.lines)])] },
    { name: 'Écritures', rows: entriesSheet(store, store.entries) },
  ])
}
