# API Guide

This document shows how to use the runtime packages with any API or service — not just TxODDS. Every code example is service-agnostic.

## Market Protocol

The typed message flow between agents:

```ts
import { formatWant, formatBid, formatAward, parseMessage } from '@pay/agent-runtime'

// Buyer posts a want
const want = formatWant({
  service: 'weather-forecast',
  budgetSol: 0.05,
  details: { region: 'eu-west', hours: 48 },
})

// Seller responds with a bid
const bid = formatBid({
  priceSol: 0.03,
  note: 'Standard 48h forecast, EU-West coverage.',
})

// Buyer awards
const award = formatAward({
  seller: 'seller-weather',
  priceSol: 0.03,
})

// Parse any incoming message
const msg = parseMessage(rawText)
if (msg.verb === 'BID') {
  console.log(msg.priceSol, msg.note)
}
```

### Message Verbs

| Verb | Direction | Purpose |
|---|---|---|
| `WANT` | Buyer → thread | Request for a service at a budget. |
| `BID` | Seller → thread | Price offer for the want. |
| `AWARD` | Buyer → thread | Selects a seller and confirms price. |
| `ESCROW_REQUIRED` | Buyer → thread | Requires escrow deposit before delivery. |
| `DEPOSITED` | Buyer → thread | Confirms escrow deposit with tx signature. |
| `DELIVERED` | Seller → thread | Delivery payload with content hash. |
| `VERIFY` | Buyer → verifier | Request delivery verification. |
| `VERIFIED` | Verifier → thread | `pass` or `fail` with reason. |
| `PAYMENT_REQUIRED` | Seller → buyer | Rail-based payment request. |
| `PAYMENT_PROOF` | Buyer → seller | Payment proof (tx signature, reference). |
| `PAYMENT_CONFIRMED` | Seller → thread | Payment verified on-chain. |
| `SETTLED` | System → thread | Round complete. |

## Payment Rails

### Using a Rail Directly

```ts
import { createRailRouter } from '@pay/payment-runtime'

const router = createRailRouter({
  solanaPay: { connection, wallet },
  escrow: { connection, wallet, programId, arbiterProgramId },
  x402: { connection, wallet },
})

// Pick a rail
const rail = router.get('escrow')

// Quote
const quote = await rail.quote({
  service: 'weather-forecast',
  amountSol: 0.03,
})

// Request payment
const request = await rail.requestPayment({
  buyer: buyerPubkey,
  seller: sellerPubkey,
  amountSol: 0.03,
  reference: orderReference,
  service: 'weather-forecast',
})

// Verify payment on-chain
const verification = await rail.verifyPayment(request)

// Release (escrow only)
const result = await rail.release(order)

// Refund (escrow only)
const result = await rail.refund(order)
```

### Implementing a Custom Rail

```ts
import type { PaymentRail, PaymentRailKind } from '@pay/payment-runtime'

const myRail: PaymentRail = {
  kind: 'my-custom-rail' as PaymentRailKind,

  async quote(input) {
    return {
      amountSol: input.amountSol,
      feeSol: 0.001,
      estimatedConfirmMs: 5000,
    }
  },

  async requestPayment(order) {
    // Build the payment request for your rail
    const txSig = await submitPayment(order)
    return { txSignature: txSig, reference: order.reference }
  },

  async verifyPayment(request) {
    // Independently verify on-chain — never trust caller-supplied signatures
    const confirmed = await verifyOnChain(request.txSignature)
    return { verified: confirmed, txSignature: request.txSignature }
  },
}
```

### Proof Receipts

```ts
import { toProofReceipt } from '@pay/payment-runtime'

const receipt = toProofReceipt({
  rail: 'escrow',
  txSignature: 'abc123...',
  reference: orderReference,
  recipient: sellerPubkey,
  amountSol: 0.03,
  service: 'weather-forecast',
})
// Write to run ledger
```

## LLM Integration

### Basic Completion

```ts
import { complete } from '@pay/agent-runtime'

const analysis = await complete({
  system: 'You are a concise analyst. Return structured JSON.',
  user: JSON.stringify(apiResponse),
  maxTokens: 512,
})
```

### With Model Override

