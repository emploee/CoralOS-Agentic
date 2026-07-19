const form = document.querySelector('#repo-form')
const input = document.querySelector('#repo-url')
const result = document.querySelector('#repo-result')
const market = document.querySelector('#market')
const start = document.querySelector('#start-auction')
const events = document.querySelector('#events')
const bids = document.querySelector('#bid-list')
const proofTitle = document.querySelector('#proof-title')
const proofCopy = document.querySelector('#proof-copy')
const proofStats = document.querySelector('#proof-stats')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, reducedMotion ? 10 : ms))

const bidData = [
  { name: 'reliable-patch', detail: 'TypeScript specialist · 97% success', price: '0.011', eta: '80s', score: '88.9', winner: true },
  { name: 'fast-fix', detail: 'Latency-optimized solver · 86% success', price: '0.018', eta: '45s', score: '73.9' },
  { name: 'budget-bot', detail: 'Cost-efficient generalist · 61% success', price: '0.005', eta: '150s', score: '59.6' },
]

const element = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const setButtonLabel = (label, arrow = '→') => {
  start.querySelector('span').textContent = label
  start.querySelector('b').textContent = arrow
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  result.className = 'repo-result loading'
  result.textContent = 'Inspecting repository metadata and pinning revision…'
  try {
    const response = await fetch('/api/repositories/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: input.value }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Repository connection failed')

    const icon = element('div', 'repo-result-icon', '✓')
    const copy = element('div', 'repo-result-copy')
    copy.append(element('b', '', data.repository.fullName))
    const pushed = data.repository.pushedAt ? new Date(data.repository.pushedAt).toLocaleDateString() : 'unknown date'
    copy.append(element('span', '', `${data.repository.primaryLanguage || 'Unknown'} · ${data.repository.defaultBranch}@${data.repository.baseCommitSha.slice(0, 7)} · pushed ${pushed}`))
    const access = element('span', 'access-chip', data.access === 'configured' ? 'PRIVATE ACCESS' : 'PUBLIC READ-ONLY')
    const link = element('a', '', 'Open repository ↗')
    link.href = data.repository.htmlUrl
    link.target = '_blank'
    link.rel = 'noreferrer'
    result.replaceChildren(icon, copy, access, link)
    result.className = 'repo-result success'
    market.classList.remove('hidden')
    market.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  } catch (error) {
    result.className = 'repo-result error'
    result.textContent = error instanceof Error ? error.message : 'Repository connection failed'
  }
})
const addEvent = (name, detail, state = 'done') => {
  const row = element('div', `event ${state}`)
  row.append(element('span', 'event-index', String(events.children.length + 1).padStart(2, '0')))
  row.append(element('b', '', name))
  row.append(element('span', '', detail))
  events.append(row)
}

const createBid = (bid) => {
  const row = element('div', `bid${bid.winner ? ' winner' : ''}`)
  const agent = element('div', 'agent')
  const initials = bid.name.split('-').map((part) => part[0]).join('').toUpperCase()
  const agentCopy = element('div', 'agent-copy')
  agentCopy.append(element('b', '', bid.name), element('span', '', bid.detail))
  agent.append(element('span', 'agent-avatar', initials), agentCopy)
  const metric = (value, label, extra = '') => {
    const node = element('div', `bid-metric ${extra}`.trim())
    node.append(element('b', '', value), element('span', '', label))
    return node
  }
  row.append(agent, metric(`${bid.price} SOL`, 'Price'), metric(bid.eta, 'ETA'), metric(bid.score, 'Value score', 'value'))
  if (bid.winner) row.append(element('em', 'award', 'AWARDED'))
  return row
}

const resetProof = () => {
  proofTitle.textContent = 'Verification in progress'
  proofCopy.textContent = 'The independent verifier will reproduce the task and execute only the allowlisted tests.'
  proofStats.replaceChildren()
  for (const [label, value] of [['Tests', 'RUNNING'], ['Escrow', 'READY'], ['Settlement', 'GATED']]) {
    const stat = element('div')
    stat.append(element('span', '', label), element('b', '', value))
    proofStats.append(stat)
  }
}

start.addEventListener('click', async () => {
  start.disabled = true
  setButtonLabel('Agents working', '···')
  events.replaceChildren()
  bids.replaceChildren()
  resetProof()

  addEvent('WANT', 'Budget 0.020 SOL · deadline 180 seconds')
  await sleep(420)
  for (const bid of bidData) {
    bids.append(createBid(bid))
    addEvent('BID', `${bid.name} · ${bid.price} SOL`)
    await sleep(300)
  }
  addEvent('AWARD', 'reliable-patch · best value at 88.9')
  await sleep(420)
  addEvent('ESCROW', 'Policy signer ready for devnet deposit', 'pending')
  await sleep(420)
  addEvent('DELIVERED', 'Patch artifact bound by SHA-256')
  await sleep(420)
  addEvent('VERIFIED', '3 passed · 0 failed · deterministic')

  proofTitle.textContent = '3 of 3 tests passed'
  proofCopy.textContent = 'The patch passed isolated verification. A funded CoralOS round can now release escrow with public Explorer evidence.'
  proofStats.replaceChildren()
  for (const [label, value] of [['Tests', '3 / 3'], ['Escrow', 'READY'], ['Devnet', 'PROVABLE']]) {
    const stat = element('div')
    stat.append(element('span', '', label), element('b', '', value))
    proofStats.append(stat)
  }
  setButtonLabel('Replay auction')
  start.disabled = false
})

fetch('/api/health')
  .then((response) => response.ok ? response.json() : Promise.reject(new Error('offline')))
  .then(() => { document.querySelector('#health-status').lastChild.textContent = ' Solana Devnet' })
  .catch(() => { document.querySelector('#health-status').lastChild.textContent = ' Service unavailable' })
