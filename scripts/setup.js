#!/usr/bin/env node
// Generates fresh local-only devnet wallets for PatchBond and writes them to .env.
// Safe to re-run: existing wallets/keys are preserved; only missing values are generated.
//
// Usage: node scripts/setup.js            # buyer (signs payments) + seller (paid) wallets

import { Keypair } from '@solana/web3.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import bs58 from 'bs58'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const envPath = join(root, '.env')
const examplePath = join(root, '.env.example')
const walletsPath = join(root, 'WALLETS.txt')
const secretsDir = join(root, '.secrets')
const buyerSecretPath = join(secretsDir, 'buyer-keypair')

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
mkdirSync(secretsDir, { recursive: true, mode: 0o700 })
writeFileSync(buyerSecretPath, `${buyerB58}\n`, { mode: 0o600 })
try { chmodSync(buyerSecretPath, 0o600) } catch { /* Windows ACLs are managed by the host */ }

// -- report --
const block = [
  'PatchBond - local devnet wallets',
  `Generated: ${new Date().toISOString()}`,
  '',
  `  Buyer   wallet  ${buyerPubkey}   <- funds escrow deposit/release/refund (FUND THIS)`,
  `  Seller  wallet  ${sellerPubkey}   <- receives released escrow (no funding needed)`,
  '',
  'FUND THE BUYER with devnet SOL - the only way is the web faucet',
  '(sign in with GitHub; CLI/RPC airdrops are gated):',
  '',
  '  https://faucet.solana.com',
  '',
].join('\n')
writeFileSync(walletsPath, block)
console.log('\n' + block)
console.log('(saved to WALLETS.txt; key stored in gitignored .env and .secrets/buyer-keypair)')
console.log(`
Next: fund the BUYER wallet above, then run the PatchBond demo:

  npm run demo:patchbond          # local patch + verifier proof, no blockchain
  npm run demo:patchbond:coral    # CoralOS + real Solana devnet escrow

Never paste .env keys into chat, issues, logs, or commits.
`)
