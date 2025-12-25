/**
 * Price Streaming Service
 *
 * Real-time token price streaming via WebSocket and cached reads via REST.
 * Uses the shared cache service for distributed price storage.
 */

import {
  type CacheClient,
  type CacheStats,
  getCacheClient,
} from '@jejunetwork/shared'
import { expectJson } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import {
  getPriceAggregator,
  type TokenPrice,
} from '../../solver/external/price-aggregator'
import type { SolanaTokenPrice } from '../../solver/external/solana-price-aggregator'
import { getSolanaPriceAggregator as createSolanaPriceAggregator } from '../../solver/external/solana-price-aggregator'

// Optional/conditional: Solana aggregator may fail due to buffer-layout compatibility issues
let _solanaAggregator: ReturnType<typeof createSolanaPriceAggregator> | null =
  null
async function getSolanaAggregator() {
  if (!_solanaAggregator) {
    try {
      _solanaAggregator = createSolanaPriceAggregator()
    } catch (err) {
      console.warn('[PriceService] Solana aggregator unavailable:', err)
      return null
    }
  }
  return _solanaAggregator
}
// Schema for cached price data (subset of full TokenPrice)
const CachedPriceSchema = z.object({
  address: z.string(),
  chainId: z.number(),
  symbol: z.string(),
  priceUSD: z.number(),
  priceETH: z.number(),
  confidence: z.number(),
  sources: z.array(
    z.object({
      dex: z.string(),
      pool: z.string(),
      price: z.number(),
      liquidity: z.number(),
      lastUpdate: z.number(),
    }),
  ),
  timestamp: z.number(),
  liquidityUSD: z.number(),
})

const TokenAddressArraySchema = z.array(z.string())

const EthPriceSchema = z.object({
  price: z.number(),
  timestamp: z.number(),
})

const SubscriptionMessageSchema = z.object({
  type: z.enum(['subscribe', 'unsubscribe']),
  tokens: z
    .array(z.object({ chainId: z.number(), address: z.string() }))
    .optional(),
  chains: z.array(z.number()).optional(),
})
export interface SubscribableWebSocket {
  readonly readyState: number
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void
}

const WS_OPEN = 1

interface PriceUpdate {
  type: 'price_update'
  chainId: number
  token: string
  priceUSD: number
  priceChange24h: number
  volume24h: string
  timestamp: number
}

interface SubscriptionMessage {
  type: 'subscribe' | 'unsubscribe'
  tokens?: Array<{ chainId: number; address: string }>
  chains?: number[]
}
const CACHE_NAMESPACE = 'prices'
const PRICE_TTL = 30 // 30 seconds
const ETH_PRICE_TTL = 60 // 1 minute

function priceKey(chainId: number, address: string): string {
  return `price:${chainId}:${address.toLowerCase()}`
}

function chainPricesKey(chainId: number): string {
  return `prices:chain:${chainId}`
}

function ethPriceKey(chainId: number): string {
  return `price:eth:${chainId}`
}
class InMemoryCache implements CacheClient {
  private store = new Map<string, { value: string; expires: number }>()

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key)
    if (!item) return null
    if (Date.now() > item.expires) {
      this.store.delete(key)
      return null
    }
    return item.value
  }

  async set(key: string, value: string, ttl = 3600): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttl * 1000 })
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  async mget(keys: string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>()
    for (const key of keys) {
      result.set(key, await this.get(key))
    }
    return result
  }

  async mset(
    entries: Array<{ key: string; value: string; ttl?: number }>,
  ): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.ttl)
    }
  }

  async keys(_pattern?: string): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key)
    if (!item) return -2
    const remaining = Math.floor((item.expires - Date.now()) / 1000)
    return remaining > 0 ? remaining : -1
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const item = this.store.get(key)
    if (!item) return false
    item.expires = Date.now() + ttl * 1000
    return true
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async getStats(): Promise<CacheStats> {
    return {
      totalKeys: this.store.size,
      namespaces: 1,
      usedMemoryMb: 0,
      totalMemoryMb: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalInstances: 1,
    }
  }
}
class PriceStreamingService {
  private cache: CacheClient
  private fallbackCache = new InMemoryCache()
  private cacheAvailable = true
  private evmAggregator = getPriceAggregator()
  private subscribers = new Map<SubscribableWebSocket, Set<string>>()
  private updateInterval: Timer | null = null
  private running = false

  constructor() {
    this.cache = getCacheClient(CACHE_NAMESPACE)
    this.checkCacheAvailability()
  }

  private async checkCacheAvailability(): Promise<void> {
    try {
      await this.getCache().get('__health_check__')
      this.cacheAvailable = true
    } catch {
      console.warn(
        '[PriceService] Cache service unavailable, using in-memory fallback',
      )
      this.cacheAvailable = false
    }
  }

  private getCache(): CacheClient {
    return this.cacheAvailable ? this.cache : this.fallbackCache
  }

