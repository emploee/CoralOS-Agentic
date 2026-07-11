import { describe, expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { PaymentRailRouter, escrowRail, solanaPayRail, x402ClientRail } from './index.js'

describe('PaymentRailRouter', () => {
  it('honors an explicit rail over the default', async () => {
    const router = new PaymentRailRouter([escrowRail(), x402ClientRail()])
    const quote = await router.quote({
      rail: 'x402',
      service: 'upstream-call',
      buyer: 'seller-agent',
      amount: 0.0005,
      currency: 'SOL',
    })
    expect(quote.rail).toBe('x402')
  })

  it('defaults to solana-pay when no rail is specified and it is registered', async () => {
    const recipient = Keypair.generate().publicKey.toBase58()
    const router = new PaymentRailRouter([escrowRail(), solanaPayRail({ recipient })])
    const request = await router.requestPayment({
      id: 'order-1',
      service: 'research-brief',
      buyer: 'buyer',
      seller: recipient,
      amount: '0.20',
      currency: 'SOL',
    })
    expect(request.rail).toBe('solana-pay')
    expect(request.payTo).toBe(recipient)
  })

  it('routes to escrow when requireEscrow is set, regardless of registration order', async () => {
    const recipient = Keypair.generate().publicKey.toBase58()
    const router = new PaymentRailRouter([solanaPayRail({ recipient }), escrowRail()])
    const quote = await router.quote({
      requireEscrow: true,
      service: 'dispute-prone-work',
      buyer: 'buyer',
      seller: 'seller',
      amount: 1,
      currency: 'SOL',
    })
    expect(quote.rail).toBe('escrow')
  })

  it('throws registering the same rail kind twice', () => {
    const recipient = Keypair.generate().publicKey.toBase58()
    expect(() => new PaymentRailRouter([solanaPayRail({ recipient }), solanaPayRail({ recipient })])).toThrow(/already registered/)
  })

  it('throws asking for an unregistered rail', () => {
    const router = new PaymentRailRouter([escrowRail()])
    expect(() => router.get('x402')).toThrow(/not registered/)
  })
})
