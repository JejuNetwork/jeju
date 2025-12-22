/**
 * Price Streaming Service
 *
 * Real-time token price streaming via WebSocket and cached reads via REST.
 * Uses the shared cache service for distributed price storage.
 *
 * Architecture:
 * 1. Price Aggregators (EVM + Solana) poll prices periodically
 * 2. Prices cached in shared cache service with pub/sub
 * 3. WebSocket connections receive real-time updates
 * 4. REST endpoints for cached reads (frontend can query directly)
 *
 * Cache Keys:
 * - price:{chainId}:{address} - Individual token prices
 * - prices:chain:{chainId} - List of all tokens on chain
 * - price:eth:{chainId} - ETH price for chain
 * - candle:{chainId}:{address}:{interval}:{timestamp} - OHLCV candles
 */

import {
  type CacheClient,
  type CacheStats,
  getCacheClient,
} from '@jejunetwork/shared'
import { Hono } from 'hono'
import type { Address } from 'viem'
import { z } from 'zod'
import {
  getPriceAggregator,
  type TokenPrice,
} from '../../solver/external/price-aggregator'
import type { SolanaTokenPrice } from '../../solver/external/solana-price-aggregator'

// Lazy load Solana price aggregator to avoid buffer-layout compatibility issues
let _solanaAggregator: Awaited<
  ReturnType<
    typeof import('../../solver/external/solana-price-aggregator').getSolanaPriceAggregator
  >
> | null = null
async function getSolanaAggregator() {
  if (!_solanaAggregator) {
    try {
      const mod = await import('../../solver/external/solana-price-aggregator')
      _solanaAggregator = mod.getSolanaPriceAggregator()
    } catch (err) {
      console.warn('[PriceService] Solana aggregator unavailable:', err)
      return null
    }
  }
  return _solanaAggregator
}

// ============ Types ============

/**
 * Minimal WebSocket interface compatible with both Bun's ServerWebSocket and browser WebSocket.
 * Only includes the methods actually used by PriceStreamingService.
 */
export interface SubscribableWebSocket {
  readonly readyState: number
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void
}

/** WebSocket.OPEN constant */
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

// ============ Cache Keys ============

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

// ============ In-Memory Fallback Cache ============

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

