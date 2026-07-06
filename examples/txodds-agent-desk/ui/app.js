/**
 * TxODDS Agent Desk — the operator console, as a thin window onto the kit's existing services.
 *
 * No bespoke glue, by design: every byte on screen comes from HTTP APIs that already exist —
 *   - the txodds proxy (:8801)  → board, agent reads, run ledger, proof receipts, settlement
 *   - the marketplace feed (:4000, optional) → ledger-derived seller reputation
 *   - the research watcher (:4600, optional) → the odds-move event queue
 * and every action the desk can take (settle, Pay.sh procurement, reality grading) is one of the
 * proxy's policy-gated endpoints. If a source is down its panel degrades; nothing here signs,
 * holds keys, or re-implements market logic.
 */

const PROXY = 'http://localhost:8801'
const FEED = 'http://localhost:4000'
const WATCHER = 'http://localhost:4600'
const SETTLE_SOL = 0.001

const state = {
  tab: 'runs',
  proxyUp: null, feedUp: null, watcherUp: null,
  board: null, runs: null, selectedRunId: null,
  reputation: null, events: null,
  busy: {}, notice: null,
}

/* ---------- data ---------- */

async function jget(url, timeoutMs = 10000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

async function refresh() {
  const [runs, board, reputation, events] = await Promise.all([
    jget(`${PROXY}/api/runs`).catch(() => null),
    jget(`${PROXY}/api/board`, 20000).catch(() => null),
    jget(`${FEED}/api/reputation`, 4000).catch(() => null),
    jget(`${WATCHER}/queue`, 4000).catch(() => null),
  ])
  state.proxyUp = runs != null || board != null
  state.runs = runs
  state.board = board
  state.feedUp = reputation != null
  state.reputation = reputation?.reputation ?? reputation
  state.watcherUp = events != null
  state.events = Array.isArray(events) ? events : events?.queue ?? null
  render()
}

/* ---------- actions (all proxy endpoints, all policy-gated server-side) ---------- */

async function act(key, url, label) {
  state.busy[key] = true
  state.notice = { kind: 'busy', text: `${label}…` }
  render()
  try {
    const r = await jget(url, 120000)
    state.notice = r?.ok === false
      ? { kind: 'err', text: `${label} failed: ${String(r.error ?? 'unknown').slice(0, 120)}` }
      : { kind: 'ok', text: `${label} done${r?.runId ? ` → ${r.runId}` : ''}`, result: r }
  } catch (e) {
    state.notice = { kind: 'err', text: `${label} failed: ${String(e?.message ?? e).slice(0, 120)}` }
  }
  state.busy[key] = false
  await refresh()
}

const settle = (fixtureId) =>
  act(`settle-${fixtureId}`, `${PROXY}/api/settle?fixtureId=${fixtureId}&amount=${SETTLE_SOL}`, `Settle read for ${fixtureId}`)
const paySh = (fixtureId) =>
  act(`paysh-${fixtureId}`, `${PROXY}/api/pay-sh-edge?fixtureId=${fixtureId}&amount=${SETTLE_SOL}&upstreamUsdc=0.03`, `Pay.sh procurement for ${fixtureId}`)
const grade = () => act('grade', `${PROXY}/api/grade-runs`, 'Reality grading')

/* ---------- rendering ---------- */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const short = (v, n = 10) => { const s = String(v ?? ''); return s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s }
const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString() }

const chip = (label, up) =>
  `<span class="chip ${up == null ? 'unknown' : up ? 'up' : 'down'}">${esc(label)} ${up == null ? '·' : up ? '●' : '○'}</span>`

