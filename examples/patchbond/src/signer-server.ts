import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  PATCHBOND_ESCROW_PROGRAM,
  assertDevnetRpc,
  depositEscrow,
  refundEscrow,
  releaseEscrow,
} from '@patchbond/core'

const PORT = Number(process.env.SIGNER_PORT ?? '8899')
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const sellerValue = process.env.SELLER_WALLET
if (!sellerValue) throw new Error('SELLER_WALLET is required')
const SELLER = new PublicKey(sellerValue)
const MAX_SOL = Number(process.env.SIGNER_MAX_SOL ?? '0.02')
if (!Number.isFinite(MAX_SOL) || MAX_SOL <= 0 || MAX_SOL > 0.02) {
  throw new Error('SIGNER_MAX_SOL must be greater than zero and no more than 0.02')
}
assertDevnetRpc(RPC)
const secretFile = process.env.BUYER_KEYPAIR_FILE ?? '/run/secrets/buyer_keypair'
const buyer = Keypair.fromSecretKey(bs58.decode(readFileSync(secretFile, 'utf8').trim()))
const connection = new Connection(RPC, 'confirmed')
const orders = new Map<string, { seller: PublicKey; amountSol: number }>()
let depositedSol = 0

const json = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const data = Buffer.from(chunk)
    size += data.length
    if (size > 16_384) throw new Error('request body too large')
    chunks.push(data)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

const asPublicKey = (value: unknown, name: string): PublicKey => {
  if (typeof value !== 'string') throw new Error(`${name} is required`)
  return new PublicKey(value)
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://signer').pathname
    if (req.method === 'GET' && path === '/health') {
      json(res, 200, {
        ok: true,
        network: 'devnet',
        buyer: buyer.publicKey.toBase58(),
        escrowProgram: PATCHBOND_ESCROW_PROGRAM.toBase58(),
        allowedSeller: SELLER.toBase58(),
        maxSol: MAX_SOL,
      })
      return
    }
    if (req.method !== 'POST') { json(res, 404, { error: 'not found' }); return }
    const body = await readBody(req)
    const reference = asPublicKey(body.reference, 'reference')
    const referenceKey = reference.toBase58()
    if (path === '/deposit') {
      const seller = asPublicKey(body.seller, 'seller')
      const amountSol = Number(body.amountSol)
      const deadlineSeconds = Number(body.deadlineSeconds)
      if (!seller.equals(SELLER)) throw new Error('seller is outside signer allowlist')
      if (!Number.isFinite(amountSol) || amountSol <= 0 || depositedSol + amountSol > MAX_SOL + Number.EPSILON) {
        throw new Error('signer session spend cap exceeded')
      }
      if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < 15 || deadlineSeconds > 300) {
        throw new Error('escrow deadline must be between 15 and 300 seconds')
      }
      if (orders.has(referenceKey)) throw new Error('reference was already used')
      const signature = await depositEscrow({ connection, buyer, seller, reference, amountSol, deadlineSeconds })
      orders.set(referenceKey, { seller, amountSol })
      depositedSol += amountSol
      json(res, 200, { signature, buyer: buyer.publicKey.toBase58() })
      return
    }

    const order = orders.get(referenceKey)
    if (!order) throw new Error('unknown escrow reference')
    if (path === '/release') {
      const seller = asPublicKey(body.seller, 'seller')
      if (!seller.equals(order.seller)) throw new Error('seller does not match funded order')
      const signature = await releaseEscrow({ connection, buyer, seller, reference })
      orders.delete(referenceKey)
      json(res, 200, { signature, buyer: buyer.publicKey.toBase58() })
      return
    }
    if (path === '/refund') {
      const signature = await refundEscrow({ connection, buyer, reference })
      orders.delete(referenceKey)
      json(res, 200, { signature, buyer: buyer.publicKey.toBase58() })
      return
    }
    json(res, 404, { error: 'not found' })
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : 'signer request failed' })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PatchBond policy signer ready on port ${PORT}`)
  console.log(`Buyer: ${buyer.publicKey.toBase58()} · devnet cap: ${MAX_SOL} SOL`)
})
