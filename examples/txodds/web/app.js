// TxODDS Agent Tutorial - a React 18 no-build app over live TxODDS devnet data.
// Talks to the local proxy (../server/proxy.ts: GET /api/board - only fixtures with verified live 1X2
// odds, inlined). If the proxy/token isn't up it shows a clearly-labelled demo board; it never mixes
// demo numbers into a live fixture.

import React, { useState, useEffect } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from 'https://esm.sh/@solana/web3.js@1.98.4'

const html = htm.bind(React.createElement)
const PROXY = window.TXODDS_PROXY ?? 'http://localhost:8801'
// The research watcher (examples/txodds/research/watcher.ts) — optional; the board degrades silently.
const WATCHER = window.TXODDS_WATCHER ?? 'http://localhost:4600'
const EXPECTED_AGENTS = ['buyer-agent', 'seller-worldcup', 'seller-fast', 'seller-premium', 'seller-risk-policy', 'seller-fan-card', 'verifier-agent']
const MARKET_VERBS = ['WANT', 'BID', 'AWARD', 'ESCROW_REQUIRED', 'DEPOSITED', 'DELIVERED', 'VERIFY', 'VERIFIED', 'RELEASED', 'ARBITER_RELEASED', 'REFUNDED', 'ERROR']
const AGENT_ROUND_TYPES = [
  { id: 'txline', label: 'TxODDS edge', want: 'txline <fixtureId>', note: 'All seller personas can bid; the seller treats a fixture id as an edge-read request.' },
  { id: 'risk-policy', label: 'Risk policy', want: 'risk-policy <fixtureId>', note: 'seller-risk-policy bids with a deterministic guardrail payload.' },
  { id: 'fan-card', label: 'Fan card', want: 'fan-card <fixtureId>', note: 'seller-fan-card bids with a fan-facing explainer payload.' },
]
const AGENT_SOURCES = [
  ['buyer-agent', 'coral-agents/buyer-agent/src/index.ts'],
  ['seller-agent image', 'coral-agents/seller-agent/src/index.ts'],
  ['seller services', 'coral-agents/seller-agent/src/service.ts'],
  ['verifier-agent', 'coral-agents/verifier-agent/src/index.ts'],
  ['Coral parser/feed', 'examples/marketplace/feed/src/server.ts'],
  ['TxODDS launcher', 'examples/txodds/coral/round.ts'],
]

async function api(path, opts) {
  const r = await fetch(`${PROXY}${path}`, opts)
  const text = await r.text()
  const data = text ? JSON.parse(text) : {}
  if (!r.ok) throw new Error(data.error ?? `${r.status}`)
  return data
}

const verbOf = (text) => {
  const first = String(text ?? '').trim().split(/\s+/)[0]?.toUpperCase()
  return MARKET_VERBS.includes(first) ? first : undefined
}

