export interface MerchantPolicy {
  allowedMerchants?: string[]
  blockedMerchants?: string[]
}

export function assertMerchantAllowed(merchant: string, policy: MerchantPolicy): void {
  if (policy.blockedMerchants?.includes(merchant)) throw new Error(`Merchant blocked: ${merchant}`)
  if (policy.allowedMerchants?.length && !policy.allowedMerchants.includes(merchant)) {
    throw new Error(`Merchant not allowed: ${merchant}`)
  }
}
