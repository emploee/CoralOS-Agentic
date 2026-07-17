// TxODDS Agent Tutorial - a React 18 no-build app over live TxODDS devnet data.
// Talks to the local proxy (../server/proxy.ts: GET /api/board - only fixtures with verified live 1X2
// odds, inlined). If the proxy/token isn't up it shows a clearly-labelled demo board; it never mixes
// demo numbers into a live fixture.

import React, { useState, useEffect, useRef } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const PROXY = window.TXODDS_PROXY ?? 'http://localhost:8801'
// The research watcher (examples/txodds/research/watcher.ts) — optional; the board degrades silently.
const WATCHER = window.TXODDS_WATCHER ?? 'http://localhost:4600'
// coral-server's own built-in console UI (raw sessions/threads/participants) - opened in a new tab,
// not proxied; the browser talks to it directly since it's a devnet dev tool, not paid delivery.
const CORAL_CONSOLE = window.CORAL_CONSOLE_URL ?? 'http://localhost:5555/ui/console'
const MARKET_VERBS =['WANT', 'BID', 'AWARD', 'ESCROW_REQUIRED', 'DEPOSITED', 'DELIVERED', 'LLM_USED', 'VERIFY', 'VERIFIED', 'RELEASED', 'ARBITER_RELEASED', 'REFUNDED', 'ERROR']
// The only round type the round launcher supports (examples/txodds/coral/round.ts's single seller
// treats a fixture id as an edge-read request) - no picker needed for one option.
const AGENTIC_SERVICE = 'txline'
const AGENTIC_ROUND_LABEL = 'TxODDS edge'
// Icon led with each feed row instead of a text-only badge.
const VERB_ICON = {
  WANT: '🙋', BID: '💬', AWARD: '🏅', ESCROW_REQUIRED: '🔒', DEPOSITED: '🔒',
  DELIVERED: '📦', VERIFY: '⏳', VERIFIED: '✅', ARBITER_RELEASED: '🏆',
  RELEASED: '🏆', REFUNDED: '↩️', ERROR: '⚠️',
}
// Which side of the conversation a message reads from - drives the feed row's accent color.
const actorFamily = (sender) => (sender === 'buyer-agent' ? 'buyer' : sender === 'verifier-agent' ? 'verifier' : 'seller')

// Friendly display names for this example's fixed roster - raw agent ids are wire identities, not
// something a viewer should have to decode. A fork with a different roster extends or replaces this
// map; unknown names fall through to the raw id unchanged so nothing renders blank.
const AGENT_LABEL = {
  'buyer-agent': 'Buyer',
  'verifier-agent': 'Verifier',
  'seller-agent': 'Seller',
}
const agentLabel = (name) => AGENT_LABEL[name] ?? name

async function api(path, opts) {
  const r = await fetch(`${PROXY}${path}`, opts)
  const text = await r.text()
  const data = text ? JSON.parse(text) : {}
  if (!r.ok) throw new Error(data.error ?? `${r.status}`)
  return data
}

const verbOf = (text) => {
  const first = String(text ?? '').trim().split(/\s+/)[0]?.toUpperCase().replace(/:$/, '')
  return MARKET_VERBS.includes(first) ? first : undefined
}

// Trims to the last whole word at-or-before the limit (never a hard mid-word chop) - `n` is a soft
// cap, not `Infinity`-safe rendering guarantee; pass a generous limit for headline text that a prompt
// already bounds in length, and a tight one for compact inline previews.
const sentence = (s, n = 160) => {
  const text = String(s ?? '').trim()
  if (text.length <= n) return text
  const cut = text.slice(0, n)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > n * 0.4 ? cut.slice(0, lastSpace) : cut}…`
}

const fieldOf = (text, key) => {
  const raw = String(text ?? '')
  const quoted = raw.match(new RegExp(`${key}="([^"]*)"`))?.[1]
  if (quoted != null) return quoted
  return raw.match(new RegExp(`${key}=(\\S+)`))?.[1]
}

// Every wire verb carries round=<n> (packages/agent-runtime/src/market/protocol.ts) - fieldOf
// already extracts it, this just names the lookup for the feed's round grouping.
const roundOf = (text) => fieldOf(text, 'round')

const fmtSol = (n) => {
  const value = Number(n)
  if (!Number.isFinite(value)) return 'waiting'
  return `${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} SOL`
}

// The delivered payload is real product content (the txline read) - pull the one line worth reading
// instead of a generic "delivered" notice that forces a click into raw JSON every time. Falls back
// to a truncated raw preview for service shapes this doesn't recognize yet, so nothing renders blank.
function deliveryPreview(text, round, maxLen = 160) {
  const payload = text.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim()
  try {
    const data = JSON.parse(payload)
    const line = data?.rationale ?? data?.error
      ?? (typeof data?.analysis === 'string' ? data.analysis : data?.analysis?.call)
      ?? data?.card?.shareCopy ?? data?.card?.explainer // fan-card
      ?? data?.result?.notes ?? (typeof data?.result?.deliverable === 'string' ? data.result.deliverable : undefined) // freelance
      ?? (data?.service === 'txline-fixtures' ? `${data.count ?? data.fixtures?.length ?? 0} upcoming fixtures` : undefined)
      ?? (data?.service === 'txline-odds' && data?.fixtureId ? `verified odds snapshot for fixture ${data.fixtureId}` : undefined)
    if (line) return sentence(String(line), maxLen)
  } catch { /* not JSON - fall through to a raw preview */ }
  return payload ? sentence(payload, maxLen) : `payload for round ${round ?? '?'}`
}

