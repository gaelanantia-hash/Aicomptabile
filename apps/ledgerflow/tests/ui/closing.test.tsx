import { screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { renderFinance, renderModule, sampleStore } from './render'

test('the year-end steps post the stock count, close the year into 13 and lock its twelve months for good', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const initial = sampleStore()
  const year = initial.entries[0].date.slice(0, 4)
  const { user, store, lastNote, violations } = renderModule('compta', 'cp.cloture', initial)
  expect((screen.getByLabelText('Exercice') as HTMLSelectElement).value).toBe(year)

  const depreciation = screen.queryByRole('button', { name: 'Comptabiliser les dotations' })
  if (depreciation) await user.click(depreciation)
  const stock = screen.getByLabelText(/Stock final compté/)
  await user.clear(stock)
  await user.type(stock, '250000')
  await user.click(screen.getByRole('button', { name: 'Comptabiliser l’inventaire' }))
  expect(store().yearEnd[year].closingStock).toBe(250000)

  await user.click(screen.getByRole('button', { name: `Clôturer l’exercice ${year}` }))
  expect(window.confirm).toHaveBeenCalled()
  expect(lastNote()).toBe(`Exercice ${year} clôturé.`)
  const state = store().yearEnd[year]
  expect(state.closing).toBeTruthy()
  expect(store().closedPeriods.filter((month) => month.startsWith(`${year}-`)).length).toBe(12)
  // Classes 6 and 7 are cleared into the result account.
  const balance = (prefix: string) => store().entries.filter((entry) => entry.account.startsWith(prefix)).reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
  expect(balance('6') + balance('7')).toBe(0)
  expect(-balance('13')).toBe(state.result)
  expect(within(screen.getByRole('group', { name: 'Détermination du résultat et clôture' })).getByText(/Fait/)).toBeTruthy()
  expect(violations).toEqual([])
})

test('a month of a closed year cannot be reopened from the periodic tasks', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const initial = sampleStore()
  const year = initial.entries[0].date.slice(0, 4)
  const { user, store, lastNote } = renderModule('compta', 'cp.cloture', initial)
  await user.click(screen.getByRole('button', { name: 'Comptabiliser l’inventaire' }))
  const depreciation = screen.queryByRole('button', { name: 'Comptabiliser les dotations' })
  if (depreciation) await user.click(depreciation)
  await user.click(screen.getByRole('button', { name: `Clôturer l’exercice ${year}` }))

  await user.click(screen.getByRole('button', { name: /Lancer les traitements périodiques/ }))
  const month = store().entries.at(-1)!.date.slice(0, 7)
  await user.click(within(screen.getByText(month).closest('tr')!).getByRole('button', { name: /Rouvrir/ }))
  expect(lastNote()).toBe(`L’exercice ${year} est clôturé définitivement : ce mois ne peut pas être rouvert.`)
  expect(store().closedPeriods).toContain(month)
})

test('month-end close: the period is locked once checked, and can be reopened while the year is open', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { user, store, lastNote } = renderFinance('close')
  const month = (screen.getByLabelText('Période') as HTMLSelectElement).value

  await user.click(screen.getByRole('button', { name: 'Verrouiller la période' }))
  expect(store().closedPeriods).toContain(month)
  expect(lastNote()).toBe(`Période ${month} verrouillée : plus aucune saisie possible.`)

  await user.click(screen.getByRole('button', { name: 'Rouvrir la période' }))
  expect(store().closedPeriods).not.toContain(month)
})
