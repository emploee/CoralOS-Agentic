/**
 * Real-data proxy for the World Cup Oracle React app.
 *
 * The browser cannot hold the TxLINE API token or sign Solana transactions, so this tiny Node server
 * does it: on first request it subscribes the kit's buyer wallet to the free World Cup tier on devnet,
 * activates an API token, then serves live fixtures/odds to the React app (which only ever talks here).
 *
 * Verified working against devnet (2026-06). Two corrections vs. the published TxODDS examples:
 *   1. host is `txline-dev.txodds.com`           (the repo's `oracle-dev.txodds.com` does not resolve)
 *   2. mint is the treasury's `4Zao8o...`          (the IDL's `TXLINE_MINT` constant is stale -> InvalidMint)
 *
 * Run:  ANCHOR off - just `npx ts-node server/proxy.ts`  (reads BUYER_KEYPAIR_B58 from the repo .env)
 */
import http from 'node:http'
import fs from 'node:fs'
import axios from 'axios'
import * as anchor from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, Keypair, Connection } from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { fileURLToPath } from 'node:url'
import { assertDevnet } from '@pay/agent-runtime'
import { x402Challenge, settleX402, type X402Accept } from '@pay/payment-runtime'
import { analyzeEdge } from '../agent/edge.js'
import { createTxOddsRound } from '../coral/round.js'

// fileURLToPath (not .pathname) so the repo-root .env resolves on macOS/Linux too, not just Windows.
const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))

// Load the repo .env into process.env FIRST - before the constants below - so .env can override the
// program/mint/host, not just keys. A shell env var still wins (we only fill what's undefined). This is
// the single .env read; everything else reads process.env.
;(function loadEnv() {
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env - rely on the shell env */ }
})()

// TxLINE devnet ids - overridable via .env (TXLINE_PROGRAM / TXLINE_MINT) so a TxODDS rotation is a
// config change, not a code edit. Defaults are the values verified working on devnet (2026-06).
const PROGRAM = new PublicKey(process.env.TXLINE_PROGRAM ?? '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J')
const MINT = new PublicKey(process.env.TXLINE_MINT ?? '4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG') // treasury mint
const BASE = process.env.TXLINE_BASE_URL ?? 'https://txline-dev.txodds.com'
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const PORT = Number(process.env.PORT ?? 8801)
const AGENTIC_FEED = process.env.TXODDS_FEED_URL ?? 'http://localhost:4000'

async function forwardFeed(res: http.ServerResponse, path: string): Promise<void> {
  try {
    const r = await fetch(`${AGENTIC_FEED}${path}`)
    res.statusCode = r.status
    res.end(await r.text())
  } catch (e) {
    res.statusCode = 502
    res.end(JSON.stringify({ error: `agentic feed unavailable: ${(e as Error).message}` }))
  }
}

function buyerKeypair(): Keypair {
  const b58 = process.env.BUYER_KEYPAIR_B58 // loaded from .env above (or the shell)
  if (!b58) throw new Error(`BUYER_KEYPAIR_B58 not set (looked in ${ENV_PATH})`)
  return Keypair.fromSecretKey(bs58.decode(b58.trim()))
}

let jwt = ''
let apiToken = ''

/** Subscribe (free tier) + activate, once. Caches the resulting API token. */
async function ensureToken(): Promise<void> {
  if (apiToken) return
  const keypair = buyerKeypair()
  assertDevnet(RPC) // devnet-only: refuse a mainnet RPC unless ALLOW_MAINNET=1
  const connection = new Connection(RPC, 'confirmed')
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' })
  const idl = (await anchor.Program.fetchIdl(PROGRAM, provider)) as anchor.Idl
  const program = new anchor.Program(idl, provider)

  jwt = (await axios.post(`${BASE}/auth/guest/start`)).data.token
  const ata = await getOrCreateAssociatedTokenAccount(
    connection, keypair, MINT, keypair.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  )
  const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from('pricing_matrix')], PROGRAM)
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('token_treasury_v2')], PROGRAM)
  const tokenTreasuryVault = getAssociatedTokenAddressSync(MINT, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID)

  const txSig = await (program.methods as any)
    .subscribe(1, 4) // service level 1 (free World Cup), 4 weeks
    .accounts({
      user: keypair.publicKey, pricingMatrix, tokenMint: MINT, userTokenAccount: ata.address,
      tokenTreasuryVault, tokenTreasuryPda, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc()

  const msg = new TextEncoder().encode(`${txSig}::${jwt}`)
  const walletSignature = Buffer.from(nacl.sign.detached(msg, keypair.secretKey)).toString('base64')
  const data = (await axios.post(
    `${BASE}/api/token/activate`,
    { txSig, walletSignature, leagues: [] },
    { headers: { Authorization: `Bearer ${jwt}` } },
  )).data
  apiToken = data.token || data
  if (typeof apiToken !== 'string' || !apiToken) throw new Error('activation returned no token')
  console.error('[proxy] subscribed + activated - serving live TxODDS data')
}

async function txGet(path: string): Promise<unknown> {
  await ensureToken()
  const res = await axios.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
  })
  return res.data
}

