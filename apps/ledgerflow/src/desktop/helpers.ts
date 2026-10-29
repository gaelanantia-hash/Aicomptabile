// Types, labels and messages shared by the desktop screens.
import { ArrowDownLeft, BookOpen, ChartColumn, CircleHelp, ClipboardCheck, FileInput, FileSearch, LayoutDashboard, ShieldCheck, ShoppingCart, Store as StoreIcon, Wallet } from 'lucide-react'
import type { AuthResult, DesktopState, LicenseReason, SyncState } from '../desktopApi'
import type { FinanceSection } from '../FinanceSections'
import type { ModuleId } from '../sageData'

export type Locale = 'en' | 'fr'
export type Translate = (fr: string, en: string) => string
export type Section = FinanceSection | ModuleId | 'audit'

export const workspace = [
  { id: 'overview', icon: LayoutDashboard, fr: 'Vue d’ensemble', en: 'Overview', frText: 'Les chiffres clés et ce qui reste à traiter, calculés sur vos écritures.', enText: 'Key figures and what is left to do, computed from your entries.' },
  { id: 'invoices', icon: FileInput, fr: 'Factures fournisseurs', en: 'Supplier invoices', frText: 'Vérifiez les factures reçues avant de les comptabiliser.', enText: 'Check received invoices before posting them.' },
  { id: 'bank', icon: ArrowDownLeft, fr: 'Rapprochement bancaire', en: 'Bank matching', frText: 'Rapprochez le relevé bancaire avec les factures ouvertes.', enText: 'Match the bank statement to open invoices.' },
  { id: 'close', icon: ClipboardCheck, fr: 'Clôture mensuelle', en: 'Month-end close', frText: 'Suivez les contrôles de fin de période, puis verrouillez-la.', enText: 'Track end-of-period checks, then lock the period.' },
  { id: 'forecast', icon: Wallet, fr: 'Prévision de trésorerie', en: 'Cash forecast', frText: 'Anticipez vos entrées et sorties de trésorerie sur 13 semaines.', enText: 'Plan cash inflows and outflows over 13 weeks.' },
  { id: 'analysis', icon: ChartColumn, fr: 'Analyse des articles', en: 'Item analysis', frText: 'Comparez ce qui a été enregistré, ce qui a été vendu et ce qui reste.', enText: 'Compare what was registered, what was sold and what remains.' },
  { id: 'data', icon: FileSearch, fr: 'Qualité des données', en: 'Data quality', frText: 'Repérez les fiches incomplètes ou en double.', enText: 'Find incomplete or duplicate records.' },
  { id: 'audit', icon: ShieldCheck, fr: 'Piste d’audit', en: 'Audit trail', frText: 'Qui a modifié quoi, quand, depuis quel PC, avec la valeur avant et après.', enText: 'Who changed what, when, from which PC, with the value before and after.' },
  { id: 'help', icon: CircleHelp, fr: 'Aide & conseils', en: 'Help & guidance', frText: 'Trouvez comment réaliser une opération.', enText: 'Find out how to carry out a task.' },
] as const

export const modules = [
  { id: 'commercial', icon: ShoppingCart, fr: 'Gestion commerciale', en: 'Sales management' },
  { id: 'caisse', icon: StoreIcon, fr: 'Saisie de caisse', en: 'Point of sale' },
  { id: 'compta', icon: BookOpen, fr: 'Comptabilité', en: 'Accounting' },
] as const

export const currencies: [string, string][] = [
  ['EUR', 'Euro (€)'], ['XAF', 'Franc CFA — Afrique centrale (FCFA)'], ['XOF', 'Franc CFA — Afrique de l’Ouest (F CFA)'], ['USD', 'Dollar US ($)'], ['CHF', 'Franc suisse (CHF)'],
  ['GBP', 'Livre sterling (£)'], ['CAD', 'Dollar canadien'], ['MAD', 'Dirham marocain'], ['TND', 'Dinar tunisien'], ['DZD', 'Dinar algérien'],
]

export const licenseMessages: Record<LicenseReason, [string, string]> = {
  missing: ['Saisissez votre code de licence.', 'Enter your licence code.'],
  invalid: ['Ce code de licence n’est pas reconnu.', 'This licence code is not recognised.'],
  expired: ['Cette licence est arrivée à échéance.', 'This licence has expired.'],
  revoked: ['Cette licence a été désactivée. Contactez le support.', 'This licence was disabled. Contact support.'],
  device_limit: ['Cette licence est déjà utilisée sur le nombre maximal de PC.', 'This licence is already in use on its maximum number of PCs.'],
  grace_expired: ['La licence n’a pas pu être vérifiée depuis trop longtemps. Connectez-vous à Internet.', 'The licence could not be verified for too long. Connect to the Internet.'],
  unreachable: ['Service de licences injoignable. Vérifiez votre connexion et réessayez.', 'Licence service unreachable. Check your connection and try again.'],
  not_registered: ['Aucune licence AICOM n’est associée à ce compte Google.', 'No AICOM licence is linked to this Google account.'],
  reauth: ['La connexion à Google a expiré. Reconnectez votre compte Google pour vérifier la licence.', 'The Google sign-in expired. Reconnect your Google account to check the licence.'],
}

