import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode, type SetStateAction } from 'react'
import { FinanceView, type FinanceSection } from '../../src/FinanceSections'
import { SageModules } from '../../src/SageModules'
import { countries, createStore, ledgerViolation, type LedgerViolation, type ModuleId, type Store } from '../../src/sageData'

const cameroon = countries.find((country) => country.code === 'CM')!

/** The sample company of Cameroon, as a new customer would try the app with it. */
export const sampleStore = () => createStore('Ets Mbarga', cameroon)

/**
 * Mounts a screen the way the desktop app does: every change goes through the OHADA checks on posted entries
 * (`violations` must stay empty), notifications and audit lines are recorded, and `store()` reads the current data.
 */
function mount(screen: (store: Store, apply: (next: SetStateAction<Store>) => void, notify: (message: string) => void, audit: (action: string, record: string) => void) => ReactNode, initial: Store) {
  const notes: string[] = []
  const audits: string[] = []
  const violations: LedgerViolation[] = []
  // Every version of the data kept so far; the last one is the current data.
  const versions = [initial]
  function Harness() {
    const [store, setStore] = useState(initial)
    const apply = (next: SetStateAction<Store>) => {
      const value = typeof next === 'function' ? next(store) : next
      const violation = ledgerViolation(store, value)
      if (violation) {
        violations.push(violation)
        return
      }
      versions.push(value)
      setStore(value)
    }
    return screen(store, apply, (message) => notes.push(message), (action, record) => audits.push(`${action} · ${record}`))
  }
  render(<Harness />)
  return { user: userEvent.setup(), notes, audits, violations, store: () => versions.at(-1)!, lastNote: () => notes.at(-1) ?? '' }
}

const money = (amount: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XAF' }).format(amount)

export function renderModule(module: ModuleId, activity: string, initial = sampleStore()) {
  return mount((store, apply, notify, audit) => (
    <SageModules module={module} initialActivity={activity} admin locale="fr" store={store} setStore={apply} money={money} notify={notify} audit={audit} onModule={() => {}} />
  ), initial)
}

export function renderFinance(section: FinanceSection, initial = sampleStore()) {
  const day = (date: string) => date.split('-').reverse().join('/')
  return mount((store, apply, notify, audit) => (
    <FinanceView section={section} admin store={store} apply={apply} tr={(fr) => fr} money={money} day={day} notify={notify} audit={audit} go={() => {}} />
  ), initial)
}
