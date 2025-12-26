/**
 * DWS Client for Bots Package
 *
 * Provides decentralized API aggregation through DWS (Decentralized Web Services)
 * for external data fetching, RPC calls, and price data.
 */

import type { Address } from 'viem'
import { z } from 'zod'

// Schemas for API responses
const DWSProxyResponseSchema = z.object({
  status: z.number(),
  headers: z.record(z.string()),
  body: z.unknown(),
  cost: z.bigint().optional(),
  latencyMs: z.number(),
  requestId: z.string(),
})

const DWSProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  categories: z.array(z.string()),
})

const DWSListingSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  pricePerRequest: z.bigint(),
  seller: z.string(),
})

export interface DWSClientConfig {
  /** DWS gateway URL */
  gatewayUrl: string
  /** User's wallet address for payments */
  userAddress: Address
  /** API key for DWS (optional if using on-chain auth) */
  apiKey?: string
  /** Default timeout in ms */
  timeout?: number
  /** Enable caching */
  enableCache?: boolean
  /** Cache TTL in seconds */
  cacheTtlSeconds?: number
}

export interface DWSRequestOptions {
  /** Provider ID (e.g., 'coingecko', 'alchemy', 'helius') */
  providerId: string
  /** API endpoint (relative to provider base URL) */
  endpoint: string
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Request body */
  body?: Record<string, unknown>
  /** Query parameters */
  queryParams?: Record<string, string>
  /** Additional headers */
  headers?: Record<string, string>
  /** Request timeout override */
  timeout?: number
}

export interface DWSResponse<T = unknown> {
  data: T
  status: number
  latencyMs: number
  cost: bigint
  requestId: string
  cached: boolean
}

// Default DWS gateway URL (local development or production)
const DEFAULT_GATEWAY_URL =
  process.env.DWS_GATEWAY_URL ?? 'http://localhost:3000/api/marketplace'

/**
 * DWS Client for decentralized API access
 *
 * Routes requests through DWS gateway which:
 * 1. Manages API key security via TEE-backed key vault
 * 2. Handles payments via on-chain deposits
 * 3. Provides rate limiting and access control
 * 4. Sanitizes responses to prevent credential leaks
 */
export class DWSClient {
  private config: Required<DWSClientConfig>
  private cache: Map<string, { data: unknown; expiresAt: number }> = new Map()
  private listingsCache: Map<string, { listing: unknown; expiresAt: number }> =
    new Map()

  constructor(config: Partial<DWSClientConfig> = {}) {
    this.config = {
      gatewayUrl: config.gatewayUrl ?? DEFAULT_GATEWAY_URL,
      userAddress:
        config.userAddress ?? ('0x0000000000000000000000000000000000000000' as Address),
      apiKey: config.apiKey ?? '',
      timeout: config.timeout ?? 30000,
      enableCache: config.enableCache ?? true,
      cacheTtlSeconds: config.cacheTtlSeconds ?? 60,
    }
  }

  /**
   * Make a request through DWS
   */
  async request<T>(options: DWSRequestOptions): Promise<DWSResponse<T>> {
    const cacheKey = this.getCacheKey(options)

    // Check cache
    if (this.config.enableCache && options.method === 'GET') {
      const cached = this.cache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return {
          data: cached.data as T,
          status: 200,
          latencyMs: 0,
          cost: 0n,
          requestId: 'cached',
          cached: true,
        }
      }
    }

    const startTime = Date.now()

    // Get listing for provider
    const listing = await this.getListing(options.providerId)
    if (!listing) {
      throw new Error(`No DWS listing found for provider: ${options.providerId}`)
    }

    // Build proxy request
    const proxyRequest = {
      listingId: listing.id,
      endpoint: options.endpoint,
      method: options.method ?? 'GET',
      body: options.body,
      queryParams: options.queryParams,
      headers: options.headers ?? {},
    }

