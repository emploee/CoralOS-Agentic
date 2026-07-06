import { SOL_MINT, USDC_MINT } from './constants.js'
import { resolveFetch } from './connection.js'
import type { PythPrice, SolanaAgentToolOptions, TokenPrice } from './types.js'

function aliasMint(id: string): string {
  const token = id.trim()
  if (/^sol$/i.test(token)) return SOL_MINT
  if (/^usdc$/i.test(token)) return USDC_MINT
  return token
}

/** Fetch a read-only USD token price from Jupiter Price API V3. */
export async function fetchTokenPrice(
  id: string,
  opts: SolanaAgentToolOptions = {},
): Promise<TokenPrice> {
  const mint = aliasMint(id)
  const base = opts.jupiterPriceBaseUrl ?? 'https://api.jup.ag/price/v3'
  const url = new URL(base)
  url.searchParams.set('ids', mint)
  const headers: Record<string, string> = {}
  const apiKey = opts.jupiterApiKey ?? process.env.JUPITER_API_KEY
  if (apiKey) headers['x-api-key'] = apiKey
  const res = await resolveFetch(opts)(url, { headers })
  if (!res.ok) throw new Error(`Jupiter price ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const body = await res.json() as Record<string, unknown>
  const item = body[mint]
  if (!item || typeof item !== 'object') throw new Error(`Jupiter price missing for ${mint}`)
  const o = item as Record<string, unknown>
  const usdPrice = Number(o.usdPrice)
  if (!Number.isFinite(usdPrice)) throw new Error(`Jupiter price for ${mint} has no numeric usdPrice`)
  return {
    id: mint,
    usdPrice,
    ...(typeof o.decimals === 'number' ? { decimals: o.decimals } : {}),
    ...(typeof o.blockId === 'number' ? { blockId: o.blockId } : {}),
    ...(typeof o.liquidity === 'number' ? { liquidity: o.liquidity } : {}),
    ...(typeof o.priceChange24h === 'number' ? { priceChange24h: o.priceChange24h } : {}),
    ...(typeof o.createdAt === 'string' ? { createdAt: o.createdAt } : {}),
    provider: 'jupiter',
  }
}

/** Fetch a read-only latest price update from Pyth Hermes. */
export async function fetchPythPrice(
  priceFeedId: string,
  opts: SolanaAgentToolOptions = {},
): Promise<PythPrice> {
  const id = priceFeedId.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(id)) throw new Error('Pyth priceFeedId must be a 32-byte hex string')
  const base = opts.pythHermesBaseUrl ?? 'https://hermes.pyth.network/v2/updates/price/latest'
  const url = new URL(base)
  url.searchParams.append('ids[]', id)
  const res = await resolveFetch(opts)(url)
  if (!res.ok) throw new Error(`Pyth Hermes ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const body = await res.json() as { parsed?: Array<{ id?: string; price?: Record<string, unknown> }> }
  const parsed = body.parsed?.find((p) => p.id?.replace(/^0x/i, '').toLowerCase() === id.toLowerCase())
  const price = parsed?.price
  if (!price) throw new Error(`Pyth price missing for ${id}`)
  const rawPrice = String(price.price ?? '')
  const exponent = Number(price.expo)
  const confidenceRaw = String(price.conf ?? '')
  const publishTime = Number(price.publish_time)
  const scaled = Number(rawPrice) * 10 ** exponent
  const confidence = Number(confidenceRaw) * 10 ** exponent
  if (!Number.isFinite(scaled) || !Number.isFinite(confidence) || !Number.isFinite(publishTime)) {
    throw new Error(`Pyth price for ${id} is malformed`)
  }
  return {
    id,
    price: scaled,
    rawPrice,
    confidence,
    exponent,
    publishTime,
    provider: 'pyth-hermes',
  }
}
