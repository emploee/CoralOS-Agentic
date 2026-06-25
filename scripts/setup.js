#!/usr/bin/env node
// Generates devnet wallets, writes .env, and saves the two addresses to WALLETS.txt.
// Safe to re-run: if .env already has wallets it re-reads them and re-prints/re-saves the addresses.
//
// Usage: node scripts/setup.js

import { Keypair } from '@solana/web3.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import bs58 from 'bs58'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const envPath = join(root, '.env')
const examplePath = join(root, '.env.example')
const walletsPath = join(root, 'WALLETS.txt')

/** Print the two addresses and save them to WALLETS.txt (so they're never lost). */
function report(sellerPubkey, buyerPubkey, fresh) {
  const block = `sol_coralOS — devnet wallets
Generated: ${new Date().toISOString()}

  Seller wallet  ${sellerPubkey}
  Buyer  wallet  ${buyerPubkey}

FUND BOTH with devnet SOL — the only way is the web faucet (sign in with GitHub;
CLI/RPC airdrops are gated):

  https://faucet.solana.com

The Checkout door also uses your own Phantom wallet — set Phantom to Devnet and
fund that separately.
`
  writeFileSync(walletsPath, block)
  console.log('\n' + block)
  console.log(`(saved to WALLETS.txt${fresh ? ' · keys written to .env' : ' · re-read from .env'})`)
  console.log(`
Then start the economy:
  bash build-agents.sh                                # build the agent images
  docker compose up -d coral bridge                  # coral-server + the bridge (:3010)
  open http://localhost:3010                          # click "Run" in the Autonomous tab
`)
}

// ── Already set up? Re-derive the addresses from .env and re-report. ──
if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf8')
  const seller = env.match(/^WALLET=(\S+)/m)?.[1]
  const buyerB58 = env.match(/^BUYER_KEYPAIR_B58=(\S+)/m)?.[1]
  if (seller && buyerB58) {
    const buyer = Keypair.fromSecretKey(bs58.decode(buyerB58)).publicKey.toBase58()
    report(seller, buyer, false)
    process.exit(0)
  }
}

// ── Fresh setup: generate wallets, write .env. ──
const seller = Keypair.generate()
const buyer = Keypair.generate()
const sellerPubkey = seller.publicKey.toBase58()
const buyerPubkey = buyer.publicKey.toBase58()

let env = readFileSync(examplePath, 'utf8')
env = env
  .replace(/^WALLET=.*$/m, `WALLET=${sellerPubkey}`)
  .replace(/^BUYER_KEYPAIR_B58=.*$/m, `BUYER_KEYPAIR_B58=${bs58.encode(buyer.secretKey)}`)
  .replace(/^SOLANA_RPC_URL=.*$/m, 'SOLANA_RPC_URL=https://api.devnet.solana.com')
writeFileSync(envPath, env)

report(sellerPubkey, buyerPubkey, true)