// The txline-edge headline: the seller's own colorful two-sentence take (service.ts's
// liveReadOrFallback prompts for a pundit-style story, not a stats readout), with just enough lead-in
// context - who's playing, what competition - that it reads as a real call and not a floating quote.
// The percentages/fair odds behind it are one click away in "show play-by-play", not repeated here.
// Falls back to deliveryPreview's terse line for any payload shape without a {teams, analysis.call}.
function deliveryNarrative(text, round, maxLen = 500) {
  const payload = text.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim()
  let data
  try { data = JSON.parse(payload) } catch { return deliveryPreview(text, round, maxLen) }

  const teams = data?.teams
  const call = typeof data?.analysis?.call === 'string' ? data.analysis.call : undefined
  if (!teams?.home || !teams?.away || !call) return deliveryPreview(text, round, maxLen)

  const comp = teams.competition ? ` (${teams.competition})` : ''
  return sentence(`${teams.home} vs ${teams.away}${comp}: ${call}`, maxLen)
}

// True when deliveryPreview's text is actually an error message (data.error, with no rationale to
// take precedence over it - see deliveryPreview's own fallback order) - the headline should read as a
// problem, not a result, in that case.
function deliveryIsError(text) {
  try {
    const data = JSON.parse(text.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim())
    return Boolean(data?.error) && !data?.rationale
  } catch {
    return false
  }
}

function humanMarketEvent(m) {
  const text = String(m?.text ?? '')
  const v = verbOf(text)
  const round = fieldOf(text, 'round')
  if (v === 'WANT') {
    const service = fieldOf(text, 'service') ?? 'service'
    const arg = fieldOf(text, 'arg') ?? 'request'
    const budget = fieldOf(text, 'budget')
    return `${agentLabel(m.sender)} asked seller agents for ${service} ${arg}${budget ? ` with budget ${fmtSol(budget)}` : ''}.`
  }
  if (v === 'BID') {
    const by = agentLabel(fieldOf(text, 'by') ?? m.sender)
    const price = fieldOf(text, 'price')
    const note = fieldOf(text, 'note')
    return `${by} offered to deliver round ${round ?? '?'}${price ? ` for ${fmtSol(price)}` : ''}${note ? `: ${note}` : ''}.`
  }
  if (v === 'AWARD') {
    const to = agentLabel(fieldOf(text, 'to') ?? 'a seller')
    const reason = fieldOf(text, 'reason')
    return `${agentLabel(m.sender)} selected ${to}${reason ? ` because ${reason}` : ''}.`
  }
  if (v === 'ESCROW_REQUIRED') {
    const amount = fieldOf(text, 'amount')
    const seller = fieldOf(text, 'seller')
    return `${agentLabel(m.sender)} returned escrow terms${amount ? ` for ${fmtSol(amount)}` : ''}${seller ? ` to payout ${shortAddr(seller)}` : ''}.`
  }
  if (v === 'DEPOSITED') {
    const sig = fieldOf(text, 'sig')
    return `${agentLabel(m.sender)} funded escrow for round ${round ?? '?'}${sig ? ` with tx ${shortAddr(sig)}` : ''}.`
  }
  if (v === 'DELIVERED') return `${agentLabel(m.sender)} delivered: ${deliveryPreview(text, round)}`
  if (v === 'VERIFY') return `${agentLabel(m.sender)} asked ${agentLabel('verifier-agent')} to check the exact delivered payload.`
  if (v === 'VERIFIED') {
    const verdict = fieldOf(text, 'verdict')
    const by = agentLabel(fieldOf(text, 'by') ?? m.sender)
    const reason = fieldOf(text, 'reason')
    return `${by} ${verdict === 'pass' ? 'passed' : 'failed'} the delivery${reason ? `: ${reason}` : ''}.`
  }
  if (v === 'ARBITER_RELEASED' || v === 'RELEASED') {
    const sig = fieldOf(text, 'sig')
    return `${agentLabel(m.sender)} released escrow to the seller${sig ? ` with tx ${shortAddr(sig)}` : ''}.`
  }
  if (v === 'REFUNDED') return `${agentLabel(m.sender)} marked the round refundable or refunded.`
  if (v === 'ERROR') return `${agentLabel(m.sender)} reported an error: ${sentence(text.replace(/^ERROR:?\s*/i, ''), 120)}`
  return sentence(text, 180)
}

// First message seen per verb, for the narrative/stage-tracker below - a round only ever has one
// WANT/AWARD/DELIVERED/etc (BID is the one legitimate many-per-round verb, handled separately).
function messagesByVerb(messages) {
  const by = {}
  messages.forEach((m) => {
    const v = verbOf(m.text)
    if (v && !by[v]) by[v] = m
  })
  return by
}

