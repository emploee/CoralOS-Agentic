import { describe, it, expect } from 'vitest'
import { detectEvents, type BoardFixture } from './detect.js'

const fixture = (id: number, pct: number[], teams = true): BoardFixture => ({
  fixtureId: id,
  ...(teams ? { home: 'A', away: 'B' } : {}),
  odds: { PriceNames: ['part1', 'x', 'part2'], Pct: pct.map(String) },
})

describe('detectEvents', () => {
  it('flags a fixture appearing with verified odds', () => {
    const { events, snapshot } = detectEvents({}, [fixture(1, [60, 25, 15])])
    expect(events).toEqual([
      { kind: 'new-fixture', fixtureId: '1', arg: '1', note: 'A v B: verified odds live' },
    ])
    expect(snapshot).toEqual({ '1': [60, 25, 15] })
  })

  it('flags an implied-probability move at or above the threshold', () => {
    const prev = { '1': [60, 25, 15] }
    const { events } = detectEvents(prev, [fixture(1, [53, 30, 17])], 5)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'odds-move', arg: '1' })
    expect(events[0].note).toContain('7.0pp')
  })

  it('stays quiet under the threshold and on unchanged boards', () => {
    const prev = { '1': [60, 25, 15] }
    expect(detectEvents(prev, [fixture(1, [58, 26, 16])], 5).events).toEqual([])
    expect(detectEvents(prev, [fixture(1, [60, 25, 15])], 5).events).toEqual([])
  })

  it('ignores fixtures with no verified odds', () => {
    const bare: BoardFixture = { fixtureId: 9, odds: null }
    const { events, snapshot } = detectEvents({}, [bare])
    expect(events).toEqual([])
    expect(snapshot).toEqual({})
  })

  it('a fixture dropping off the board just leaves the snapshot', () => {
    const prev = { '1': [60, 25, 15], '2': [40, 30, 30] }
    const { snapshot } = detectEvents(prev, [fixture(1, [60, 25, 15])])
    expect(Object.keys(snapshot)).toEqual(['1'])
  })
})
