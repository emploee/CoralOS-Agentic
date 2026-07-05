import { useEffect, useState } from 'react'
import { getCoral, type CoralSession } from '../api'

/**
 * The Coral facts behind a tab: which session is live, who is in it (and running), and how many
 * threads the conversation rides on. The proof that this is an MCP session, not a REST poll.
 */
export function SessionHeader({ kind }: { kind: CoralSession['kind'] }) {
  const [session, setSession] = useState<CoralSession>()

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const { sessions } = await getCoral()
        if (!stop) setSession(sessions.find((s) => s.kind === kind))
      } catch { /* bridge not up yet */ }
    }
    void tick()
    const id = setInterval(tick, 4000)
    return () => { stop = true; clearInterval(id) }
  }, [kind])

  if (!session) return null
  return (
    <div className="coral-head" data-testid="coral-head">
      <span className="coral-sid" title={session.sessionId}>coral session {session.sessionId.slice(0, 8)}</span>
      {session.agents.map((a) => (
        <span key={a.name} className="coral-agent">
          <span className={`presence ${a.status === 'running' ? 'presence-on' : 'presence-off'}`} />
          {a.name}
        </span>
      ))}
      {session.threads.length > 0 && (
        <span className="coral-threads">{session.threads.length} thread{session.threads.length === 1 ? '' : 's'}</span>
      )}
    </div>
  )
}