// A short, flowing recap of the whole round - the "story" a viewer actually wants, instead of
// reconstructing what happened from nine separate protocol rows.
function roundNarrative(messages, by) {
  const bids = messages.filter((m) => verbOf(m.text) === 'BID')
  const parts = []

  if (by.WANT) {
    const service = fieldOf(by.WANT.text, 'service') ?? 'a service'
    const arg = fieldOf(by.WANT.text, 'arg')
    const budget = fieldOf(by.WANT.text, 'budget')
    parts.push(`${agentLabel(by.WANT.sender)} put out a call for ${service}${arg ? ` (${arg})` : ''}${budget ? `, offering up to ${fmtSol(budget)}` : ''}.`)
  }

  if (by.AWARD) {
    const winnerName = fieldOf(by.AWARD.text, 'to')
    const winningBid = bids.find((b) => (fieldOf(b.text, 'by') ?? b.sender) === winnerName)
    const price = winningBid ? fieldOf(winningBid.text, 'price') : undefined
    const rivals = bids.length - (winningBid ? 1 : 0)
    const reason = fieldOf(by.AWARD.text, 'reason')
    parts.push(`${winnerName ? agentLabel(winnerName) : 'a seller'} won the round${price ? ` at ${fmtSol(price)}` : ''}${rivals > 0 ? ` (beating ${rivals} other bid${rivals === 1 ? '' : 's'})` : ''}${reason ? ` — ${reason}` : ''}.`)
  } else if (bids.length) {
    parts.push(`${bids.length} seller${bids.length === 1 ? '' : 's'} bid, awaiting award.`)
  }

  if (by.DEPOSITED) {
    const amount = by.ESCROW_REQUIRED ? fieldOf(by.ESCROW_REQUIRED.text, 'amount') : undefined
    parts.push(`${agentLabel(by.DEPOSITED.sender)} locked${amount ? ` ${fmtSol(amount)}` : ' funds'} into escrow.`)
  } else if (by.ESCROW_REQUIRED) {
    parts.push('Escrow terms were issued; waiting on deposit.')
  }

  // The delivered content itself is pulled out as its own headline (see roundHeadline) rather than
  // folded into this mechanics recap - a viewer wants the actual pick front and center, not one clause
  // in a sentence about escrow and awards.
  if (by.DELIVERED) parts.push(`${agentLabel(by.DELIVERED.sender)} delivered the result below.`)

  if (by.VERIFIED) {
    const reason = fieldOf(by.VERIFIED.text, 'reason')
    parts.push(verifiedTone(by.VERIFIED.text) === 'fail'
      ? `The verifier rejected it${reason ? `: ${reason}` : '.'}`
      : 'The verifier confirmed it checks out.')
  } else if (by.VERIFY) {
    parts.push('Waiting on the verifier.')
  }

  if (by.ARBITER_RELEASED || by.RELEASED) parts.push('Payment released on-chain.')
  else if (by.REFUNDED) parts.push('Funds were refunded.')

  if (by.ERROR) parts.push(`${agentLabel(by.ERROR.sender)} hit an error: ${sentence(by.ERROR.text.replace(/^ERROR:?\s*/i, ''), 120)}`)

  return parts.join(' ')
}

// The actual product of the round - the delivered pick/analysis, unattributed and unqualified by
// escrow mechanics - is the headline a viewer came for. Everything roundNarrative recaps (who bid,
// who won, escrow, verification, settlement) is real but secondary; this is not.
function roundHeadline(by) {
  if (!by.DELIVERED) return null
  return {
    text: deliveryNarrative(by.DELIVERED.text, roundOf(by.DELIVERED.text)),
    error: deliveryIsError(by.DELIVERED.text),
  }
}

// VERIFIED must read the verdict, not just the verb - a fail is not the same green "success" badge
// as a pass.
const verifiedTone = (text) => (fieldOf(text, 'verdict') === 'fail' ? 'fail' : 'pass')

// Flattens bus.threads[].messages[] into one time-ordered stream for the live feed. The buyer opens
// exactly one 'market' thread per session and sends every message sequentially from one await-chained
// loop (coral-agents/buyer-agent/src/index.ts), so array order is already chronological - only
// reorder when both sides being compared carry a real timestamp and disagree.
function flattenBus(bus) {
  const threads = bus?.threads ?? []
  const flat = []
  threads.forEach((t) => (t.messages ?? []).forEach((m) => flat.push({ ...m, threadId: t.id, threadName: t.name })))
  return flat
    .map((m, i) => ({ m, i, t: m.timestamp ? Date.parse(m.timestamp) : NaN }))
    .sort((a, b) => (!Number.isNaN(a.t) && !Number.isNaN(b.t) && a.t !== b.t) ? a.t - b.t : a.i - b.i)
    .map((x) => x.m)
}

// The one inline fact worth surfacing per verb - a real amount/verdict/tx link, not raw text.
function metricChip(m) {
  const text = String(m?.text ?? '')
  const v = verbOf(text)
  if (v === 'WANT') {
    const budget = fieldOf(text, 'budget')
    return budget ? { label: 'budget', value: fmtSol(budget) } : null
  }
  if (v === 'BID') {
    const price = fieldOf(text, 'price')
    return price ? { label: 'price', value: fmtSol(price) } : null
  }
  if (v === 'ESCROW_REQUIRED') {
    const amount = fieldOf(text, 'amount')
    return amount ? { label: 'amount', value: fmtSol(amount) } : null
  }
  if (v === 'DEPOSITED') {
    const sig = fieldOf(text, 'sig')
    return sig ? { label: 'deposit tx', value: shortAddr(sig), href: txLink(sig) } : null
  }
  if (v === 'VERIFIED') {
    const verdict = fieldOf(text, 'verdict')
    return verdict ? { label: 'verdict', value: verdict } : null
  }
  if (v === 'ARBITER_RELEASED' || v === 'RELEASED') {
    const sig = fieldOf(text, 'sig')
    return sig ? { label: 'release tx', value: shortAddr(sig), href: txLink(sig) } : null
  }
  return null
}

// Short phrase for the typing indicator while the latest round is between steps.
function roundStatusLabel(status) {
  const labels = {
    bidding: 'collecting bids...', awarded: 'funding escrow...', deposited: 'awaiting delivery...',
    delivered: 'verifying delivery...', settled: 'settled', refunded: 'refunded',
  }
  return labels[status] ?? 'working...'
}


/** Turns a RunRecord/Round's `outcome` (ScoreOutcome, see packages/agent-runtime/src/ledger/run.ts)
 *  into a short display label. No grading pass has run yet -> '-', not 'pending'. */
function gradeLabel(outcome) {
  if (!outcome) return '-'
  if (outcome.status === 'pending') return 'grading pending'
  return outcome.correct ? 'correct' : outcome.correct === false ? 'incorrect' : 'graded'
}

