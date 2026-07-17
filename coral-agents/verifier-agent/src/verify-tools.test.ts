import { describe, it, expect } from 'vitest'
import { inspectPayloadStructureTool, submitVerdictTool, assessScrutiny } from './verify-tools.js'

describe('inspectPayloadStructureTool', () => {
  it('reports structure for valid JSON', async () => {
    const tool = inspectPayloadStructureTool('{"a":1,"b":2}')
    expect(await tool.execute({})).toEqual({ isJson: true, topLevelKeys: ['a', 'b'], hasErrorField: false, byteLength: 13 })
  })

  it('flags non-JSON payloads', async () => {
    const tool = inspectPayloadStructureTool('not json')
    expect((await tool.execute({})).isJson).toBe(false)
  })

  it('flags an error field', async () => {
    const tool = inspectPayloadStructureTool('{"error":"boom"}')
    expect((await tool.execute({})).hasErrorField).toBe(true)
  })
})

describe('submitVerdictTool', () => {
  it('echoes the submitted input', async () => {
    expect(await submitVerdictTool.execute({ pass: true, reason: 'ok' })).toEqual({ pass: true, reason: 'ok' })
  })
})

describe('assessScrutiny', () => {
  it('is low for a recognized, well-formed shape', () => {
    const payload = JSON.stringify({ service: 'txline-edge', fixtureId: '1', teams: {}, market: {}, analysis: {} })
    expect(assessScrutiny({ payload })).toBe('low')
  })

  it('is low for a well-formed sharp-movement delivery', () => {
    const payload = JSON.stringify({ service: 'sharp-movement', fixtureId: '1', magnitude: 'sharp', confidence: 0.8, spreadPct: 20, leadingLabel: 'part1', market: {}, analysis: {} })
    expect(assessScrutiny({ payload })).toBe('low')
  })

  it('is high for a recognized service missing expected keys', () => {
    const payload = JSON.stringify({ service: 'txline-edge', analysis: {} })
    expect(assessScrutiny({ payload })).toBe('high')
  })

  it('is high for an unrecognized service', () => {
    const payload = JSON.stringify({ service: 'mystery-service', data: 1 })
    expect(assessScrutiny({ payload })).toBe('high')
  })

  it('is high for non-JSON payloads', () => {
    expect(assessScrutiny({ payload: 'not json' })).toBe('high')
  })
})