// ============ Price Cache Service ============

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
    // Test cache availability
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

  /**
   * Start the price polling loop
   */
  start(): void {
    if (this.running) return
    this.running = true

    // Poll prices every 10 seconds
    this.updateInterval = setInterval(() => {
      this.pollPrices().catch(console.error)
    }, 10_000)

    // Initial poll
    this.pollPrices().catch(console.error)
    console.log('[PriceService] Started price polling')
  }

  /**
   * Stop the price polling loop
   */
  stop(): void {
    this.running = false
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
    console.log('[PriceService] Stopped price polling')
  }

  /**
   * Poll prices from aggregators and update cache
   */
  private async pollPrices(): Promise<void> {
    const chains = [1, 42161, 10, 8453] // Ethereum, Arbitrum, Optimism, Base

    // Update ETH prices for all chains
    for (const chainId of chains) {
      const ethPrice = await this.evmAggregator
        .getETHPrice(chainId)
        .catch(() => 0)
      if (ethPrice > 0) {
        await this.getCache().set(
          ethPriceKey(chainId),
          JSON.stringify({ price: ethPrice, timestamp: Date.now() }),
          ETH_PRICE_TTL,
        )
      }
    }

    // Get tracked tokens from cache
    for (const chainId of chains) {
      const tokensJson = await this.getCache().get(chainPricesKey(chainId))
      if (!tokensJson) continue

      const tokenAddresses: string[] = JSON.parse(tokensJson)

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

  /**
   * Update a token's price in cache and notify subscribers
   */
  private async updateTokenPrice(
    chainId: number,
    address: string,
    price: TokenPrice,
  ): Promise<void> {
    const key = priceKey(chainId, address)
    const cached = await this.getCache().get(key)

    // Calculate 24h change if we have previous price
    let priceChange24h = 0
    if (cached) {
      const prev = JSON.parse(cached) as TokenPrice
      if (prev.priceUSD > 0) {
        priceChange24h =
          ((price.priceUSD - prev.priceUSD) / prev.priceUSD) * 100
      }
    }

    // Cache the price
    await this.getCache().set(key, JSON.stringify(price), PRICE_TTL)

    // Notify WebSocket subscribers
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

  /**
   * Broadcast update to all subscribers of a token
   */
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

  /**
   * Get cached price for a token
   */
  async getPrice(chainId: number, address: string): Promise<TokenPrice | null> {
    const cached = await this.getCache().get(priceKey(chainId, address))
    return cached ? JSON.parse(cached) : null
  }

  /**
   * Get cached prices for multiple tokens
   */
  async getPrices(
    tokens: Array<{ chainId: number; address: string }>,
  ): Promise<Map<string, TokenPrice>> {
    const keys = tokens.map((t) => priceKey(t.chainId, t.address))
    const results = await this.getCache().mget(keys)

    const prices = new Map<string, TokenPrice>()
    for (const [key, value] of results) {
      if (value) {
        prices.set(key, JSON.parse(value))
      }
    }
    return prices
  }

  /**
   * Get ETH price for a chain
   */
  async getETHPrice(chainId: number): Promise<number> {
    const cached = await this.getCache().get(ethPriceKey(chainId))
    if (cached) {
      const data = JSON.parse(cached)
      return data.price
    }
    return this.evmAggregator.getETHPrice(chainId)
  }

  /**
   * Track a token for price updates
   */
  async trackToken(chainId: number, address: string): Promise<void> {
    const key = chainPricesKey(chainId)
    const existing = await this.getCache().get(key)
    const tokens: string[] = existing ? JSON.parse(existing) : []

    if (!tokens.includes(address.toLowerCase())) {
      tokens.push(address.toLowerCase())
      await this.getCache().set(key, JSON.stringify(tokens))
    }
  }

  /**
   * Subscribe a WebSocket to price updates
   */
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

  /**
   * Unsubscribe a WebSocket from price updates
   */
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

  /**
   * Remove a WebSocket from all subscriptions
   */
  removeSubscriber(ws: SubscribableWebSocket): void {
    this.subscribers.delete(ws)
  }

  /**
   * Get Solana token price
   */
  async getSolanaPrice(mint: string): Promise<SolanaTokenPrice | null> {
    const aggregator = await getSolanaAggregator()
    if (!aggregator) return null
    return aggregator.getPrice(mint)
  }
}

// ============ Singleton Service ============

let priceService: PriceStreamingService | null = null

function getPriceService(): PriceStreamingService {
  if (!priceService) {
    priceService = new PriceStreamingService()
    priceService.start()
  }
  return priceService
}

// ============ Validation Schemas ============

const GetPriceParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

const GetPricesBodySchema = z.object({
  tokens: z.array(
    z.object({
      chainId: z.number(),
      address: z.string(),
    }),
  ),
})

const TrackTokenBodySchema = z.object({
  chainId: z.number(),
  address: z.string(),
})

// ============ Router ============

export function createPricesRouter(): Hono {
  const router = new Hono()
  const service = getPriceService()

  /**
   * Health check
   */
  router.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      service: 'price-streaming',
      subscribers: priceService?.subscribers.size ?? 0,
    })
  })

  /**
   * Get price for a single token
   */
  router.get('/:chainId/:address', async (c) => {
    const params = GetPriceParamsSchema.parse({
      chainId: c.req.param('chainId'),
      address: c.req.param('address'),
    })

    const price = await service.getPrice(params.chainId, params.address)
    if (!price) {
      // Fetch fresh if not cached
      const fresh = await getPriceAggregator().getPrice(
        params.address as Address,
        params.chainId,
      )
      if (!fresh) {
        return c.json({ error: 'Token not found' }, 404)
      }
      await service.trackToken(params.chainId, params.address)
      return c.json(fresh)
    }

    return c.json(price)
  })

  /**
   * Get prices for multiple tokens (batch)
   */
  router.post('/batch', async (c) => {
    const body = GetPricesBodySchema.parse(await c.req.json())
    const prices = await service.getPrices(body.tokens)

    // Convert Map to object
    const result: Record<string, TokenPrice> = {}
    for (const [key, value] of prices) {
      result[key] = value
    }

    return c.json({ prices: result })
  })

  /**
   * Get ETH price for a chain
   */
  router.get('/eth/:chainId', async (c) => {
    const chainId = parseInt(c.req.param('chainId'), 10)
    const price = await service.getETHPrice(chainId)
    return c.json({ chainId, priceUSD: price, timestamp: Date.now() })
  })

  /**
   * Track a token for price updates
   */
  router.post('/track', async (c) => {
    const body = TrackTokenBodySchema.parse(await c.req.json())
    await service.trackToken(body.chainId, body.address)
    return c.json({ success: true })
  })

  /**
   * Get Solana token price
   */
  router.get('/solana/:mint', async (c) => {
    const mint = c.req.param('mint')
    const price = await service.getSolanaPrice(mint)
    if (!price) {
      return c.json({ error: 'Token not found' }, 404)
    }
    return c.json(price)
  })

  return router
}

// ============ WebSocket Handler ============

/**
 * Browser WebSocket interface with event handling - used by handlePriceWebSocket
 */
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
    const msg = JSON.parse(event.data as string) as SubscriptionMessage

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

// ============ Exports ============

export { getPriceService, PriceStreamingService }
