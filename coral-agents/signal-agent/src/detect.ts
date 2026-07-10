/**
 * Odds-move detection — pure and network-free, so it's fully unit-testable.
 *
 * Intentionally mirrors `examples/txodds/research/detect.ts`'s pure diff logic rather than
 * importing it: `coral-agents/*` are generic per-session participants that examples orchestrate,
 * never the reverse, so this package cannot depend on a specific example. Both read the same
 * `/api/board` shape from `server/proxy.ts` (fixtures with verified 1X2 odds inlined).
 *
 * Two event kinds are worth paid research:
 *   new-fixture  a fixture with verified odds appears that wasn't on the previous board
 *   odds-move    any outcome's implied probability moved >= threshold percentage points
 */

export interface BoardFixture {
  fixtureId: string | number
  home?: unknown
  away?: unknown
  odds?: { PriceNames?: string[]; Pct?: Array<string | number> } | null
}

export interface SignalEvent {
  kind: 'new-fixture' | 'odds-move'
  fixtureId: string
  /** The WANT arg (the fixture id — the seller runs the full edge read on it). */
  arg: string
  note: string
  /** Largest single-outcome implied-probability delta observed, in percentage points. Present for odds-move. */
  movePct?: number
  detectedAt: string
}

/** fixtureId -> implied probabilities (Pct) from the last poll. */
export type BoardSnapshot = Record<string, number[]>

const pcts = (f: BoardFixture): number[] => (f.odds?.Pct ?? []).map(Number).filter(Number.isFinite)

const label = (f: BoardFixture): string => (f.home && f.away ? `${f.home} v ${f.away}` : `fixture ${f.fixtureId}`)

export function detectSignals(
  prev: BoardSnapshot,
  board: BoardFixture[],
  moveThresholdPct = 5,
  now: () => string = () => new Date().toISOString(),
): { events: SignalEvent[]; snapshot: BoardSnapshot } {
  const events: SignalEvent[] = []
  const snapshot: BoardSnapshot = {}

  for (const f of board) {
    const id = String(f.fixtureId)
    const current = pcts(f)
    if (!current.length) continue // no verified odds -> nothing to research
    snapshot[id] = current

    const before = prev[id]
    if (!before) {
      events.push({ kind: 'new-fixture', fixtureId: id, arg: id, note: `${label(f)}: verified odds live`, detectedAt: now() })
      continue
    }
    const delta = Math.max(...current.map((p, i) => Math.abs(p - (before[i] ?? p))))
    if (delta >= moveThresholdPct) {
      events.push({
        kind: 'odds-move', fixtureId: id, arg: id,
        note: `${label(f)}: implied probability moved ${delta.toFixed(1)}pp`,
        movePct: Number(delta.toFixed(2)), detectedAt: now(),
      })
    }
  }
  return { events, snapshot }
}
