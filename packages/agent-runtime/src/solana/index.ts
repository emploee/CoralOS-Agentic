// Solana pillar — devnet-guarded connection + Solana Pay settlement primitives.

export { assertDevnet, solanaConnection, DEVNET_RPC } from './connection.js'

export { generatePaymentUrl, verifyPayment, signTransfer, loadKeypairB58, generateReference } from './pay.js'
export type { PaymentUrl } from './pay.js'

export {
  keypairSigner, envSigner, resolveSigner, walletProviderFromEnv,
  signAndSendTransfer, signTransferTransaction, submitSignedTransaction,
} from './signer.js'
export type { WalletSigner, SignedTransferOpts, WalletProviderName } from './signer.js'

export { privySigner, privySignerFromEnv } from './privy-signer.js'
export type { PrivySignerConfig } from './privy-signer.js'
