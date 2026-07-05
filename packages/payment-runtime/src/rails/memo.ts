import type { MarketOrder } from '../types.js'

export function settlementMemo(order: MarketOrder, extra: Record<string, string | number | undefined> = {}): string {
  const fields: Record<string, string | number | undefined> = {
    order: order.id,
    round: order.round,
    service: order.service,
    rail: order.rail,
    currency: order.currency,
    ...extra,
  }
  return Object.entries(fields)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_')}`)
    .join(' ')
    .slice(0, 180)
}
