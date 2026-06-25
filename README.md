# solana_coralOS — Solana Agent Economy Starter

Agents request, pay, and settle on-chain automatically. Two ready-to-fork tracks where every
payment is a **real on-chain Solana transaction** (devnet):

- **Track 1 — Pay-Per-Call:** an LLM buyer agent hits a paywall (HTTP 402), decides to pay, and
  settles in SOL. The seller verifies on-chain, then delivers.
- **Track 2 — Consumer Checkout:** a human connects Phantom, clicks Pay, and gets the result —
  no login, no API key, just a wallet.

---

## 🔑 Keys & accounts you need

Everything is **devnet** and **free**. You bring your own keys in a local `.env` — none are in the
repo. `scripts/setup.js` generates the Solana wallets for you, so you mostly just fund them.

### Required

| What | For | How to get it |
|------|-----|---------------|
| **Devnet SOL** (2 wallets) | both tracks — paying + receiving | `node scripts/setup.js` generates a buyer + seller keypair into `.env` and prints two addresses. **Fund both** at [faucet.solana.com](https://faucet.solana.com) (1 SOL each, free). |
| **Anthropic API key** | Track 1 — the LLM buyer *decides* to pay (and the seller's optional inference service) | Free-tier key at [console.anthropic.com](https://console.anthropic.com). Set `ANTHROPIC_API_KEY` in `.env`. *(The on-chain payment itself works without it — this is only the "agent reasons about paying" step.)* |
| **Phantom wallet** | Track 2 — the human signs the payment | [phantom.com](https://phantom.com) browser extension, switched to **Devnet**. Not an API key — it's the wallet that signs. |

### Optional (free fallbacks — skip and it still runs)

| Key | For | Get it |
|-----|-----|--------|
| `HELIUS_API_KEY` | faster/reliable devnet RPC | [helius.dev](https://helius.dev) — falls back to public devnet |
| `JUPITER_API_KEY` | higher rate limits on the Jupiter price service | [jup.ag/developers](https://jup.ag/developers) |
| `NEWS_API_KEY` | only if you set `SERVICE=news` | [newsapi.org](https://newsapi.org) |

> **Don't have an Anthropic key but have an OpenAI/Codex one?** The LLM step is Anthropic-only
> today — open an issue or swap the call in `coral-agents/buyer-agent/src/llm_buyer.ts`.

---

## Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Phantom wallet](https://phantom.com) (Track 2 only), set to **Devnet**

## Quick start

```sh
git clone https://github.com/trilltino/solana_coralOS
cd solana_coralOS

# 1. Generate devnet wallets + write .env  (prints two addresses to fund)
cd scripts && npm install && cd ..
node scripts/setup.js

# 2. Fund both printed addresses at https://faucet.solana.com (1 SOL each)

# 3. Add your Anthropic key to .env (for Track 1's LLM buyer)
#    ANTHROPIC_API_KEY=sk-ant-...
```

Then pick a track below.

---

## Track 1 — Pay-Per-Call API

An LLM buyer agent hits a data endpoint, gets `402 Payment Required`, decides to pay, signs a SOL
transfer on devnet, and re-requests with the payment as proof. The seller confirms it on-chain
(`findReference` / `validateTransfer`) and delivers.

```sh
cd examples/track-1-pay-per-call
cp ../../.env .env          # reuse the generated wallets; add ANTHROPIC_API_KEY
npm install
npm run server              # terminal 1 — the 402 seller
npm run buyer               # terminal 2 — the LLM buyer pays, then gets data
```

> **Verified live on devnet:** the full loop settles on-chain (tx
> [3g2wQri9…](https://explorer.solana.com/tx/3g2wQri9w9y3B6dJ1xyvk4L43o8BsbvgafqcE9oTgNkzroXzSe6UmdUTrenbebxKPsZ7mdDaLUx7HPSoRHxfTG1U?cluster=devnet)).

**Fork it** — change what the seller sells in one function:

```typescript
// coral-agents/seller-agent/src/service.ts → deliverService(request)
//   built-in options via SERVICE env: jupiter | coingecko | news | inference (a Claude completion)
```

---

## Track 2 — Consumer Checkout

A human connects Phantom and pays with one click. The **server builds the transaction**, Phantom
signs and sends it, the server confirms on-chain and delivers.

```sh
cd examples/track-2-consumer-checkout
cp ../../.env .env          # reuse the generated SELLER_WALLET
npm install
npm run server              # checkout server on :3010
# then open web/index.html in a browser with Phantom (Devnet) installed
```

**Fork it** — change the deliverable in `server.ts → deliver(city)` (default: live weather).

---

## Repo layout

| Directory | Purpose |
|-----------|---------|
| `coral-agents/seller-agent/` | Sells data for SOL — fork `src/service.ts` |
| `coral-agents/buyer-agent/` | LLM buyer that decides + pays — `src/llm_buyer.ts`, `src/goal.ts` |
| `coral-agents/echo-agent/` | Minimal MCP agent (proves CoralOS connectivity) |
| `sdk/agent-core-ts/` | Agent runtime: `AgentManager`, `Strategy`, MessageBus, CoralOS MCP, strategies |
| `api-ts/` | Express REST API (:8081) wrapping the runtime |
| `web/` | Next.js frontend — `/track-1`, `/track-2` |
| `examples/track-1-pay-per-call/` | Self-contained 402 seller + LLM buyer + on-chain verify |
| `examples/track-2-consumer-checkout/` | Self-contained checkout server + framework-free Phantom demo |
| `scripts/` | `setup.js` (wallet generation) + smoke tests |

---

## Development

```sh
# API server + web
cd api-ts && npm install && npm run dev    # :8081
cd web && npm install && npm run dev       # :3000

# Typecheck (clean across all packages)
cd sdk/agent-core-ts && npm run typecheck
cd api-ts && npm run typecheck
```

> **CoralOS:** agents can coordinate over a real CoralOS server (MCP) — proven working. CoralOS's
> *native* payment rail (x402/CORAL token) is **not** used here: it's half-built upstream, so this
> kit settles in plain SOL, which works end-to-end. See `.claude/IMPLEMENTATION_SPEC.md` for the
> full investigation.

## License

MIT
