import { useState } from 'react'
import { startSwarm, getSwarmFeed } from '../api'
import { useFeed } from '../hooks/useFeed'
import { SwarmFeed } from './SwarmFeed'
import { SessionHeader } from './SessionHeader'

export function SwarmTab() {
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const messages = useFeed(running, getSwarmFeed)

  async function run() {
    setErr('')
    try {
      await startSwarm()
      setRunning(true)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <section>
      <p>
        A <b>broker</b> agent shops two sellers (cheap vs premium), buys the cheaper one on-chain, then
        resells to the buyer at a markup. Money flows through a graph of agents — <b>two on-chain
        settlements</b> per request, all coordinated over CoralOS.
      </p>
      <button className="primary" onClick={run} disabled={running}>
        {running ? 'Running…' : 'Run the swarm demo'}
      </button>
      {err && <p className="error">{err}</p>}
      {running && <SessionHeader kind="swarm" />}
      <SwarmFeed messages={messages} />
    </section>
  )
}