  start(): void {
    if (this.running) return
    this.running = true

    this.updateInterval = setInterval(() => {
      this.pollPrices().catch(console.error)
    }, 10_000)

    this.pollPrices().catch(console.error)
    console.log('[PriceService] Started price polling')
  }

  stop(): void {
    this.running = false
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
    console.log('[PriceService] Stopped price polling')
  }

  private async pollPrices(): Promise<void> {
    // In development mode without network access, skip external chain price polling
    const isDev = process.env.NODE_ENV !== 'production'
    const chains = [1, 42161, 10, 8453]

    for (const chainId of chains) {
      try {
        const ethPrice = await this.evmAggregator.getETHPrice(chainId)
        if (ethPrice > 0) {
          await this.getCache().set(
            ethPriceKey(chainId),
            JSON.stringify({ price: ethPrice, timestamp: Date.now() }),
            ETH_PRICE_TTL,
          )
        }
      } catch (error) {
        if (isDev) {
          // Silently skip in dev mode
        } else {
          console.warn(
            `[PriceService] Failed to get ETH price for chain ${chainId}:`,
            error,
          )
        }
      }
    }

    for (const chainId of chains) {
      const tokensJson = await this.getCache().get(chainPricesKey(chainId))
      if (!tokensJson) continue

      const tokenAddresses = expectJson(
        tokensJson,
        TokenAddressArraySchema,
        'token addresses',
      )

      for (const address of tokenAddresses) {
        const price = await this.evmAggregator.getPrice(
          address as Address,
          chainId,
        )
        if (price) {
          await this.updateTokenPrice(chainId, address, price)
        }
      }
    }
  }

  private async updateTokenPrice(
    chainId: number,
    address: string,
    price: TokenPrice,
  ): Promise<void> {
    const key = priceKey(chainId, address)
    const cached = await this.getCache().get(key)

    let priceChange24h = 0
    if (cached) {
      const prev = expectJson(
        cached,
        CachedPriceSchema,
        'cached price',
      ) as TokenPrice
      if (prev.priceUSD > 0) {
        priceChange24h =
          ((price.priceUSD - prev.priceUSD) / prev.priceUSD) * 100
      }
    }

    await this.getCache().set(key, JSON.stringify(price), PRICE_TTL)

    const update: PriceUpdate = {
      type: 'price_update',
      chainId,
      token: address,
      priceUSD: price.priceUSD,
      priceChange24h,
      volume24h: price.liquidityUSD.toString(),
      timestamp: Date.now(),
    }

    this.broadcast(key, update)
  }

  private broadcast(key: string, update: PriceUpdate): void {
    const message = JSON.stringify(update)

    for (const [ws, subscriptions] of this.subscribers) {
      if (
        subscriptions.has(key) ||
        subscriptions.has(`chain:${update.chainId}`)
      ) {
        if (ws.readyState === WS_OPEN) {
          ws.send(message)
        }
      }
    }
  }

  async getPrice(chainId: number, address: string): Promise<TokenPrice | null> {
    const cached = await this.getCache().get(priceKey(chainId, address))
    return cached
      ? (expectJson(cached, CachedPriceSchema, 'price cache') as TokenPrice)
      : null
  }

  async getPrices(
    tokens: Array<{ chainId: number; address: string }>,
  ): Promise<Map<string, TokenPrice>> {
    const keys = tokens.map((t) => priceKey(t.chainId, t.address))
    const results = await this.getCache().mget(keys)

    const prices = new Map<string, TokenPrice>()
    for (const [key, value] of results) {
      if (value) {
        prices.set(
          key,
          expectJson(value, CachedPriceSchema, 'batch price') as TokenPrice,
        )
      }
    }
    return prices
  }

  async getETHPrice(chainId: number): Promise<number> {
    const cached = await this.getCache().get(ethPriceKey(chainId))
    if (cached) {
      const data = expectJson(cached, EthPriceSchema, 'ETH price cache')
      return data.price
    }
    return this.evmAggregator.getETHPrice(chainId)
  }

  async trackToken(chainId: number, address: string): Promise<void> {
    const key = chainPricesKey(chainId)
    const existing = await this.getCache().get(key)
    const tokens = existing
      ? expectJson(existing, TokenAddressArraySchema, 'tracked tokens')
      : []

    if (!tokens.includes(address.toLowerCase())) {
      tokens.push(address.toLowerCase())
      await this.getCache().set(key, JSON.stringify(tokens))
    }
  }

  subscribe(ws: SubscribableWebSocket, msg: SubscriptionMessage): void {
    if (!this.subscribers.has(ws)) {
      this.subscribers.set(ws, new Set())
    }
    const subs = this.subscribers.get(ws)

    if (msg.tokens) {
      for (const t of msg.tokens) {
        subs?.add(priceKey(t.chainId, t.address))
        this.trackToken(t.chainId, t.address)
      }
    }

    if (msg.chains) {
      for (const chainId of msg.chains) {
        subs?.add(`chain:${chainId}`)
      }
    }
  }

