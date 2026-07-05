import type { Bus, BusMessage } from '../types'

/**
 * The bus view — the Coral mechanics the market rides on, made visible: the agent roster with
 * presence, and each thread's messages with sender, @mentions, and the market verb. This is the
 * tab that shows the coordination IS Coral (threads + mentions over MCP), not a REST poll.
 */

const VERBS = ['WANT', 'BID', 'AWARD', 'ESCROW_REQUIRED', 'DEPOSITED', 'DELIVERED', 'VERIFY', 'VERIFIED', 'RELEASED', 'ARBITER_RELEASED', 'REFUNDED', 'ERROR']

const verbOf = (text: string): string | undefined => {
  const first = text.trim().split(/\s+/)[0]?.toUpperCase()
  return VERBS.includes(first ?? '') ? first : undefined
}

/** Stable hue per agent name so senders are visually distinct without config. */
const hueOf = (name: string): number => {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

function Message({ m }: { m: BusMessage }) {
  const verb = verbOf(m.text)
  return (
    <div className="bus-msg" data-testid="bus-msg">
      <span className="bus-sender" style={{ color: `hsl(${hueOf(m.sender)} 70% 65%)` }}>{m.sender}</span>
      {verb && <span className={`bus-verb bus-verb-${verb.toLowerCase()}`}>{verb}</span>}
      {(m.mentions ?? []).map((name) => (
        <span key={name} className="bus-mention" data-testid="mention">@{name}</span>
      ))}
      {m.timestamp && <span className="bus-ts">{m.timestamp.slice(11, 19)}</span>}
      <div className="bus-text">{m.text}</div>
    </div>
  )
}

export function CoralView({ bus }: { bus?: Bus }) {
  if (!bus || bus.threads.length === 0) {
    return <p className="empty" data-testid="bus-empty">No threads yet — the buyer opens the market thread when sellers are online.</p>
  }
  return (
    <div className="bus" data-testid="bus">
      {bus.agents.length > 0 && (
        <div className="bus-roster" data-testid="roster">
          <span className="bus-roster-label">agents in session:</span>
          {bus.agents.map((a) => (
            <span key={a.name} className="bus-agent" data-status={a.status ?? 'unknown'}>
              <span className={`dot ${a.status === 'running' ? 'dot-on' : 'dot-off'}`} /> {a.name}
            </span>
          ))}
        </div>
      )}
      {bus.threads.map((t) => (
        <section key={t.id} className="bus-thread" data-testid="thread">
          <header className="bus-thread-head">
            <strong>{t.name ?? 'thread'}</strong>
            <span className="bus-thread-id">{t.id.slice(0, 8)}</span>
            <span className="bus-participants">{t.participants.join(' · ')}</span>
          </header>
          {t.messages.map((m, i) => <Message key={i} m={m} />)}
        </section>
      ))}
      <p className="bus-hint">
        Every line above is a Coral MCP message on a shared thread — agents block in{' '}
        <code>wait_for_mention</code> and wake when @mentioned. Money moves off-bus, on Solana.
      </p>
    </div>
  )
}