function receiptRow(r, runId) {
  return `<tr>
    <td>${esc(runId ?? '')}</td>
    <td><b>${esc(r.rail)}</b></td>
    <td>${esc(r.provider ?? '—')}</td>
    <td>${esc(r.amount)} ${esc(r.currency)}</td>
    <td class="${r.paid ? 'ok' : 'err'}">${r.paid ? 'paid' : `unpaid${r.reason ? ` — ${esc(r.reason)}` : ''}`}</td>
    <td>${r.simulated ? '<span class="sim-badge">simulated</span>' : '<span class="live-badge">live</span>'}</td>
    <td class="mono" title="${esc(r.proof)}">${esc(short(r.proof, 14))}</td>
    <td>${esc(fmtTime(r.issuedAt))}</td>
  </tr>`
}

function runsView() {
  const runs = state.runs
  if (!runs) return `<p class="muted">Run ledger unreachable — start the proxy: <code>npm run proxy</code> in <code>examples/txodds</code>.</p>`
  if (!runs.length) return `<p class="muted">No paid runs yet. Settle a read from the Board tab.</p>`
  const top = runs.find((r) => r.runId === state.selectedRunId) ?? runs[0]
  const outcome = top?.outcome
  return `<div class="split">
    <div class="run-list">
      ${runs.map((r) => `
        <button class="run-row ${r.runId === top.runId ? 'on' : ''}" data-run="${esc(r.runId)}">
          <span class="run-id">#${r.round}</span>
          <span class="run-main">${esc(r.want?.arg ?? 'txline read')}</span>
          ${r.proofReceipts?.length ? '<span class="rcpt-dot" title="has proof receipts">⛁</span>' : ''}
          <span class="run-status ${esc(r.status)}">${esc(r.status)}</span>
          <span class="run-time">${esc(fmtTime(r.updatedAt))}</span>
        </button>`).join('')}
    </div>
    <div class="run-detail">
      <div class="rd-top"><span class="tag">${esc(top.runId)}</span><span>${top.escrow?.amountSol ?? top.want?.budgetSol ?? SETTLE_SOL} SOL</span></div>
      <p class="rd-call">${esc(top.delivery?.data?.analysis?.call ?? 'delivery not recorded')}</p>
      <div class="rd-lines">
        <span>request <b>${esc(top.want?.arg ?? '')}</b></span>
        ${top.delivery?.sha256 ? `<span>delivery sha <b class="mono">${esc(short(top.delivery.sha256))}</b></span>` : ''}
        ${top.escrow?.reference ? `<span>escrow ref <b class="mono">${esc(short(top.escrow.reference))}</b></span>` : ''}
        ${top.verification?.verdict ? `<span>verifier <b class="${top.verification.verdict === 'pass' ? 'ok' : 'err'}">${esc(top.verification.verdict)}</b></span>` : ''}
        ${outcome ? `<span>reality <b>${outcome.status === 'graded'
          ? `${esc(outcome.actual?.winner ?? 'unknown')} — ${outcome.correct === true ? 'hit' : outcome.correct === false ? 'miss' : 'unscored'}`
          : 'pending'}</b></span>` : ''}
      </div>
      ${top.proofReceipts?.length ? `
        <table class="receipts small"><thead><tr><th></th><th>rail</th><th>provider</th><th>amount</th><th>status</th><th>mode</th><th>proof</th><th>at</th></tr></thead>
        <tbody>${top.proofReceipts.map((r) => receiptRow(r)).join('')}</tbody></table>` : ''}
      <div class="rd-txs">${(top.txs ?? []).map((tx) =>
        `<a href="${esc(tx.explorer)}" target="_blank" rel="noreferrer" data-ext>${esc(tx.kind)} ↗</a>`).join('')}</div>
    </div>
  </div>`
}

function receiptsView() {
  const rows = (state.runs ?? [])
    .flatMap((run) => (run.proofReceipts ?? []).map((r) => receiptRow(r, run.runId)))
  if (!rows.length) return `<p class="muted">No proof receipts yet — run a Pay.sh procurement from the Board tab. Each payment leg lands here and in the run folder as <code>proof_receipts.json</code>.</p>`
  return `<table class="receipts"><thead><tr><th>run</th><th>rail</th><th>provider</th><th>amount</th><th>status</th><th>mode</th><th>proof</th><th>at</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`
}