  unsubscribe(ws: SubscribableWebSocket, msg: SubscriptionMessage): void {
    const subs = this.subscribers.get(ws)
    if (!subs) return

    if (msg.tokens) {
      for (const t of msg.tokens) {
        subs.delete(priceKey(t.chainId, t.address))
      }
    }

    if (msg.chains) {
      for (const chainId of msg.chains) {
        subs.delete(`chain:${chainId}`)
      }
    }
  }

  removeSubscriber(ws: SubscribableWebSocket): void {
    this.subscribers.delete(ws)
  }

  async getSolanaPrice(mint: string): Promise<SolanaTokenPrice | null> {
    const aggregator = await getSolanaAggregator()
    if (!aggregator) return null
    return aggregator.getPrice(mint)
  }

  getSubscriberCount(): number {
    return this.subscribers.size
  }
}
let priceService: PriceStreamingService | null = null

export function getPriceService(): PriceStreamingService {
  if (!priceService) {
    priceService = new PriceStreamingService()
    priceService.start()
  }
  return priceService
}
export function createPricesRouter() {
  const service = getPriceService()

  return (
    new Elysia({ name: 'prices', prefix: '/prices' })
      // Health check
      .get('/health', () => ({
        status: 'healthy',
        service: 'price-streaming',
        subscribers: service.getSubscriberCount(),
      }))

      // Get price for a single token
      .get(
        '/:chainId/:address',
        async ({ params, set }) => {
          const chainId = parseInt(params.chainId, 10)
          const price = await service.getPrice(chainId, params.address)
          if (!price) {
            // Fetch fresh if not cached
            const fresh = await getPriceAggregator().getPrice(
              params.address as Address,
              chainId,
            )
            if (!fresh) {
              set.status = 404
              return { error: 'Token not found' }
            }
            await service.trackToken(chainId, params.address)
            return fresh
          }

          return price
        },
        {
          params: t.Object({
            chainId: t.String({ pattern: '^\\d+$' }),
            address: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
          }),
        },
      )

      // Get prices for multiple tokens (batch)
      .post(
        '/batch',
        async ({ body }) => {
          const prices = await service.getPrices(body.tokens)

          const result: Record<string, TokenPrice> = {}
          for (const [key, value] of prices) {
            result[key] = value
          }

          return { prices: result }
        },
        {
          body: t.Object({
            tokens: t.Array(
              t.Object({
                chainId: t.Number(),
                address: t.String(),
              }),
            ),
          }),
        },
      )

      // Get ETH price for a chain
      .get(
        '/eth/:chainId',
        async ({ params }) => {
          const chainId = parseInt(params.chainId, 10)
          const price = await service.getETHPrice(chainId)
          return { chainId, priceUSD: price, timestamp: Date.now() }
        },
        {
          params: t.Object({
            chainId: t.String({ pattern: '^\\d+$' }),
          }),
        },
      )

      // Track a token for price updates
      .post(
        '/track',
        async ({ body }) => {
          await service.trackToken(body.chainId, body.address)
          return { success: true }
        },
        {
          body: t.Object({
            chainId: t.Number(),
            address: t.String(),
          }),
        },
      )

      // Get Solana token price
      .get(
        '/solana/:mint',
        async ({ params, set }) => {
          const price = await service.getSolanaPrice(params.mint)
          if (!price) {
            set.status = 404
            return { error: 'Token not found' }
          }
          return price
        },
        {
          params: t.Object({
            mint: t.String(),
          }),
        },
      )
  )
}
interface BrowserWebSocket extends SubscribableWebSocket {
  addEventListener(
    type: 'message',
    listener: (event: { data: string | ArrayBuffer }) => void,
  ): void
  addEventListener(type: 'close' | 'error', listener: () => void): void
}

export function handlePriceWebSocket(ws: BrowserWebSocket): void {
  const service = getPriceService()

  ws.addEventListener('message', (event) => {
    // WebSocket text messages are always strings - binary ArrayBuffer is not supported for JSON
    if (typeof event.data !== 'string') {
      console.warn('[PriceService] Received binary message, expected JSON text')
      return
    }
    const parseResult = SubscriptionMessageSchema.safeParse(
      JSON.parse(event.data),
    )
    if (!parseResult.success) {
      console.warn(
        '[PriceService] Invalid WebSocket message:',
        parseResult.error,
      )
      return
    }
    const msg = parseResult.data

    if (msg.type === 'subscribe') {
      service.subscribe(ws, msg)
      ws.send(JSON.stringify({ type: 'subscribed', success: true }))
    } else if (msg.type === 'unsubscribe') {
      service.unsubscribe(ws, msg)
      ws.send(JSON.stringify({ type: 'unsubscribed', success: true }))
    }
  })

  ws.addEventListener('close', () => {
    service.removeSubscriber(ws)
  })

  ws.addEventListener('error', () => {
    service.removeSubscriber(ws)
  })
}

export type PricesRoutes = ReturnType<typeof createPricesRouter>
export { PriceStreamingService }
