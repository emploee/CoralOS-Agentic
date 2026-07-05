import { useState } from 'react'
import { startAutonomous } from '../api'
import { useFeed } from '../hooks/useFeed'
import { Feed } from './Feed'
import { SessionHeader } from './SessionHeader'

/** The MCP primitives each step of the loop actually rides on — Coral, made literal. */
const PRIMITIVES = [
  ['coral spawns both agents', 'create-session'],
  ['buyer opens the conversation', 'create_thread'],
  ['buyer requests, @mentions the seller', 'send_message'],
  ['seller (blocked) wakes on the mention', 'wait_for_mention'],
  ['quote / payment / delivery flow back', 'send_message ↔ wait_for_mention'],
] as const

export function AutonomousTab() {
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const messages = useFeed(running)

  async function run() {
    setErr('')
    try {
      await startAutonomous()
      setRunning(true)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <section>
      <p>
        An LLM buyer agent requests a service, decides it's worth the price, pays the seller on-chain,
        and uses the result — with no human in the loop. Watch the two agents trade below.
      </p>
      <div className="mcp-strip" data-testid="mcp-strip">
        {PRIMITIVES.map(([step, tool]) => (
          <span key={tool} className="mcp-step">
            {step} <code>{tool}</code>
          </span>
        ))}
      </div>
      <button className="primary" onClick={run} disabled={running}>
        {running ? 'Running…' : 'Run the agent↔agent demo'}
      </button>
      {err && <p className="error">{err}</p>}
      {running && <SessionHeader kind="autonomous" />}
      <Feed messages={messages} />
    </section>
  )
}
