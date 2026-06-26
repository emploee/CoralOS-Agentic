import { useState } from 'react'
import { startAutonomous } from '../api'
import { useFeed } from '../hooks/useFeed'
import { Feed } from './Feed'

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
      <button className="primary" onClick={run} disabled={running}>
        {running ? 'Running…' : 'Run the agent↔agent demo'}
      </button>
      {err && <p className="error">{err}</p>}
      <Feed messages={messages} />
    </section>
  )
}
