/**
 * node-llm — the kit's original seller path as an adapter: quote with the shared LLM bidder,
 * deliver by calling the service function the seller was constructed with (`deliverService()`,
 * the fork point). Zero behavior change from the pre-adapter seller; every other harness is
 * measured against this one always-works baseline.
 */
import { sha256Hex } from '@pay/agent-runtime'
import { decideBid } from '../quote.js'
import { orderRequest, type HarnessAdapter, type Delivery } from '../types.js'

/** A text-in/text-out service: takes "<service> <arg>", returns the JSON payload to deliver. */
export type DeliverFn = (request: string) => Promise<string>

export function nodeLlmAdapter(deliver: DeliverFn): HarnessAdapter {
  return {
    name: 'node-llm',
    quote: (want, cfg) => decideBid(want, cfg),
    async run(order, onEvent): Promise<Delivery> {
      const emit = (kind: string, text?: string) =>
        onEvent?.({ ts: new Date().toISOString(), kind, ...(text ? { text } : {}) })
      emit('start', orderRequest(order))
      try {
        const payload = await deliver(orderRequest(order))
        emit('delivered')
        return { payload, sha256: sha256Hex(payload) }
      } catch (e) {
        emit('error', (e as Error).message)
        throw e
      }
    },
  }
}
