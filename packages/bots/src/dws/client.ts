/**
 * DWS Client for Bots Package
 *
 * Provides decentralized API aggregation through DWS (Decentralized Web Services).
 * Handles authentication, rate limiting, and automatic failover between providers.
 */

import { getDwsApiKey, getDwsApiUrl } from '@jejunetwork/config'
import { z } from 'zod'

export interface DWSClientConfig {
  /** Base URL for DWS API Marketplace */
  baseUrl: string
  /** API key for DWS access */
  apiKey?: string
  /** Default timeout for requests in ms */
  timeout?: number
  /** Enable automatic retries on failure */
  autoRetry?: boolean
  /** Maximum retry attempts */
  maxRetries?: number
}

export interface DWSRequestOptions {
  /** Provider ID from DWS marketplace (e.g., 'coingecko', 'jupiter', 'openai') */
  providerId: string
  /** Endpoint path relative to provider base URL */
  endpoint: string
  /** HTTP method (defaults to GET) */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Query parameters */
  queryParams?: Record<string, string>
  /** Request body for POST/PUT */
  body?: Record<string, unknown>
  /** Custom headers */
  headers?: Record<string, string>
  /** Request timeout override */
  timeout?: number
}

export interface DWSResponse<T> {
  data: T
  /** Response status code */
  status: number
  /** Provider ID that served the request */
  providerId: string
  /** Request latency in ms */
  latencyMs: number
  /** Whether request was served from cache */
  cached: boolean
}

const DWSErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

export class DWSError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DWSError'
  }
}

export class DWSClient {
  private baseUrl: string
  private apiKey: string | undefined
  private timeout: number
  private autoRetry: boolean
  private maxRetries: number

  constructor(config: DWSClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.timeout = config.timeout ?? 30000
    this.autoRetry = config.autoRetry ?? true
    this.maxRetries = config.maxRetries ?? 3
  }

  /**
   * Make a request through DWS API Marketplace
   */
  async request<T>(options: DWSRequestOptions): Promise<DWSResponse<T>> {
    const startTime = Date.now()

    const url = this.buildUrl(options)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (this.apiKey) {
      headers['X-DWS-API-Key'] = this.apiKey
    }

    const fetchOptions: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(options.timeout ?? this.timeout),
    }

    if (options.body && (options.method === 'POST' || options.method === 'PUT')) {
      fetchOptions.body = JSON.stringify(options.body)
    }

    let lastError: Error | null = null
    const maxAttempts = this.autoRetry ? this.maxRetries : 1

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100))
      }

      const response = await fetch(url, fetchOptions)
      const latencyMs = Date.now() - startTime

      if (response.ok) {
        const data = (await response.json()) as T
        return {
          data,
          status: response.status,
          providerId: options.providerId,
          latencyMs,
          cached: response.headers.get('X-DWS-Cache-Hit') === 'true',
        }
      }

      // Handle error response
      const errorData = await response.json()
      const parsed = DWSErrorResponseSchema.safeParse(errorData)

      if (parsed.success) {
        lastError = new DWSError(
          parsed.data.error,
          parsed.data.code ?? 'UNKNOWN',
          response.status,
          parsed.data.details,
        )
      } else {
        lastError = new Error(`DWS request failed: ${response.status}`)
      }

      // Don't retry on client errors (4xx) except rate limits (429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        break
      }
    }

    throw lastError ?? new Error('DWS request failed')
  }

  /**
   * Make a GET request
   */
  async get<T>(
    providerId: string,
    endpoint: string,
    queryParams?: Record<string, string>,
  ): Promise<DWSResponse<T>> {
    return this.request<T>({
      providerId,
      endpoint,
      method: 'GET',
      queryParams,
    })
  }

  /**
   * Make a POST request
   */
  async post<T>(
    providerId: string,
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<DWSResponse<T>> {
    return this.request<T>({
      providerId,
      endpoint,
      method: 'POST',
      body,
    })
  }

  /**
   * Get RPC URL for a specific chain through DWS
   */
  getRpcUrl(chainId: number): string {
    return `${this.baseUrl}/rpc/${chainId}`
  }

  /**
   * Get all available providers
   */
  async getProviders(): Promise<
    DWSResponse<Array<{ id: string; name: string; categories: string[] }>>
  > {
    return this.request({
      providerId: 'dws',
      endpoint: '/providers',
      method: 'GET',
    })
  }

  /**
   * Check provider health
   */
  async checkProviderHealth(providerId: string): Promise<DWSResponse<{ healthy: boolean; latencyMs: number }>> {
    return this.request({
      providerId: 'dws',
      endpoint: `/providers/${providerId}/health`,
      method: 'GET',
    })
  }

  private buildUrl(options: DWSRequestOptions): string {
    // Route through DWS proxy: /api/marketplace/{providerId}/{endpoint}
    const path = `/api/marketplace/${options.providerId}${options.endpoint}`
    const url = new URL(path, this.baseUrl)

    if (options.queryParams) {
      for (const [key, value] of Object.entries(options.queryParams)) {
        url.searchParams.set(key, value)
      }
    }

    return url.toString()
  }
}

// Singleton instance
let sharedClient: DWSClient | null = null

/**
 * Get or create the shared DWS client instance
 */
export function getDWSClient(config?: DWSClientConfig): DWSClient {
  if (!sharedClient) {
    const defaultConfig: DWSClientConfig = {
      baseUrl: getDwsApiUrl(),
      apiKey: getDwsApiKey(),
      timeout: 30000,
      autoRetry: true,
      maxRetries: 3,
    }
    sharedClient = new DWSClient(config ?? defaultConfig)
  }
  return sharedClient
}

/**
 * Reset the shared client (useful for testing)
 */
export function resetDWSClient(): void {
  sharedClient = null
}
