import test from 'node:test'
import assert from 'node:assert/strict'
import { food4cities } from '../food4cities.js'

test('food4cities fixture contains 8 cities', () => {
  assert.equal(Object.keys(food4cities).length, 8)
  assert.deepEqual(food4cities.opalino, {
    chleb: 45,
    woda: 120,
    mlotek: 6,
  })
})
