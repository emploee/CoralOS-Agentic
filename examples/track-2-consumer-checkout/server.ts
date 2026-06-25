/**
 * server.ts — Consumer Checkout (Track 2).
 *
 * The "server builds the transaction, the wallet signs it" pattern (Solana Pay
 * Transaction Request, simplified for a Phantom dapp). A human clicks Pay; the
 * server hands back an unsigned transfer; Phantom signs and sends it; the server
 * confirms on-chain and delivers.
 *
 *   GET  /checkout/:agentId          → { label, priceLamports, sellerWallet }
 *   POST /checkout/:agentId {account}→ { transaction: <base64 unsigned tx>, message }
 *   GET  /checkout/status/:sig?q=…   → confirm on-chain → { status, result }
 *
 * Fork point: replace deliver() with whatever the human is paying for.
 * Self-contained — no api-ts, no CoralOS. Devnet only.
 */
import express from 'express'
import {
  Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js'

const PORT = Number(process.env.PORT ?? 3010)
const SELLER = process.env.SELLER_WALLET ?? process.env.WALLET ?? ''
const PRICE_SOL = Number(process.env.PRICE_SOL ?? 0.00005)
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

if (!SELLER) {
  console.error('SELLER_WALLET (or WALLET) must be set to a devnet pubkey')
  process.exit(1)
}

const conn = new Connection(RPC, 'confirmed')
const app = express()
app.use(express.json())
// Permit the framework-free web/index.html (opened from file://) to call us.
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

/** Storefront info the UI renders before payment. */
app.get('/checkout/:agentId', (req, res) => {
  res.json({
    agentId: req.params.agentId,
    label: 'Live Weather',
    priceLamports: Math.round(PRICE_SOL * LAMPORTS_PER_SOL),
    sellerWallet: SELLER,
  })
})

/** Build the unsigned transfer the human's wallet will sign. */
app.post('/checkout/:agentId', async (req, res) => {
  const { account } = req.body as { account?: string }
  if (!account) { res.status(400).json({ error: 'account (buyer pubkey) required' }); return }
  try {
    const buyer = new PublicKey(account)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: new PublicKey(SELLER),
        lamports: Math.round(PRICE_SOL * LAMPORTS_PER_SOL),
      }),
    )
    const { blockhash } = await conn.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = buyer
    // Serialize unsigned — Phantom adds the signature.
    const transaction = tx.serialize({ requireAllSignatures: false }).toString('base64')
    res.json({ transaction, message: `Pay ${PRICE_SOL} SOL for weather` })
  } catch (e) {
    res.status(400).json({ error: String(e) })
  }
})

/** Confirm the signed+sent transaction on-chain, then deliver. */
app.get('/checkout/status/:sig', async (req, res) => {
  const sig = req.params.sig
  try {
    const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    if (!tx) { res.json({ status: 'pending' }); return }
    if (tx.meta?.err) { res.json({ status: 'failed', error: JSON.stringify(tx.meta.err) }); return }
    const result = await deliver(req.query.q?.toString() ?? 'London')
    res.json({ status: 'confirmed', result })
  } catch (e) {
    res.status(500).json({ status: 'error', error: String(e) })
  }
})

app.listen(PORT, () => {
  console.error(`[checkout] on :${PORT} — seller ${SELLER}, price ${PRICE_SOL} SOL`)
})

// ── FORK POINT ───────────────────────────────────────────────────────────────
/** What the human receives after paying. Default: live weather (open-meteo, no key). */
async function deliver(city: string): Promise<unknown> {
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
  ).then(r => r.json()) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
  const first = geo.results?.[0]
  if (!first) return { error: `city '${city}' not found` }
  const wx = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${first.latitude}&longitude=${first.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m&wind_speed_unit=mph`,
  ).then(r => r.json()) as { current?: { temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number } }
  return {
    city: first.name,
    temperature_c: wx.current?.temperature_2m,
    humidity_pct: wx.current?.relative_humidity_2m,
    wind_mph: wx.current?.wind_speed_10m,
    fetched_at: new Date().toISOString(),
  }
}
