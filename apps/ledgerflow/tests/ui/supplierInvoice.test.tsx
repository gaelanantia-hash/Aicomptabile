import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { renderFinance, sampleStore } from './render'

// An invoice number shows in the queue and again in the history below it: the first one is the queue's row.
const rowOf = (text: string) => screen.getAllByText(text)[0].closest('tr')!

test('approving a received invoice posts expense, VAT and the supplier debt to the purchase journal', async () => {
  const initial = sampleStore()
  const invoice = initial.supplierInvoices.find((item) => item.status === 'needs_review')!
  const { user, store, lastNote, violations } = renderFinance('invoices', initial)

  await user.click(within(rowOf(invoice.number)).getByRole('button', { name: /Valider/ }))

  const approved = store().supplierInvoices.find((item) => item.id === invoice.id)!
  expect(approved.status).toBe('approved')
  const lines = store().entries.filter((entry) => entry.piece === approved.piece)
  expect(lines.map((entry) => [entry.journal, entry.account, entry.debit, entry.credit])).toEqual([
    ['ACH', invoice.account, invoice.amount - invoice.vat, 0], ['ACH', '445200', invoice.vat, 0], ['ACH', '401100', 0, invoice.amount],
  ])
  expect(lastNote()).toBe('Facture validée et comptabilisée dans le journal des achats.')
  expect(violations).toEqual([])
})

test('a paper invoice from a new supplier is typed in, queued, then approved; the supplier is created', async () => {
  const { user, store } = renderFinance('invoices')
  const form = screen.getByText('Saisir une facture reçue').closest('section')!

  await user.selectOptions(within(form).getByLabelText('Fournisseur'), '__new__')
  await user.type(within(form).getByLabelText('Nom du nouveau fournisseur'), 'Garage Moderne')
  await user.type(within(form).getByLabelText('Numéro de facture'), 'GM-2026-118')
  await user.type(within(form).getByLabelText('Montant TTC'), '119250')
  await user.type(within(form).getByLabelText('Dont TVA'), '19250')
  await user.selectOptions(within(form).getByLabelText('Compte de charge'), '621000')
  await user.click(within(form).getByRole('button', { name: 'Ajouter à la file' }))

  const queued = store().supplierInvoices.find((item) => item.number === 'GM-2026-118')!
  expect([queued.status, queued.supplier, queued.amount, queued.vat, queued.account]).toEqual(['needs_review', 'Garage Moderne', 119250, 19250, '621000'])
  expect(store().entries.some((entry) => entry.label.includes('GM-2026-118'))).toBe(false)

  await user.click(within(rowOf('GM-2026-118')).getByRole('button', { name: /Valider/ }))
  const supplier = store().suppliers.find((item) => item.name === 'Garage Moderne')!
  expect(supplier).toBeTruthy()
  expect(store().entries.filter((entry) => entry.label.includes('GM-2026-118')).find((entry) => entry.account === '401100')?.tiers).toBe(supplier.code)
})

test('an invoice without an expense account cannot be approved and says what is missing', () => {
  const initial = sampleStore()
  const invoice = initial.supplierInvoices.find((item) => item.status === 'needs_review')!
  renderFinance('invoices', { ...initial, supplierInvoices: initial.supplierInvoices.map((item) => item.id === invoice.id ? { ...item, account: '' } : item) })
  expect((within(rowOf(invoice.number)).getByRole('button', { name: /Valider/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(rowOf(invoice.number)).getByText(/Manque : compte/)).toBeTruthy()
})

test('an invoice dated in a locked month is not posted', async () => {
  const initial = sampleStore()
  const invoice = initial.supplierInvoices.find((item) => item.status === 'needs_review')!
  const { user, store, lastNote } = renderFinance('invoices', { ...initial, closedPeriods: [invoice.date.slice(0, 7)] })
  await user.click(within(rowOf(invoice.number)).getByRole('button', { name: /Valider/ }))
  expect(lastNote()).toBe(`La période ${invoice.date.slice(0, 7)} est clôturée.`)
  expect(store().entries.length).toBe(initial.entries.length)
})
