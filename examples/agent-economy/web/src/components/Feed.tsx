import { type FeedMsg } from '../api'

/** Turn the seller's delivered payload into something human-readable. */
function renderResult(raw: string): string {
  try {
    const d = JSON.parse(raw)
    if (d.inAmount && d.outAmount) return `${d.inAmount} → ${d.outAmount}`
    if (d.usd != null) return `${d.usd} ${d.coin ?? ''}`.trim()
    if (d.completion) return String(d.completion)
    return JSON.stringify(d)
  } catch {
    return raw
  }
}

/** Map a raw agent message to a plain "who did what" line. */
function describe(m: FeedMsg): { who: string; verb: string; detail?: string } {
  const who = m.sender === 'buyer-agent' ? 'Buyer' : 'Seller'
  const t = m.text.trim()
  if (/^request/i.test(t)) return { who, verb: 'Requests a service' }
  if (/PAYMENT_REQUIRED/.test(t)) {
    const amt = t.match(/amount=([\d.]+)/)?.[1]
    return { who, verb: 'Asks for payment', detail: amt ? `${amt} SOL` : undefined }
  }
  if (/^paid/i.test(t)) {
    const sig = t.match(/paid\s+([1-9A-HJ-NP-Za-km-z]{20,})/)?.[1]
    return { who, verb: 'Paid on-chain', detail: sig ? `${sig.slice(0, 8)}…` : undefined }
  }
  if (/DELIVERED/.test(t)) {
    return { who, verb: 'Delivered the result', detail: renderResult(t.replace(/^[\s\S]*DELIVERED\s+/, '')) }
  }
  return { who, verb: t.slice(0, 100) }
}

export function Feed({ messages }: { messages: FeedMsg[] }) {
  if (!messages.length) {
    return <p className="muted">No messages yet — give the agents ~20s on first run.</p>
  }
  return (
    <ol className="feed">
      {messages.map((m, i) => {
        const d = describe(m)
        return (
          <li key={i} className={m.sender === 'buyer-agent' ? 'buyer' : 'seller'}>
            <span className="who">{d.who}</span> {d.verb}
            {d.detail && <span className="detail"> — {d.detail}</span>}
          </li>
        )
      })}
    </ol>
  )
}
