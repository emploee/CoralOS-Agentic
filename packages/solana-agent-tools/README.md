# @pay/solana-agent-tools

Allowlisted Solana tools for richer agents. This package is the safe integration point for
Solana Agent Kit-style capabilities: agents may **read** chain/market context and dry-run a payment
intent, but they cannot trade, bridge, launch tokens, sign, or broadcast.

The package exports plain TypeScript helpers plus a Solana Agent Kit-compatible plugin shape. The
`solana-agent-kit` dependency is optional on purpose: core repo packages stay Node 20-compatible,
while the example that loads the plugin into SAK runs on Node 22.

## Tools

| Tool | What it does | Moves funds? |
|---|---|---|
| `readWalletBalance(address)` | Reads SOL balance on the guarded devnet RPC. | No |
| `readTokenBalances(owner)` | Reads parsed SPL token accounts. | No |
| `fetchTokenPrice(id)` | Reads USD price from Jupiter Price API V3 (`SOL`/`USDC` aliases included). | No |
| `fetchPythPrice(priceFeedId)` | Reads a Pyth Hermes latest price update. | No |
| `simulateTransferIntent(input)` | Builds a non-executable transfer intent and runs `policy.enforce()` if a policy is supplied. | No |

`simulateTransferIntent` is deliberately not a transaction sender. A future live payment action must
go through the existing repo path: devnet guard, `policy.enforce()`, explicit user approval,
simulation/signing UX, ledger receipt, and UI transaction surface.

## Solana Agent Kit

```ts
import { SolanaAgentKit } from 'solana-agent-kit'
import {
  createReadOnlyWallet,
  createReadonlySolanaPlugin,
  createSolanaAgentTools,
} from '@pay/solana-agent-tools'

const tools = createSolanaAgentTools({ rpcUrl: 'https://api.devnet.solana.com' })
const agent = new SolanaAgentKit(
  createReadOnlyWallet(process.env.WALLET!),
  process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  {},
).use(createReadonlySolanaPlugin(tools))

const balance = await agent.methods.readWalletBalance(process.env.WALLET!)
```

The read-only wallet satisfies SAK's wallet interface for read tools while refusing every signing
method. If a future example needs a signing wallet, it should be a new package path with a transaction
review surface, not an expansion of this read-only plugin.

Executable example: [`examples/agent-economy/solana-agent-kit`](../../examples/agent-economy/solana-agent-kit/README.md).

## Dev

```sh
npm install
npm run typecheck
npm test
npm run build
```
