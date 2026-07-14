import { describe, it, expect } from 'vitest'
import type { Want } from '@pay/agent-runtime'
import { deriveFloorSol } from './cost.js'
import type { SellerConfig } from './types.js'

const cfg: SellerConfig = { name: 'seller-x', services: ['txline', 'sharp-movement'], floorSol: 0.0003, persona: 'test' }
const want = (service: string): Want => ({ round: 1, service, arg: '7jw', budgetSol: 0.001 })

describe('deriveFloorSol - cost is derived per service, not one typed-in floor', () => {
  it('returns the base floor unchanged for a service with no llmDeliveryTokens entry', () => {
    expect(deriveFloorSol(want('txline'), cfg)).toBe(0.0003)
  })

  it('adds a real LLM-cost surcharge for a service listed in llmDeliveryTokens', () => {
    const llmCfg: SellerConfig = { ...cfg, llmDeliveryTokens: { 'sharp-movement': 180 } }
    const floor = deriveFloorSol(want('sharp-movement'), llmCfg)
    expect(floor).toBeGreaterThan(cfg.floorSol)
  })

  it('a heavier token budget derives a higher floor than a lighter one', () => {
    const lightCfg: SellerConfig = { ...cfg, llmDeliveryTokens: { 'sharp-movement': 180 } }
    const heavyCfg: SellerConfig = { ...cfg, llmDeliveryTokens: { 'sharp-movement': 700 } }
    expect(deriveFloorSol(want('sharp-movement'), heavyCfg)).toBeGreaterThan(deriveFloorSol(want('sharp-movement'), lightCfg))
  })

  it('only surcharges the listed service, not the seller\'s other services', () => {
    const llmCfg: SellerConfig = { ...cfg, llmDeliveryTokens: { 'sharp-movement': 180 } }
    expect(deriveFloorSol(want('txline'), llmCfg)).toBe(0.0003)
  })
})
