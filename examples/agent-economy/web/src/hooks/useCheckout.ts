import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { startOrder, submitPaid, type Delivered } from '../api'

/** Returns a `buy(service, onStep)` that runs the full human checkout against the bridge. */
export function useCheckout() {
  const { publicKey, sendTransaction } = useWallet()
  const { connection } = useConnection()

  return async function buy(
    service: string,
    onStep: (s: string) => void,
  ): Promise<Delivered & { sig: string }> {
    if (!publicKey) throw new Error('Connect your wallet first')

    onStep('Asking the seller for a price…')
    const order = await startOrder(service)

    // Build the transfer and write the reference key — binds this payment to THIS order.
    const ix = SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: new PublicKey(order.recipient),
      lamports: Math.round(Number(order.amountSol) * LAMPORTS_PER_SOL),
    })
    ix.keys.push({ pubkey: new PublicKey(order.reference), isSigner: false, isWritable: false })

    const tx = new Transaction().add(ix)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.feePayer = publicKey

    onStep(`Paying ${order.amountSol} SOL — confirm in Phantom…`)
    const sig = await sendTransaction(tx, connection)
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

    onStep('Payment confirmed — seller is verifying on-chain + delivering…')
    const delivered = await submitPaid(order.reference, sig)
    return { ...delivered, sig }
  }
}
