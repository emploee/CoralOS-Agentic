/**
 * The TxODDS Pay.sh procurement demo — a thin wrapper over the payment-runtime's generic
 * `procureUpstream`: the seller buys upstream fixture context through the Pay.sh rail before
 * delivering, and the proof receipt (simulated while the rail is a scaffold) lands in the run
 * ledger + the Oracle UI.
 */
import { procureUpstream, type UpstreamProcurement } from '../../../packages/payment-runtime/src/procure.js'

export type PayShProcurement = UpstreamProcurement

export interface PayShProcurementInput {
  orderId: string
  round: number
  fixtureId: string
  buyer: string
  seller: string
  amount: string
  currency?: 'USDC'
  provider?: string
}

export async function procureTxOddsContext(input: PayShProcurementInput): Promise<PayShProcurement> {
  const provider = input.provider ?? input.seller ?? 'pay.sh/txodds-context'
  return procureUpstream({
    orderId: input.orderId,
    round: input.round,
    buyer: input.buyer,
    provider,
    service: 'txline-edge-upstream',
    amount: input.amount,
    currency: input.currency ?? 'USDC',
    url: `https://pay.sh/api/quicknode/rpc?fixtureId=${encodeURIComponent(input.fixtureId)}`,
  })
}
