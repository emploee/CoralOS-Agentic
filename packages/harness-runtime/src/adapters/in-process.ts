/**
 * in-process — the kit's original seller path as an adapter: quote with the shared bidder,
 * deliver by calling the service function the seller was constructed with (`deliverService()`,
 * the fork point) directly in this process. Zero behavior change from the pre-adapter seller;
 * every other harness is measured against this one always-works baseline.
 */
import { sha256Hex } from '@pay/agent-runtime'
import { decideBid } from '../quote.js'
import { orderRequest, type HarnessAdapter, type Delivery, type Order } from '../types.js'

/** A text-in/text-out service: takes "<service> <arg>", returns the JSON payload to deliver. */
export interface DeliverResult {
  payload: string
}

export type DeliverFn = (request: string, order?: Order) => Promise<string | DeliverResult>

export function inProcessAdapter(deliver: DeliverFn): HarnessAdapter {
  return {
    name: 'in-process',
    quote: (want, cfg) => decideBid(want, cfg),
    async run(order, onEvent): Promise<Delivery> {
      const emit = (kind: string, text?: string) =>
        onEvent?.({ ts: new Date().toISOString(), kind, ...(text ? { text } : {}) })
      emit('start', orderRequest(order))
      try {
        const result = await deliver(orderRequest(order), order)
        const payload = typeof result === 'string' ? result : result.payload
        emit('delivered')
        return { payload, sha256: sha256Hex(payload) }
      } catch (e) {
        emit('error', (e as Error).message)
        throw e
      }
    },
  }
}
