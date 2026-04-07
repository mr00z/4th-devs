import test from 'node:test'
import assert from 'node:assert/strict'
import { isSafeDatabaseQuery, validateOrders } from '../core/validate.js'
import type { NormalizedOrder } from '../types.js'

test('read-only SQL guardrails allow safe patterns and reject writes', () => {
  assert.equal(isSafeDatabaseQuery('show tables'), true)
  assert.equal(isSafeDatabaseQuery('.schema users'), true)
  assert.equal(isSafeDatabaseQuery('select * from users'), true)
  assert.equal(isSafeDatabaseQuery('select * from users; select * from orders'), false)
  assert.equal(isSafeDatabaseQuery('delete from users'), false)
})

test('validateOrders reports missing and wrong quantities', () => {
  const orders: NormalizedOrder[] = [
    {
      id: '1',
      title: 'Dostawa dla opalino',
      destination: 123,
      creatorID: 1,
      items: { chleb: 44, woda: 120 },
      raw: {},
    },
  ]

  const result = validateOrders(orders)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.type === 'wrong_quantity' && issue.item === 'chleb'))
  assert.ok(result.issues.some((issue) => issue.type === 'missing_item' && issue.item === 'mlotek'))
  assert.ok(result.issues.some((issue) => issue.type === 'missing_city' && issue.city === 'domatowo'))
})
