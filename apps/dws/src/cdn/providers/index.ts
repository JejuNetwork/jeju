/**
 * CDN Provider Interface
 *
 * This module defines the interface for CDN providers. The actual provider
 * implementations are deployed infrastructure (CloudFront, Cloudflare, Fleek,
 * Pipe, etc.) managed through vendor/cloud and packages/deployment.
 *
 * The core CDN app only defines the interface - no vendor-specific code here.
 */

import type { CDNProviderType, CDNRegion } from '@jejunetwork/types'
import { z } from 'zod'
import type { CDNProviderAdapter, ProviderMetrics } from '../types'

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Generic CDN provider that connects to deployed infrastructure.
 * Actual implementations (CloudFront, Cloudflare, etc.) are:
 * - Deployed via packages/deployment terraform
 * - Configured in vendor/cloud
 * - Accessed via standard HTTP endpoints
 */
export interface DeployedCDNProvider {
  /** Provider identifier */
  id: string
  /** Provider type */
  type: CDNProviderType
  /** Provider endpoint (gateway URL) */
  endpoint: string
  /** Supported regions */
  regions: CDNRegion[]
  /** Whether provider is healthy */
  healthy: boolean
}

const DeployedCDNProviderSchema = z.object({
  id: z.string(),
  type: z.string(),
  endpoint: z.string(),
  regions: z.array(z.string()),
  healthy: z.boolean(),
})

const ProvidersResponseSchema = z.object({
  providers: z.array(DeployedCDNProviderSchema),
})

/**
 * HTTP-based provider adapter that works with any deployed CDN gateway
 */
export class HTTPProviderAdapter implements CDNProviderAdapter {
  name: string
  type: CDNProviderType

  private endpoint: string
  private apiKey?: string
  private metrics: ProviderMetrics = {
    totalRequests: 0,
    totalBytes: 0,
    avgLatency: 0,
    errorRate: 0,
    cacheHitRate: 0,
  }

  constructor(config: {
    name: string
    type: CDNProviderType
    endpoint: string
    apiKey?: string
  }) {
    this.name = config.name
    this.type = config.type
    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
  }

  async fetch(
    url: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: Buffer
      timeout?: number
    } = {},
  ): Promise<{
    success: boolean
    status: number
    headers: Record<string, string>
    body: Buffer
    latencyMs: number
    origin: string
    error?: string
  }> {
    const startTime = Date.now()
    const fullUrl = url.startsWith('http') ? url : `${this.endpoint}${url}`

    const headers: Record<string, string> = {
      ...options.headers,
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await fetch(fullUrl, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? new Uint8Array(options.body) : undefined,
      signal: options.timeout
        ? AbortSignal.timeout(options.timeout)
        : undefined,
    }).catch((e: Error) => ({ error: e.message }))

    if ('error' in response) {
      this.metrics.totalRequests++
      return {
        success: false,
        status: 0,
        headers: {},
        body: Buffer.from(''),
        latencyMs: Date.now() - startTime,
        origin: this.name,
        error: response.error,
      }
    }

    const latencyMs = Date.now() - startTime
    const body = Buffer.from(await response.arrayBuffer())

    this.metrics.totalRequests++
    this.metrics.totalBytes += body.length
    this.metrics.avgLatency = (this.metrics.avgLatency + latencyMs) / 2

    return {
      success: response.ok,
      status: response.status,
      headers: this.headersToRecord(response.headers),
      body,
      latencyMs,
      origin: this.name,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  }

  async purge(
    paths: string[],
  ): Promise<{ success: boolean; pathsPurged: number; error?: string }> {
    const response = await fetch(`${this.endpoint}/_cdn/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ paths }),
    }).catch((e: Error) => ({ error: e.message }))

    if ('error' in response) {
      return { success: false, pathsPurged: 0, error: response.error }
    }

    if (!response.ok) {
      return {
        success: false,
        pathsPurged: 0,
        error: `HTTP ${response.status}`,
      }
    }

    return { success: true, pathsPurged: paths.length }
  }

  async warmup(urls: string[]): Promise<{
    success: boolean
    urlsWarmed: number
    bytesWarmed: number
    errors?: Array<{ url: string; error: string }>
  }> {
    let success = 0
    let bytesWarmed = 0
    const errors: Array<{ url: string; error: string }> = []

    for (const url of urls) {
      const result = await this.fetch(url)
      if (result.success) {
        success++
        bytesWarmed += result.body.length
      } else {
        errors.push({ url, error: result.error ?? 'Unknown error' })
      }
    }

    return {
      success: errors.length === 0,
      urlsWarmed: success,
      bytesWarmed,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  async isHealthy(): Promise<boolean> {
    const result = await this.fetch('/_cdn/health', { timeout: 5000 })
    return result.success
  }

  async getMetrics(): Promise<ProviderMetrics> {
    return { ...this.metrics }
  }

  getRegions(): CDNRegion[] {
    return ['global']
  }

  private headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value
    })
    return result
  }
}

/**
 * Create a provider adapter from endpoint configuration
 */
export function createProviderFromEndpoint(config: {
  name: string
  type: CDNProviderType
  endpoint: string
  apiKey?: string
}): HTTPProviderAdapter {
  return new HTTPProviderAdapter(config)
}

/**
 * Discover deployed providers from coordinator
 */
export async function discoverProviders(
  coordinatorUrl: string,
): Promise<DeployedCDNProvider[]> {
  const response = await fetch(`${coordinatorUrl}/providers`).catch(
    (err: Error) => {
      console.warn(
        `[CDN Providers] Failed to discover providers from ${coordinatorUrl}: ${err.message}`,
      )
      return null
    },
  )

  if (!response?.ok) {
    return []
  }

  const rawData: unknown = await response.json()
  const result = ProvidersResponseSchema.safeParse(rawData)
  if (!result.success) {
    console.warn('[CDN Providers] Invalid provider response:', result.error.message)
    return []
  }
  return result.data.providers as DeployedCDNProvider[]
}
