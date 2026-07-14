/**
 * Arbiter settlement client for the CoralOS buyer.
 *
 * The arbiter wraps the base escrow by making a vault PDA the escrow's buyer. The human buyer funds
 * the vault, then only the configured arbiter key can release/refund by signing for that vault.
 */
import anchor from '@coral-xyz/anchor'
import type { Idl, Program } from '@coral-xyz/anchor'
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js'
import { solanaConnection } from '@pay/agent-runtime'
import { PROGRAM_ID as ESCROW_PROGRAM_ID } from './escrow.js'

const { AnchorProvider, BN } = anchor

export const ARBITER_PROGRAM_ID = new PublicKey('FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd')

const ARBITER_IDL = {
  address: ARBITER_PROGRAM_ID.toBase58(),
  metadata: { name: 'arbiter', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'init_config',
      discriminator: [23, 235, 115, 232, 168, 96, 1, 231],
      accounts: [
        { name: 'admin', writable: true, signer: true },
        { name: 'config', writable: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [{ name: 'arbiter', type: 'pubkey' }],
    },
    {
      name: 'open',
      discriminator: [228, 220, 155, 71, 199, 189, 60, 45],
      accounts: [
        { name: 'payer', writable: true, signer: true },
        { name: 'vault', writable: true },
        { name: 'seller' },
        { name: 'escrow', writable: true },
        { name: 'escrow_program', address: ESCROW_PROGRAM_ID.toBase58() },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [
        { name: 'amount', type: 'u64' },
        { name: 'reference', type: 'pubkey' },
        { name: 'deadline', type: 'i64' },
      ],
    },
    {
      name: 'arbitrate_release',
      discriminator: [194, 41, 251, 189, 16, 195, 150, 11],
      accounts: [
        { name: 'arbiter', signer: true },
        { name: 'config' },
        { name: 'vault', writable: true },
        { name: 'seller', writable: true },
        { name: 'escrow', writable: true },
        { name: 'escrow_program', address: ESCROW_PROGRAM_ID.toBase58() },
      ],
      args: [{ name: 'reference', type: 'pubkey' }],
    },
  ],
} as Idl

export const configPda = (): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from('config')], ARBITER_PROGRAM_ID)[0]

export const vaultPda = (reference: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), reference.toBuffer()], ARBITER_PROGRAM_ID)[0]

export const arbitratedEscrowPda = (vault: PublicKey, reference: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), vault.toBuffer(), reference.toBuffer()],
    ESCROW_PROGRAM_ID,
  )[0]

export function makeArbiter(signer: Keypair, rpcUrl: string): Program {
  const provider = new AnchorProvider(solanaConnection(rpcUrl), new anchor.Wallet(signer), { commitment: 'confirmed' })
  return new anchor.Program(ARBITER_IDL, provider)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function ensureArbiterConfig(admin: Keypair, arbiter: PublicKey, rpcUrl: string): Promise<void> {
  const connection = solanaConnection(rpcUrl)
  if (await connection.getAccountInfo(configPda(), 'confirmed')) return
  await (makeArbiter(admin, rpcUrl).methods as any)
    .initConfig(arbiter)
    .accounts({ admin: admin.publicKey, config: configPda(), systemProgram: SystemProgram.programId })
    .signers([admin])
    .rpc()
}

export async function ensureArbiterFunded(payer: Keypair, arbiter: PublicKey, rpcUrl: string): Promise<void> {
  const connection = new Connection(rpcUrl, 'confirmed')
  if ((await connection.getBalance(arbiter)) >= 0.01 * LAMPORTS_PER_SOL) return
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: arbiter,
    lamports: Math.round(0.02 * LAMPORTS_PER_SOL),
  }))
  await sendAndConfirmTransaction(connection, tx, [payer])
}

export async function openArbitrated(
  program: Program,
  payer: Keypair,
  seller: PublicKey,
  reference: PublicKey,
  amountSol: number,
  deadlineSecs: number,
): Promise<{ sig: string; vault: PublicKey; escrow: PublicKey }> {
  const vault = vaultPda(reference)
  const escrow = arbitratedEscrowPda(vault, reference)
  const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSecs)
  const sig = await (program.methods as any)
    .open(new BN(Math.round(amountSol * LAMPORTS_PER_SOL)), reference, deadline)
    .accounts({
      payer: payer.publicKey,
      vault,
      seller,
      escrow,
      escrowProgram: ESCROW_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc()
  return { sig, vault, escrow }
}

export async function arbitrateRelease(
  program: Program,
  arbiter: Keypair,
  seller: PublicKey,
  reference: PublicKey,
): Promise<string> {
  const vault = vaultPda(reference)
  const escrow = arbitratedEscrowPda(vault, reference)
  return (program.methods as any)
    .arbitrateRelease(reference)
    .accounts({ arbiter: arbiter.publicKey, config: configPda(), vault, seller, escrow, escrowProgram: ESCROW_PROGRAM_ID })
    .signers([arbiter])
    .rpc()
}
