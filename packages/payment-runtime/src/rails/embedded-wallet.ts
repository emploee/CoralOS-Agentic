import type { PaymentRail } from '../types.js'

export interface EmbeddedWalletRailOptions {
  walletProvider: 'privy' | 'dynamic' | 'para' | 'magic' | 'custom'
  inner: PaymentRail
}

export function embeddedWalletRail(opts: EmbeddedWalletRailOptions): PaymentRail {
  return {
    ...opts.inner,
    kind: 'embedded-wallet',
    async quote(input) {
      return { ...(await opts.inner.quote(input)), rail: 'embedded-wallet', metadata: { ...input.metadata, walletProvider: opts.walletProvider } }
    },
    async requestPayment(order) {
      return { ...(await opts.inner.requestPayment(order)), rail: 'embedded-wallet', metadata: { ...order.metadata, walletProvider: opts.walletProvider, innerRail: opts.inner.kind } }
    },
    async verifyPayment(request) {
      return { ...(await opts.inner.verifyPayment(request)), rail: 'embedded-wallet' }
    },
  }
}
