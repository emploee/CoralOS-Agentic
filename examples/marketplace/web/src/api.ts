import { useEffect, useRef, useState } from 'react'
import type { Bus, Feed, RunRecord, SellerReputation, WatcherEvent } from './types'

const FEED_URL = import.meta.env.VITE_FEED_URL ?? 'http://localhost:4000'

/** Ask the feed server to launch a market session; returns its id. (Fund wallets first.) */
export async function startMarket(): Promise<string> {
  const r = await fetch(`${FEED_URL}/api/start`, { method: 'POST' })
  const body = (await r.json()) as { session?: string; error?: string }
  if (!r.ok || !body.session) throw new Error(body.error ?? `start failed (${r.status})`)
  return body.session
}

/** Poll a feed endpoint into state. Plain hooks (no extra deps) — swap for TanStack Query when you outgrow polling. */
function usePoll<T>(url: string | null, intervalMs: number): { data?: T; error?: string } {
  const [state, setState] = useState<{ data?: T; error?: string }>({})
  const stop = useRef(false)
  useEffect(() => {
    stop.current = false
    if (!url) { setState({}); return }
    const tick = async () => {
      try {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`${r.status}`)
        const data = (await r.json()) as T
        if (!stop.current) setState({ data })
      } catch (e) {
        if (!stop.current) setState((s) => ({ ...s, error: (e as Error).message }))
      }
    }
    void tick()
    const id = setInterval(tick, intervalMs)
    return () => { stop.current = true; clearInterval(id) }
  }, [url, intervalMs])
  return state
}

export interface FeedState {
  rounds: Feed['rounds']
  connected: boolean
  /** 'ledger' when the feed is replaying persisted runs because coral-server is unreachable. */
  source?: 'live' | 'ledger'
  error?: string
}

/** Poll the feed server for a session's rounds. */
export function useFeed(session: string, intervalMs = 1000): FeedState {
  const { data, error } = usePoll<Feed>(
    session ? `${FEED_URL}/api/feed?session=${encodeURIComponent(session)}` : null,
    intervalMs,
  )
  if (!session) return { rounds: [], connected: false, error: 'no session' }
  if (!data) return { rounds: [], connected: false, ...(error ? { error } : {}) }
  return { rounds: data.rounds ?? [], connected: !error, ...(data.source ? { source: data.source } : {}) }
}

/** The Coral bus view: threads + mentions + the agent roster. */
export function useBus(session: string, intervalMs = 2000): { bus?: Bus; error?: string } {
  const { data, error } = usePoll<Bus>(
    session ? `${FEED_URL}/api/threads?session=${encodeURIComponent(session)}` : null,
    intervalMs,
  )
  return { ...(data ? { bus: data } : {}), ...(error ? { error } : {}) }
}

/** Every persisted run across sessions (the ledger). */
export function useRuns(intervalMs = 3000): { runs: RunRecord[]; error?: string } {
  const { data, error } = usePoll<{ runs: RunRecord[] }>(`${FEED_URL}/api/runs`, intervalMs)
  return { runs: data?.runs ?? [], ...(error ? { error } : {}) }
}

/** Per-seller track record derived from the run ledger. */
export function useReputation(intervalMs = 5000): { reputation: SellerReputation[] } {
  const { data } = usePoll<{ reputation: SellerReputation[] }>(`${FEED_URL}/api/reputation`, intervalMs)
  return { reputation: data?.reputation ?? [] }
}

/** The research watcher's queued events (empty when the watcher is down or the board is quiet). */
export function useEvents(intervalMs = 5000): { events: WatcherEvent[] } {
  const { data } = usePoll<{ queue: WatcherEvent[] }>(`${FEED_URL}/api/events`, intervalMs)
  return { events: data?.queue ?? [] }
}
