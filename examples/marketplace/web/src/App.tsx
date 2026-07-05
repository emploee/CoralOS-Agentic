import { useState } from 'react'
import { useFeed, useBus, useRuns, useReputation, useEvents, startMarket } from './api'
import { MarketView } from './components/MarketView'
import { CoralView } from './components/CoralView'
import { RunsView } from './components/RunsView'
import { ReputationPanel } from './components/ReputationPanel'
import { EventsStrip } from './components/EventsStrip'
import { Explainer } from './components/Explainer'

/** Read ?session=<id> from the URL so the launcher can deep-link straight to a live market. */
const initialSession = new URLSearchParams(window.location.search).get('session') ?? ''

type Tab = 'market' | 'coral' | 'runs'

export default function App() {
  const [session, setSession] = useState(initialSession)
  const [tab, setTab] = useState<Tab>('market')
  const [starting, setStarting] = useState(false)
  const [startErr, setStartErr] = useState<string>()
  const { rounds, connected, source, error } = useFeed(session)
  const { bus } = useBus(tab === 'coral' ? session : '')
  const { runs } = useRuns(tab === 'runs' ? 3000 : 30_000)
  const { reputation } = useReputation()
  const { events } = useEvents()

  async function onStart() {
    setStarting(true)
    setStartErr(undefined)
    try {
      const id = await startMarket()
      setSession(id)
      const url = new URL(window.location.href)
      url.searchParams.set('session', id)
      window.history.replaceState({}, '', url)
    } catch (e) {
      setStartErr((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="app">
      <header className="app-head">
        <h1>The Agent Marketplace</h1>
        <span className="sub">LLM agents compete on CoralOS · settled by Solana escrow</span>
        <span className={`dot ${connected ? 'dot-on' : 'dot-off'}`} data-testid="conn" title={connected ? 'connected' : (error ?? 'disconnected')} />
      </header>

      <div className="session-bar">
        <input
          aria-label="session id"
          placeholder="paste a market session id…"
          value={session}
          onChange={(e) => setSession(e.target.value.trim())}
        />
        <button onClick={onStart} disabled={starting} data-testid="start">
          {starting ? 'starting…' : 'Start a market'}
        </button>
      </div>
      {startErr && <p className="start-err" data-testid="start-err">{startErr}</p>}

      {source === 'ledger' && (
        <p className="replay-banner" data-testid="replay-banner">
          replaying from the <strong>run ledger</strong> — coral-server offline, every round below is served from disk
        </p>
      )}

      <nav className="tabs" data-testid="tabs">
        {(['market', 'coral', 'runs'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'tab-on' : ''}`} data-testid={`tab-${t}`} onClick={() => setTab(t)}>
            {t === 'market' ? 'Market' : t === 'coral' ? 'Coral bus' : 'Runs'}
          </button>
        ))}
      </nav>

      {tab === 'market' && <Explainer />}

      <main>
        {tab === 'market' && (
          session ? (
            <>
              <EventsStrip events={events} />
              <ReputationPanel reputation={reputation} />
              <MarketView rounds={rounds} />
            </>
          ) : (
            <p className="empty">Fund your wallets, then <strong>Start a market</strong> — agents will bid and settle live.</p>
          )
        )}
        {tab === 'coral' && (
          session ? <CoralView bus={bus} /> : <p className="empty">Paste a session id to watch the bus.</p>
        )}
        {tab === 'runs' && <RunsView runs={runs} />}
      </main>
    </div>
  )
}
