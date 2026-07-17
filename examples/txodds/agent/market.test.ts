import { describe, it, expect } from 'vitest'
import { hasFinitePrice, select1x2Market } from './market.js'

describe('hasFinitePrice', () => {
  it('is true when at least one Pct value parses as a finite number', () => {
    expect(hasFinitePrice({ Pct: ['12.5', 'NA', '30'] })).toBe(true)
  })

  it('is false when every Pct value is missing or unparseable', () => {
    expect(hasFinitePrice({ Pct: ['NA', 'NA'] })).toBe(false)
    expect(hasFinitePrice({})).toBe(false)
    expect(hasFinitePrice(undefined)).toBe(false)
  })
})

describe('select1x2Market', () => {
  it('prefers a priced 1X2 market over other priced markets', () => {
    const odds = [
      { SuperOddsType: 'OVER_UNDER', Pct: ['50', '50'] },
      { SuperOddsType: '1X2_PARTICIPANT_RESULT', Pct: ['40', '30', '30'] },
    ]
    expect(select1x2Market(odds)).toBe(odds[1])
  })

  it('falls back to any priced market when no 1X2 market is priced', () => {
    const odds = [
      { SuperOddsType: '1X2_PARTICIPANT_RESULT', Pct: ['NA', 'NA', 'NA'] },
      { SuperOddsType: 'OVER_UNDER', Pct: ['55', '45'] },
    ]
    expect(select1x2Market(odds)).toBe(odds[1])
  })

  it('returns undefined for a non-array or an all-unpriced odds payload', () => {
    expect(select1x2Market(undefined)).toBeUndefined()
    expect(select1x2Market([{ SuperOddsType: '1X2', Pct: ['NA'] }])).toBeUndefined()
  })
})
