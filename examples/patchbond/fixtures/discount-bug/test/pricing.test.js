import test from 'node:test'
import assert from 'node:assert/strict'
import { discountedTotal } from '../src/pricing.js'

test('applies a percentage discount to the subtotal', () => {
  assert.equal(discountedTotal(50, 2, 10), 90)
})

test('supports a zero discount', () => {
  assert.equal(discountedTotal(12, 3, 0), 36)
})

test('supports a full discount', () => {
  assert.equal(discountedTotal(25, 4, 100), 0)
})
