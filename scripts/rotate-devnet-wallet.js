#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import bs58 from 'bs58'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')
const secretsDir = join(root, '.secrets')
const buyerSecretPath = join(secretsDir, 'buyer-keypair')
let env = readFileSync(envPath, 'utf8')
const get = (key) => env.match(new RegExp(`^${key}=(\\S+)`, 'm'))?.[1]
const set = (key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`
}

const oldSecret = get('BUYER_KEYPAIR_B58')
if (!oldSecret) throw new Error('BUYER_KEYPAIR_B58 is missing from .env')
const rpc = get('SOLANA_RPC_URL') || 'https://api.devnet.solana.com'
if (!rpc.toLowerCase().includes('devnet')) throw new Error('wallet rotation is devnet-only')

const connection = new Connection(rpc, 'confirmed')
const previous = Keypair.fromSecretKey(bs58.decode(oldSecret))
const replacement = Keypair.generate()
const balance = await connection.getBalance(previous.publicKey, 'confirmed')
const reserve = Math.round(0.01 * LAMPORTS_PER_SOL)
let signature

if (balance > reserve) {
  signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: previous.publicKey,
      toPubkey: replacement.publicKey,
      lamports: balance - reserve,
    })),
    [previous],
    { commitment: 'confirmed' },
  )
}

const replacementSecret = bs58.encode(replacement.secretKey)
set('BUYER_KEYPAIR_B58', replacementSecret)
writeFileSync(envPath, env)
mkdirSync(secretsDir, { recursive: true, mode: 0o700 })
writeFileSync(buyerSecretPath, `${replacementSecret}\n`, { mode: 0o600 })
try { chmodSync(buyerSecretPath, 0o600) } catch { /* Windows ACLs are managed by the host */ }
console.log(`Previous devnet buyer: ${previous.publicKey.toBase58()}`)
console.log(`New devnet buyer:      ${replacement.publicKey.toBase58()}`)
console.log(`Moved:                 ${Math.max(0, balance - reserve) / LAMPORTS_PER_SOL} devnet SOL`)
if (signature) console.log(`Migration transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`)
console.log('The new private key was written only to gitignored .env and .secrets/buyer-keypair files.')
