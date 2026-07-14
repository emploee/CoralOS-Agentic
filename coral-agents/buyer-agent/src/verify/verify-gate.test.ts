import { describe, it, expect } from 'vitest'
import { decideVerifyEscalation } from './verify-gate.js'

const respond = (status: number, body?: unknown) =>
  (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

describe('decideVerifyEscalation', () => {
  it('never escalates when no verifier is configured', async () => {
    const d = await decideVerifyEscalation(false, true, 'seller-x', 'http://x/api/reputation')
    expect(d).toEqual({ escalate: false, reason: 'no verifier configured' })
  })

  it('always escalates when the gate is disabled', async () => {
    const d = await decideVerifyEscalation(true, false, 'seller-x')
    expect(d.escalate).toBe(true)
  })

  it('escalates for a seller with too few prior deliveries', async () => {
    const d = await decideVerifyEscalation(true, true, 'seller-new', 'http://x/api/reputation', respond(200, {
      reputation: [{ seller: 'seller-new', awarded: 1, delivered: 1, settled: 1, verifiedPass: 0, verifiedFail: 0, refunded: 0, score: 50 }],
    }))
    expect(d.escalate).toBe(true)
    expect(d.reason).toContain('fewer than 3')
  })

  it('escalates for a seller with any prior verification failure, even with a long history', async () => {
    const d = await decideVerifyEscalation(true, true, 'seller-mixed', 'http://x/api/reputation', respond(200, {
      reputation: [{ seller: 'seller-mixed', awarded: 10, delivered: 10, settled: 9, verifiedPass: 9, verifiedFail: 1, refunded: 0, score: 80 }],
    }))
    expect(d.escalate).toBe(true)
    expect(d.reason).toContain('failed verification')
  })

  it('skips escalation for a seller with a clean, established record', async () => {
    const d = await decideVerifyEscalation(true, true, 'seller-good', 'http://x/api/reputation', respond(200, {
      reputation: [{ seller: 'seller-good', awarded: 5, delivered: 5, settled: 5, verifiedPass: 5, verifiedFail: 0, refunded: 0, score: 95 }],
    }))
    expect(d).toEqual({ escalate: false, reason: 'seller-good has a clean record over 5 deliveries' })
  })

  it('escalates when the reputation fetch fails (unknown record = untrusted)', async () => {
    const boom = (async () => { throw new Error('down') }) as unknown as typeof fetch
    const d = await decideVerifyEscalation(true, true, 'seller-x', 'http://x/api/reputation', boom)
    expect(d.escalate).toBe(true)
  })
})
