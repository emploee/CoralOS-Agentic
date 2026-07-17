/**
 * Seller services.
 *
 * `txline` - verified TxLINE fair-line reads for a fixture.
 * `sharp-movement` - a report on the CURRENT state of a fixture's 1X2 market (magnitude/confidence
 * from the leader's spread over the field, plus a plain-language read), sold in response to a WANT
 * the research watcher raised because a real move already happened. The seller doesn't re-detect
 * the move itself - by the time this WANT exists, examples/txodds/research/watcher.ts already
 * confirmed one - it just delivers a rich analysis of the fixture as it stands now.
 */
const TXLINE_BASE = process.env.TXLINE_BASE_URL || 'https://txline-dev.txodds.com'
const SUPPORTED_SERVICES = ['txline', 'sharp-movement']
type DeliveryOrder = { round?: number }

export interface ServiceDelivery {
  payload: string
}

const payloadOnly = async (delivery: Promise<ServiceDelivery>): Promise<string> => (await delivery).payload

export async function deliverService(request: string): Promise<string> {
  return payloadOnly(deliverServiceResult(request))
}

export async function deliverServiceResult(request: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
  const [first, ...rest] = request.trim().split(/\s+/).filter(Boolean)
  const service = (first ?? 'txline').toLowerCase()
  if (service === 'sharp-movement') return sharpMovementService(rest.join(' '))
  if (service !== 'txline') {
    return { payload: JSON.stringify({ error: 'unsupported service', service, supported: SUPPORTED_SERVICES }) }
  }
  return txlineService(rest.join(' '), order)
}

function fixtureIdFrom(request: string): string | undefined {
  return request.trim().split(/\s+/).find((token) => /^\d+$/.test(token))
}

function hasFinitePrice(market: Record<string, unknown> | undefined): boolean {
  const pct = (market?.Pct ?? []) as Array<string | number>
  return pct.some((p) => Number.isFinite(Number(p)))
}

/** Same selection examples/txodds/agent/market.ts uses for the watcher - kept as a local copy since
 *  this package is a separate npm workspace with no import path to that one. */
function select1x2Market(odds: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(odds)) return undefined
  const markets = odds as Array<Record<string, unknown>>
  return markets.find((m) => String(m.SuperOddsType ?? '').includes('1X2') && hasFinitePrice(m))
    ?? markets.find(hasFinitePrice)
}

async function sharpMovementService(request: string): Promise<ServiceDelivery> {
  const fixtureId = fixtureIdFrom(request) ?? request.trim()
  const [odds, fixtures] = await Promise.all([
    txlineGet(`/api/odds/snapshot/${fixtureId}`),
    txlineGet('/api/fixtures/snapshot'),
  ])
  const market = select1x2Market(odds)
  const fx = Array.isArray(fixtures)
    ? (fixtures as Array<Record<string, unknown>>).find((f) => String(f.FixtureId) === String(fixtureId))
    : undefined
  const teams = fx ? { home: fx.Participant1, away: fx.Participant2, competition: fx.Competition } : undefined

  if (!market) {
    return { payload: JSON.stringify({ service: 'sharp-movement', fixtureId, error: 'no priced 1X2 market available' }) }
  }

  // Magnitude/confidence come from the CURRENT market's decisiveness (spread between the top two
  // outcomes), not a delta against history - the watcher already confirmed a real move happened
  // before this WANT existed, so the seller reports the fixture as it stands now rather than
  // duplicating the watcher's own before/after diffing.
  const pctNums = ((market.Pct ?? []) as Array<string | number>).map(Number).filter(Number.isFinite)
  const sorted = [...pctNums].sort((a, b) => b - a)
  const spread = sorted.length >= 2 ? sorted[0] - sorted[1] : 0
  const magnitude: 'moderate' | 'sharp' | 'extreme' = spread >= 30 ? 'extreme' : spread >= 15 ? 'sharp' : 'moderate'
  const confidence = Number(Math.max(0, Math.min(1, spread / 40)).toFixed(2))
  const names = (market.PriceNames ?? []) as string[]
  const leaderIndex = pctNums.indexOf(Math.max(...pctNums))
  const leadingLabel = names[leaderIndex] ?? String(leaderIndex)

  const analysis = deterministicRead(market, teams)
  return {
    payload: JSON.stringify({
      service: 'sharp-movement', fixtureId, magnitude, confidence,
      spreadPct: Number(spread.toFixed(1)), leadingLabel, market, analysis,
    }),
  }
}

