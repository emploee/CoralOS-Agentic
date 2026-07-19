import { hashTask, sha256 } from './artifact.js'
import type { PatchDelivery, PatchTask } from './types.js'

export const DISCOUNT_BROKEN_SOURCE = `export function discountedTotal(price, quantity, discountPercent) {
  const subtotal = price * quantity
  return subtotal - discountPercent
}
`

export const DISCOUNT_FIXED_SOURCE = `export function discountedTotal(price, quantity, discountPercent) {
  const subtotal = price * quantity
  return subtotal * (1 - discountPercent / 100)
}
`

export const DISCOUNT_TEST_SOURCE = `import test from 'node:test'
import assert from 'node:assert/strict'
import { discountedTotal } from '../src/pricing.js'

test('applies a percentage discount', () => assert.equal(discountedTotal(50, 2, 10), 90))
test('supports zero discount', () => assert.equal(discountedTotal(12, 3, 0), 36))
test('supports full discount', () => assert.equal(discountedTotal(25, 4, 100), 0))
`

export const DISCOUNT_TASK: PatchTask = {
  id: 'discount-calculation-001',
  title: 'Repair percentage discount calculation',
  description: 'The checkout subtracts a raw percentage instead of applying it to the subtotal.',
  language: 'javascript',
  baseCommit: sha256(DISCOUNT_BROKEN_SOURCE),
  testCommand: 'node --test test/pricing.test.js',
  allowedPaths: ['src/pricing.js'],
  budgetSol: 0.02,
  deadlineSeconds: 180,
}

export function createDiscountDelivery(seller: string): PatchDelivery {
  return {
    schema: 'patchbond.delivery.v1',
    taskId: DISCOUNT_TASK.id,
    taskSha256: hashTask(DISCOUNT_TASK),
    seller,
    files: [{
      path: 'src/pricing.js',
      beforeSha256: sha256(DISCOUNT_BROKEN_SOURCE),
      contentBase64: Buffer.from(DISCOUNT_FIXED_SOURCE).toString('base64'),
    }],
    summary: 'Apply the percentage to the subtotal rather than subtracting the raw percentage.',
  }
}