const latestSessionFromRuns = (runs) => {
  const list = Array.isArray(runs) ? runs.filter((r) => r?.session) : []
  if (!list.length) return ''
  const time = (r) => {
    const ms = Date.parse(r.updatedAt ?? '')
    return Number.isFinite(ms) ? ms : 0
  }
  return [...list].sort((a, b) => time(b) - time(a))[0].session
}

// Aggregate "did the flagged move call it right" scoreboard across the whole persisted run ledger
// (every session, not just the one currently on screen) - only sharp-movement deliveries carry a
// structured prediction to grade (see research/GRADING.md's scope note), so other services are
// excluded rather than diluting the accuracy stat with rounds that never made a directional call.
function sharpMovementAccuracy(runs) {
  const list = Array.isArray(runs) ? runs.filter((r) => r?.want?.service === 'sharp-movement') : []
  let correct = 0, incorrect = 0, pending = 0, ungraded = 0
  for (const r of list) {
    const outcome = r.outcome
    if (!outcome) { ungraded++; continue }
    if (outcome.status === 'pending') { pending++; continue }
    if (outcome.correct === true) correct++
    else if (outcome.correct === false) incorrect++
    else ungraded++ // graded, but no prediction was made on this one to score
  }
  const graded = correct + incorrect
  return { total: list.length, graded, correct, incorrect, pending, ungraded }
}

// -- flags + abbreviations (national teams) ----------------------------------
const FLAGS = {
  brazil: 'br', argentina: 'ar', france: 'fr', england: 'gb-eng', spain: 'es', germany: 'de',
  portugal: 'pt', netherlands: 'nl', italy: 'it', belgium: 'be', croatia: 'hr', uruguay: 'uy',
  'united states': 'us', usa: 'us', mexico: 'mx', japan: 'jp', 'south korea': 'kr', 'korea republic': 'kr',
  senegal: 'sn', morocco: 'ma', switzerland: 'ch', denmark: 'dk', poland: 'pl', serbia: 'rs',
  ecuador: 'ec', ghana: 'gh', cameroon: 'cm', 'saudi arabia': 'sa', australia: 'au', canada: 'ca',
  qatar: 'qa', tunisia: 'tn', wales: 'gb-wls', scotland: 'gb-sct', 'northern ireland': 'gb-nir',
  ireland: 'ie', norway: 'no', sweden: 'se', austria: 'at', 'czech republic': 'cz', czechia: 'cz',
  turkey: 'tr', turkiye: 'tr', ukraine: 'ua', colombia: 'co', chile: 'cl', peru: 'pe', paraguay: 'py',
  nigeria: 'ng', egypt: 'eg', algeria: 'dz', 'ivory coast': 'ci', greece: 'gr', hungary: 'hu',
  romania: 'ro', iran: 'ir', china: 'cn', 'costa rica': 'cr', panama: 'pa', jamaica: 'jm',
  'new zealand': 'nz', 'south africa': 'za', slovenia: 'si', slovakia: 'sk', finland: 'fi',
  venezuela: 've', bolivia: 'bo',
}
const ABBR = {
  brazil: 'BRA', argentina: 'ARG', france: 'FRA', england: 'ENG', spain: 'ESP', germany: 'GER',
  portugal: 'POR', netherlands: 'NED', uruguay: 'URU', 'united states': 'USA', mexico: 'MEX',
  serbia: 'SRB', denmark: 'DEN', ecuador: 'ECU', croatia: 'CRO', belgium: 'BEL',
}
const key = (n) => (n || '').trim().toLowerCase()
const flagCode = (n) => FLAGS[key(n)]
const abbr = (n) => ABBR[key(n)] ?? (n || '??').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()

function Flag({ name, size }) {
  const [bad, setBad] = useState(false)
  const code = flagCode(name)
  const big = size === 'big'
  if (bad || !code) return html`<div class=${big ? 'flag-fallback' : 'mc-flag-fb'}>${abbr(name)}</div>`
  return html`<img class=${big ? 'flag' : 'mc-flag'} alt=${name}
    src=${`https://flagcdn.com/${big ? 'w160' : 'w80'}/${code}.png`} onError=${() => setBad(true)} />`
}

// -- demo fallback data (realistic de-margined 1X2) --------------------------
const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString()
const mkt = (pct) => [{ Bookmaker: 'StablePrice', SuperOddsType: '1X2 (de-margined)', PriceNames: ['part1', 'draw', 'part2'], Pct: pct }]
const DEMO_FIXTURES = [
  { FixtureId: 9001, Competition: 'World Cup', Participant1: 'Brazil', Participant2: 'Serbia', StartTime: soon(3) },
  { FixtureId: 9002, Competition: 'World Cup', Participant1: 'Argentina', Participant2: 'Mexico', StartTime: soon(6) },
  { FixtureId: 9003, Competition: 'World Cup', Participant1: 'France', Participant2: 'Denmark', StartTime: soon(27) },
  { FixtureId: 9004, Competition: 'World Cup', Participant1: 'England', Participant2: 'United States', StartTime: soon(30) },
  { FixtureId: 9005, Competition: 'World Cup', Participant1: 'Spain', Participant2: 'Germany', StartTime: soon(51) },
  { FixtureId: 9006, Competition: 'World Cup', Participant1: 'Portugal', Participant2: 'Uruguay', StartTime: soon(54) },
  { FixtureId: 9007, Competition: 'World Cup', Participant1: 'Netherlands', Participant2: 'Ecuador', StartTime: soon(75) },
  { FixtureId: 9008, Competition: 'World Cup', Participant1: 'Croatia', Participant2: 'Belgium', StartTime: soon(78) },
]
const DEMO_ODDS = {
  9001: mkt([62.4, 22.1, 15.5]), 9002: mkt([58.0, 24.5, 17.5]), 9003: mkt([54.2, 26.0, 19.8]),
  9004: mkt([47.5, 27.0, 25.5]), 9005: mkt([41.0, 27.5, 31.5]), 9006: mkt([49.0, 27.0, 24.0]),
  9007: mkt([56.5, 24.0, 19.5]), 9008: mkt([38.0, 28.0, 34.0]),
}
const demoOddsFor = (id) => DEMO_ODDS[id] ?? mkt([45, 27, 28])