async function txlineGet(path: string): Promise<unknown> {
  const apiToken = process.env.TXLINE_API_KEY
  if (!apiToken) return { error: 'TXLINE_API_KEY not set - run the one-time subscribe (see examples/txodds)' }
  const auth = await fetch(`${TXLINE_BASE}/auth/guest/start`, { method: 'POST' })
  if (!auth.ok) return { error: `txline auth ${auth.status}` }
  const jwt = ((await auth.json()) as { token: string }).token
  const res = await fetch(`${TXLINE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
  })
  if (!res.ok) return { error: `txline ${path} ${res.status}` }
  return res.json()
}

async function txlineService(request: string, _order?: DeliveryOrder): Promise<ServiceDelivery> {
  const tokens = request.trim().split(/\s+/).filter(Boolean)
  let action = (tokens[0] ?? 'fixtures').toLowerCase()
  let fixtureId = tokens[1]
  if (/^\d+$/.test(action)) {
    fixtureId = action
    action = 'edge'
  }

  switch (action) {
    case 'odds':
      return { payload: JSON.stringify({ service: 'txline-odds', fixtureId, odds: await txlineGet(`/api/odds/snapshot/${fixtureId}`) }) }
    case 'edge':
      return txlineEdge(fixtureId)
    case 'fixtures':
    default: {
      const fixtures = await txlineGet('/api/fixtures/snapshot')
      const list = Array.isArray(fixtures) ? fixtures : []
      return { payload: JSON.stringify({ service: 'txline-fixtures', count: list.length, fixtures: list.slice(0, 10) }) }
    }
  }
}

async function txlineEdge(fixtureId: string | undefined): Promise<ServiceDelivery> {
  const [odds, fixtures] = await Promise.all([
    txlineGet(`/api/odds/snapshot/${fixtureId}`),
    txlineGet('/api/fixtures/snapshot'),
  ])
  const market = Array.isArray(odds)
    ? (odds as Array<Record<string, unknown>>).find((x) => String(x.SuperOddsType ?? '').includes('1X2'))
    : undefined
  const fx = Array.isArray(fixtures)
    ? (fixtures as Array<Record<string, unknown>>).find((f) => String(f.FixtureId) === String(fixtureId))
    : undefined
  const teams = fx ? { home: fx.Participant1, away: fx.Participant2, competition: fx.Competition } : undefined

  const analysis = deterministicRead(market, teams)
  return { payload: JSON.stringify({ service: 'txline-edge', fixtureId, teams, market, analysis }) }
}

function outcomeLabel(name: string, teams: Record<string, unknown> | undefined): string {
  if (name === 'part1') return String(teams?.home ?? 'Home')
  if (name === 'part2') return String(teams?.away ?? 'Away')
  if (name === 'draw') return 'Draw'
  return name
}

/** Clean {label, pct} pairs only - never the raw odds/price ticks the API also carries (e.g.
 *  Prices: [3284, 2212, 4107]), which would otherwise read as if they were meaningful percentages. */
function plainOutcomes(
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
): Array<{ label: string; pct: number }> {
  const names = (market?.PriceNames ?? []) as string[]
  const pcts = (market?.Pct ?? []) as Array<string | number>
  return names
    .map((name, i) => ({ label: outcomeLabel(name, teams), pct: Number(pcts[i]) }))
    .filter((o) => Number.isFinite(o.pct))
}

function deterministicRead(
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
): unknown {
  const outcomes = plainOutcomes(market, teams)
  const bestIndex = outcomes.reduce((best, o, i) => (best < 0 || o.pct > outcomes[best].pct ? i : best), -1)
  if (bestIndex < 0) return { call: 'odds unavailable', confidence: 0 }
  const { label, pct: bestPct } = outcomes[bestIndex]
  return { call: `Odds favour ${label} (${bestPct.toFixed(0)}%)`, confidence: Number((bestPct / 100).toFixed(2)) }
}
