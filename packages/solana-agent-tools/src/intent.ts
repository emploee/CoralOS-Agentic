import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from '@solana/web3.js'
import { enforce } from '@pay/agent-runtime'
import type { TransferIntentInput, TransferIntentSimulation } from './types.js'

function instructionShape(ix: TransactionInstruction): TransferIntentSimulation['instruction'] {
  return {
    programId: ix.programId.toBase58(),
    dataBase64: Buffer.from(ix.data).toString('base64'),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
  }
}

/**
 * Build an instruction-shaped SOL transfer intent without returning a signable transaction.
 *
 * This is for agent reasoning and UI review only. It runs the repo policy gate when provided and
 * always returns `executable: false`.
 */
export async function simulateTransferIntent(
  input: TransferIntentInput,
): Promise<TransferIntentSimulation> {
  if (input.amountSol <= 0) throw new Error('amountSol must be positive')
  const buyer = new PublicKey(input.buyer)
  const recipient = new PublicKey(input.recipient)
  const lamports = Math.round(input.amountSol * LAMPORTS_PER_SOL)
  const policyDecision = input.policy
    ? enforce({
        kind: 'payment',
        round: input.round ?? 0,
        service: input.service,
        amountSol: input.amountSol,
        payout: recipient.toBase58(),
        ...(input.awardedPriceSol != null ? { awardedPriceSol: input.awardedPriceSol } : {}),
        ...(input.spentSol != null ? { spentSol: input.spentSol } : {}),
        ...(input.lastPaymentAt != null ? { lastPaymentAt: input.lastPaymentAt } : {}),
        ...(input.now != null ? { now: input.now } : {}),
      }, input.policy)
    : { ok: true, violations: [] }
  const ix = SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: recipient,
    lamports,
  })
  if (input.reference) ix.keys.push({ pubkey: new PublicKey(input.reference), isSigner: false, isWritable: false })
  return {
    kind: 'transfer-intent',
    executable: false,
    cluster: 'devnet',
    service: input.service,
    buyer: buyer.toBase58(),
    recipient: recipient.toBase58(),
    amountSol: input.amountSol,
    lamports,
    ...(input.reference ? { reference: input.reference } : {}),
    policyDecision,
    reason: policyDecision.ok
      ? 'dry-run only: no signature requested and no transaction broadcast'
      : `blocked by policy: ${policyDecision.violations.join('; ')}`,
    instruction: instructionShape(ix),
  }
}
