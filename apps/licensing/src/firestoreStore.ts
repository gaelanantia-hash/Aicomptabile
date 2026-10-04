import { Firestore } from '@google-cloud/firestore'
import type { License, Store } from './store.ts'

/** Production store. Uses the Cloud Run service identity; no key file is created or shipped. */
export function createFirestoreStore(collectionName = 'licenses'): Store {
  const collection = new Firestore().collection(collectionName)
  return {
    get: async (id) => (await collection.doc(id).get()).data() as License | undefined,
    create: async (license) => { await collection.doc(license.id).create(license) },
    update: (id, change) => collection.firestore.runTransaction(async (transaction) => {
      const reference = collection.doc(id)
      const current = (await transaction.get(reference)).data() as License | undefined
      const next = current && change(current)
      if (next) transaction.set(reference, next)
      return next
    }),
    list: async () => (await collection.orderBy('createdAt', 'desc').get()).docs.map((document) => document.data() as License),
    remove: async (id) => {
      const reference = collection.doc(id)
      if (!(await reference.get()).exists) return false
      await reference.delete()
      return true
    },
  }
}
