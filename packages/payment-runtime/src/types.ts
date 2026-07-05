export type PaymentRailKind =
  | 'solana-pay'
  | 'escrow'
  | 'x402'
  | 'pay-sh'
  | 'spl-usdc'
  | 'allowance'
  | 'embedded-wallet'
  | 'payout'

export type PaymentCurrency = 'SOL' | 'USDC' | 'PYUSD' | 'USDG'

export interface PaymentQuoteInput {
  service: string
  buyer: string
  seller?: string
  amount?: number
  currency?: PaymentCurrency
  metadata?: Record<string, unknown>
}

export interface PaymentQuote {
  rail: PaymentRailKind
  service: string
  amount: string
  currency: PaymentCurrency
  buyer: string
  seller?: string
  expiresAt?: string
  metadata?: Record<string, unknown>
}

export interface MarketOrder {
  id: string
  round?: number
  service: string
  buyer: string
  seller?: string
  amount: string
  currency: PaymentCurrency
  rail?: PaymentRailKind
  metadata?: Record<string, unknown>
}

export interface PaymentRequest {
  id: string
  rail: PaymentRailKind
  orderId: string
  amount: string
  currency: PaymentCurrency
  buyer: string
  seller?: string
  payTo?: string
  url?: string
  reference?: string
  memo?: string
  headers?: Record<string, string>
  body?: unknown
  expiresAt?: string
  metadata?: Record<string, unknown>
}

export interface PaymentVerification {
  paid: boolean
  rail: PaymentRailKind
  proof?: string
  txSignature?: string
  amount: string
  currency: PaymentCurrency
  payer?: string
  recipient?: string
  reference?: string
  reason?: string
  metadata?: Record<string, unknown>
}

export interface SettlementResult {
  settled: boolean
  rail: PaymentRailKind
  orderId: string
  txSignature?: string
  amount: string
  currency: PaymentCurrency
  reason?: string
  metadata?: Record<string, unknown>
}

export interface PaymentRail {
  kind: PaymentRailKind
  quote(input: PaymentQuoteInput): Promise<PaymentQuote>
  requestPayment(order: MarketOrder): Promise<PaymentRequest>
  verifyPayment(request: PaymentRequest): Promise<PaymentVerification>
  release?(order: MarketOrder): Promise<SettlementResult>
  refund?(order: MarketOrder): Promise<SettlementResult>
}

export function money(amount: string | number | undefined, fallback = '0'): string {
  if (amount == null) return fallback
  const value = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid payment amount: ${amount}`)
  return String(amount)
}

export function requestId(prefix: PaymentRailKind, orderId: string): string {
  return `${prefix}:${orderId}:${Date.now().toString(36)}`
}