// A market is real if it has at least one finite price (the live feed is full of rows priced "NA" we
// must NOT surface). A fixture is board-worthy if it has ANY such market - the free World Cup tier's
// 1X2 odds are intermittent, but over/under + Asian-handicap markets are usually present, and those
// are verified de-margined odds too. 1X2 fixtures are still preferred (sorted first) when available.
const hasFinitePrice = (m: any): boolean =>
  Array.isArray(m?.PriceNames) &&
  m.PriceNames.some((_: unknown, i: number) => Number.isFinite(Number((m.Pct || [])[i])))
const has1x2 = (odds: any[]): boolean =>
  odds.some((m) => String(m?.SuperOddsType ?? '').includes('1X2') && hasFinitePrice(m))

/**
 * The fixtures to actually show: those with any verified live market, odds inlined so the UI never has
 * to guess or fall back to demo numbers for a live game. 1X2 fixtures sort first. Cached briefly +
 * fetched with bounded concurrency so the board loads fast without hammering the upstream.
 */
// Cache holds the last NON-EMPTY board. We never cache an empty scan (the free tier flickers in and
// out of having priced markets); instead, when a scan comes back empty we keep serving the last good
// board for a few minutes so the UI stays live through the gaps.
let boardCache: { at: number; data: any[] } = { at: 0, data: [] }
async function board(): Promise<any[]> {
  if (boardCache.data.length && Date.now() - boardCache.at < 30_000) return boardCache.data // fresh + good
  try {
    const fixtures = await txGet('/api/fixtures/snapshot')
    const list = ((Array.isArray(fixtures) ? fixtures : []) as any[]).slice(0, 80)
    const results: (any | null)[] = new Array(list.length).fill(null)
    let next = 0
    async function worker(): Promise<void> {
      while (next < list.length) {
        const idx = next++
        const f = list[idx]
        try {
          const odds = await txGet(`/api/odds/snapshot/${f.FixtureId}`)
          if (Array.isArray(odds) && (odds as any[]).some(hasFinitePrice)) results[idx] = { ...f, odds }
        } catch { /* skip this fixture on an upstream error */ }
      }
    }
    await Promise.all(Array.from({ length: 6 }, () => worker()))
    const data = (results.filter(Boolean) as any[])
      .sort((a, b) => Number(has1x2(b.odds)) - Number(has1x2(a.odds))) // 1X2 fixtures first
    if (data.length) { boardCache = { at: Date.now(), data }; return data } // got a live board - cache it
    if (boardCache.data.length && Date.now() - boardCache.at < 300_000) return boardCache.data // flicker - keep last good
    return data // genuinely nothing priced right now
  } catch (e) {
    // Upstream TxLINE itself is down/erroring (e.g. a 503) - the fixtures/snapshot call throws
    // before we ever get to the "flicker, keep last good" fallback above. Same fallback, one level
    // up: never let a transient upstream outage surface as a 500 - degrade to cache, then empty.
    console.error(`[proxy] board() upstream failure: ${(e as Error).message}`)
    if (boardCache.data.length && Date.now() - boardCache.at < 300_000) return boardCache.data
    return []
  }
}

interface ReadBundle {
  request: {
    fixtureId: string
    requestedAt: string
    source: 'txodds-web'
    oddsPath: string
    fixturesPath: string
  }
  delivery: any
}

async function readEdge(fixtureId: string): Promise<ReadBundle> {
  const request: ReadBundle['request'] = {
    fixtureId,
    requestedAt: new Date().toISOString(),
    source: 'txodds-web',
    oddsPath: `/api/odds/snapshot/${fixtureId}`,
    fixturesPath: '/api/fixtures/snapshot',
  }
  const [live, fixtures] = await Promise.all([
    txGet(`/api/odds/snapshot/${fixtureId}`).catch(() => []),
    txGet('/api/fixtures/snapshot'),
  ])
  let odds = live
  if (!(Array.isArray(odds) && (odds as any[]).some(hasFinitePrice))) {
    const fromBoard = (await board()).find((f) => String(f.FixtureId) === fixtureId)
    if (fromBoard) odds = fromBoard.odds
  }
  const delivery = await analyzeEdge({ fixtureId, odds, fixtures })
  return { request, delivery }
}

