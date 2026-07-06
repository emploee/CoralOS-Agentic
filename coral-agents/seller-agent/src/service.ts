/**
 * Seller services.
 *
 * `txline` - verified TxLINE fair-line reads for a fixture.
 * `risk-policy` - deterministic policy guardrails for a fixture/order.
 * `fan-card` - deterministic fan-facing explanation card for a fixture/order.
 * `freelance` - the generic LLM worker (the freelancer market's baseline seller): the brief goes to
 * the LLM, the deliverable comes back as JSON. Without an LLM key it returns an error payload, which
 * the verifier fails and the buyer refuses to pay for - no-capability sellers don't get released.
 */
import { complete, llmRuntimeInfo, parseJsonReply, type LlmUse } from '@pay/agent-runtime'

const TXLINE_BASE = process.env.TXLINE_BASE_URL || 'https://txline-dev.txodds.com'
const SUPPORTED_SERVICES = ['txline', 'freelance', 'risk-policy', 'fan-card']
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
): LlmUse {
  const info = opts.includeModel === false ? undefined : llmRuntimeInfo({ maxTokens: opts.maxTokens ?? 180 })
  return {
    round: order?.round ?? 0,
    agent: process.env.AGENT_NAME ?? 'seller-agent',
    purpose: 'seller_delivery',
    status,
    ...(info ? { provider: info.provider, model: info.model } : {}),
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
  if (service === 'risk-policy') return riskPolicyService(rest.join(' '), order)
  if (service === 'fan-card') return fanCardService(rest.join(' '), order)
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

async function riskPolicyService(request: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
  const fixtureId = fixtureIdFrom(request)
  return {
    payload: JSON.stringify({
      service: 'risk-policy',
      ...(fixtureId ? { fixtureId } : {}),
      request: request || 'unspecified',
      policy: {
        action: fixtureId ? 'observe' : 'no-action',
        maxExposureSol: 0,
        requires: [
          'verified TxLINE fair-line payload',
          'buyer budget policy pass',
          'verifier pass before escrow release',
        ],
        guardrails: [
          'devnet only',
          'no real-money wagering',
          'no automated sportsbook execution',
        ],
      },
      rationale: fixtureId
        ? `Fixture ${fixtureId} can be analyzed after verified fair-line delivery.`
        : 'No fixture id supplied.',
    }),
    llm: [deliveryLlm(order, 'skipped', 'risk policy payload is deterministic', 'static policy guardrails', { includeModel: false })],
  }
}

async function fanCardService(request: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
  const fixtureId = fixtureIdFrom(request)
  const target = fixtureId ? `fixture ${fixtureId}` : 'the selected fixture'
  return {
    payload: JSON.stringify({
      service: 'fan-card',
      ...(fixtureId ? { fixtureId } : {}),
      request: request || 'unspecified',
      card: {
        title: `Fair-line explainer for ${target}`,
        audience: 'fan',
        explainer: 'TxODDS provides a break-even fair line. A value claim needs an outside book price above that fair price.',
        sections: [
          { label: 'What was bought', value: 'verified fair-line context' },
          { label: 'What it is not', value: 'not a sportsbook recommendation' },
          { label: 'Proof path', value: 'hash-bound delivery, verifier verdict, devnet escrow release' },
        ],
        shareCopy: `Agent-delivered fair-line context for ${target}; verification and settlement are recorded in the run ledger.`,
      },
      limits: ['educational summary', 'not betting advice'],
    }),
    llm: [deliveryLlm(order, 'skipped', 'fan card payload is deterministic', 'static educational limits', { includeModel: false })],
  }
}

async function freelanceService(brief: string, order?: DeliveryOrder): Promise<ServiceDelivery> {
  try {
    const text = await complete({
      system:
        'You are a freelance agent delivering a PAID order. Produce the deliverable for the brief. ' +
        'Reply ONLY with JSON: {"deliverable": <string or object>, "notes": "<under 15 words>"}.',
      user: `Brief: ${brief || 'unspecified'}`,
      maxTokens: 700,
    })
    const parsed = parseJsonReply<{ deliverable?: unknown; notes?: string }>(text)
    return {
      payload: JSON.stringify({
        service: 'freelance', brief,
        result: parsed ?? { deliverable: text.trim() },
      }),
      llm: [deliveryLlm(order, 'used', 'model produced freelance deliverable', 'verifier checks JSON and order fit before release', { maxTokens: 700 })],
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

async function liveReadOrFallback(
  matchup: string,
  odds: unknown,
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
  order?: DeliveryOrder,
): Promise<{ value: unknown; llm: LlmUse }> {
  try {
    const text = await complete({
      system: 'You are a football trading analyst. Reply only as JSON {"call": string, "confidence": number}.',
      user:
        `For ${matchup}, make a one-line value read from these de-margined World Cup odds. ` +
        `Odds: ${JSON.stringify(odds).slice(0, 1500)}`,
      maxTokens: 180,
    })
    return {
      value: parseJsonReply(text) ?? { call: text },
      llm: deliveryLlm(order, 'used', 'model produced TxODDS edge analysis', 'TxLINE data fetch plus verifier hash/fixture checks', { maxTokens: 180 }),
    }
  } catch (e) {
    return {
      value: deterministicRead(market, teams, (e as Error).message),
      llm: deliveryLlm(order, 'fallback', `LLM unavailable: ${(e as Error).message}`, 'deterministic fair-line fallback plus verifier checks', { maxTokens: 180 }),
    }
  }
}

function deterministicRead(
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
  reason: string,
): unknown {
  const names = (market?.PriceNames ?? []) as string[]
  const pcts = (market?.Pct ?? []) as string[]
  let bestIndex = -1
  let bestPct = -1
  names.forEach((_, i) => {
    const pct = Number(pcts[i])
    if (Number.isFinite(pct) && pct > bestPct) {
      bestPct = pct
      bestIndex = i
    }
  })
  if (bestIndex < 0) return { call: 'odds unavailable', note: `deterministic fallback: ${reason}` }
  const raw = names[bestIndex]
  const label = raw === 'part1'
    ? (teams?.home ?? 'Home')
    : raw === 'part2'
      ? (teams?.away ?? 'Away')
      : 'Draw'
  return {
    call: `Odds favour ${label} (${bestPct.toFixed(0)}%)`,
    confidence: Number((bestPct / 100).toFixed(2)),
    note: `deterministic fallback: ${reason}`,
  }
}