// fair (break-even) decimal odds = 100 / implied probability - the price a book must beat for value.
const fairOdds = (pct) => { const p = Number(pct); return Number.isFinite(p) && p > 0 ? 100 / p : NaN }
const fmtOdds = (pct) => { const o = fairOdds(pct); return Number.isFinite(o) ? o.toFixed(2) : '-' }

const shortAddr = (a) => (a ? `${String(a).slice(0, 4)}...${String(a).slice(-4)}` : '')
const txLink = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`
// Coral messages carry a UTC ISO timestamp - render in the viewer's own timezone (matches how
// fixture kickoff times are already shown), not a raw slice of the UTC string.
const fmtFeedTime = (iso) => {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
}

// -- odds board --------------------------------------------------------------
// LIVE TxODDS markets are messy: Pct values arrive as strings ("41.946"), some priced "NA",
// and many fixtures carry only over/under or Asian-handicap rows with no 1X2. Pick the best
// renderable market - a 1X2 result with usable numbers first, else any market that has at
// least one finite percentage - and treat every percentage as possibly-missing throughout.
const hasUsablePct = (m) =>
  Array.isArray(m?.PriceNames) && m.PriceNames.some((_, i) => Number.isFinite(Number((m.Pct || [])[i])))
function pickMarket(odds) {
  if (!Array.isArray(odds)) return odds
  return odds.find((x) => String(x?.SuperOddsType ?? '').includes('1X2') && hasUsablePct(x))
    ?? odds.find(hasUsablePct)
    ?? null
}

function Board({ fixture, odds, loading }) {
  if (loading) return html`<div class="board"><p class="muted">fetching de-margined odds...</p></div>`
  const m = pickMarket(odds)
  const names = Array.isArray(m?.PriceNames) ? m.PriceNames : null
  if (!names) return html`<div class="board"><p class="muted">No priced market for this fixture yet.</p></div>`
  const pct = names.map((_, i) => Number((m.Pct || [])[i]))
  const labelOf = { part1: fixture.Participant1, draw: 'Draw', part2: fixture.Participant2, over: 'Over', under: 'Under' }
  const cls = { part1: 'home', draw: 'draw', part2: 'away', over: 'home', under: 'away' }
  // favourite = the highest *finite* percentage (indexOf(Math.max) breaks when any price is NaN)
  let favI = -1, favVal = -Infinity
  pct.forEach((p, i) => { if (Number.isFinite(p) && p > favVal) { favVal = p; favI = i } })
  if (favI < 0) return html`<div class="board"><p class="muted">No priced market for this fixture yet.</p></div>`
  const favLabel = labelOf[names[favI]] ?? names[favI]
  const fmt = (p) => (Number.isFinite(p) ? p.toFixed(0) : '-')
  return html`
    <div class="board">
      ${names.map((name, i) => html`
        <div class=${'outcome' + (i === favI ? ' fav' : '')} key=${name}>
          <span class="label">${labelOf[name] ?? name}</span>
          <span class="track"><span class=${'fill ' + (cls[name] ?? 'draw')} style=${{ width: `${Number.isFinite(pct[i]) ? Math.min(100, pct[i]) : 0}%` }}></span></span>
          <span class="val">${fmt(pct[i])}%</span>
          <span class="odds">${fmtOdds(pct[i])}</span>
        </div>`)}
      <div class="edge">
        <span class="e-text"><b>${favLabel}</b> - verified favourite at <b>${fmt(pct[favI])}%</b> - fair price <b>${fmtOdds(pct[favI])}</b>
          <div class="e-sub">fair (break-even) odds = 100 / probability - a bet only has value ABOVE this price</div>
        </span>
      </div>
    </div>`
}

function MatchCard({ fx, on, onSelect, event }) {
  return html`
    <div class=${'mcard' + (on ? ' on' : '')} onClick=${() => onSelect(fx)}>
      <div class="mc-top">
        <span class="mc-side"><${Flag} name=${fx.Participant1} /><span class="mc-abbr">${abbr(fx.Participant1)}</span></span>
        <span class="mc-vs">vs</span>
        <span class="mc-side r"><${Flag} name=${fx.Participant2} /><span class="mc-abbr">${abbr(fx.Participant2)}</span></span>
      </div>
      <div class="mc-comp"><span class="c">${fx.Competition}</span><span>${new Date(fx.StartTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      ${event && html`<div class="mc-event" title=${event.note}>${event.kind === 'odds-move' ? '▲ line moved' : '● odds live'} — research WANT queued</div>`}
    </div>`
}

function FeedIcon({ verb, tone }) {
  const icon = verb === 'VERIFIED' ? (tone === 'fail' ? '❌' : '✅') : (VERB_ICON[verb] ?? '💬')
  return html`<span class="feed-icon">${icon}</span>`
}

function FeedChip({ chip }) {
  if (!chip) return null
  return chip.href
    ? html`<a class="feed-chip" href=${chip.href} target="_blank" rel="noreferrer">${chip.label}: ${chip.value}</a>`
    : html`<span class="feed-chip">${chip.label}: ${chip.value}</span>`
}

function FeedRow({ m, i }) {
  const text = String(m.text ?? '')
  const v = verbOf(text)
  const tone = v === 'VERIFIED' ? verifiedTone(text) : undefined
  const family = actorFamily(m.sender)
  const verbClass = v ? `verb-${v.toLowerCase()}${tone ? `-${tone}` : ''}` : ''
  return html`
    <div class=${'feed-row actor-' + family + (v ? ' verb-group-' + v.toLowerCase() : '')} key=${i}>
      <${FeedIcon} verb=${v} tone=${tone} />
      <div class="feed-body">
        <div class="feed-top">
          <b class="feed-sender" title=${m.sender}>${agentLabel(m.sender)}</b>
          ${v && html`<span class=${'verb ' + verbClass}>${v}</span>`}
          ${m.timestamp && html`<small class="feed-time">${fmtFeedTime(m.timestamp)}</small>`}
        </div>
        <p class="feed-text">${humanMarketEvent(m)}</p>
        <${FeedChip} chip=${metricChip(m)} />
        <details class="raw-msg">
          <summary>raw message</summary>
          <code>${text}</code>
        </details>
      </div>
    </div>`
}

// Human label per LLM_USED purpose (packages/agent-runtime/src/market/protocol.ts's LlmUse.purpose,
// set by buyer-agent/award.ts, verifier-agent/verify.ts, harness-runtime's quote.ts/node-llm adapter).
// seller_delivery is deliberately not shown here - its content (the edge-analysis "call") is already
// the round narrative's DELIVERED highlight, so repeating it in the reasoning strip would be a
// second copy of the same sentence rather than new information.
const LLM_PURPOSE_LABEL = {
  buyer_award: 'why this seller',
  verifier_judgment: 'verifier read',
  seller_quote: 'pricing logic',
}

// The model's own explanation text, or - when there wasn't one (no key configured, the call failed,
// or policy skipped it outright) - a plain status note. Either way this is real signal, not filler:
// it's the difference between "seller-agent won" and knowing *why*, or knowing the round ran on a
// deterministic fallback rather than a live model.
function llmReasonText(l) {
  if (l.reason) return l.reason
  if (l.status === 'fallback') return 'used a deterministic fallback — no LLM reasoning captured.'
  if (l.status === 'skipped') return 'skipped the model call.'
  if (l.status === 'error') return 'the model call failed.'
  return null
}

// meta.llm is the round's folded LLM_USED messages (foldRounds.ts) - every agent's model-backed
// decision for this round (award justification, verifier read, seller pricing/delivery notes),
// already flowing over the wire and already parsed server-side but never rendered until now.
function LlmReasoning({ llm }) {
  const rows = (llm ?? [])
    .filter((l) => l.purpose in LLM_PURPOSE_LABEL)
    .map((l) => ({ ...l, text: llmReasonText(l) }))
    .filter((l) => l.text)
  if (!rows.length) return null
  return html`
    <div class="story-reasoning">
      ${rows.map((l, i) => html`
        <div class="reasoning-row" key=${i}>
          <span class="reasoning-agent">🧠 ${agentLabel(l.agent)} — ${LLM_PURPOSE_LABEL[l.purpose] ?? l.purpose}</span>
          <span class="reasoning-text">${l.text}</span>
          ${l.model && html`<span class="feed-chip">${l.provider ? `${l.provider} · ` : ''}${l.model}</span>`}
        </div>`)}
    </div>`
}

// One round's story: a headline, a progress tracker, a plain-language recap, and the raw
// protocol messages tucked behind "show play-by-play" for anyone who wants the wire-level detail.
function RoundStoryCard({ round, meta, messages, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen)
  const by = messagesByVerb(messages)
  const status = meta?.status ?? 'bidding'
  const inFlight = status !== 'settled' && status !== 'refunded'
  const headline = roundHeadline(by)
  return html`
    <div class="story-card">
      <div class="story-head">
        <span class="story-round">Round ${round}</span>
        <span class=${'story-status status-' + status}>${status}</span>
        ${meta?.outcome && html`<span class="story-grade">${gradeLabel(meta.outcome)}</span>`}
        ${inFlight && html`
          <span class="story-live">
            <span class="typing-dots"><span></span><span></span><span></span></span>
            ${roundStatusLabel(status)}
          </span>`}
      </div>
      ${headline
        ? html`<p class=${'story-headline' + (headline.error ? ' error' : '')}>${headline.text}</p>`
        : html`<p class="story-waiting">Waiting on a result…</p>`}
      <p class="story-text">${roundNarrative(messages, by)}</p>
      <${LlmReasoning} llm=${meta?.llm} />
      <button class="story-toggle" onClick=${() => setOpen((o) => !o)}>${open ? '▾ hide' : '▸ show'} play-by-play (${messages.length})</button>
      ${open && html`<div class="story-detail">${messages.map((m, i) => html`<${FeedRow} key=${i} m=${m} i=${i} />`)}</div>`}
    </div>`
}

// The core deliverable: one round-by-round story for the whole live session - a narrative card per
// round (replacing a flat chat log of every protocol message) with the full technical detail one
// click away, not the default view.
function AgenticFeed({ bus, feed }) {
  const scrollRef = useRef(null)
  // LLM_USED status messages (e.g. "model skipped - service not in seller inventory") are internal
  // diagnostics, not something a viewer can act on - keep them out of the live story.
  const rows = flattenBus(bus).filter((m) => verbOf(m.text) !== 'LLM_USED')

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows.length])

  if (!bus) return html`<div class="agent-empty">Attach or start a session to see the live agent feed.</div>`
  if (!rows.length) return html`<div class="agent-empty">Session found. Waiting for the buyer to open a market thread.</div>`

  const roundMeta = new Map((feed?.rounds ?? []).map((r) => [r.round, r]))
  const groups = []
  let current = null
  rows.forEach((m) => {
    const r = roundOf(m.text)
    const roundNum = r != null ? Number(r) : (current ? current.round : 0)
    if (!current || current.round !== roundNum) {
      current = { round: roundNum, messages: [] }
      groups.push(current)
    }
    current.messages.push(m)
  })

  return html`
    <div class="agentic-feed" ref=${scrollRef}>
      ${groups.map((g, gi) => html`
        <${RoundStoryCard}
          key=${g.round}
          round=${g.round}
          meta=${roundMeta.get(g.round)}
          messages=${g.messages}
          defaultOpen=${gi === groups.length - 1} />`)}
    </div>`
}

// "Did the flagged move call it right, over the whole run ledger" - the aggregate counterpart to
// each story card's own per-round grade badge. Silent (renders nothing) until at least one
// sharp-movement round has actually happened, so the default demo mode shows no empty scoreboard.
function Scoreboard({ accuracy }) {
  if (!accuracy || accuracy.total === 0) return null
  const { graded, correct, pending, total } = accuracy
  const pct = graded > 0 ? Math.round((correct / graded) * 100) : null
  return html`
    <div class="scoreboard" title="Sharp-movement predictions graded against the real final score">
      <span class="scoreboard-label">Sharp-movement accuracy</span>
      <span class="scoreboard-stat">${graded > 0 ? html`${correct}/${graded} correct (${pct}%)` : 'no grades yet'}</span>
      ${pending > 0 && html`<span class="scoreboard-pending">${pending} pending</span>`}
      <span class="scoreboard-total">${total} flagged move${total === 1 ? '' : 's'} total</span>
    </div>`
}

function AgenticPanel({
  selected, source, onStart, starting, startError, feed, bus, pollError, onClear, accuracy,
}) {
  const fixture = selected ? `${selected.Participant1} vs ${selected.Participant2}` : 'current fixture'
  const liveTarget = selected && source === 'live'
  return html`
    <section class="agentic-panel">
      <div class="agentic-actions">
        <button class="agent-start" disabled=${starting} onClick=${onStart}>
          ${starting
            ? html`<span class="spin"></span> starting agents...`
            : liveTarget ? `Start ${AGENTIC_ROUND_LABEL} Round for ${fixture}` : `Start ${AGENTIC_ROUND_LABEL} Round from live proxy`}
        </button>
        <a class="coral-console-link" href=${CORAL_CONSOLE} target="_blank" rel="noreferrer">Open Coral Console ↗</a>
      </div>
      <${Scoreboard} accuracy=${accuracy} />
      ${startError && html`<p class="agent-error">${startError}</p>`}
      ${pollError && html`<p class="agent-error">${pollError}</p>`}
      <section class="agentic-block feed-block">
        <div class="block-head">
          <h3>Live feed</h3>
          ${bus && html`<button class="clear-rounds" onClick=${onClear}>Clear rounds</button>`}
        </div>
        <${AgenticFeed} bus=${bus} feed=${feed} />
      </section>
    </section>`
}

function App() {
  const urlSession = new URLSearchParams(window.location.search).get('agentSession') ?? ''
  const [fixtures, setFixtures] = useState(null)
  const [source, setSource] = useState(null) // 'live' | 'demo'
  const [idx, setIdx] = useState(0)
  const [odds, setOdds] = useState(null)
  const [loadingOdds, setLoadingOdds] = useState(false)
  const [agenticSession, setAgenticSession] = useState(urlSession)
  const [agenticStarting, setAgenticStarting] = useState(false)
  const [agenticStartError, setAgenticStartError] = useState('')
  const [agenticPollError, setAgenticPollError] = useState('')
  const [agenticFeed, setAgenticFeed] = useState(null)
  const [agenticBus, setAgenticBus] = useState(null)
  const [events, setEvents] = useState({}) // fixtureId -> the watcher's queued research event
  const [runs, setRuns] = useState(null) // the persisted run ledger, for the sharp-movement scoreboard
  // Set once the user explicitly clears the feed, so the auto-latest-session effect below doesn't
  // immediately re-adopt the same session it was just told to drop. Reset on a real page load only -
  // there's no "un-clear" action, just start a new round or reload.
  const [agenticCleared, setAgenticCleared] = useState(false)
  const selected = fixtures ? fixtures[idx] : null

  const rememberAgenticSession = (id) => {
    setAgenticSession(id)
    const u = new URL(window.location.href)
    if (id) u.searchParams.set('agentSession', id)
    else u.searchParams.delete('agentSession')
    window.history.replaceState({}, '', u)
  }

  useEffect(() => {
    if (urlSession || agenticSession || agenticCleared) return
    let alive = true
    ;(async () => {
      try {
        const d = await api('/api/agentic/runs')
        const id = latestSessionFromRuns(d.runs)
        if (alive && id) rememberAgenticSession(id)
      } catch { /* no live feed or no persisted agentic runs yet */ }
    })()
    return () => { alive = false }
  }, [urlSession, agenticSession, agenticCleared])

  // Drops the current session from view (and stops polling it, via the feed effect below reacting to
  // agenticSession going empty) without touching any persisted run/ledger data - reputation scoring
  // reads that history, so "clear rounds" is a view reset, not a delete.
  const clearAgenticRound = () => {
    setAgenticCleared(true)
    setAgenticStartError('')
    setAgenticPollError('')
    rememberAgenticSession('')
  }

  const startAgenticRound = async () => {
    setAgenticStarting(true)
    setAgenticStartError('')
    setAgenticPollError('')
    try {
      const params = new URLSearchParams({ service: AGENTIC_SERVICE })
      if (selected && source === 'live') params.set('fixtureId', selected.FixtureId)
      const qs = `?${params.toString()}`
      const d = await api(`/api/agentic/start${qs}`, { method: 'POST' })
      rememberAgenticSession(d.sessionId)
    } catch (e) {
      setAgenticStartError(String(e?.message ?? e))
    } finally {
      setAgenticStarting(false)
    }
  }

  // load the board: fixtures with verified live odds (inlined). The free World Cup tier's odds are
  // intermittent and the proxy needs a few seconds to subscribe on a cold start, so we KEEP polling
  // until live data arrives - showing the labelled sample board meanwhile, then switching to live on
  // its own. We never mix demo numbers into a live fixture.
  useEffect(() => {
    let alive = true
    let timer = null
    let tries = 0
    const load = () => {
      fetch(`${PROXY}/api/board`).then((r) => r.json()).then((d) => {
        if (!alive) return
        if (Array.isArray(d) && d.length) { setFixtures(d); setSource('live'); setIdx(0); return }
        throw new Error('no live fixtures yet')
      }).catch(() => {
        if (!alive) return
        setFixtures((f) => f ?? DEMO_FIXTURES)   // keep the board full while we wait
        setSource((s) => (s === 'live' ? s : 'demo'))
        if (tries++ < 30) timer = setTimeout(load, 5000) // live odds can return at any time
      })
    }
    load()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!agenticSession) {
      setAgenticFeed(null)
      setAgenticBus(null)
      return
    }
    let alive = true
    const tick = async () => {
      const sid = encodeURIComponent(agenticSession)
      const results = await Promise.allSettled([
        api(`/api/agentic/feed?session=${sid}`),
        api(`/api/agentic/threads?session=${sid}`),
      ])
      if (!alive) return
      const errors = []
      if (results[0].status === 'fulfilled') setAgenticFeed(results[0].value)
      else errors.push(`feed: ${results[0].reason.message ?? results[0].reason}`)
      if (results[1].status === 'fulfilled') setAgenticBus(results[1].value)
      else errors.push(`bus: ${results[1].reason.message ?? results[1].reason}`)
      setAgenticPollError(errors.join(' | '))
    }
    tick()
    const timer = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [agenticSession])

  // The research watcher's queue -> event badges on the board ("line moved -> WANT queued").
  // Entirely optional: when the watcher isn't running, the board renders exactly as before. Backs
  // off (10s -> 20s -> 40s -> 60s cap) on repeated failures so an absent optional process doesn't
  // spam the console with a connection-refused error every 10s forever; resets to 10s once it's
  // reachable again, so it still picks the watcher up promptly if started later.
  useEffect(() => {
    let alive = true
    let timer = null
    let delay = 10000
    const tick = async () => {
      try {
        const d = await (await fetch(`${WATCHER}/queue`)).json()
        if (!alive) return
        const byFixture = {}
        for (const e of d.queue ?? []) byFixture[String(e.fixtureId)] = e
        setEvents(byFixture)
        delay = 10000
      } catch {
        delay = Math.min(delay * 2, 60000) // watcher down - no badges
      }
      if (alive) timer = setTimeout(tick, delay)
    }
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  // The persisted run ledger, polled independently of the current agenticSession - the sharp-movement
  // scoreboard is a whole-tournament stat, not scoped to whichever round happens to be on screen.
  // GRADE_POLL_MS on the proxy defaults to 5 minutes, so there's no need to poll faster than that.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const d = await api('/api/agentic/runs')
        if (alive) setRuns(d.runs)
      } catch { /* no live feed yet - scoreboard just stays empty */ }
    }
    tick()
    const timer = setInterval(tick, 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // odds come inlined on live fixtures (from /api/board); demo fixtures use the baked-in board.
  useEffect(() => {
    if (!selected) return
    setLoadingOdds(false)
    setOdds(Array.isArray(selected.odds) ? selected.odds : demoOddsFor(selected.FixtureId))
  }, [idx, fixtures])

  const select = (fx) => setIdx(fixtures.findIndex((f) => f.FixtureId === fx.FixtureId))

  return html`
    <header class="hero">
      <h1>TxODDS Agent Tutorial</h1>
    </header>
    <main>
      <${AgenticPanel}
        selected=${selected}
        source=${source}
        onStart=${startAgenticRound}
        starting=${agenticStarting}
        startError=${agenticStartError}
        feed=${agenticFeed}
        bus=${agenticBus}
        pollError=${agenticPollError}
        onClear=${clearAgenticRound}
        accuracy=${sharpMovementAccuracy(runs)} />
      ${!fixtures && html`<p class="muted" style=${{ textAlign: 'center' }}>loading fixtures...</p>`}
      ${selected && html`
        <section class="featured agentic-fixture">
          <div class="matchup">
            <div class="team home"><${Flag} name=${selected.Participant1} size="big" /><span class="team-name">${selected.Participant1}</span></div>
            <div class="vs">VS</div>
            <div class="team away"><${Flag} name=${selected.Participant2} size="big" /><span class="team-name">${selected.Participant2}</span></div>
          </div>
          <${Board} fixture=${selected} odds=${odds} loading=${loadingOdds} />
          <div class="agentic-fixture-actions">
            <button class="agent-start" disabled=${agenticStarting} onClick=${startAgenticRound}>
              ${agenticStarting
                ? html`<span class="spin"></span> starting agents...`
                : source === 'live' ? `Start ${AGENTIC_ROUND_LABEL} agents for this fixture` : `Start ${AGENTIC_ROUND_LABEL} agents from live proxy`}
            </button>
          </div>
        </section>`}

      <h3 class="grid-title">All fixtures - tap a match</h3>
      <div class="grid">
        ${fixtures?.map((fx) => html`<${MatchCard} key=${fx.FixtureId} fx=${fx} on=${selected?.FixtureId === fx.FixtureId} onSelect=${select} event=${events[String(fx.FixtureId)]} />`)}
      </div>
    </main>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
