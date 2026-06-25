# Track 2 — Consumer Checkout

> **Thesis:** A human connects Phantom and pays with one click. Zero friction — no wallet address
> to copy, no QR to scan. They just click Pay and get the thing.

The **human → agent** track (Track 1 is agent → agent). Uses the "server builds the transaction,
the wallet signs it" pattern: the server hands the browser an unsigned transfer, Phantom signs and
sends it, the server confirms on-chain and delivers. Because the *server* builds the transaction,
you can put anything in it — an SPL transfer, an Anchor instruction, a batch — and Phantom just
signs what it's handed.

```
Browser (web/index.html)             Server (server.ts)
────────────────────────             ──────────────────────────────
GET  /checkout/:agentId          →   { label, priceLamports, sellerWallet }
POST /checkout/:agentId {account}→   build SystemProgram.transfer(buyer→seller) → { transaction: base64 }
Phantom.signAndSendTransaction
GET  /checkout/status/:sig       →   getTransaction(sig) confirms on-chain → { status, result }
```

---

## Run it

```sh
cp .env.example .env          # SELLER_WALLET (devnet pubkey to receive payment)
npm install && npm run server # checkout server on :3010
# then open web/index.html in a browser with Phantom (devnet) installed
#   — or point it at a remote server:  web/index.html?server=http://host:3010
```

The full Next.js version of this flow also lives at `web/app/track-2/page.tsx` (run the root
`web/` app with `npm run dev`).

---

## The fork point

```
server.ts  →  deliver(city)   — what the human receives after payment confirms
```

Default returns live weather (open-meteo, no key). Swap for gated content, an AI image, a
generated report — any deliverable a human would pay a few cents for.

---

## Files

```
server.ts        Checkout server: build-tx + on-chain-confirm + deliver   ✓
web/index.html   Framework-free Phantom demo (whole flow in one file)      ✓
package.json     express + @solana/web3.js                                 ✓
docker-compose.yml  Full Next.js stack                                     ✓
```

## Env

`SELLER_WALLET` (recipient pubkey) and optionally `PRICE_SOL` (default 0.00005) /
`SOLANA_RPC_URL` (default public devnet). **No buyer keypair** — the human's Phantom wallet signs.
Devnet only.
