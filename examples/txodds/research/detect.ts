/**
 * Odds-event detection - pure and network-free, so it's fully unit-testable.
 *
 * The watcher polls the oracle proxy's /api/board (fixtures with verified live 1X2 odds inlined)
 * and diffs consecutive snapshots. Two event kinds trigger a paid research WANT:
 *   new-fixture  a fixture with verified odds appears that wasn't on the previous board
 *   odds-move    any outcome's implied probability moved >= threshold percentage points
 *
 * The WANT arg is the bare fixture id (one token on the wire); the seller's txline service treats
 * a bare numeric arg as `edge <id>` - the full verified read.
 */

export interface BoardFixture {
  fixtureId: string | number
  home?: unknown
  away?: unknown
  odds?: { PriceNames?: string[]; Pct?: Array<string | number> } | null
}

export interface MarketEvent {
  kind: 'new-fixture' | 'odds-move'
  fixtureId: string
  /** The WANT arg (the fixture id - the seller runs the full edge read on it). */
  arg: string
  note: string
}

/** fixtureId -> implied probabilities (Pct) from the last poll. */
export type BoardSnapshot = Record<string, number[]>

const pcts = (f: BoardFixture): number[] =>
  (f.odds?.Pct ?? []).map(Number).filter(Number.isFinite)

const label = (f: BoardFixture): string =>
  f.home && f.away ? `${f.home} v ${f.away}` : `fixture ${f.fixtureId}`

export function detectEvents(
  prev: BoardSnapshot,
  board: BoardFixture[],
  moveThresholdPct = 5,
): { events: MarketEvent[]; snapshot: BoardSnapshot } {
  const events: MarketEvent[] = []
  const snapshot: BoardSnapshot = {}

  for (const f of board) {
    const id = String(f.fixtureId)
    const now = pcts(f)
    if (!now.length) continue // no verified odds -> nothing to research
    snapshot[id] = now

    const before = prev[id]
    if (!before) {
      events.push({ kind: 'new-fixture', fixtureId: id, arg: id, note: `${label(f)}: verified odds live` })
      continue
    }
    const delta = Math.max(...now.map((p, i) => Math.abs(p - (before[i] ?? p))))
    if (delta >= moveThresholdPct) {
      events.push({
        kind: 'odds-move', fixtureId: id, arg: id,
        note: `${label(f)}: implied probability moved ${delta.toFixed(1)}pp`,
      })
    }
  }
  return { events, snapshot }
}
