/**
 * Shared market-selection helper for TxLINE odds arrays — `/api/odds/snapshot/{id}` returns an
 * array of markets (1X2, over/under, etc.); this picks the one match-winner (1X2) market, requiring
 * an actual priced outcome. Used by `research/watcher.ts` (to build `detect.ts`'s `BoardFixture`
 * shape correctly — see the module comment there for the bug this fixes) and mirrored as a local
 * copy in `coral-agents/seller-agent/src/service.ts`, a separate npm workspace with no import path
 * to this package.
 */

export function hasFinitePrice(market: Record<string, unknown> | undefined): boolean {
  const pct = (market?.Pct ?? []) as Array<string | number>
  return pct.some((p) => Number.isFinite(Number(p)))
}

/** The 1X2 (match-winner) market, preferred; any other priced market as a fallback. */
export function select1x2Market(odds: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(odds)) return undefined
  const markets = odds as Array<Record<string, unknown>>
  return markets.find((m) => String(m.SuperOddsType ?? '').includes('1X2') && hasFinitePrice(m))
    ?? markets.find(hasFinitePrice)
}
