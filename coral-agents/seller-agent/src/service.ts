/**
 * Seller services.
 *
 * `txline` - verified TxLINE fair-line reads for a fixture.
 * `sharp-movement` - a report on the CURRENT state of a fixture's 1X2 market (magnitude/confidence
 * from the leader's spread over the field, plus an LLM read), sold in response to a WANT the
 * research watcher raised because a real move already happened. The seller doesn't re-detect the
 * move itself - by the time this WANT exists, examples/txodds/research/watcher.ts already confirmed
 * one - it just delivers a rich analysis of the fixture as it stands now.
 * `freelance` - the generic LLM worker (the freelancer market's baseline seller): the brief goes to
 * the LLM, the deliverable comes back as JSON. Without an LLM key it returns an error payload, which
 * the verifier fails and the buyer refuses to pay for - no-capability sellers don't get released.
 */
import { complete, llmRuntimeInfo, parseJsonReply, sha256Hex, type LlmUse } from '@pay/agent-runtime'

const TXLINE_BASE = process.env.TXLINE_BASE_URL || 'https://txline-dev.txodds.com'
const SUPPORTED_SERVICES = ['txline', 'freelance', 'sharp-movement']
type DeliveryOrder = { round?: number }

export interface ServiceDelivery {
  payload: string
  llm: LlmUse[]
}

function deliveryLlm(
  order: DeliveryOrder | undefined,
  status: LlmUse['status'],
  reason: string,
  guardrail: string,
  opts: { maxTokens?: number; includeModel?: boolean } = {},
  audit: Pick<LlmUse, 'inputHash' | 'outputHash'> = {},
): LlmUse {
  const info = opts.includeModel === false ? undefined : llmRuntimeInfo({ maxTokens: opts.maxTokens ?? 180 })
  return {
    round: order?.round ?? 0,
    agent: process.env.AGENT_NAME ?? 'seller-agent',
    purpose: 'seller_delivery',
    status,
    ...(info ? { provider: info.provider, model: info.model } : {}),
    usedFor: 'seller_delivery_summary',
    affectedFunds: false,
    ...audit,
    reason,
    guardrail,
    createdAt: new Date().toISOString(),
  }
}

const payloadOnly = async (delivery: Promise<ServiceDelivery>): Promise<string> => (await delivery).payload

export async function deliverService(request: string): Promise<string> {
  return payloadOnly(deliverServiceResult(request))
}

