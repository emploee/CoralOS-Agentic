import { describe, it, expect } from 'vitest'
import { sha256Hex, type VerifyRequest } from '@pay/agent-runtime'
import { checkDelivery } from './verify.js'

const payload = '{"service":"txline-edge","analysis":{"call":"Home value","confidence":0.7}}'
const req = (over: Partial<VerifyRequest> = {}): VerifyRequest => ({
  round: 5, service: 'txline', arg: '12345', sha: sha256Hex(payload), payload, ...over,
})
const llmDown = async () => { throw new Error('llm down') }
const llmSays = (json: string) => async () => json

describe('checkDelivery - deterministic checks decide first', () => {
  it('fails a tampered payload on hash mismatch (no LLM say)', async () => {
    const v = await checkDelivery(req({ sha: sha256Hex('something else') }), 'v', llmSays('{"pass":true}'))
    expect(v).toMatchObject({ verdict: 'fail', reason: 'content hash mismatch' })
  })

  it('fails a non-JSON payload', async () => {
    const bad = 'sorry, no data today'
    const v = await checkDelivery(req({ payload: bad, sha: sha256Hex(bad) }), 'v', llmDown)
    expect(v).toMatchObject({ verdict: 'fail', reason: 'payload is not JSON' })
  })

  it('fails a payload that reports an error', async () => {
    const err = '{"error":"TXLINE_API_KEY not set"}'
    const v = await checkDelivery(req({ payload: err, sha: sha256Hex(err) }), 'v', llmDown)
    expect(v.verdict).toBe('fail')
    expect(v.reason).toContain('payload reports error')
  })

  it('passes deterministically when the LLM judge is down', async () => {
    const v = await checkDelivery(req(), 'v', llmDown)
    expect(v).toMatchObject({ verdict: 'pass', reason: 'hash + structure verified', by: 'v' })
    expect(v.sha).toBe(sha256Hex(payload))
  })

  it('honours an LLM fail verdict on structurally valid payloads', async () => {
    const v = await checkDelivery(req(), 'v', llmSays('{"pass":false,"reason":"does not answer the arg"}'))
    expect(v).toMatchObject({ verdict: 'fail', reason: 'does not answer the arg' })
  })

  it('honours an LLM pass verdict with its reason', async () => {
    const v = await checkDelivery(req(), 'v', llmSays('{"pass":true,"reason":"fits the order"}'))
    expect(v).toMatchObject({ verdict: 'pass', reason: 'fits the order' })
  })
})
