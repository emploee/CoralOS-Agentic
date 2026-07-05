import type { PaymentCurrency } from '../types.js'

export interface AllowancePolicy {
  maxPerCall?: number
  maxPerDay?: number
  spentToday?: number
  allowedProviders?: string[]
  allowedServices?: string[]
  allowedCurrencies?: PaymentCurrency[]
  expiresAt?: string
}

export interface AllowanceAction {
  service: string
  amount: number
  currency: PaymentCurrency
  provider?: string
  now?: string
}

export function enforceAllowance(action: AllowanceAction, policy: AllowancePolicy): void {
  const violations: string[] = []
  if (policy.maxPerCall != null && action.amount > policy.maxPerCall) violations.push(`per-call cap ${policy.maxPerCall} exceeded by ${action.amount}`)
  if (policy.maxPerDay != null && (policy.spentToday ?? 0) + action.amount > policy.maxPerDay) violations.push(`daily cap ${policy.maxPerDay} exceeded`)
  if (policy.allowedServices?.length && !policy.allowedServices.includes(action.service)) violations.push(`service not allowed: ${action.service}`)
  if (policy.allowedProviders?.length && action.provider && !policy.allowedProviders.includes(action.provider)) violations.push(`provider not allowed: ${action.provider}`)
  if (policy.allowedCurrencies?.length && !policy.allowedCurrencies.includes(action.currency)) violations.push(`currency not allowed: ${action.currency}`)
  if (policy.expiresAt && Date.parse(action.now ?? new Date().toISOString()) > Date.parse(policy.expiresAt)) violations.push(`allowance expired at ${policy.expiresAt}`)
  if (violations.length) throw new Error(`Allowance denied: ${violations.join('; ')}`)
}
