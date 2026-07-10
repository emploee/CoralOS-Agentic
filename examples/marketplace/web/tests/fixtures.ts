import type { Round } from '../src/types'

/** A settled round — premium wins on value over cheap; lazy declined. Shapes match a real devnet run. */
export const settledRound: Round = {
  round: 1,
  want: { service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 },
  bids: [
    { by: 'seller-premium', priceSol: 0.0005, note: 'verified' },
    { by: 'seller-cheap', priceSol: 0.0002, note: 'undercut' },
  ],
  declined: ['seller-lazy'],
  award: { to: 'seller-premium', reason: 'verified data worth the premium for this lookup' },
  escrow: { reference: 'DKQy', seller: '7jwB', amountSol: 0.0005, deadlineSecs: 600 },
  deposit: { sig: '5syzoWto3RjRYfLMCAkJ', buyer: '47Dp' },
  delivered: { raw: '{"coin":"solana","usd":72.33}', data: { coin: 'solana', usd: 72.33 } },
  release: { sig: '3PMa9LBZn7VEMD1qZnmr' },
  status: 'settled',
}

/** A round still collecting bids. */
export const biddingRound: Round = {
  round: 2,
  want: { service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 },
  bids: [{ by: 'seller-cheap', priceSol: 0.0002 }],
  declined: [],
  status: 'bidding',
}

/** A verifier-gated freelancer round that SETTLED — heterogeneous harnesses, verified pass. */
export const verifiedRound: Round = {
  round: 3,
  want: { service: 'freelance', arg: 'landing-page-hero-copy', budgetSol: 0.001 },
  bids: [
    { by: 'seller-scribe', priceSol: 0.0002, note: 'fast, one pass' },
    { by: 'seller-claude', priceSol: 0.0008, note: 'tested, multi-step' },
  ],
  declined: [],
  award: { to: 'seller-scribe', reason: 'the brief fits a single pass' },
  escrow: { reference: 'Ref3', seller: '7jwB', amountSol: 0.0002, deadlineSecs: 600 },
  deposit: { sig: 'depSig3', buyer: '47Dp' },
  delivered: { raw: '{"service":"freelance","result":{"deliverable":"Ship faster"}}' },
  verification: { verdict: 'pass', by: 'verifier-agent', reason: 'hash + structure verified' },
  llm: [
    {
      round: 3, agent: 'seller-scribe', purpose: 'seller_delivery', status: 'used',
      provider: 'venice', model: 'llama-3.3-70b', usedFor: 'seller_delivery_summary',
      inputHash: 'a1b2c3d4e5', outputHash: 'f6a7b8c9d0', affectedFunds: false,
      reason: 'model produced freelance deliverable', guardrail: 'verifier checks JSON and order fit before release',
    },
    {
      round: 3, agent: 'verifier-agent', purpose: 'verifier_judgment', status: 'skipped',
      usedFor: 'verifier_judgment', affectedFunds: false,
      reason: 'txline fixture matched deterministic verifier', guardrail: 'content hash and JSON structure checks run before model judgment',
    },
  ],
  proofReceipts: [{
    rail: 'pay-sh',
    provider: 'pay.sh/txodds-context',
    service: 'freelance-upstream',
    reference: 'pay-3',
    proof: 'pay-sh-demo:abc123',
    amount: '0.03',
    currency: 'USDC',
    paid: true,
    simulated: true,
    issuedAt: '2026-07-06T00:00:00.000Z',
  }],
  release: { sig: 'relSig3' },
  status: 'settled',
}

/** The no-pay path: delivery failed verification → release REFUSED, funds stay refundable. */
export const refusedRound: Round = {
  round: 4,
  want: { service: 'freelance', arg: 'pricing-table-microcopy', budgetSol: 0.001 },
  bids: [{ by: 'seller-scribe', priceSol: 0.0002 }],
  declined: [],
  award: { to: 'seller-scribe' },
  escrow: { reference: 'Ref4', seller: '7jwB', amountSol: 0.0002, deadlineSecs: 600 },
  deposit: { sig: 'depSig4', buyer: '47Dp' },
  delivered: { raw: '{"service":"freelance","error":"llm unavailable"}' },
  verification: { verdict: 'fail', by: 'verifier-agent', reason: 'payload reports error' },
  status: 'delivered',
}

export const fixtureRounds: Round[] = [settledRound, biddingRound]