const sentence = (s, n = 120) => {
  const text = String(s ?? '')
  return text.length > n ? `${text.slice(0, n - 3)}...` : text
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

// client-side fair line + read (used when the proxy/LLM is offline) - mirrors agent/edge.ts
function clientFair(m, teams) {
  const labelOf = { part1: teams.home, part2: teams.away, draw: 'Draw', over: 'Over', under: 'Under' }
  const outcomes = []
  ;(m.PriceNames || []).forEach((name, i) => {
    const pct = Number((m.Pct || [])[i])
    if (Number.isFinite(pct) && pct > 0) outcomes.push({ name, label: labelOf[name] ?? name, pct, fairOdds: Number(fairOdds(pct).toFixed(2)) })
  })
  const favourite = outcomes.reduce((b, o) => (!b || o.pct > b.pct ? o : b), undefined)
  return { outcomes, favourite }
}
function clientRead(fair) {
  const f = fair.favourite
  if (!f) return { call: 'no priced market for this fixture', confidence: 0, note: 'deterministic' }
  const alt = fair.outcomes.filter((o) => o !== f).sort((a, b) => b.pct - a.pct)[0]
  return {
    call: `${f.label} is the verified favourite at ${f.pct.toFixed(0)}% - fair odds ${f.fairOdds.toFixed(2)}${alt ? `; ${alt.label} the main alternative at ${alt.pct.toFixed(0)}%` : ''}.`,
    confidence: Number((f.pct / 100).toFixed(2)), note: 'deterministic (demo)',
  }
}
const clientEdge = (fx) => {
  // prefer the fixture's real inlined odds (live board); only fall back to the demo board offline
  const live = Array.isArray(fx.odds) ? (fx.odds.find((x) => String(x.SuperOddsType ?? '').includes('1X2')) ?? fx.odds.find(hasUsablePct)) : null
  const m = live?.PriceNames ? live : demoOddsFor(fx.FixtureId)[0]
  const teams = { home: fx.Participant1, away: fx.Participant2 }
  const fair = clientFair(m, teams)
  return { fixtureId: String(fx.FixtureId), teams, market: { names: m.PriceNames, pct: m.Pct }, fair, analysis: clientRead(fair), demo: !live }
}
const ESCROW_PROGRAM = 'R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet'
// >= the rent-exempt minimum (~0.00089 SOL) so the release makes a brand-new seller account rent-exempt
// in one shot - otherwise the first payout to a fresh wallet is rejected ("insufficient funds for rent").
const SETTLE_SOL = 0.001
const shortAddr = (a) => (a ? `${String(a).slice(0, 4)}...${String(a).slice(-4)}` : '')
const addrLink = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`
const txLink = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`
const DEVNET_RPC = 'https://api.devnet.solana.com'
const fmtTime = (s) => {
  try { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return s || '-' }
}

// Detect an injected browser wallet (Phantom / Solflare) - no wallet-adapter needed for a no-build app.
function getWallet() {
  const w = window
  const phantom = w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null)
  const solflare = w.solflare?.isSolflare ? w.solflare : null
  if (phantom) return { name: 'Phantom', provider: phantom }
  if (solflare) return { name: 'Solflare', provider: solflare }
  return null
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
      <div class="board-head"><span>${m.Bookmaker} - ${m.SuperOddsType}</span><span class="bh-cols"><span>fair prob</span><span>fair odds</span></span></div>
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
        <span class="e-cta">txline ${fixture.FixtureId}</span>
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

// the agent's read of the verified fair line (+ the break-even price) - the product being sold
function EdgeCard({ edge }) {
  if (!edge) return html`<div class="edgecard"><p class="muted">reading the fair line...</p></div>`
  const a = edge.analysis || {}
  const fav = edge.fair?.favourite
  const conf = typeof a.confidence === 'number' ? Math.round(a.confidence * 100) : null
  const det = /deterministic/i.test(a.note || '')
  return html`
    <div class="edgecard">
      <div class="ec-head"><span class="ec-tag">agent's read</span>
        <span class=${'ec-badge' + (det ? '' : ' llm')}>${det ? 'deterministic' : 'LLM'}</span></div>
      <p class="ec-call">${a.call}</p>
      ${fav && html`
        <div class="ec-beat">
          <span class="ec-beat-l">price to beat</span>
          <b>${fav.label} @ ${fav.fairOdds.toFixed(2)}</b>
          <span class="ec-beat-s">a bet has value only if a book offers more than this</span>
        </div>`}
      ${conf != null && html`
        <div class="ec-conf"><span>how decisive</span>
          <div class="ec-bar"><div class="ec-fill" style=${{ width: `${conf}%` }}></div></div><b>${conf}%</b></div>`}
      <p class="ec-honest">A read of the <b>verified fair line</b>, not a tip. Calling true "value" needs a sportsbook's
        offered price to compare against - the free TxODDS tier carries only the fair line.</p>
    </div>`
}

// the explainer - what the app actually does, end to end, threaded with the selected fixture's numbers
function Pipeline({ edge, source, settleRes, procurementRes }) {
  const fav = edge?.fair?.favourite
  const steps = [
    { n: 1, title: 'Verified data',
      desc: 'TxODDS de-margined World Cup odds - true-probability estimates with the bookmaker margin stripped out - fetched over a token-gated subscription on Solana devnet.',
      live: fav ? `${fav.label} ${fav.pct.toFixed(0)}%` : (source === 'live' ? 'live' : 'sample') },
    { n: 2, title: 'Fair line + price to beat',
      desc: 'The agent turns each probability into its fair (break-even) decimal odds = 100 / probability - the price a sportsbook must beat for a bet to have value - plus a one-line LLM read.',
      live: fav ? `fair odds ${fav.fairOdds.toFixed(2)}` : '-' },
    { n: 3, title: 'Settled by a neutral arbiter',
      desc: 'The buyer funds a per-order escrow but cannot unilaterally refund - a trusted neutral arbiter program releases to the seller on verified delivery. The escrow reference is bound to the read (sha256), so the on-chain order IS the data bought. Real devnet txs, linked on Explorer.',
      live: settleRes?.ok ? `${settleRes.amountSol} SOL${settleRes.mode === 'arbiter' ? ' - arbiter' : ''}` : `${SETTLE_SOL} SOL` },
    { n: 4, title: 'Optional upstream spend',
      desc: 'The seller can buy an upstream API through the Pay.sh rail before delivery. The run ledger stores PAYMENT_REQUIRED, PAYMENT_PROOF, and PAYMENT_CONFIRMED alongside the escrow settlement.',
      live: procurementRes?.procurement?.paid ? `${procurementRes.procurement.amount} ${procurementRes.procurement.currency}` : 'Pay.sh' },
  ]
  return html`
    <section class="pipeline">
      <div class="pipe-title">What this does, end to end <span>- verified data -> a usable read -> paid on-chain</span></div>
      <div class="pipe-steps">
        ${steps.map((s, i) => html`
          <div class="pipe-step" key=${s.n}>
            <div class="pipe-h"><span class="pipe-n">0${s.n}</span><span class="pipe-live">${s.live}</span></div>
            <h4>${s.title}</h4>
            <p>${s.desc}</p>
            ${i < steps.length - 1 && html`<span class="pipe-arrow">-></span>`}
          </div>`)}
      </div>
    </section>`
}

function statusTone(status) {
  if (/settled|ready|live|recorded|paid|verified/i.test(status)) return ' ok'
  if (/waiting|sample|needs|unavailable|disabled/i.test(status)) return ' warn'
  if (/running|loading|settling|checking/i.test(status)) return ' busy'
  return ''
}

function TutorialPanel({ selected, edge, source, settling, settleRes, procurementRes, runs }) {
  const fixtureName = selected ? `${selected.Participant1} vs ${selected.Participant2}` : 'No fixture selected'
  const dataStatus = source === 'live' ? 'live TxODDS' : source === 'demo' ? 'sample mode' : 'connecting'
  const readStatus = edge?.analysis ? (/deterministic/i.test(edge.analysis.note || '') ? 'fallback read ready' : 'LLM read ready') : 'waiting for read'
  const escrowStatus = source !== 'live'
    ? 'disabled on sample'
    : settling
      ? 'settling now'
      : settleRes?.ok
        ? 'settled on devnet'
        : settleRes
          ? 'needs funded wallet'
          : 'starts after read'
  const payShStatus = procurementRes?.procurement?.paid
    ? 'proof recorded'
    : source === 'live'
      ? 'optional'
      : 'requires live fixture'
  const runStatus = Array.isArray(runs) && runs.length ? `${runs.length} run${runs.length === 1 ? '' : 's'} recorded` : 'no runs yet'

  const steps = [
    {
      title: '1. Proxy reads TxODDS',
      body: 'The browser asks the local proxy for /api/board. The proxy holds the TxLINE token and only returns live fixtures with verified priced markets.',
      endpoint: 'GET /api/board',
      status: dataStatus,
    },
    {
      title: '2. Pick one fixture',
      body: 'The selected match drives the rest of the page: fair probabilities, fair odds, the agent read, settlement reference, and ledger entry.',
      endpoint: fixtureName,
      status: selected ? 'selected' : 'waiting',
    },
    {
      title: '3. Agent produces the read',
      body: 'For live fixtures the proxy calls /api/edge. If the model is unavailable, deterministic analysis keeps the data path inspectable.',
      endpoint: 'GET /api/edge',
      status: readStatus,
    },
    {
      title: '4. Escrow auto-settles',
      body: 'After delivery, /api/settle opens and releases a devnet escrow. The reference is bound to the purchased read.',
      endpoint: 'GET /api/settle',
      status: escrowStatus,
    },
    {
      title: '5. Optional rails',
      body: 'The purple wallet path is real Solana Pay. The green Pay.sh path is an upstream procurement proof path and is currently simulated.',
      endpoint: '/api/pay-intent + /api/pay-sh-edge',
      status: payShStatus,
    },
    {
      title: '6. Inspect the ledger',
      body: 'Every completed paid read is written to the run ledger with delivery hash, escrow references, transaction links, receipts, and grading status.',
      endpoint: 'GET /api/runs',
      status: runStatus,
    },
  ]

  return html`
    <section class="tutorial">
      <div class="tutorial-head">
        <div>
          <span class="section-kicker">End-to-end walkthrough</span>
          <h2>Follow the agent payment from data request to proof</h2>
        </div>
        <div class=${'source-pill' + (source === 'live' ? ' ok' : source === 'demo' ? ' warn' : ' busy')}>
          ${dataStatus}
        </div>
      </div>
      <div class="current-strip">
        <div><span>Fixture</span><b>${fixtureName}</b></div>
        <div><span>Read</span><b>${readStatus}</b></div>
        <div><span>Escrow</span><b>${escrowStatus}</b></div>
        <div><span>Ledger</span><b>${runStatus}</b></div>
      </div>
      <div class="lesson-grid">
        ${steps.map((s) => html`
          <article class="lesson-card" key=${s.title}>
            <div class="lesson-top">
              <h3>${s.title}</h3>
              <span class=${'lesson-status' + statusTone(s.status)}>${s.status}</span>
            </div>
            <p>${s.body}</p>
            <code>${s.endpoint}</code>
          </article>`)}
      </div>
    </section>`
}

function PaymentGuide({ source, settling, settleRes, procurementRes }) {
  const escrowStatus = source !== 'live'
    ? 'sample only'
    : settling
      ? 'running'
      : settleRes?.ok
        ? 'done'
        : settleRes
          ? 'blocked'
          : 'pending'
  const payShStatus = procurementRes?.procurement?.paid ? 'receipt written' : source === 'live' ? 'available' : 'live only'
  return html`
    <div class="payment-guide">
      <div class="path-card primary">
        <div class="path-top"><span>Path A</span><b>Automatic escrow</b><em>${escrowStatus}</em></div>
        <p>Runs after the agent read on a live fixture. The proxy opens and releases escrow on devnet, then writes the run ledger.</p>
      </div>
      <div class="path-card wallet">
        <div class="path-top"><span>Path B</span><b>Your wallet</b><em>optional</em></div>
        <p>Uses Solana Pay: your browser wallet signs a reference-tagged SOL transfer and the proxy verifies it on-chain.</p>
      </div>
      <div class="path-card payrail">
        <div class="path-top"><span>Path C</span><b>Pay.sh procurement</b><em>${payShStatus}</em></div>
        <p>Shows an upstream payment proof leg before settlement. This rail is simulated today and marked as such in receipts.</p>
      </div>
    </div>`
}

// the settlement - a real devnet escrow round, linked on Explorer. Two modes: the arbiter-gated
// wrapper (3 parties; the buyer can't unilaterally refund) or the direct buyer-released escrow.
function BindLine({ r }) {
  if (!r.order?.favourite) return null
  return html`
    <div class="settled-line bind">
      <span class="bind-tag">bound</span> this payment references
      <b>${r.order.favourite} @ ${r.order.fairOdds}</b>${r.order.matchup ? ` - ${r.order.matchup}` : ''}
      <span class="bind-ref">ref ${shortAddr(r.reference)} = sha256(${r.order.preimage})</span>
    </div>`
}
function SettleResult({ r }) {
  if (r.ok && r.mode === 'arbiter') return html`
    <div class="settled ok">
      <div class="settled-line">settled <b>${r.amountSol} SOL</b> via the arbiter - buyer
        <a href=${addrLink(r.buyer)} target="_blank" rel="noreferrer">${shortAddr(r.buyer)}</a> funds escrow -
        arbiter <a href=${addrLink(r.arbiter)} target="_blank" rel="noreferrer">${shortAddr(r.arbiter)}</a> releases
        <span class="settled-arrow">-></span> seller <a href=${addrLink(r.seller)} target="_blank" rel="noreferrer">${shortAddr(r.seller)}</a>
        ${r.selfPay && html`<span class="settled-note">self-pay seller - set a distinct SELLER_WALLET</span>`}
      </div>
      <div class="settled-line arbiter-note">
        <span class="bind-tag arb">arbiter</span> buyer cannot take delivery and refund - only the trusted neutral
        arbiter can release, gated on verified delivery
      </div>
      <${BindLine} r=${r} />
      <div class="settled-line links">
        <a href=${r.open.explorer} target="_blank" rel="noreferrer">open open</a> -
        <a href=${r.release.explorer} target="_blank" rel="noreferrer">arbiter release open</a> -
        <a href=${r.escrow.explorer} target="_blank" rel="noreferrer">escrow PDA open</a>
      </div>
    </div>`
  if (r.ok) return html`
    <div class="settled ok">
      <div class="settled-line">settled <b>${r.amountSol} SOL</b> on devnet - buyer
        <a href=${addrLink(r.buyer)} target="_blank" rel="noreferrer">${shortAddr(r.buyer)}</a>
        <span class="settled-arrow">-></span> seller
        <a href=${addrLink(r.seller)} target="_blank" rel="noreferrer">${shortAddr(r.seller)}</a>
        ${r.selfPay && html`<span class="settled-note">self-pay - set a distinct SELLER_WALLET to split the parties</span>`}
      </div>
      <${BindLine} r=${r} />
      <div class="settled-line links">
        <a href=${r.deposit.explorer} target="_blank" rel="noreferrer">deposit open</a> -
        <a href=${r.release.explorer} target="_blank" rel="noreferrer">release open</a> -
        <a href=${r.escrow.explorer} target="_blank" rel="noreferrer">escrow PDA open</a>
      </div>
    </div>`
  return html`
    <div class="settled sim">live settle unavailable${r.error ? ` (${String(r.error).slice(0, 70)})` : ''} -
      needs a funded devnet buyer wallet (.env). See the
      <a href=${addrLink(ESCROW_PROGRAM)} target="_blank" rel="noreferrer">escrow program open</a></div>`
}

function ProofReceiptChip({ receipt }) {
  if (!receipt) return null
  return html`
    <div class="settled-line bind proof-receipt">
      <span class="bind-tag">proof receipt</span>
      <b>${receipt.rail}</b>${receipt.provider ? html` · ${receipt.provider}` : ''}
      · ${receipt.paid ? 'paid' : `unpaid${receipt.reason ? ` (${receipt.reason})` : ''}`}
      <b> ${receipt.amount} ${receipt.currency}</b>
      · proof <b>${shortAddr(receipt.proof)}</b>
      ${receipt.simulated && html`<span class="sim-badge">simulated rail</span>`}
    </div>`
}

function ProcurementResult({ r }) {
  if (!r) return null
  if (r.ok) return html`
    <div class="settled ok pay-sh-result">
      <div class="settled-line"><span class="bind-tag">Pay.sh</span>
        seller procured upstream context for <b>${r.procurement?.amount} ${r.procurement?.currency}</b>
        then settled <b>${r.amountSol} SOL</b> to the seller
      </div>
      <${ProofReceiptChip} receipt=${r.procurement?.receipt} />
      <div class="settled-line bind">
        stored in the run ledger as <b>proof_receipts.json</b> + PAYMENT_PROOF in the transcript
      </div>
    </div>`
  return html`<div class="settled sim">Pay.sh demo unavailable${r.error ? ` (${String(r.error).slice(0, 70)})` : ''}</div>`
}

function RunsPanel({ runs, selectedRun, onSelect, onGrade, grading }) {
  const top = selectedRun ?? runs?.[0]
  const outcome = top?.outcome
  return html`
    <section class="runs">
      <div class="runs-head">
        <div>
          <span class="section-kicker">ELI5 ledger</span>
          <h3>Runs = receipts for paid agent jobs</h3>
          <p>A run is one complete job record: what you asked the agent to buy, what it answered, how it was paid, and where the proof lives.</p>
        </div>
        <button class="grade-btn" disabled=${grading} onClick=${onGrade}>${grading ? 'checking...' : 'check against final scores'}</button>
      </div>
      <div class="runs-explain">
        <div><b>Ask</b><span>fixture + service request</span></div>
        <div><b>Answer</b><span>the agent's delivered read</span></div>
        <div><b>Money</b><span>escrow, wallet, or rail proof</span></div>
        <div><b>Proof</b><span>hashes, receipts, tx links</span></div>
      </div>
      ${!runs && html`<p class="muted">loading run ledger...</p>`}
      ${runs && !runs.length && html`<p class="muted">No runs yet. Pick a live fixture and let auto-settle finish; this panel will fill with the receipt for that agent job.</p>`}
      ${runs?.length > 0 && html`
        <div class="runs-grid">
          <div class="run-list">
            ${runs.map((r) => html`
              <button key=${r.runId} class=${'run-row' + (top?.runId === r.runId ? ' on' : '')} onClick=${() => onSelect(r)}>
                <span class="run-id">#${r.round}</span>
                <span class="run-main">${r.want?.arg ?? 'txline read'}</span>
                <span class=${'run-status ' + r.status}>${r.status}</span>
                <span class="run-time">${fmtTime(r.updatedAt)}</span>
              </button>`)}
          </div>
          ${top && html`
            <div class="run-detail">
              <div class="rd-top">
                <span class="bind-tag">${top.runId}</span>
                <span>${top.escrow?.amountSol ?? top.want?.budgetSol ?? SETTLE_SOL} SOL</span>
              </div>
              <p class="rd-call">${top.delivery?.data?.analysis?.call ?? 'delivery not recorded'}</p>
              <div class="rd-lines">
                <span>What was bought <b>${top.want?.arg ?? 'txline read'}</b></span>
                ${top.delivery?.sha256 && html`<span>Answer fingerprint <b>${shortAddr(top.delivery.sha256)}</b></span>`}
                ${top.escrow?.reference && html`<span>Payment reference <b>${shortAddr(top.escrow.reference)}</b></span>`}
                ${top.verification?.upstreamPayment?.rail && html`<span>Upstream purchase <b>${top.verification.upstreamPayment.rail} ${top.verification.upstreamPayment.amount} ${top.verification.upstreamPayment.currency}</b></span>`}
                ${top.proofReceipts?.map((pr) => html`<span key=${pr.rail + pr.proof}>Rail receipt <b>${pr.rail} ${pr.amount} ${pr.currency} ${pr.paid ? 'paid' : 'not paid'}${pr.simulated ? ' (simulated)' : ''}</b></span>`)}
                ${outcome && html`<span>Final-score check <b>${outcome.status === 'graded'
                  ? `${outcome.actual?.winner ?? 'unknown'} - ${outcome.correct === true ? 'matched' : outcome.correct === false ? 'missed' : 'unscored'}`
                  : 'pending'}</b></span>`}
              </div>
              <div class="rd-txs">
                ${top.txs?.map((tx) => html`<a key=${tx.kind + tx.sig} href=${tx.explorer} target="_blank" rel="noreferrer">${tx.kind}</a>`)}
              </div>
            </div>`}
        </div>`}
    </section>`
}

function ModeSwitch({ mode, onMode, agenticSession }) {
  return html`
    <section class="mode-switch">
      <button class=${mode === 'local' ? 'mode-card on' : 'mode-card'} onClick=${() => onMode('local')}>
        <span>Local Proxy Tutorial</span>
        <b>Single server path</b>
        <small>TxODDS proxy reads data, settles locally, and writes tutorial runs.</small>
      </button>
      <button class=${mode === 'agentic' ? 'mode-card on' : 'mode-card'} onClick=${() => onMode('agentic')}>
        <span>Live CoralOS Agents</span>
        <b>${agenticSession ? `session ${shortAddr(agenticSession)}` : 'buyer + sellers + verifier'}</b>
        <small>Dockerized coded agents coordinate over CoralOS and settle through devnet escrow.</small>
      </button>
    </section>`
}

function AgentRoster({ agents }) {
  const byName = new Map((agents ?? []).map((a) => [a.name, a.status ?? 'seen']))
  return html`
    <div class="agent-roster">
      ${EXPECTED_AGENTS.map((name) => {
        const status = byName.get(name) ?? 'waiting'
        return html`
          <div class=${'agent-pill ' + (status === 'running' ? 'ok' : status === 'waiting' ? 'wait' : '')} key=${name}>
            <span class="agent-dot"></span>
            <b>${name}</b>
            <small>${status}</small>
          </div>`
      })}
    </div>`
}

function SourceMap() {
  return html`
    <div class="source-map">
      ${AGENT_SOURCES.map(([label, path]) => html`
        <div key=${label}>
          <span>${label}</span>
          <code>${path}</code>
        </div>`)}
    </div>`
}

function CoralBus({ bus }) {
  const threads = bus?.threads ?? []
  if (!bus) return html`<div class="agent-empty">Attach or start a session to see CoralOS messages.</div>`
  if (!threads.length) return html`<div class="agent-empty">Session found. Waiting for the buyer to open a market thread.</div>`
  return html`
    <div class="coral-bus">
      ${threads.map((thread) => html`
        <section class="coral-thread" key=${thread.id}>
          <div class="coral-thread-head">
            <b>${thread.name ?? 'market thread'}</b>
            <span>${thread.participants?.join(' / ')}</span>
          </div>
          ${(thread.messages ?? []).map((m, i) => {
            const v = verbOf(m.text)
            return html`
              <div class="coral-msg" key=${`${thread.id}-${i}`}>
                <div class="coral-msg-top">
                  <b>${m.sender}</b>
                  ${v && html`<span class=${'verb verb-' + v.toLowerCase()}>${v}</span>`}
                  ${(m.mentions ?? []).map((name) => html`<em key=${name}>@${name}</em>`)}
                  ${m.timestamp && html`<small>${m.timestamp.slice(11, 19)}</small>`}
                </div>
                <p>${m.text}</p>
              </div>`
          })}
        </section>`)}
    </div>`
}

function RoundLifecycle({ feed }) {
  const rounds = feed?.rounds ?? []
  if (!feed) return html`<div class="agent-empty">No folded rounds yet.</div>`
  if (!rounds.length) return html`<div class="agent-empty">The feed is live, but no market round has been folded yet.</div>`
  return html`
    <div class="agent-rounds">
      ${rounds.slice(-4).reverse().map((r) => html`
        <article class="agent-round" key=${r.round}>
          <div class="agent-round-head">
            <span>round ${r.round}</span>
            <b>${r.status}</b>
          </div>
          <div class="round-eli5">
            <div><span>Ask</span><b>${r.want?.arg ?? 'txline fixture'}</b></div>
            <div><span>Bids</span><b>${r.bids?.length ?? 0}</b></div>
            <div><span>Winner</span><b>${r.award?.to ?? 'not awarded'}</b></div>
            <div><span>Money</span><b>${r.escrow?.amountSol ? `${r.escrow.amountSol} SOL` : 'waiting'}</b></div>
            <div><span>Verifier</span><b>${r.verification?.verdict ?? 'waiting'}</b></div>
            <div><span>Proof</span><b>${r.release?.sig ? shortAddr(r.release.sig) : r.delivered ? 'delivered' : 'pending'}</b></div>
          </div>
          ${r.delivered?.raw && html`<p class="round-delivery">${sentence(r.delivered.raw, 160)}</p>`}
        </article>`)}
    </div>`
}

function AgenticRuns({ runs }) {
  const list = runs ?? []
  return html`
    <section class="runs agent-runs">
      <div class="runs-head">
        <div>
          <span class="section-kicker">Agentic ledger</span>
          <h3>Runs = receipts from CoralOS agent jobs</h3>
          <p>Each run is folded from Coral thread messages and persisted by the feed server.</p>
        </div>
      </div>
      <div class="runs-explain">
        <div><b>Ask</b><span>buyer-agent WANT</span></div>
        <div><b>Bids</b><span>seller personas reply</span></div>
        <div><b>Winner</b><span>AWARD message</span></div>
        <div><b>Money</b><span>escrow deposit/release</span></div>
        <div><b>Verifier</b><span>VERIFIED pass/fail</span></div>
        <div><b>Proof</b><span>hashes and tx links</span></div>
      </div>
      ${!list.length && html`<p class="muted">No agentic runs persisted yet. Start a live round and wait for the feed to fold it.</p>`}
      ${list.length > 0 && html`
        <div class="agent-run-list">
          ${list.slice(0, 6).map((r) => html`
            <article class="agent-run-card" key=${r.runId}>
              <div><b>${r.runId}</b><span>${r.status}</span></div>
              <p>${r.want?.arg ?? 'txline request'}</p>
              <small>${r.award?.to ?? 'no winner yet'} / ${r.verification?.verdict ?? 'no verifier verdict'} / ${r.escrow?.amountSol ?? r.want?.budgetSol ?? '-'} SOL</small>
            </article>`)}
        </div>`}
    </section>`
}

function AgenticPanel({
  selected, source, session, sessionInput, setSessionInput, onAttach, onStart, starting,
  startError, feed, bus, runs, reputation, pollError, roundType, setRoundType,
}) {
  const fixture = selected ? `${selected.Participant1} vs ${selected.Participant2}` : 'current fixture'
  const liveTarget = selected && source === 'live'
  const agents = bus?.agents ?? []
  const activeRound = AGENT_ROUND_TYPES.find((x) => x.id === roundType) ?? AGENT_ROUND_TYPES[0]
  return html`
    <section class="agentic-panel">
      <div class="agentic-head">
        <div>
          <span class="section-kicker">Live CoralOS Agents</span>
          <h2>Proper coded agents run this path</h2>
          <p>CoralOS launches Docker agents. The browser shows their real session roster, thread messages, folded market rounds, and ledger output.</p>
        </div>
        <div class="agentic-status">
          <span class=${session ? 'source-pill ok' : 'source-pill warn'}>${session ? 'session attached' : 'no session'}</span>
          ${feed?.source && html`<span class="source-pill busy">feed ${feed.source}</span>`}
        </div>
      </div>
      ${session && html`
        <div class="session-strip">
          <span>Coral session id</span>
          <code>${session}</code>
        </div>`}
      <div class="agent-service-tabs" role="tablist" aria-label="Agent round type">
        ${AGENT_ROUND_TYPES.map((item) => html`
          <button
            key=${item.id}
            class=${roundType === item.id ? 'on' : ''}
            role="tab"
            aria-selected=${roundType === item.id}
            onClick=${() => setRoundType(item.id)}>
            <span>${item.label}</span>
            <small>${item.want}</small>
          </button>`)}
      </div>
      <p class="agent-service-note">${activeRound.note}</p>
      <div class="agentic-actions">
        <button class="agent-start" disabled=${starting} onClick=${onStart}>
          ${starting
            ? html`<span class="spin"></span> starting agents...`
            : liveTarget ? `Start ${activeRound.label} Round for ${fixture}` : `Start ${activeRound.label} Round from live proxy`}
        </button>
        <div class="attach-box">
          <input
            value=${sessionInput}
            onInput=${(e) => setSessionInput(e.target.value.trim())}
            placeholder="paste CoralOS session id"
            aria-label="CoralOS session id" />
          <button onClick=${onAttach}>Attach</button>
        </div>
      </div>
      ${startError && html`<p class="agent-error">${startError}</p>`}
      ${pollError && html`<p class="agent-error">${pollError}</p>`}
      <${AgentRoster} agents=${agents} />
      <div class="agentic-grid">
        <section class="agentic-block wide">
          <div class="block-head"><h3>Coral bus</h3><span>messages from MCP threads</span></div>
          <${CoralBus} bus=${bus} />
        </section>
        <section class="agentic-block">
          <div class="block-head"><h3>Market rounds</h3><span>folded by feed server</span></div>
          <${RoundLifecycle} feed=${feed} />
        </section>
        <section class="agentic-block">
          <div class="block-head"><h3>Source of truth</h3><span>repo-owned code paths</span></div>
          <${SourceMap} />
        </section>
      </div>
      ${reputation?.length > 0 && html`
        <div class="reputation-row">
          ${reputation.map((r) => html`<span key=${r.seller}>${r.seller}: ${r.score}</span>`)}
        </div>`}
      <${AgenticRuns} runs=${runs} />
    </section>`
}

// Pay for the read yourself with Phantom / Solflare - a real Solana Pay reference-tagged transfer to
// the seller, verified on-chain by the proxy. The wallet signs; we submit to devnet so the cluster is
// guaranteed regardless of the wallet's setting. (Needs a Devnet-funded wallet.)
function PayButton({ fixture }) {
  const [st, setSt] = useState({ status: 'idle', msg: '' })
  const wallet = getWallet()

  const pay = async () => {
    if (!wallet) { setSt({ status: 'error', msg: 'No Phantom/Solflare detected - install one and switch it to Devnet' }); return }
    try {
      setSt({ status: 'busy', msg: 'connecting wallet...' })
      const { provider } = wallet
      const conn = await provider.connect()
      const payer = new PublicKey((conn?.publicKey ?? provider.publicKey).toString())

      setSt({ status: 'busy', msg: 'building payment...' })
      const intent = await (await fetch(`${PROXY}/api/pay-intent?fixtureId=${fixture.FixtureId}&amount=${SETTLE_SOL}`)).json()
      const connection = new Connection(DEVNET_RPC, 'confirmed')
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const ix = SystemProgram.transfer({
        fromPubkey: payer, toPubkey: new PublicKey(intent.recipient),
        lamports: Math.round(intent.amountSol * LAMPORTS_PER_SOL),
      })
      ix.keys.push({ pubkey: new PublicKey(intent.reference), isSigner: false, isWritable: false }) // Solana Pay reference
      const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(ix)

      setSt({ status: 'busy', msg: `approve in ${wallet.name}...` })
      const signed = await provider.signTransaction(tx)
      const sig = await connection.sendRawTransaction(signed.serialize())
      setSt({ status: 'busy', msg: 'confirming on devnet...' })
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

      const v = await (await fetch(`${PROXY}/api/pay-verify?sig=${sig}&reference=${intent.reference}&amount=${intent.amountSol}&recipient=${intent.recipient}&fixtureId=${fixture.FixtureId}`)).json()
      setSt({ status: v.ok ? 'ok' : 'error', msg: v.ok ? '' : 'paid, but verification failed', explorer: v.explorer ?? txLink(sig), amountSol: intent.amountSol })
    } catch (e) {
      setSt({ status: 'error', msg: String(e?.message ?? e).slice(0, 100) })
    }
  }

  if (st.status === 'ok') return html`
    <div class="settled ok"><span class="bind-tag">paid</span> you paid <b>${st.amountSol} SOL</b> with ${wallet?.name} -
      <a href=${st.explorer} target="_blank" rel="noreferrer">tx open</a> - verified by its Solana Pay reference</div>`

  return html`
    <div class="pay-self">
      <button class="pay-btn" disabled=${st.status === 'busy'} onClick=${pay}>
        ${st.status === 'busy'
          ? html`<span class="spin"></span> ${st.msg}`
          : `Pay it yourself with Phantom / Solflare - ${SETTLE_SOL} SOL`}
      </button>
      ${st.status === 'error' && html`<span class="pay-err">${st.msg}</span>`}
    </div>`
}

function App() {
  const urlSession = new URLSearchParams(window.location.search).get('agentSession') ?? ''
  const [mode, setMode] = useState(urlSession ? 'agentic' : 'local')
  const [fixtures, setFixtures] = useState(null)
  const [source, setSource] = useState(null) // 'live' | 'demo'
  const [idx, setIdx] = useState(0)
  const [odds, setOdds] = useState(null)
  const [loadingOdds, setLoadingOdds] = useState(false)
  const [edge, setEdge] = useState(null)
  const [settleRes, setSettleRes] = useState(null)
  const [procurementRes, setProcurementRes] = useState(null)
  const [procuring, setProcuring] = useState(false)
  const [settling, setSettling] = useState(false)
  const [runs, setRuns] = useState(null)
  const [selectedRun, setSelectedRun] = useState(null)
  const [grading, setGrading] = useState(false)
  const [events, setEvents] = useState({}) // fixtureId -> the watcher's queued research event
  const [agenticSession, setAgenticSession] = useState(urlSession)
  const [agenticInput, setAgenticInput] = useState(urlSession)
  const [agenticStarting, setAgenticStarting] = useState(false)
  const [agenticStartError, setAgenticStartError] = useState('')
  const [agenticPollError, setAgenticPollError] = useState('')
  const [agenticFeed, setAgenticFeed] = useState(null)
  const [agenticBus, setAgenticBus] = useState(null)
  const [agenticRuns, setAgenticRuns] = useState([])
  const [agenticReputation, setAgenticReputation] = useState([])
  const [agenticRoundType, setAgenticRoundType] = useState('txline')
  const selected = fixtures ? fixtures[idx] : null
  const activeAgentRound = AGENT_ROUND_TYPES.find((x) => x.id === agenticRoundType) ?? AGENT_ROUND_TYPES[0]

  const loadRuns = async () => {
    try {
      const d = await (await fetch(`${PROXY}/api/runs`)).json()
      if (Array.isArray(d)) {
        setRuns(d)
        setSelectedRun((r) => r ? (d.find((x) => x.runId === r.runId) ?? d[0] ?? null) : (d[0] ?? null))
      }
    } catch {
      setRuns((r) => r ?? [])
    }
  }

  const gradeRuns = async () => {
    setGrading(true)
    try { await fetch(`${PROXY}/api/grade-runs`); await loadRuns() }
    finally { setGrading(false) }
  }

  const runPayShDemo = async () => {
    if (!selected || source !== 'live') return
    setProcuring(true)
    setProcurementRes(null)
    try {
      const r = await (await fetch(`${PROXY}/api/pay-sh-edge?fixtureId=${selected.FixtureId}&amount=${SETTLE_SOL}&upstreamUsdc=0.03`)).json()
      setProcurementRes(r)
      await loadRuns()
    } catch (e) {
      setProcurementRes({ ok: false, error: String(e?.message ?? e) })
    } finally {
      setProcuring(false)
    }
  }

  const rememberAgenticSession = (id) => {
    setAgenticSession(id)
    setAgenticInput(id)
    setMode('agentic')
    const u = new URL(window.location.href)
    if (id) u.searchParams.set('agentSession', id)
    else u.searchParams.delete('agentSession')
    window.history.replaceState({}, '', u)
  }

  useEffect(() => {
    if (urlSession || agenticSession) return
    let alive = true
    ;(async () => {
      try {
        const d = await api('/api/agentic/runs')
        const id = latestSessionFromRuns(d.runs)
        if (alive && id) rememberAgenticSession(id)
      } catch { /* no live feed or no persisted agentic runs yet */ }
    })()
    return () => { alive = false }
  }, [urlSession, agenticSession])

  const attachAgenticSession = () => {
    if (!agenticInput) return
    setAgenticStartError('')
    setAgenticPollError('')
    rememberAgenticSession(agenticInput)
  }

  const startAgenticRound = async () => {
    setMode('agentic')
    setAgenticStarting(true)
    setAgenticStartError('')
    setAgenticPollError('')
    try {
      const params = new URLSearchParams({ service: agenticRoundType })
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
    let alive = true
    const tick = async () => { if (alive) await loadRuns() }
    tick()
    const timer = setInterval(tick, 8000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!agenticSession) {
      setAgenticFeed(null)
      setAgenticBus(null)
      setAgenticRuns([])
      setAgenticReputation([])
      return
    }
    let alive = true
    const tick = async () => {
      const sid = encodeURIComponent(agenticSession)
      const results = await Promise.allSettled([
        api(`/api/agentic/feed?session=${sid}`),
        api(`/api/agentic/threads?session=${sid}`),
        api('/api/agentic/runs'),
        api('/api/agentic/reputation'),
      ])
      if (!alive) return
      const errors = []
      if (results[0].status === 'fulfilled') setAgenticFeed(results[0].value)
      else errors.push(`feed: ${results[0].reason.message ?? results[0].reason}`)
      if (results[1].status === 'fulfilled') setAgenticBus(results[1].value)
      else errors.push(`bus: ${results[1].reason.message ?? results[1].reason}`)
      if (results[2].status === 'fulfilled') {
        const list = results[2].value.runs ?? []
        setAgenticRuns(list.filter((r) => r.session === agenticSession))
      } else errors.push(`runs: ${results[2].reason.message ?? results[2].reason}`)
      if (results[3].status === 'fulfilled') setAgenticReputation(results[3].value.reputation ?? [])
      else errors.push(`reputation: ${results[3].reason.message ?? results[3].reason}`)
      setAgenticPollError(errors.join(' | '))
    }
    tick()
    const timer = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [agenticSession])

  // The research watcher's queue -> event badges on the board ("line moved -> WANT queued").
  // Entirely optional: when the watcher isn't running, the board renders exactly as before.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const d = await (await fetch(`${WATCHER}/queue`)).json()
        if (!alive) return
        const byFixture = {}
        for (const e of d.queue ?? []) byFixture[String(e.fixtureId)] = e
        setEvents(byFixture)
      } catch { /* watcher down - no badges */ }
    }
    tick()
    const timer = setInterval(tick, 10000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // odds come inlined on live fixtures (from /api/board); demo fixtures use the baked-in board.
  useEffect(() => {
    if (!selected) return
    setLoadingOdds(false)
    setOdds(Array.isArray(selected.odds) ? selected.odds : demoOddsFor(selected.FixtureId))
  }, [idx, fixtures])

  // the agent delivers its call, then the buyer escrow fires automatically (Option A - no button).
  // Live -> the proxy's /api/edge (real odds -> real call) -> /api/settle (real devnet deposit->release);
  // demo -> a client-side call only (no wallet flow). Never invents data for an empty game.
  useEffect(() => {
    if (!selected || mode !== 'local') { setSettling(false); return }
    let alive = true
    setEdge(null); setSettleRes(null); setProcurementRes(null); setSettling(false)
    ;(async () => {
      // 1) the agent's call
      let e = clientEdge(selected)
      if (source === 'live') {
        try {
          const d = await (await fetch(`${PROXY}/api/edge?fixtureId=${selected.FixtureId}`)).json()
          if (d && d.analysis) e = d
        } catch { /* keep the client-side call */ }
      }
      if (!alive) return
      setEdge(e)
      // 2) delivery -> settlement fires on its own; the Explorer links appear when it confirms
      if (source !== 'live') return
      setSettling(true)
      try {
        const s = await (await fetch(`${PROXY}/api/settle?fixtureId=${selected.FixtureId}&amount=${SETTLE_SOL}`)).json()
        if (alive) { setSettleRes(s); loadRuns() }
      } catch (err) {
        if (alive) setSettleRes({ ok: false, error: String(err) })
      } finally {
        if (alive) setSettling(false)
      }
    })()
    return () => { alive = false }
  }, [idx, fixtures, mode])

  const select = (fx) => setIdx(fixtures.findIndex((f) => f.FixtureId === fx.FixtureId))

  return html`
    <header class="hero">
      <span class=${'kicker' + (source === 'demo' ? ' demo' : '')}>
        <span class="dot"></span>${source === 'demo' ? 'sample fixtures - live odds quiet' : 'live - devnet - free World Cup tier'}
      </span>
      <h1>TxODDS Agent Tutorial</h1>
      <p class="tagline">Trace one paid agent job end to end: <b>verified TxODDS data</b>, an <b>agent read</b>,
        <b>devnet escrow settlement</b>, optional payment rails, and the run ledger proof.</p>
    </header>
    <main>
      <${ModeSwitch} mode=${mode} onMode=${setMode} agenticSession=${agenticSession} />
      ${mode === 'agentic' && html`
        <${AgenticPanel}
          selected=${selected}
          source=${source}
          session=${agenticSession}
          sessionInput=${agenticInput}
          setSessionInput=${setAgenticInput}
          onAttach=${attachAgenticSession}
          onStart=${startAgenticRound}
          starting=${agenticStarting}
          startError=${agenticStartError}
          feed=${agenticFeed}
          bus=${agenticBus}
          runs=${agenticRuns}
          reputation=${agenticReputation}
          pollError=${agenticPollError}
          roundType=${agenticRoundType}
          setRoundType=${setAgenticRoundType} />`}
      ${mode === 'local' && html`
        <${TutorialPanel} selected=${selected} edge=${edge} source=${source} settling=${settling} settleRes=${settleRes} procurementRes=${procurementRes} runs=${runs} />
        <${Pipeline} edge=${edge} source=${source} settleRes=${settleRes} procurementRes=${procurementRes} />`}
      ${!fixtures && html`<p class="muted" style=${{ textAlign: 'center' }}>loading fixtures...</p>`}
      ${mode === 'local' && selected && html`
        <section class="featured">
          <div class="feat-top">
            <span class="chip">${selected.Competition}</span>
            <span class="feat-when">kickoff ${new Date(selected.StartTime).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="matchup">
            <div class="team home"><${Flag} name=${selected.Participant1} size="big" /><span class="team-name">${selected.Participant1}</span></div>
            <div class="vs">VS</div>
            <div class="team away"><${Flag} name=${selected.Participant2} size="big" /><span class="team-name">${selected.Participant2}</span></div>
          </div>
          <${Board} fixture=${selected} odds=${odds} loading=${loadingOdds} />
          <div class="thesis">
            <${EdgeCard} edge=${edge} />
            <${PaymentGuide} source=${source} settling=${settling} settleRes=${settleRes} procurementRes=${procurementRes} />
            <div class="settle-row">
              ${settling && html`<div class="settling-auto">
                <span class="spin"></span> agent delivered - arbiter settling ${SETTLE_SOL} SOL in escrow on devnet...
              </div>`}
              ${settleRes && html`<${SettleResult} r=${settleRes} />`}
              <button class="pay-sh-btn" disabled=${source !== 'live' || procuring} onClick=${runPayShDemo}>
                ${procuring ? html`<span class="spin"></span> procuring + settling...` : 'Run Pay.sh procurement demo'}
              </button>
              ${procurementRes && html`<${ProcurementResult} r=${procurementRes} />`}
              ${selected && html`<${PayButton} fixture=${selected} />`}
            </div>
          </div>
        </section>`}

      ${mode === 'agentic' && selected && html`
        <section class="featured agentic-fixture">
          <div class="feat-top">
            <span class="chip live">Agent target</span>
            <span class="feat-when">fixture ${selected.FixtureId}</span>
          </div>
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
                : source === 'live' ? `Start ${activeAgentRound.label} agents for this fixture` : `Start ${activeAgentRound.label} agents from live proxy`}
            </button>
            <p>${source === 'live'
              ? `buyer-agent will post WANT ${activeAgentRound.want.replace('<fixtureId>', selected.FixtureId)}; seller personas bid; verifier-agent checks delivery before arbiter release.`
              : 'Sample cards are not sent as orders; the backend will choose a live proxy fixture or fallback id.'}</p>
          </div>
        </section>`}

      ${mode === 'local' && html`<${RunsPanel} runs=${runs} selectedRun=${selectedRun} onSelect=${setSelectedRun} onGrade=${gradeRuns} grading=${grading} />`}

      <h3 class="grid-title">All fixtures - tap a match</h3>
      <div class="grid">
        ${fixtures?.map((fx) => html`<${MatchCard} key=${fx.FixtureId} fx=${fx} on=${selected?.FixtureId === fx.FixtureId} onSelect=${select} event=${events[String(fx.FixtureId)]} />`)}
      </div>
    </main>
    <footer class="foot">
      <p class="pillars">Verified <b>TxODDS</b> fair line - the agent's <b>break-even read</b> - settled by <b>Solana escrow</b>.</p>
      <p>${source === 'live'
        ? `live - devnet - ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'} with verified odds`
        : source === 'demo'
          ? 'live World Cup odds are quiet right now - showing sample fixtures; the board switches to live automatically when they return'
          : 'connecting to the live proxy...'}</p>
    </footer>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
