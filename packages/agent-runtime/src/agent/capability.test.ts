import { describe, it, expect } from 'vitest'
import { grantCapabilities, hasCapability, requireCapability } from './capability.js'

describe('capability grants', () => {
  it('grants exactly the requested capabilities', () => {
    const grant = grantCapabilities('buyer-agent', ['bid', 'settle'])
    expect(hasCapability(grant, 'bid')).toBe(true)
    expect(hasCapability(grant, 'settle')).toBe(true)
    expect(hasCapability(grant, 'verify')).toBe(false)
  })

  it('hasCapability is false for an undefined grant', () => {
    expect(hasCapability(undefined, 'bid')).toBe(false)
  })

  it('requireCapability does not throw when granted', () => {
    const grant = grantCapabilities('seller-agent', ['deliver'])
    expect(() => requireCapability(grant, 'deliver')).not.toThrow()
  })

  it('requireCapability throws when not granted, naming the agent and capability', () => {
    const grant = grantCapabilities('seller-agent', ['deliver'])
    expect(() => requireCapability(grant, 'settle')).toThrow(/seller-agent.*'settle'/)
  })

  it('requireCapability throws on an undefined grant', () => {
    expect(() => requireCapability(undefined, 'bid')).toThrow(/no grant/)
  })
})
