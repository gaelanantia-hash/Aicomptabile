import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { renderModule, sampleStore } from './render'

test('an invoice entered on the sales screen is numbered, moves stock and is posted to the sales journal', async () => {
  const initial = sampleStore()
  const client = initial.clients[0]
  const article = initial.articles.find((item) => item.stock > 0)!
  const { user, store, lastNote, violations } = renderModule('commercial', 'gc.saisie', initial)

  await user.selectOptions(screen.getByLabelText('Type'), 'facture')
  await user.selectOptions(screen.getByLabelText('Client'), client.code)
  await user.selectOptions(screen.getByLabelText('Article'), article.ref)
  await user.clear(screen.getByLabelText('Quantité'))
  await user.type(screen.getByLabelText('Quantité'), '2')
  await user.click(screen.getByRole('button', { name: 'Enregistrer le document' }))

  const invoice = store().salesDocs.at(-1)!
  expect([invoice.type, invoice.client, invoice.posted, invoice.lines]).toEqual(['facture', client.code, true, [{ ref: article.ref, qty: 2, price: article.price, vat: article.vat }]])
  expect(lastNote()).toBe(`Facture ${invoice.id} enregistrée et comptabilisée.`)
  expect(store().articles.find((item) => item.ref === article.ref)!.stock).toBe(article.stock - 2)
  const lines = store().entries.filter((entry) => entry.piece === invoice.id)
  expect(lines.map((entry) => entry.journal)).toEqual(['VTE', 'VTE', 'VTE'])
  expect(lines.reduce((sum, entry) => sum + entry.debit - entry.credit, 0)).toBe(0)
  expect(violations).toEqual([])
  // The form is ready for the next document.
  expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('')
})

test('a document without customer or item is refused with an explanation', async () => {
  const { user, store, lastNote } = renderModule('commercial', 'gc.saisie')
  const before = store().salesDocs.length
  await user.click(screen.getByRole('button', { name: 'Enregistrer le document' }))
  expect(lastNote()).toBe('Choisissez un client et au moins un article.')
  expect(store().salesDocs.length).toBe(before)
})

test('an invoice in a locked month is not saved', async () => {
  const initial = sampleStore()
  const { user, store, lastNote } = renderModule('commercial', 'gc.saisie', { ...initial, closedPeriods: ['2026-03'] })
  await user.selectOptions(screen.getByLabelText('Type'), 'facture')
  await user.selectOptions(screen.getByLabelText('Client'), initial.clients[0].code)
  await user.selectOptions(screen.getByLabelText('Article'), initial.articles[0].ref)
  await user.clear(screen.getByLabelText('Date'))
  await user.type(screen.getByLabelText('Date'), '2026-03-10')
  await user.click(screen.getByRole('button', { name: 'Enregistrer le document' }))
  expect(store().salesDocs.length).toBe(initial.salesDocs.length)
  expect(lastNote()).toBe('La période 2026-03 est clôturée.')
})

test('a sales document prints with the company, the customer, the totals and the amount in words', async () => {
  const initial = sampleStore()
  const invoice = initial.salesDocs.find((doc) => doc.type === 'facture')!
  const { user } = renderModule('commercial', 'gc.documents', { ...initial, companyInfo: { ...initial.companyInfo, address: 'Bonanjo, Douala', taxId: 'P098765432109Z', rccm: 'RC/DLA/2020/B/1234' } })

  await user.click(screen.getByRole('button', { name: `Imprimer ${invoice.id}` }))
  const sheet = screen.getByRole('dialog', { name: `Facture ${invoice.id}` })
  expect(within(sheet).getByText('NIU : P098765432109Z · RCCM : RC/DLA/2020/B/1234')).toBeTruthy()
  expect(within(sheet).getByText(/Arrêtée la présente facture à la somme de/)).toBeTruthy()
  expect(within(sheet).getByText(/francs CFA$/)).toBeTruthy()
  expect(within(sheet).getByText('Centimes additionnels communaux (CAC)')).toBeTruthy()
  // The sample customer has no NIU yet: the sheet says so before it is printed.
  expect(within(sheet).getByText(/Mentions manquantes : NIU du client/)).toBeTruthy()

  await user.click(within(sheet).getByRole('button', { name: 'Fermer' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
