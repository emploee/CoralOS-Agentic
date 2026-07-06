/**
 * buyer.ts — self-contained LLM buyer for the bare-metal 402 seller (Track 1, Layer B).
 *
 * The shared runtime LLM drives the loop: fetch -> see 402 -> decide to pay -> sign transfer -> retry.
 * Set LLM_PROVIDER=venice + VENICE_API_KEY to use Venice/Kimi; OpenAI/Anthropic still work through the
 * same `complete()` shim.
 *
 * Run:  SELLER endpoint must be up (npm run server), then `npm run buyer`.
 * Env:  VENICE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY (+ LLM_PROVIDER), BUYER_KEYPAIR_B58,
 *       SOLANA_RPC_URL, ENDPOINT (default localhost:3001)
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js'
import { complete, parseJsonReply } from '@pay/agent-runtime'

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:3001/api/data'
const BUDGET_LAMPORTS = Number(process.env.BUYER_MAX_SOL ?? 0.001) * LAMPORTS_PER_SOL
const GOAL = process.env.BUYER_GOAL ?? 'Fetch the SOL→USDC swap quote from the data endpoint.'
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
// Devnet-only guard (standalone — mirrors @pay/agent-runtime's solanaConnection).
if (process.env.ALLOW_MAINNET !== '1' && /mainnet/i.test(RPC)) {
  throw new Error(`Refusing mainnet RPC "${RPC}" — this kit is devnet-only. Set ALLOW_MAINNET=1 to override (never with a funded key).`)
}

interface Challenge { recipient: string; amountSol: number; reference?: string }
interface PaymentDecision { pay: boolean; reason: string }

function loadKeypair(): Keypair {
  const b58 = process.env.BUYER_KEYPAIR_B58
  if (!b58) throw new Error('BUYER_KEYPAIR_B58 not set')
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = 0n
  for (const c of b58) {
    const idx = ALPHABET.indexOf(c)
    if (idx < 0) throw new Error('invalid base58')
    n = n * 58n + BigInt(idx)
  }
  const hex = n.toString(16).padStart(128, '0')
  const bytes = new Uint8Array(64)
  for (let i = 0; i < 64; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return Keypair.fromSecretKey(bytes)
}

async function payAndRetry(challenge: Challenge): Promise<string> {
  if (challenge.amountSol * LAMPORTS_PER_SOL > BUDGET_LAMPORTS) {
    return `budget exceeded: ${challenge.amountSol} SOL`
  }
  const keypair = loadKeypair()
  const conn = new Connection(RPC, 'confirmed')
  const ix = SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: new PublicKey(challenge.recipient),
    lamports: Math.round(challenge.amountSol * LAMPORTS_PER_SOL),
  })
  if (challenge.reference) {
    ix.keys.push({ pubkey: new PublicKey(challenge.reference), isSigner: false, isWritable: false })
  }
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [keypair], { commitment: 'confirmed' })
  console.error(`[buyer] paid ${challenge.amountSol} SOL sig=${sig}`)
  const retry = await fetch(ENDPOINT, {
    headers: { 'x-payment-proof': sig, ...(challenge.reference ? { 'x-payment-reference': challenge.reference } : {}) },
  })
  return (await retry.text()).slice(0, 2000)
}

function fallbackDecision(challenge: Challenge, reason: string): PaymentDecision {
  return {
    pay: challenge.amountSol * LAMPORTS_PER_SOL <= BUDGET_LAMPORTS,
    reason,
  }
}

async function decidePayment(challenge: Challenge): Promise<PaymentDecision> {
  try {
    const raw = await complete({
      system:
        'You are an autonomous Solana devnet data buyer. Return JSON {pay:boolean, reason:string}. ' +
        'Pay only when the challenge matches the user goal, is within budget, and includes the exact recipient/amount/reference. ' +
        'Never invent payment values.',
      user: JSON.stringify({
        goal: GOAL,
        challenge,
        budgetSol: BUDGET_LAMPORTS / LAMPORTS_PER_SOL,
      }),
      maxTokens: 160,
    })
    const parsed = parseJsonReply<{ pay?: unknown; reason?: unknown }>(raw)
    if (typeof parsed?.pay === 'boolean') {
      return {
        pay: parsed.pay && challenge.amountSol * LAMPORTS_PER_SOL <= BUDGET_LAMPORTS,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'LLM decision',
      }
    }
    return fallbackDecision(challenge, 'LLM returned no parseable decision; using budget policy')
  } catch (e) {
    return fallbackDecision(challenge, `LLM unavailable; using budget policy (${(e as Error).message})`)
  }
}

async function summarize(data: string): Promise<string> {
  try {
    const text = await complete({
      system: 'Summarize the paid API response in one concise sentence.',
      user: data.slice(0, 2000),
      maxTokens: 120,
    })
    return text || data.slice(0, 240)
  } catch {
    return data.slice(0, 240)
  }
}

async function readChallenge(response: Response): Promise<Challenge> {
  const header = response.headers.get('x-payment-required')
  return JSON.parse(header ?? (await response.text())) as Challenge
}

async function main() {
  const first = await fetch(ENDPOINT)
  if (first.status !== 402) {
    console.error(`[buyer] DONE: ${await summarize((await first.text()).slice(0, 2000))}`)
    return
  }

  const challenge = await readChallenge(first)
  console.error(`[buyer] 402 challenge: ${challenge.amountSol} SOL -> ${challenge.recipient}`)
  const decision = await decidePayment(challenge)
  console.error(`[buyer] decision: ${decision.pay ? 'pay' : 'skip'} - ${decision.reason}`)
  if (!decision.pay) return

  const data = await payAndRetry(challenge)
  console.error(`[buyer] DONE: ${await summarize(data)}`)
}

main().catch((e) => { console.error(`[buyer] error: ${e}`); process.exitCode = 1 })
