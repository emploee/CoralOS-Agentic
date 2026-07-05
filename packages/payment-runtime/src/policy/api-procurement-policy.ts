import type { PaymentCurrency } from '../types.js'
import { enforceAllowance, type AllowancePolicy } from './spend-policy.js'

export interface ApiProcurement {
  provider: string
  service: string
  amount: number
  currency: PaymentCurrency
}

export function assertApiProcurementAllowed(procurement: ApiProcurement, policy: AllowancePolicy): void {
  enforceAllowance(procurement, policy)
}
