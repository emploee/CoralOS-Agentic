import { describe, it, expect } from 'vitest'
import { detectSignals, type BoardFixture, type BoardSnapshot } from './detect.js'

const fixture = (id: number, pcts: number[], home = 'Home', away = 'Away'): BoardFixture => ({
  fixtureId: id,
  home,
  away,
  odds: { PriceNames: ['part1', 'draw', 'part2'], Pct: pcts },
})

describe('detectSignals', () => {
  it('emits new-fixture for a fixture not seen before', () => {
    const { events, snapshot } = detectSignals({}, [fixture(1, [45, 28, 27])])
    expect(events).toEqual([
      expect.objectContaining({ kind: 'new-fixture', fixtureId: '1', arg: '1' }),
    ])
    expect(snapshot['1']).toEqual([45, 28, 27])
  })

  it('skips fixtures with no verified odds', () => {
    const { events } = detectSignals({}, [{ fixtureId: 2, odds: null }])
    expect(events).toEqual([])
  })

  it('emits odds-move when a probability moves past the threshold', () => {
    const prev: BoardSnapshot = { '1': [45, 28, 27] }
    const { events } = detectSignals(prev, [fixture(1, [52, 26, 22])], 5)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'odds-move', fixtureId: '1', movePct: 7 })
  })

  it('does not emit below the threshold', () => {
    const prev: BoardSnapshot = { '1': [45, 28, 27] }
    const { events } = detectSignals(prev, [fixture(1, [47, 27, 26])], 5)
    expect(events).toEqual([])
  })

  it('updates the snapshot even when no event fires', () => {
    const prev: BoardSnapshot = { '1': [45, 28, 27] }
    const { snapshot } = detectSignals(prev, [fixture(1, [46, 28, 26])], 5)
    expect(snapshot['1']).toEqual([46, 28, 26])
  })

  it('uses the injected clock for detectedAt', () => {
    const { events } = detectSignals({}, [fixture(1, [45, 28, 27])], 5, () => '2026-07-10T00:00:00.000Z')
    expect(events[0].detectedAt).toBe('2026-07-10T00:00:00.000Z')
  })
})
