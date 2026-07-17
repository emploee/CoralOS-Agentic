import { describe, it, expect } from 'vitest'
import type { Want } from '@pay/agent-runtime'
import { deriveFloorSol } from './cost.js'
import type { SellerConfig } from './types.js'

const cfg: SellerConfig = { name: 'seller-x', services: ['txline'], floorSol: 0.0003, persona: 'test' }
const want: Want = { round: 1, service: 'txline', arg: '7jw', budgetSol: 0.001 }

describe('deriveFloorSol', () => {
  it('returns the persona floor unchanged', () => {
    expect(deriveFloorSol(want, cfg)).toBe(0.0003)
  })
})
