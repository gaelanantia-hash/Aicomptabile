import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isMeteredConnection, parseConnectionCost } from './network.ts'

test('connections paid by volume, roaming or near their limit are metered', () => {
  assert.equal(parseConnectionCost('Unrestricted|False|False|False\r\n'), false)
  assert.equal(parseConnectionCost('Unknown|False|False|False'), false)
  assert.equal(parseConnectionCost('Fixed|False|False|False'), true)
  assert.equal(parseConnectionCost('Variable|False|False|False'), true)
  assert.equal(parseConnectionCost('Unrestricted|True|False|False'), true)
  assert.equal(parseConnectionCost('Unrestricted|False|True|False'), true)
  assert.equal(parseConnectionCost('Unrestricted|False|False|True'), true)
})

test('an unreadable answer counts as not metered', () => {
  assert.equal(parseConnectionCost(''), false)
  assert.equal(parseConnectionCost('Exception calling "GetConnectionCost"'), false)
})

test('the check answers on any platform without throwing', async () => {
  assert.equal(typeof await isMeteredConnection(), 'boolean')
})
