import type { License } from './store.ts'

/** How long licence data are kept once they are no longer needed, as set out in the privacy policy (docs/04-sicurezza-conformita.md, T50). */
export const RETENTION_MONTHS = 24

export type RetentionPlan = {
  /** Licences expired, or revoked, before the cut-off: the whole record goes. */
  remove: { id: string; customer: string; reason: 'expired' | 'revoked' }[]
  /** PCs of kept licences not seen since the cut-off: their activation goes (name of the PC, version, dates). */
  devices: { id: string; customer: string; deviceIds: string[] }[]
  /** Revoked before revocation dates were recorded: kept, for the administrator to decide. */
  undatedRevocations: { id: string; customer: string }[]
  cutoff: string
}

/** What the retention rule removes today. Nothing is changed here; the service applies the plan. */
export function retentionPlan(licenses: License[], now: Date, months = RETENTION_MONTHS): RetentionPlan {
  const limit = new Date(now)
  limit.setUTCMonth(limit.getUTCMonth() - months)
  const cutoff = limit.toISOString()
  const day = cutoff.slice(0, 10)
  const plan: RetentionPlan = { remove: [], devices: [], undatedRevocations: [], cutoff }
  for (const license of licenses) {
    const { id, customer } = license
    if (license.expires && license.expires < day) {
      plan.remove.push({ id, customer, reason: 'expired' })
      continue
    }
    if (license.revoked) {
      if (!license.revokedAt) plan.undatedRevocations.push({ id, customer })
      else if (license.revokedAt < cutoff) {
        plan.remove.push({ id, customer, reason: 'revoked' })
        continue
      }
    }
    const stale = license.activations.filter((activation) => activation.lastSeenAt < cutoff).map((activation) => activation.deviceId)
    if (stale.length) plan.devices.push({ id, customer, deviceIds: stale })
  }
  return plan
}