export function licenceLabel(license: DesktopState['license'], tr: Translate) {
  if (license.trial) return tr(`Version d’essai jusqu’au ${license.expires}`, `Trial version until ${license.expires}`)
  if (license.dev) return tr('Mode développement', 'Development mode')
  return `${license.customer ?? ''}${license.expires ? ` · ${tr('jusqu’au', 'until')} ${license.expires}` : ''}`
}

export function syncLabel(sync: SyncState, localOnly: boolean, tr: Translate): { text: string; tone: 'good' | 'busy' | 'warn' } {
  if (localOnly) return { text: tr('Sur ce PC uniquement (sans Google)', 'On this PC only (no Google)'), tone: 'warn' }
  switch (sync.status) {
    case 'synced': return { text: tr('Enregistré sur Google', 'Saved to Google'), tone: 'good' }
    case 'pending': return { text: tr('Modifications à envoyer', 'Changes waiting to upload'), tone: 'busy' }
    case 'syncing': return { text: tr('En synchronisation…', 'Syncing…'), tone: 'busy' }
    case 'offline': return { text: tr('Hors ligne · enregistré sur ce PC', 'Offline · saved on this PC'), tone: 'warn' }
    case 'conflict': return { text: tr('Conflit à résoudre', 'Conflict to resolve'), tone: 'warn' }
    case 'locked': return { text: tr('Ouvert sur un autre PC', 'Open on another PC'), tone: 'warn' }
    case 'reauth': return { text: tr('Reconnexion Google requise', 'Google sign-in required'), tone: 'warn' }
    case 'unlock': return { text: tr('Connexion requise pour ouvrir les données', 'Sign in to open the data'), tone: 'warn' }
    case 'error': return { text: sync.detail === 'quota' ? tr('Espace Google Drive plein', 'Google Drive is full') : sync.detail === 'newer_schema' ? tr('Mettez à jour AICOM', 'Update AICOM') : sync.detail === 'insufficient_scopes' ? tr('Autorisation Google à renouveler', 'Google permission needs renewal') : tr('Erreur de synchronisation', 'Sync error'), tone: 'warn' }
    default: return { text: tr('Non connecté', 'Not connected'), tone: 'warn' }
  }
}

/**
 * What to show for a failed action: Electron's technical prefix removed, and the Google sign-in failures a customer can
 * meet said in plain words. Empty when the customer cancelled the sign-in: nothing went wrong.
 */
export function errorMessage(error: unknown, tr: Translate) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  if (message === 'Google sign-in was cancelled.') return ''
  if (message === 'Google sign-in timed out.') return tr('La connexion à Google n’a pas été terminée dans le navigateur. Cliquez de nouveau sur le bouton pour recommencer.', 'The Google sign-in was not completed in the browser. Click the button again to start over.')
  if (message === 'access_denied') return tr('L’accès a été refusé sur la page de Google. Pour utiliser AICOM, recommencez et acceptez l’accès aux fichiers créés par AICOM.', 'Access was declined on the Google page. To use AICOM, start over and allow access to the files AICOM creates.')
  if (message.startsWith('Google did not grant offline access')) return tr('Google n’a pas accordé tous les accès nécessaires. Recommencez et acceptez les autorisations demandées.', 'Google did not grant every access needed. Start over and accept the requested permissions.')
  if (message.startsWith('Google token request failed') || message === 'Google did not return the account identity.') return tr('Google n’a pas pu terminer la connexion. Vérifiez votre connexion internet et réessayez.', 'Google could not complete the sign-in. Check your internet connection and try again.')
  return message
}

export function authMessage(result: Extract<AuthResult, { ok: false }>, tr: Translate) {
  switch (result.reason) {
    case 'locked': return tr(`Trop de tentatives. Réessayez dans ${result.waitSeconds} secondes.`, `Too many attempts. Try again in ${result.waitSeconds} seconds.`)
    case 'forbidden': return tr('Action réservée à un administrateur.', 'Only an administrator can do this.')
    case 'exists': return tr('Cet identifiant existe déjà.', 'This username already exists.')
    case 'no_key': return tr('Ce compte ne peut pas encore ouvrir les données chiffrées sur un nouveau PC. Connectez-vous d’abord avec un compte déjà utilisé depuis la mise à jour (par exemple l’administrateur).', 'This account cannot open the encrypted data on a new PC yet. First sign in with an account already used since the update (for example the administrator).')
    case 'weak': return tr('Identifiant : 3 à 40 lettres, chiffres, point ou tiret. Mot de passe : 8 caractères minimum.', 'Username: 3 to 40 letters, digits, dot or dash. Password: at least 8 characters.')
    default: return tr('Identifiant, mot de passe ou code incorrect.', 'Wrong username, password or code.')
  }
}
