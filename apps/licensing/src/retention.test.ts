import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retentionPlan } from './retention.ts'
import type { License } from './store.ts'

const now = new Date('2026-10-29T12:00:00Z')
const device = (deviceId: string, lastSeenAt: string) => ({ deviceId, deviceName: deviceId, appVersion: '1.0.0', activatedAt: '2023-01-01T00:00:00Z', lastSeenAt })
const license = (id: string, fields: Partial<License>): License => ({ id, customer: id, maxDevices: 2, expires: null, revoked: false, createdAt: '2023-01-01T00:00:00Z', activations: [], ...fields })

test('licences ended more than 24 months ago are erased; recent ones and undated revocations are kept', () => {
  const plan = retentionPlan([
    license('expired-long-ago', { expires: '2024-10-28' }),
    license('expired-recently', { expires: '2024-10-29' }),
    license('revoked-long-ago', { revoked: true, revokedAt: '2024-10-01T00:00:00Z' }),
    license('revoked-recently', { revoked: true, revokedAt: '2025-06-01T00:00:00Z' }),
    license('revoked-undated', { revoked: true }),
    license('active', { expires: '2027-12-31' }),
  ], now)
  assert.equal(plan.cutoff, '2024-10-29T12:00:00.000Z')
  assert.deepEqual(plan.remove.map((item) => [item.id, item.reason]), [['expired-long-ago', 'expired'], ['revoked-long-ago', 'revoked']])
  assert.deepEqual(plan.undatedRevocations.map((item) => item.id), ['revoked-undated'])
})

test('PCs of a kept licence not seen for 24 months lose their activation; the others stay', () => {
  const plan = retentionPlan([license('active', { activations: [device('old-pc', '2024-09-30T00:00:00Z'), device('current-pc', '2026-10-20T00:00:00Z')] })], now)
  assert.deepEqual(plan.devices, [{ id: 'active', customer: 'active', deviceIds: ['old-pc'] }])
  assert.deepEqual(plan.remove, [])
})

test('the keeping time can be set to another number of months', () => {
  const licences = [license('expired', { expires: '2026-03-01' })]
  assert.equal(retentionPlan(licences, now).remove.length, 0)
  assert.equal(retentionPlan(licences, now, 6).remove.length, 1)
})
