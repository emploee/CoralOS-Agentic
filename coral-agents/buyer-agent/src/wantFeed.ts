/**
 * Event-driven WANTs - the research-market trigger.
 *
 * When WANT_FEED_URL is set, the buyer stops rotating static BUYER_ARGS and instead asks the feed
 * for the next job each cycle (the watcher in examples/research queues odds-move events from the
 * live TxLINE board). A quiet market posts nothing - no event, no WANT, no spend.
 */

export interface NextWant {
  /** Defaults to the buyer's BUYER_SERVICE when the feed omits it. */
  service?: string
  arg: string
  /** Requested budget; the buyer clamps it to its own BUYER_MAX_SOL cap. */
  budgetSol?: number
  note?: string
}

/** GET the next queued WANT, or null when the queue is empty / the feed is unreachable. */
export async function fetchNextWant(url: string, doFetch: typeof fetch = fetch): Promise<NextWant | null> {
  try {
    const res = await doFetch(url)
    if (res.status === 204) return null
    if (!res.ok) return null
    const body = (await res.json()) as NextWant | null
    if (!body || typeof body.arg !== 'string' || !body.arg.trim()) return null
    return body
  } catch {
    return null // feed down -> sit the cycle out, never crash the market loop
  }
}
