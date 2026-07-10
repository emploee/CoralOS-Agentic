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

## Source layout

| File | Responsibility |
|---|---|
| `src/constants.ts` | Public ids used by read tools (`SOL_MINT`, `USDC_MINT`, `TOKEN_PROGRAM_ID`). |
| `src/types.ts` | Shared interfaces for connections, prices, balances, wallets, and transfer-intent simulation. |
| `src/connection.ts` | Dependency injection for the guarded devnet connection and mocked fetch. |
| `src/wallet.ts` | Read-only wallet facade; every signer method throws. |
| `src/balances.ts` | SOL and SPL token balance reads. |
| `src/prices.ts` | Jupiter Price API V3 and Pyth Hermes reads. |
| `src/intent.ts` | Non-executable transfer-intent simulation through the repo policy gate. |
| `src/tools.ts` | Stable facade that composes the allowlisted tools. |
| `src/sak.ts` | Solana Agent Kit-compatible plugin/action adapter. |

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

This package has no standalone runnable example in this kit; see its own tests (`npm test`) for exercised usage of every tool.

## Dev

```sh
npm install
npm run typecheck
npm test
npm run build
```
