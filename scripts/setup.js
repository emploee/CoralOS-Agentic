#!/usr/bin/env node
// Generates the devnet wallets the World Cup Oracle needs, writes .env, and saves the addresses to
// WALLETS.txt. Safe to re-run: existing wallets/keys are preserved; only what's missing is generated.
//
// Usage: node scripts/setup.js            # buyer (signs payments) + seller (paid) wallets

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

/** Set or append `KEY=value` without disturbing the rest of the file. */
function setKv(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\s*$/, '\n')}${key}=${value}\n`
}
/** Read an existing assignment, or undefined. */
const getKv = (text, key) => text.match(new RegExp(`^${key}=(\\S+)`, 'm'))?.[1]

// Base on an existing .env (preserve user-added keys); else the template.
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8')

// Generate only what's missing - re-running never rotates a key you've already funded.
// The BUYER signs x402 payments and must be funded. The SELLER is a real, distinct keypair too (not
// just a receive address) so settlement is a genuine two-party transfer the seller could later spend
// or prove - it only RECEIVES payment, so it needs no funding by default.
let buyerB58 = getKv(env, 'BUYER_KEYPAIR_B58') || bs58.encode(Keypair.generate().secretKey)
let sellerB58 = getKv(env, 'SELLER_KEYPAIR_B58') || bs58.encode(Keypair.generate().secretKey)
const buyerPubkey = Keypair.fromSecretKey(bs58.decode(buyerB58)).publicKey.toBase58()
const sellerPubkey = Keypair.fromSecretKey(bs58.decode(sellerB58)).publicKey.toBase58()

env = setKv(env, 'BUYER_KEYPAIR_B58', buyerB58)
env = setKv(env, 'SELLER_KEYPAIR_B58', sellerB58)
env = setKv(env, 'WALLET', sellerPubkey) // the seller's public key - the x402 payment destination
env = setKv(env, 'SOLANA_RPC_URL', getKv(env, 'SOLANA_RPC_URL') || 'https://api.devnet.solana.com')

writeFileSync(envPath, env)

// -- report --
const block = [
  'World Cup Oracle - devnet wallets',
  `Generated: ${new Date().toISOString()}`,
  '',
  `  Buyer   wallet  ${buyerPubkey}   <- signs + funds x402 payments (FUND THIS)`,
  `  Seller  wallet  ${sellerPubkey}   <- receives payment (no funding needed)`,
  '',
  'FUND THE BUYER with devnet SOL - the only way is the web faucet',
  '(sign in with GitHub; CLI/RPC airdrops are gated):',
  '',
  '  https://faucet.solana.com',
  '',
].join('\n')
writeFileSync(walletsPath, block)
console.log('\n' + block)
console.log('(saved to WALLETS.txt - keys written to .env)')
console.log(`
Next: fund the BUYER wallet above, then run the demo:

  npm run dev          # starts the proxy (live data + x402 settlement) + the Oracle UI, opens the browser

The board fills from live TxODDS data; selecting a fixture delivers the agent's read and the buyer
pays the distinct seller directly over x402 on devnet automatically.
`)
