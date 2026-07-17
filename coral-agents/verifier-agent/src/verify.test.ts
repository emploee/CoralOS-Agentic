import { describe, it, expect } from 'vitest'
import { sha256Hex, type VerifyRequest } from '@pay/agent-runtime'
import { checkDelivery } from './verify.js'

const payload = '{"service":"txline-edge","analysis":{"call":"Home value","confidence":0.7}}'
const req = (over: Partial<VerifyRequest> = {}): VerifyRequest => ({
  round: 5, service: 'txline', arg: '12345', sha: sha256Hex(payload), payload, ...over,
})

describe('checkDelivery - deterministic checks', () => {
  it('fails a tampered payload on hash mismatch', async () => {
    const v = await checkDelivery(req({ sha: sha256Hex('something else') }), 'v')
    expect(v).toMatchObject({ verdict: 'fail', reason: 'content hash mismatch' })
  })

  it('fails a non-JSON payload', async () => {
    const bad = 'sorry, no data today'
    const v = await checkDelivery(req({ payload: bad, sha: sha256Hex(bad) }), 'v')
    expect(v).toMatchObject({ verdict: 'fail', reason: 'payload is not JSON' })
  })

  it('fails a payload that reports an error', async () => {
    const err = '{"error":"TXLINE_API_KEY not set"}'
    const v = await checkDelivery(req({ payload: err, sha: sha256Hex(err) }), 'v')
    expect(v.verdict).toBe('fail')
    expect(v.reason).toContain('payload reports error')
  })

  it('passes a structurally valid, hash-matched payload', async () => {
    const v = await checkDelivery(req(), 'v')
    expect(v).toMatchObject({ verdict: 'pass', reason: 'hash + structure verified', by: 'v' })
    expect(v.sha).toBe(sha256Hex(payload))
  })
})