/**
 * x402 reference merchant — a gated door onto the `readEdge()` product, demonstrating the repo's
 * x402 rail (`@pay/payment-runtime`'s `x402Challenge`/`settleX402`) end to end: no `X-PAYMENT`
 * header -> 402 with a fresh reference-bound challenge; a valid `X-PAYMENT` -> submit, confirm,
 * verify on-chain, then deliver with `X-PAYMENT-RESPONSE` set. Priced in native SOL — no SPL mint
 * dependency. This is also coral-agents/seller-agent's default PROCURE_X402_URL target when
 * PROCURE_RAIL=x402 (see PAY.md) — not just a browser-demo path.
 *
 * Challenges are held in memory only, keyed by reference, and evicted once too many are open at
 * once — this is a devnet demo endpoint, not a production payment queue.
 */
const X402_PRICE_SOL = process.env.X402_PRICE_SOL ?? '0.0005'
const MAX_OPEN_X402_CHALLENGES = 50
const openX402Challenges = new Map<string, X402Accept>()

function x402Recipient(): string {
  return process.env.SELLER_WALLET || process.env.WALLET || buyerKeypair().publicKey.toBase58()
}

async function handleEdgeX402(req: http.IncomingMessage, res: http.ServerResponse, fixtureId: string): Promise<void> {
  const paymentHeader = req.headers['x-payment']
  if (typeof paymentHeader === 'string' && paymentHeader) {
    let reference: string | undefined
    try {
      reference = (JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8')) as { payload?: { reference?: string } }).payload?.reference
    } catch { /* settleX402 below reports the malformed-header case */ }
    const accept = reference ? openX402Challenges.get(reference) : undefined
    if (!accept) {
      res.statusCode = 402
      res.end(JSON.stringify({ error: 'unknown or expired x402 reference — request the resource again to get a fresh challenge' }))
      return
    }
    const result = await settleX402(paymentHeader, accept)
    if (!result.settled) {
      res.statusCode = 402
      res.end(JSON.stringify({ error: result.reason ?? 'x402 settlement failed' }))
      return
    }
    openX402Challenges.delete(reference!)
    res.setHeader('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ settled: true, txSignature: result.txSignature })).toString('base64'))
    res.end(JSON.stringify((await readEdge(fixtureId)).delivery))
    return
  }

  const challenge = x402Challenge(
    { id: `x402:${fixtureId}:${Date.now()}`, service: 'txline-edge', buyer: 'anonymous', seller: x402Recipient(), amount: X402_PRICE_SOL, currency: 'SOL' },
    { id: 'req', rail: 'x402', orderId: 'order', amount: X402_PRICE_SOL, currency: 'SOL', buyer: 'anonymous', headers: { 'X-PAYMENT-NETWORK': 'solana' } },
    `/api/edge-x402?fixtureId=${fixtureId}`,
  )
  const accept = challenge.body.accepts[0]
  if (openX402Challenges.size >= MAX_OPEN_X402_CHALLENGES) {
    const oldest = openX402Challenges.keys().next().value
    if (oldest) openX402Challenges.delete(oldest)
  }
  openX402Challenges.set(accept.reference, accept)
  res.statusCode = 402
  res.end(JSON.stringify(challenge.body))
}

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
      if (url.pathname === '/api/board') {
        // only fixtures with verified live 1X2 odds (odds inlined) - what the dashboard renders
        res.end(JSON.stringify(await board()))
      } else if (url.pathname === '/api/edge-x402') {
        // The verified-read product (readEdge/analyzeEdge), gated behind a real x402 challenge/pay/
        // settle round trip - see handleEdgeX402 above. This is coral-agents/seller-agent's default
        // PROCURE_X402_URL target when PROCURE_RAIL=x402 (see PAY.md), not just a UI demo path.
        await handleEdgeX402(req, res, url.searchParams.get('fixtureId') ?? '')
      } else if (url.pathname === '/api/agentic/start') {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        const result = await createTxOddsRound({
          fixtureId: url.searchParams.get('fixtureId') ?? undefined,
          service: url.searchParams.get('service') ?? undefined,
          arg: url.searchParams.get('arg') ?? undefined,
        })
        res.end(JSON.stringify({ ...result, feed: AGENTIC_FEED }))
      } else if (url.pathname === '/api/agentic/feed') {
        await forwardFeed(res, `/api/feed?${url.searchParams.toString()}`)
      } else if (url.pathname === '/api/agentic/threads') {
        await forwardFeed(res, `/api/threads?${url.searchParams.toString()}`)
      } else if (url.pathname === '/api/agentic/runs') {
        await forwardFeed(res, '/api/runs')
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'not found' }))
      }
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: (e as Error).message, detail: (e as any)?.response?.data }))
    }
  })
  .listen(PORT, () => {
    console.error(`[proxy] http://localhost:${PORT}  (GET /api/board - /api/edge-x402?fixtureId= - /api/agentic/*)`)
  })
