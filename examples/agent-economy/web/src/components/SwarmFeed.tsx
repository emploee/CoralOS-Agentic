import { type FeedMsg } from '../api'

const LABEL: Record<string, string> = {
  'buyer-agent': 'Buyer',
  broker: 'Broker',
  'seller-cheap': 'Seller · cheap',
  'seller-premium': 'Seller · premium',
}
const CLASS: Record<string, string> = {
  'buyer-agent': 'buyer',
  broker: 'broker',
  'seller-cheap': 'seller',
  'seller-premium': 'seller',
}

function shortResult(raw: string): string {
  try {
    const d = JSON.parse(raw)
    if (d.inAmount && d.outAmount) return `${d.inAmount} → ${d.outAmount}`
    if (d.usd != null) return `${d.usd} ${d.coin ?? ''}`.trim()
    if (d.completion) return String(d.completion).slice(0, 90)
    return JSON.stringify(d).slice(0, 90)
  } catch {
    return raw.slice(0, 90)
  }
}

function describe(m: FeedMsg): { verb: string; detail?: string } {
  const t = m.text.trim()
  if (/^request/i.test(t)) return { verb: 'requests a service' }
  if (/PAYMENT_REQUIRED/.test(t)) {
    const amt = t.match(/amount=([\d.]+)/)?.[1]
    const via = t.match(/via=(\S+)/)?.[1]
    return {
      verb: m.sender === 'broker' ? 'quotes the buyer' : 'quotes',
      detail: `${amt ?? '?'} SOL${via ? ` (via ${via})` : ''}`,
    }
  }
  if (/^paid/i.test(t)) {
    return { verb: 'pays on-chain', detail: t.match(/paid\s+([1-9A-HJ-NP-Za-km-z]{20,})/)?.[1]?.slice(0, 8) }
  }
  if (/DELIVERED/i.test(t)) return { verb: 'delivers', detail: shortResult(t.replace(/^[\s\S]*?DELIVERED\s*/i, '')) }
  if (/^ANALYSIS/i.test(t)) return { verb: 'summarises', detail: t.replace(/^ANALYSIS\s*/i, '').slice(0, 90) }
  if (/NO_SELLERS|UPSTREAM_FAILED|PAYMENT_NOT_VERIFIED/.test(t)) return { verb: t }
  return { verb: t.slice(0, 90) }
}

/** Label a lane by who talks on it — the broker's fan-out pattern (one private thread per seller). */
function laneLabel(msgs: FeedMsg[]): string {
  const members = [...new Set(msgs.map((m) => m.sender))]
  return members.map((s) => LABEL[s] ?? s).join(' ↔ ')
}

export function SwarmFeed({ messages }: { messages: FeedMsg[] }) {
  if (!messages.length) {
    return <p className="muted">No messages yet — the swarm takes ~30–60s (it shops two sellers and settles twice).</p>
  }

  // Group by Coral thread: the buyer↔broker thread + one PRIVATE thread per upstream seller.
  // This is the Coral capability the broker exists to demo — request/response correlation over a bus.
  const lanes = new Map<string, FeedMsg[]>()
  for (const m of messages) {
    const id = m.threadId ?? 'swarm'
    lanes.set(id, [...(lanes.get(id) ?? []), m])
  }

  const renderList = (msgs: FeedMsg[]) => (
    <ol className="feed">
      {msgs.map((m, i) => {
        const d = describe(m)
        return (
          <li key={i} className={CLASS[m.sender] ?? 'seller'}>
            <span className="who">{LABEL[m.sender] ?? m.sender}</span> {d.verb}
            {d.detail && <span className="detail"> — {d.detail}</span>}
            {m.mentions?.map((name) => <span key={name} className="mention">@{name}</span>)}
          </li>
        )
      })}
    </ol>
  )

  if (lanes.size <= 1) return renderList(messages)
  return (
    <div className="lanes" data-testid="lanes">
      {[...lanes.entries()].map(([id, msgs]) => (
        <div key={id} className="lane" data-testid="lane">
          <div className="lane-head">
            <span className="lane-label">{laneLabel(msgs)}</span>
            <span className="lane-id">thread {id.slice(0, 8)}</span>
          </div>
          {renderList(msgs)}
        </div>
      ))}
    </div>
  )
}
