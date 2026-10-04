import { getApps, initializeApp } from '@firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from '@firebase/auth'

const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const appConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const cloudConfigured = Object.values(appConfig).every(Boolean)
export const cloudAuth = cloudConfigured
  ? getAuth(getApps()[0] ?? initializeApp(appConfig))
  : null

export type CloudWorkspace = {
  id: string
  name: string
  storage_quota_bytes: string
  storage_used_bytes: string
  storage_reserved_bytes: string
}

export type CloudInvoice = {
  id: string
  document_id: string | null
  source_name: string | null
  invoice_number: string
  supplier: string
  invoice_date: string
  due_date: string | null
  amount: string
  vat_amount: string | null
  currency: string
  account_code: string | null
  status: 'needs_review' | 'approved' | 'rejected'
  created_at: string
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  if (!cloudAuth) return () => undefined
  return onAuthStateChanged(cloudAuth, callback)
}

export async function createAccount(email: string, password: string) {
  if (!cloudAuth) throw new Error('Cloud sign-in is not configured.')
  const credential = await createUserWithEmailAndPassword(cloudAuth, email, password)
  await sendEmailVerification(credential.user)
}

export async function signIn(email: string, password: string) {
  if (!cloudAuth) throw new Error('Cloud sign-in is not configured.')
  return signInWithEmailAndPassword(cloudAuth, email, password)
}

export async function sendPasswordReset(email: string) {
  if (!cloudAuth) throw new Error('Cloud sign-in is not configured.')
  return sendPasswordResetEmail(cloudAuth, email)
}

export async function signOutAccount() {
  if (cloudAuth) await signOut(cloudAuth)
}

export async function cloudRequest<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const token = await user.getIdToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer)) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Cloud request failed (${response.status}).`)
  return payload
}

export async function downloadCloudDocument(user: User, workspaceId: string, documentId: string, fileName: string) {
  const token = await user.getIdToken()
  const query = new URLSearchParams({ workspaceId })
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/content?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `Document download failed (${response.status}).`)
  }
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}