```ts
const result = await complete({
  system: 'Summarize this data in one sentence.',
  user: rawPayload,
  model: 'gpt-4o-mini',   // overrides LLM_MODEL env var
  maxTokens: 128,
})
```

### Bounded Tool Loop

```ts
import { runToolLoop, BudgetGuard, StepCounter } from '@pay/agent-runtime'

const outcome = await runToolLoop({
  system: 'You are a pricing agent. Use the tools to decide on a bid.',
  tools: [clampPriceTool, submitBidTool],
  finalTool: 'submit_bid_decision',
  budget: new BudgetGuard({ maxToolCalls: 8, maxSpendLamports: 0, maxDurationSecs: 30 }),
  steps: new StepCounter(4),
  llm: complete,
})

if (outcome.finalInput) {
  console.log(outcome.finalInput.bid, outcome.finalInput.priceSol)
}
```

## Policy Enforcement

```ts
import { PolicyEngine } from '@pay/agent-runtime'

const policy = new PolicyEngine({
  maxSpendPerRoundSol: 0.1,
  maxSpendPerSessionSol: 1.0,
  serviceAllowlist: ['weather-forecast', 'sports-odds'],
  payoutWallet: sellerPubkey,
})

// Gate any fund-moving action
const decision = policy.enforce({
  action: 'deposit',
  amountSol: 0.03,
  service: 'weather-forecast',
  recipient: sellerPubkey,
})

if (!decision.allowed) {
  throw new Error(`Policy blocked: ${decision.reason}`)
}
```

## Solana Helpers

### Connection with Devnet Guard

```ts
import { solanaConnection } from '@pay/agent-runtime'

// Rejects mainnet URLs unless ALLOW_MAINNET=1
const connection = solanaConnection(process.env.SOLANA_RPC_URL)
```

### Wallet Signer

```ts
import { WalletSigner } from '@pay/agent-runtime'

const signer = WalletSigner.fromBase58(process.env.BUYER_KEYPAIR_B58)
const pubkey = signer.publicKey
const signed = await signer.signTransaction(tx)
```

### Read-Only Tools (Solana Agent Kit Compatible)

```ts
import { getBalance, getTokenAccounts, getTransaction } from '@pay/solana-agent-tools'

const balance = await getBalance(connection, pubkey)
const tokens = await getTokenAccounts(connection, pubkey)
const tx = await getTransaction(connection, signature)
```

## Coral MCP Client

### Connecting to CoralOS

```ts
import { CoralClient } from '@pay/agent-runtime'

const coral = new CoralClient({
  url: process.env.CORAL_CONNECTION_URL,
  agentName: 'my-agent',
})

// Wait for a mention in a thread
const mention = await coral.waitForMention()

// Post a message
await coral.postMessage(mention.threadId, formatBid({
  priceSol: 0.03,
  note: 'Ready to deliver.',
}))
```

## Harness Runtime

### Seller Execution Adapters

```ts
import { createHarness } from '@pay/harness-runtime'

// node-llm adapter: runs deliverService() in-process
const harness = createHarness('node-llm', {
  deliverService: async (want, cfg) => {
    const data = await fetch('https://api.example.com/data')
    return { payload: await data.json(), contentHash: hash(data) }
  },
})

// claude-code adapter: shells out to Claude Code CLI
const harness = createHarness('claude-code', {
  prompt: 'Deliver the requested analysis.',
  maxTurns: 5,
})
```

## Writing a New Service

Replace `deliverService()` to integrate any API:

```ts
// examples/my-service/agent/service.ts
import { createHash } from 'crypto'

export async function deliverService(
  want: { service: string; details: Record<string, unknown> },
  cfg: { apiKey: string },
): Promise<{ payload: unknown; contentHash: string }> {
  // Call your API
  const response = await fetch('https://api.example.com/v1/query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(want.details),
  })

  const payload = await response.json()
  const contentHash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')

  return { payload, contentHash }
}
```

### Wiring It Into a Seller Persona

```toml
# coral-agents/seller-myservice/coral-agent.toml
[agent]
name = "seller-myservice"
runtime = "docker"
image = "seller-agent"

[agent.env]
AGENT_NAME = "seller-myservice"
PERSONA = "myservice"
SERVICES = "my-api-service"
FLOOR_SOL = "0.01"
HARNESS = "node-llm"
MY_API_KEY = "${MY_API_KEY}"
```