function boardView() {
  const board = state.board
  if (!board) return `<p class="muted">Live board unreachable — start the proxy: <code>npm run proxy</code> in <code>examples/txodds</code>.</p>`
  if (!board.length) return `<p class="muted">Nothing priced on the free World Cup tier right now — the board flickers; try again shortly.</p>`
  return `<div class="board">${board.slice(0, 12).map((f) => `
    <div class="fixture">
      <div class="fx-teams">${esc(f.Participant1)} <span class="muted">v</span> ${esc(f.Participant2)}</div>
      <div class="fx-actions">
        <button data-settle="${esc(String(f.FixtureId))}" ${state.busy[`settle-${f.FixtureId}`] ? 'disabled' : ''}>buy read + settle</button>
        <button class="alt" data-paysh="${esc(String(f.FixtureId))}" ${state.busy[`paysh-${f.FixtureId}`] ? 'disabled' : ''}>procure via Pay.sh + settle</button>
      </div>
    </div>`).join('')}</div>`
}

function reputationStrip() {
  const rep = state.reputation
  if (!Array.isArray(rep) || !rep.length) return ''
  return `<div class="rep-strip">${rep.slice(0, 6).map((s) =>
    `<span class="rep">${esc(s.seller ?? s.by ?? '?')} <b>${esc(String(s.score ?? '—'))}</b></span>`).join('')}</div>`
}

function render() {
  const root = document.getElementById('root')
  root.innerHTML = `
    <header>
      <div><h1>TxODDS Agent Desk</h1>
        <p class="sub">the run ledger, proof receipts, and settlement rails of the kit — one window</p></div>
      <div class="chips">${chip('proxy :8801', state.proxyUp)}${chip('feed :4000', state.feedUp)}${chip('watcher :4600', state.watcherUp)}</div>
    </header>
    <nav>
      ${['runs', 'receipts', 'board'].map((t) => `<button class="tab ${state.tab === t ? 'on' : ''}" data-tab="${t}">${t}</button>`).join('')}
      <span class="spacer"></span>
      <button class="tool" data-grade ${state.busy.grade ? 'disabled' : ''}>${state.busy.grade ? 'grading…' : 'grade reality'}</button>
      <button class="tool" data-refresh>refresh</button>
    </nav>
    ${state.notice ? `<div class="notice ${state.notice.kind}">${esc(state.notice.text)}</div>` : ''}
    ${reputationStrip()}
    <main>${state.tab === 'runs' ? runsView() : state.tab === 'receipts' ? receiptsView() : boardView()}</main>
    <footer class="muted">devnet only · actions run through the proxy's policy gate · receipts marked
      <span class="sim-badge">simulated</span> come from scaffold rails (see packages/payment-runtime)</footer>`
}

/* ---------- events (delegated once) ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tab],[data-run],[data-settle],[data-paysh],[data-grade],[data-refresh],a[data-ext]')
  if (!el) return
  if (el.dataset.tab) { state.tab = el.dataset.tab; render() }
  else if (el.dataset.run) { state.selectedRunId = el.dataset.run; render() }
  else if (el.dataset.settle) settle(el.dataset.settle)
  else if (el.dataset.paysh) paySh(el.dataset.paysh)
  else if (el.hasAttribute('data-grade')) grade()
  else if (el.hasAttribute('data-refresh')) refresh()
  else if (el.matches('a[data-ext]') && window.__TAURI__) {
    // Inside the Tauri shell new-window navigation is blocked by policy; copy the link instead.
    e.preventDefault()
    navigator.clipboard?.writeText(el.href)
    state.notice = { kind: 'ok', text: `Explorer link copied: ${short(el.href, 34)}` }
    render()
  }
})

render()
refresh()
setInterval(refresh, 12000)
