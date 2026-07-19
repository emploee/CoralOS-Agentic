import { createHash } from 'node:crypto'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from '@solana/web3.js'

export const PATCHBOND_ESCROW_PROGRAM = new PublicKey('R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet')

export type EscrowState = {
  address: PublicKey
  buyer: PublicKey
  seller: PublicKey
  amountLamports: bigint
  reference: PublicKey
  deadlineUnix: bigint
  bump: number
}

const discriminator = (namespace: 'global' | 'account', name: string): Buffer =>
  createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8)

const u64 = (value: bigint): Buffer => {
  const out = Buffer.alloc(8)
  out.writeBigUInt64LE(value)
  return out
}

const i64 = (value: bigint): Buffer => {
  const out = Buffer.alloc(8)
  out.writeBigInt64LE(value)
  return out
}

export function escrowPda(buyer: PublicKey, reference: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.toBuffer(), reference.toBuffer()],
    PATCHBOND_ESCROW_PROGRAM,
  )[0]
}
export function assertDevnetRpc(endpoint: string): void {
  const value = endpoint.toLowerCase()
  if (!value.includes('devnet') && !value.includes('localhost') && !value.includes('127.0.0.1')) {
    throw new Error('PatchBond refuses non-devnet RPC endpoints')
  }
}

export async function depositEscrow(input: {
  connection: Connection
  buyer: Keypair
  seller: PublicKey
  reference: PublicKey
  amountSol: number
  deadlineSeconds: number
  commitment?: Commitment
}): Promise<string> {
  assertDevnetRpc(input.connection.rpcEndpoint)
  if (!Number.isFinite(input.amountSol) || input.amountSol <= 0) throw new Error('escrow amount must be positive')
  if (!Number.isInteger(input.deadlineSeconds) || input.deadlineSeconds < 15) {
    throw new Error('escrow deadline must be at least 15 seconds')
  }
  const amount = BigInt(Math.round(input.amountSol * LAMPORTS_PER_SOL))
  const deadline = BigInt(Math.floor(Date.now() / 1000) + input.deadlineSeconds)
  const data = Buffer.concat([
    discriminator('global', 'initialize'),
    u64(amount),
    input.reference.toBuffer(),
    i64(deadline),
  ])
  const instruction = new TransactionInstruction({
    programId: PATCHBOND_ESCROW_PROGRAM,
    keys: [
      { pubkey: input.buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: input.seller, isSigner: false, isWritable: false },
      { pubkey: escrowPda(input.buyer.publicKey, input.reference), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
  return sendAndConfirmTransaction(input.connection, new Transaction().add(instruction), [input.buyer], {
    commitment: input.commitment ?? 'confirmed',
  })
}

export async function releaseEscrow(input: {
  connection: Connection
  buyer: Keypair
  seller: PublicKey
  reference: PublicKey
  commitment?: Commitment
}): Promise<string> {
  assertDevnetRpc(input.connection.rpcEndpoint)
  const instruction = new TransactionInstruction({
    programId: PATCHBOND_ESCROW_PROGRAM,
    keys: [
      { pubkey: input.buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: input.seller, isSigner: false, isWritable: true },
      { pubkey: escrowPda(input.buyer.publicKey, input.reference), isSigner: false, isWritable: true },
    ],
    data: discriminator('global', 'release'),
  })
  return sendAndConfirmTransaction(input.connection, new Transaction().add(instruction), [input.buyer], {
    commitment: input.commitment ?? 'confirmed',
  })
}
export async function refundEscrow(input: {
  connection: Connection
  buyer: Keypair
  reference: PublicKey
  commitment?: Commitment
}): Promise<string> {
  assertDevnetRpc(input.connection.rpcEndpoint)
  const instruction = new TransactionInstruction({
    programId: PATCHBOND_ESCROW_PROGRAM,
    keys: [
      { pubkey: input.buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda(input.buyer.publicKey, input.reference), isSigner: false, isWritable: true },
    ],
    data: discriminator('global', 'refund'),
  })
  return sendAndConfirmTransaction(input.connection, new Transaction().add(instruction), [input.buyer], {
    commitment: input.commitment ?? 'confirmed',
  })
}

export async function fetchEscrow(
  connection: Connection,
  buyer: PublicKey,
  reference: PublicKey,
  commitment: Commitment = 'confirmed',
): Promise<EscrowState | null> {
  assertDevnetRpc(connection.rpcEndpoint)
  const address = escrowPda(buyer, reference)
  const account = await connection.getAccountInfo(address, commitment)
  if (!account) return null
  if (!account.owner.equals(PATCHBOND_ESCROW_PROGRAM)) throw new Error('escrow account has wrong owner')
  if (account.data.length < 121) throw new Error('escrow account data is truncated')
  const expected = discriminator('account', 'Escrow')
  if (!account.data.subarray(0, 8).equals(expected)) throw new Error('escrow account discriminator mismatch')
  return {
    address,
    buyer: new PublicKey(account.data.subarray(8, 40)),
    seller: new PublicKey(account.data.subarray(40, 72)),
    amountLamports: account.data.readBigUInt64LE(72),
    reference: new PublicKey(account.data.subarray(80, 112)),
    deadlineUnix: account.data.readBigInt64LE(112),
    bump: account.data[120],
  }
}

export async function verifyFundedEscrow(input: {
  connection: Connection
  buyer: PublicKey
  seller: PublicKey
  reference: PublicKey
  minimumSol: number
}): Promise<EscrowState | null> {
  const state = await fetchEscrow(input.connection, input.buyer, input.reference)
  if (!state) return null
  const minimum = BigInt(Math.round(input.minimumSol * LAMPORTS_PER_SOL))
  const valid = state.buyer.equals(input.buyer) && state.seller.equals(input.seller) &&
    state.reference.equals(input.reference) && state.amountLamports >= minimum
  return valid ? state : null
}

export const devnetExplorerTx = (signature: string): string =>
  `https://explorer.solana.com/tx/${signature}?cluster=devnet`

export const devnetExplorerAddress = (address: PublicKey): string =>
  `https://explorer.solana.com/address/${address.toBase58()}?cluster=devnet`