    // Execute request through DWS gateway
    const response = await fetch(`${this.config.gatewayUrl}/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey
          ? { Authorization: `Bearer ${this.config.apiKey}` }
          : {}),
        'X-User-Address': this.config.userAddress,
      },
      body: JSON.stringify(proxyRequest),
      signal: AbortSignal.timeout(options.timeout ?? this.config.timeout),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `DWS request failed: ${response.status} - ${errorText}`,
      )
    }

    const result = await response.json()
    const parsed = DWSProxyResponseSchema.safeParse(result)

    if (!parsed.success) {
      throw new Error(`Invalid DWS response: ${parsed.error.message}`)
    }

    const data = parsed.data.body as T
    const latencyMs = Date.now() - startTime

    // Cache successful GET requests
    if (this.config.enableCache && options.method === 'GET') {
      this.cache.set(cacheKey, {
        data,
        expiresAt: Date.now() + this.config.cacheTtlSeconds * 1000,
      })
    }

    return {
      data,
      status: parsed.data.status,
      latencyMs,
      cost: parsed.data.cost ?? 0n,
      requestId: parsed.data.requestId,
      cached: false,
    }
  }

  /**
   * Get listing for a provider
   */
  private async getListing(
    providerId: string,
  ): Promise<z.infer<typeof DWSListingSchema> | null> {
    // Check cache
    const cached = this.listingsCache.get(providerId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.listing as z.infer<typeof DWSListingSchema>
    }

    const response = await fetch(
      `${this.config.gatewayUrl}/listings?providerId=${providerId}`,
      {
        headers: {
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
      },
    )

    if (!response.ok) {
      return null
    }

    const listings = (await response.json()) as Array<unknown>
    if (listings.length === 0) {
      return null
    }

    const parsed = DWSListingSchema.safeParse(listings[0])
    if (!parsed.success) {
      return null
    }

    // Cache listing for 5 minutes
    this.listingsCache.set(providerId, {
      listing: parsed.data,
      expiresAt: Date.now() + 300000,
    })

    return parsed.data
  }

  /**
   * Generate cache key for request
   */
  private getCacheKey(options: DWSRequestOptions): string {
    return `${options.providerId}:${options.endpoint}:${JSON.stringify(options.queryParams ?? {})}:${JSON.stringify(options.body ?? {})}`
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
    this.listingsCache.clear()
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<bigint> {
    const response = await fetch(
      `${this.config.gatewayUrl}/account/${this.config.userAddress}`,
      {
        headers: {
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
      },
    )

    if (!response.ok) {
      throw new Error('Failed to get balance')
    }

    const data = (await response.json()) as { balance: string }
    return BigInt(data.balance)
  }

  // Convenience methods for common APIs

  /**
   * Fetch price data from CoinGecko via DWS
   */
  async getCoinGeckoPrice(
    ids: string[],
    vsCurrencies: string[] = ['usd'],
  ): Promise<Record<string, Record<string, number>>> {
    const response = await this.request<Record<string, Record<string, number>>>({
      providerId: 'coingecko',
      endpoint: '/simple/price',
      queryParams: {
        ids: ids.join(','),
        vs_currencies: vsCurrencies.join(','),
      },
    })
    return response.data
  }

  /**
   * Fetch market chart from CoinGecko via DWS
   */
  async getCoinGeckoMarketChart(
    id: string,
    days: number,
    vsCurrency = 'usd',
  ): Promise<{
    prices: [number, number][]
    market_caps: [number, number][]
    total_volumes: [number, number][]
  }> {
    const response = await this.request<{
      prices: [number, number][]
      market_caps: [number, number][]
      total_volumes: [number, number][]
    }>({
      providerId: 'coingecko',
      endpoint: `/coins/${id}/market_chart`,
      queryParams: {
        vs_currency: vsCurrency,
        days: days.toString(),
      },
    })
    return response.data
  }

  /**
   * Make RPC call through Alchemy via DWS
   */
  async alchemyRpc(
    method: string,
    params: unknown[],
    network = 'eth-mainnet',
  ): Promise<unknown> {
    const response = await this.request({
      providerId: 'alchemy',
      endpoint: `/${network}`,
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        method,
        params,
        id: 1,
      },
    })

    const data = response.data as { result?: unknown; error?: { message: string } }
    if (data.error) {
      throw new Error(`Alchemy RPC error: ${data.error.message}`)
    }
    return data.result
  }

  /**
   * Fetch Solana data from Helius via DWS
   */
  async heliusGetAsset(mint: string): Promise<unknown> {
    const response = await this.request({
      providerId: 'helius',
      endpoint: '/v0/token-metadata',
      queryParams: {
        mint,
      },
    })
    return response.data
  }

  /**
   * Get token price from Birdeye via DWS
   */
  async birdeyeGetPrice(address: string): Promise<{
    value: number
    updateUnixTime: number
  }> {
    const response = await this.request<{
      data: { value: number; updateUnixTime: number }
    }>({
      providerId: 'birdeye',
      endpoint: '/defi/price',
      queryParams: {
        address,
      },
    })
    return response.data.data
  }

  /**
   * Get Etherscan transaction data via DWS
   */
  async etherscanGetTxList(
    address: string,
    startBlock = 0,
    endBlock = 99999999,
  ): Promise<unknown[]> {
    const response = await this.request<{ result: unknown[] }>({
      providerId: 'etherscan',
      endpoint: '',
      queryParams: {
        module: 'account',
        action: 'txlist',
        address,
        startblock: startBlock.toString(),
        endblock: endBlock.toString(),
        sort: 'desc',
      },
    })
    return response.data.result
  }
}

// Singleton instance
let dwsClientInstance: DWSClient | null = null

/**
 * Get shared DWS client instance
 */
export function getDWSClient(config?: Partial<DWSClientConfig>): DWSClient {
  if (!dwsClientInstance) {
    dwsClientInstance = new DWSClient(config)
  }
  return dwsClientInstance
}

/**
 * Reset DWS client instance (for testing)
 */
export function resetDWSClient(): void {
  dwsClientInstance = null
}