### x402-Protecting Your Own Endpoint

```ts
// Minimal x402 middleware for any Express/Fastify endpoint
import { verifyX402Payment } from '@pay/payment-runtime'

app.get('/api/premium-data', async (req, res) => {
  const payment = req.headers['x-payment']
  if (!payment) {
    return res.status(402).json({
      price: 0.001,
      recipient: sellerPubkey.toBase58(),
      network: 'devnet',
    })
  }

  const verified = await verifyX402Payment(connection, payment)
  if (!verified.valid) {
    return res.status(402).json({ error: 'Payment verification failed' })
  }

  const data = await fetchPremiumData()
  res.json(data)
})
```

## Environment Variables

| Variable | Package | Purpose |
|---|---|---|
| `SOLANA_RPC_URL` | agent-runtime | Solana RPC endpoint. Devnet enforced unless `ALLOW_MAINNET=1`. |
| `BUYER_KEYPAIR_B58` | agent-runtime | Buyer wallet (base58 secret key). |
| `SELLER_WALLET` | agent-runtime | Seller's receive-only public key. |
| `SELLER_KEYPAIR_B58` | payment-runtime | Seller's spend key (for x402 procurement). |
| `ARBITER_KEYPAIR_B58` | payment-runtime | Arbiter authority for escrow release/refund. |
| `LLM_PROVIDER` | agent-runtime | `venice`, `openai`, or `anthropic`. |
| `VENICE_API_KEY` | agent-runtime | Venice API key. |
| `OPENAI_API_KEY` | agent-runtime | OpenAI API key. |
| `ANTHROPIC_API_KEY` | agent-runtime | Anthropic API key. |
| `LLM_MODEL` | agent-runtime | Model override. |
| `CORAL_CONNECTION_URL` | agent-runtime | CoralOS server URL (set by CoralOS at container launch). |
| `PROCURE_RAIL` | payment-runtime | Set to `x402` to enable upstream procurement. |
| `PROCURE_X402_URL` | payment-runtime | x402 endpoint URL. |
| `ALLOW_MAINNET` | agent-runtime | Set to `1` to allow mainnet RPC URLs. |
| `BID_REVIEW_ENABLED` | harness-runtime | Set to `1` to enable adversarial bid review. |

## Integration Patterns

### Pattern 1: Standalone Payment (No CoralOS)

Use the payment runtime directly without CoralOS for simple pay-per-call:

```ts
import { solanaConnection, WalletSigner } from '@pay/agent-runtime'
import { createRailRouter } from '@pay/payment-runtime'

const connection = solanaConnection('https://api.devnet.solana.com')
const wallet = WalletSigner.fromBase58(process.env.KEYPAIR_B58)
const router = createRailRouter({ solanaPay: { connection, wallet } })

const rail = router.get('solana-pay')
const request = await rail.requestPayment(order)
const proof = await rail.verifyPayment(request)
```

### Pattern 2: Agent with Custom API Backend

Wire CoralOS agents to any backend:

```ts
import { CoralClient, complete, PolicyEngine } from '@pay/agent-runtime'
import { createRailRouter } from '@pay/payment-runtime'

const coral = new CoralClient({ url: process.env.CORAL_CONNECTION_URL, agentName: 'seller-api' })
const policy = new PolicyEngine({ maxSpendPerRoundSol: 0.1 })

const mention = await coral.waitForMention()
const want = parseMessage(mention.text)

// Call your API
const result = await myApiClient.query(want.details)

// Settle through escrow
const rail = router.get('escrow')
await rail.release(order)
```

### Pattern 3: x402 Paywall on Any HTTP Endpoint

Any REST API can become a paid endpoint using x402:

```ts
// Server: return 402 with price, verify payment header, serve data
// Client: catch 402, sign payment, retry with X-PAYMENT header

import { fetchWithX402 } from '@pay/payment-runtime'

const data = await fetchWithX402('https://api.example.com/premium', {
  wallet: signer,
  connection,
})
```
