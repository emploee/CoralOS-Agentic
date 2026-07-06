import { describe, expect, it } from 'vitest'
import { toProofReceipt } from './receipt.js'
import type { PaymentVerification } from './types.js'

const paid: PaymentVerification = {
  paid: true,
  rail: 'pay-sh',
  proof: 'pay-sh-demo:abc123',
  amount: '0.03',
  currency: 'USDC',
  payer: 'seller-agent',
  recipient: 'pay.sh/txodds-context',
  reference: 'order-7',
}

describe('toProofReceipt', () => {
  it('folds a paid verification into a formal receipt', () => {
    const receipt = toProofReceipt(paid, { provider: 'pay.sh/txodds-context', service: 'txline-edge-upstream', simulated: true })
    expect(receipt).toMatchObject({
      rail: 'pay-sh',
      provider: 'pay.sh/txodds-context',
      service: 'txline-edge-upstream',
      reference: 'order-7',
      proof: 'pay-sh-demo:abc123',
      amount: '0.03',
      currency: 'USDC',
      paid: true,
      simulated: true,
    })
    expect(Date.parse(receipt.issuedAt)).not.toBeNaN()
    expect(receipt.reason).toBeUndefined()
  })

  it('keeps the failure reason and falls back to the tx signature as proof', () => {
    const receipt = toProofReceipt(
      { paid: false, rail: 'solana-pay', txSignature: 'sig111', amount: '0.001', currency: 'SOL', reason: 'missing signature, recipient, or reference' },
    )
    expect(receipt.paid).toBe(false)
    expect(receipt.proof).toBe('sig111')
    expect(receipt.reason).toMatch(/missing/)
    expect(receipt.simulated).toBeUndefined()
  })
})
