import { describe, it, expect } from 'vitest'
import { formatVerify, parseVerify, formatVerified, parseVerified } from './protocol.js'

const payload = '{"coin":"solana","usd":72.33, "note":"has spaces and = signs"}'

describe('VERIFY wire format', () => {
  it('round-trips a request with a spaced JSON payload', () => {
    const req = { round: 4, service: 'txline', arg: '12345', sha: 'abc123', payload }
    expect(parseVerify(formatVerify(req))).toEqual(req)
  })

  it('rejects a VERIFY missing its payload', () => {
    expect(parseVerify('VERIFY round=4 sha=abc123 service=txline arg=x payload=')).toBeNull()
    expect(parseVerify('VERIFY round=4 sha=abc123 service=txline arg=x')).toBeNull()
  })

  it('ignores other verbs', () => {
    expect(parseVerify('VERIFIED round=4 verdict=pass by=v')).toBeNull()
  })
})

describe('VERIFIED wire format', () => {
  it('round-trips a pass with sha + reason (quotes neutralized)', () => {
    const v = parseVerified(formatVerified({
      round: 4, verdict: 'pass', by: 'verifier-agent', sha: 'abc123', reason: 'hash "matches" want',
    }))
    expect(v).toEqual({ round: 4, verdict: 'pass', by: 'verifier-agent', sha: 'abc123', reason: "hash 'matches' want" })
  })

  it('round-trips a bare fail', () => {
    expect(parseVerified(formatVerified({ round: 9, verdict: 'fail', by: 'v' })))
      .toEqual({ round: 9, verdict: 'fail', by: 'v' })
  })

  it('rejects an unknown verdict', () => {
    expect(parseVerified('VERIFIED round=4 verdict=maybe by=v')).toBeNull()
  })
})
