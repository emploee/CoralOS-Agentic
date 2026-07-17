import { describe, it, expect } from 'vitest'
import { analyzeEdge, deterministicCall, fairLine } from './edge.js'

const odds = [{ SuperOddsType: '1X2 (de-margined)', PriceNames: ['part1', 'draw', 'part2'], Pct: [62.4, 22.1, 15.5] }]
const fixtures = [{ FixtureId: 9001, Competition: 'World Cup', Participant1: 'Brazil', Participant2: 'Serbia' }]

describe('fairLine — verified line → break-even odds', () => {
  it('derives each outcome and the favourite with fair (break-even) decimal odds', () => {
    const { outcomes, favourite } = fairLine({ names: ['part1', 'draw', 'part2'], pct: [62.4, 22.1, 15.5] }, { home: 'Brazil', away: 'Serbia' })
    expect(outcomes.map((o) => o.label)).toEqual(['Brazil', 'Draw', 'Serbia'])
    expect(favourite?.label).toBe('Brazil')
    expect(favourite?.fairOdds).toBeCloseTo(1.60, 2) // 100 / 62.4
  })
})

describe('deterministicCall — read of the fair line', () => {
  it('names the favourite, its probability and break-even odds', () => {
    const a = deterministicCall({ names: ['part1', 'draw', 'part2'], pct: [62.4, 22.1, 15.5] }, { home: 'Brazil', away: 'Serbia' })
    expect(a.call).toMatch(/Brazil/)
    expect(a.call).toMatch(/1\.60/)
    expect(a.confidence).toBeCloseTo(0.62, 2)
  })
  it('handles an empty market', () => {
    expect(deterministicCall(undefined, undefined).call).toBe('no priced market for this fixture')
  })
})

describe('analyzeEdge — verified snapshots → product', () => {
  it('resolves teams and the fair line', async () => {
    const edge = await analyzeEdge({ fixtureId: 9001, odds, fixtures })
    expect(edge.teams?.home).toBe('Brazil')
    expect(edge.market?.pct).toEqual([62.4, 22.1, 15.5])
    expect(edge.fair?.favourite?.fairOdds).toBeCloseTo(1.60, 2)
    expect(edge.analysis.call).toMatch(/Brazil/)
  })
})
