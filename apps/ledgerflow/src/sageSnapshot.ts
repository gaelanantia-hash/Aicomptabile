import type { Snapshot } from './desktopApi.ts'
import { createEmptyStore, type Store } from './sageData.ts'

// Which field identifies a record in each collection. One record = one row in the local database and one line in the activity log.
const keys = {
  clients: 'code', suppliers: 'code', articles: 'ref', salesDocs: 'id', purchaseDocs: 'id', boms: 'ref',
  workOrders: 'id', accounts: 'number', journals: 'code', entries: 'id', groups: 'name', supplierInvoices: 'id', bankLines: 'id',
} as const satisfies Partial<Record<keyof Store, string>>

type Collection = keyof typeof keys

/** Splits the company data into individually stored records. */
export function toSnapshot(store: Store): Snapshot {
  const snapshot: Snapshot = {
    settings: { company: { value: store.company }, currency: { value: store.currency }, defaultVat: { value: store.defaultVat }, closedPeriods: { value: store.closedPeriods }, reminders: { value: store.reminders }, closeTasks: { value: store.closeTasks } },
  }
  for (const collection of Object.keys(keys) as Collection[]) {
    snapshot[collection] = Object.fromEntries((store[collection] as unknown as Record<string, unknown>[]).map((record) => [String(record[keys[collection]]), record]))
  }
  return snapshot
}

/** Rebuilds the company data from stored records. Missing collections come back empty, so older data files still open. */
export function fromSnapshot(snapshot: Snapshot): Store {
  const setting = <T>(key: string, fallback: T) => (snapshot.settings?.[key] as { value?: T } | undefined)?.value ?? fallback
  // Data saved before the currency and VAT settings existed were in euros with 20 % VAT.
  const store = createEmptyStore(setting('company', ''), setting('currency', 'EUR'), setting('defaultVat', 20))
  const sorted = (collection: Collection) => Object.entries(snapshot[collection] ?? {})
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, record]) => record)
  return {
    ...store,
    ...Object.fromEntries((Object.keys(keys) as Collection[]).map((collection) => [collection, sorted(collection)])),
    closedPeriods: setting('closedPeriods', []),
    reminders: setting('reminders', {}),
    closeTasks: setting('closeTasks', {}),
  } as Store
}