export async function deliverServiceResult(request: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
  const [first, ...rest] = request.trim().split(/\s+/).filter(Boolean)
  const service = (first ?? 'txline').toLowerCase()
  if (service === 'freelance') return freelanceService(rest.join(' '), order)
  if (service === 'sharp-movement') return sharpMovementService(rest.join(' '), order)
  if (service !== 'txline') {
    return {
      payload: JSON.stringify({ error: 'unsupported service', service, supported: SUPPORTED_SERVICES }),
      llm: [deliveryLlm(order, 'skipped', 'unsupported service rejected before delivery work', 'service allowlist', { includeModel: false })],
    }
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

async function sharpMovementService(request: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
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
  const matchup = teams ? `${teams.home} v ${teams.away}` : `fixture ${fixtureId}`

  if (!market) {
    return {
      payload: JSON.stringify({ service: 'sharp-movement', fixtureId, error: 'no priced 1X2 market available' }),
      llm: [deliveryLlm(order, 'skipped', 'no priced market to analyze', 'deterministic market check', { includeModel: false })],
    }
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

  const analysis = await liveReadOrFallback(matchup, odds, market, teams, order)
  return {
    payload: JSON.stringify({
      service: 'sharp-movement', fixtureId, magnitude, confidence,
      spreadPct: Number(spread.toFixed(1)), leadingLabel, market, analysis: analysis.value,
    }),
    llm: [analysis.llm],
  }
}

async function freelanceService(brief: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
  try {
    const system =
      'You are a freelance agent delivering a PAID order. Produce the deliverable for the brief. ' +
      'Reply ONLY with JSON: {"deliverable": <string or object>, "notes": "<under 15 words>"}.'
    const user = `Brief: ${brief || 'unspecified'}`
    const inputHash = sha256Hex(`${system}\n${user}`)
    const text = await complete({
      system,
      user,
      maxTokens: 700,
    })
    const outputHash = sha256Hex(text)
    const parsed = parseJsonReply<{ deliverable?: unknown; notes?: string }>(text)
    return {
      payload: JSON.stringify({
        service: 'freelance', brief,
        result: parsed ?? { deliverable: text.trim() },
      }),
      llm: [deliveryLlm(order, 'used', 'model produced freelance deliverable', 'verifier checks JSON and order fit before release', { maxTokens: 700 }, { inputHash, outputHash })],
    }
  } catch (e) {
    // No LLM -> an honest error payload; the verifier fails it and the escrow is never released.
    return {
      payload: JSON.stringify({ service: 'freelance', brief, error: `llm unavailable: ${(e as Error).message}` }),
      llm: [deliveryLlm(order, 'error', `LLM unavailable: ${(e as Error).message}`, 'error payload fails verification; escrow is not released', { maxTokens: 700 })],
    }
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

async function txlineService(request: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
  const tokens = request.trim().split(/\s+/).filter(Boolean)
  let action = (tokens[0] ?? 'fixtures').toLowerCase()
  let fixtureId = tokens[1]
  if (/^\d+$/.test(action)) {
    fixtureId = action
    action = 'edge'
  }

  switch (action) {
    case 'odds':
      return {
        payload: JSON.stringify({ service: 'txline-odds', fixtureId, odds: await txlineGet(`/api/odds/snapshot/${fixtureId}`) }),
        llm: [deliveryLlm(order, 'skipped', 'odds snapshot is a direct TxLINE fetch', 'token-gated TxLINE fetch plus verifier checks', { includeModel: false })],
      }
    case 'edge':
      return txlineEdge(fixtureId, order)
    case 'fixtures':
    default: {
      const fixtures = await txlineGet('/api/fixtures/snapshot')
      const list = Array.isArray(fixtures) ? fixtures : []
      return {
        payload: JSON.stringify({ service: 'txline-fixtures', count: list.length, fixtures: list.slice(0, 10) }),
        llm: [deliveryLlm(order, 'skipped', 'fixture snapshot is a direct TxLINE fetch', 'token-gated TxLINE fetch plus verifier checks', { includeModel: false })],
      }
    }
  }
}

async function txlineEdge(fixtureId: string | undefined, order?: DeliveryOrder): Promise<ServiceDelivery> {
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
  const matchup = teams ? `${teams.home} v ${teams.away}` : `fixture ${fixtureId}`

  const analysis = await liveReadOrFallback(matchup, odds, market, teams, order)
  return {
    payload: JSON.stringify({ service: 'txline-edge', fixtureId, teams, market, analysis: analysis.value }),
    llm: [analysis.llm],
  }
}

function outcomeLabel(name: string, teams: Record<string, unknown> | undefined): string {
  if (name === 'part1') return String(teams?.home ?? 'Home')
  if (name === 'part2') return String(teams?.away ?? 'Away')
  if (name === 'draw') return 'Draw'
  return name
}

/** Clean {label, pct} pairs only - never the raw odds/price ticks the API also carries (e.g.
 *  Prices: [3284, 2212, 4107]), which a weak model will otherwise quote back verbatim as if they
 *  were meaningful numbers ("odds of 3267") instead of the internal price format they actually are. */
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

// A prompt asking nicely for plain language isn't a guarantee with a small model - this is the actual
// enforcement. Any leftover betting jargon or a raw 3+ digit number (the telltale sign of a quoted
// price tick rather than a percentage) discards the reply for the deterministic fallback below, same
// as an outright LLM failure.
const JARGON_RE = /\b(implied probability|1x2|underlay|overlay|value)\b/i
const RAW_NUMBER_RE = /\b\d{3,}\b(?!%)/

function isPlainEnough(call: unknown): call is string {
  return typeof call === 'string' && call.length > 0 && !JARGON_RE.test(call) && !RAW_NUMBER_RE.test(call)
}

async function liveReadOrFallback(
  matchup: string,
  odds: unknown,
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
  order?: DeliveryOrder,
): Promise<{ value: unknown; llm: LlmUse }> {
  try {
    const system =
      'You are a lively football pundit reading fair-value odds for a casual fan, not a trader. Reply only as JSON ' +
      '{"call": string, "confidence": number}. `call` is a colorful, two-sentence take (under 55 words total): set ' +
      'the scene for the matchup, then say plainly who the fair line favours and how decisively. Have personality - ' +
      'a punchy opening, a vivid turn of phrase - but stay in plain English. No jargon - never say "implied ' +
      'probability", "1X2", "underlay/overlay", or "value"; never quote a raw price number, only the percentages ' +
      'given; say things like "likely to win", "close match", or "big favourite" instead. Do not claim a betting ' +
      'edge or tell anyone to place a bet - you only have a fair-value read, not what any bookmaker is offering.'
    const user =
      `For ${matchup}, give your colorful take on who the fair line favours and how decisively - something a ` +
      `non-bettor would enjoy reading, not a stats table. Outcome percentages: ${JSON.stringify(plainOutcomes(market, teams))}`
    const inputHash = sha256Hex(`${system}\n${user}`)
    const text = await complete({
      system,
      user,
      maxTokens: 260,
    })
    const outputHash = sha256Hex(text)
    const parsed = parseJsonReply<{ call?: unknown; confidence?: unknown }>(text)
    if (!isPlainEnough(parsed?.call)) {
      return {
        value: deterministicRead(market, teams, 'model reply used betting jargon or a raw price - discarded'),
        llm: deliveryLlm(order, 'fallback', 'model reply used betting jargon or a raw price - discarded for the plain-language fallback', 'plain-language validation plus verifier checks', { maxTokens: 260 }, { inputHash, outputHash }),
      }
    }
    return {
      value: parsed,
      llm: deliveryLlm(order, 'used', 'model produced TxODDS edge analysis', 'TxLINE data fetch plus verifier hash/fixture checks', { maxTokens: 260 }, { inputHash, outputHash }),
    }
  } catch (e) {
    return {
      value: deterministicRead(market, teams, (e as Error).message),
      llm: deliveryLlm(order, 'fallback', `LLM unavailable: ${(e as Error).message}`, 'deterministic fair-line fallback plus verifier checks', { maxTokens: 260 }),
    }
  }
}

function deterministicRead(
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
  reason: string,
): unknown {
  const outcomes = plainOutcomes(market, teams)
  const bestIndex = outcomes.reduce((best, o, i) => (best < 0 || o.pct > outcomes[best].pct ? i : best), -1)
  if (bestIndex < 0) return { call: 'odds unavailable', note: `deterministic fallback: ${reason}` }
  const { label, pct: bestPct } = outcomes[bestIndex]
  return {
    call: `Odds favour ${label} (${bestPct.toFixed(0)}%)`,
    confidence: Number((bestPct / 100).toFixed(2)),
    note: `deterministic fallback: ${reason}`,
  }
}
