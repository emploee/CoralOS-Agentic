// Typed client for the bridge endpoints. The browser only ever talks to the bridge —
// never directly to CoralOS or Solana RPC (except the wallet-adapter's read connection).

const json = (r: Response) =>
  r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(new Error(e.error || r.statusText)))

export interface Order {
  reference: string
  amountSol: string
  solanaPayUrl: string
  recipient: string
}
export interface Delivered {
  status: string
  sig: string
  data: string
}
export interface FeedMsg {
  sender: string // buyer-agent | seller-agent | broker | seller-cheap | seller-premium
  text: string
  /** The Coral thread this message rode on (the swarm draws one lane per thread). */
  threadId?: string
  /** Who was @mentioned — the wake-up signal for agents blocked in wait_for_mention. */
  mentions?: string[]
}

export interface CoralSession {
  kind: 'checkout' | 'autonomous' | 'swarm'
  sessionId: string
  agents: Array<{ name: string; status?: string }>
  threads: Array<{ id: string; name?: string; participants: string[]; messages: number }>
}

const POST = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(json)

export const startOrder = (service: string, prompt?: string): Promise<Order> =>
  POST('/order', { service, prompt })

export const submitPaid = (reference: string, sig: string): Promise<Delivered> =>
  POST(`/order/${reference}/paid`, { sig })

export const startAutonomous = (): Promise<{ sessionId: string }> => POST('/autonomous/start')

export const getFeed = (): Promise<{ running: boolean; messages: FeedMsg[] }> =>
  fetch('/autonomous/feed').then(json)

export const startSwarm = (): Promise<{ sessionId: string }> => POST('/swarm/start')

export const getSwarmFeed = (): Promise<{ running: boolean; messages: FeedMsg[] }> =>
  fetch('/swarm/feed').then(json)

export const getCoral = (): Promise<{ sessions: CoralSession[] }> => fetch('/coral').then(json)
