/**
 * Origin Fetcher
 *
 * Fetches content from various origins:
 * - IPFS gateways
 * - S3/R2 buckets
 * - HTTP origins
 * - Arweave
 * - Vercel Blob
 *
 * Features:
 * - Automatic retries with backoff
 * - Health checking and failover
 * - Compression handling
 * - Range request support
 */

import { createHash, createHmac } from '@jejunetwork/shared'
import type {
  FetchOptions,
  OriginConfig,
  OriginFetchResult,
  OriginHealthCheck,
} from '../types'

// ============================================================================
// Origin Fetcher
// ============================================================================

export class OriginFetcher {
  private origins: Map<string, OriginConfig> = new Map()
  private healthStatus: Map<string, OriginHealthCheck> = new Map()
  private defaultOrigin: string | null = null

  constructor(origins: OriginConfig[]) {
    for (const origin of origins) {
      this.origins.set(origin.name, origin)
      this.healthStatus.set(origin.name, {
        origin: origin.name,
        healthy: true,
        latencyMs: 0,
        lastCheck: 0,
        consecutiveFailures: 0,
      })
    }
    if (origins.length > 0 && origins[0]) {
      this.defaultOrigin = origins[0].name
    }
  }

  /**
   * Fetch from origin
   */
  async fetch(
    path: string,
    originName?: string,
    options: FetchOptions = {},
  ): Promise<OriginFetchResult> {
    const origin = originName
      ? this.origins.get(originName)
      : this.getHealthyOrigin()

    if (!origin) {
      return {
        success: false,
        status: 503,
        headers: {},
        body: Buffer.from(''),
        latencyMs: 0,
        origin: originName ?? 'unknown',
        error: 'No healthy origin available',
      }
    }

    const startTime = Date.now()
    let lastError: string | undefined

    for (let attempt = 0; attempt <= origin.retries; attempt++) {
      const result = await this.fetchFromOrigin(origin, path, options)

      if (result.success) {
        this.recordSuccess(origin.name, Date.now() - startTime)
        return result
      }

      lastError = result.error

      // Exponential backoff
      if (attempt < origin.retries) {
        await this.delay(2 ** attempt * 100)
      }
    }

    this.recordFailure(origin.name)

    return {
      success: false,
      status: 502,
      headers: {},
      body: Buffer.from(''),
      latencyMs: Date.now() - startTime,
      origin: origin.name,
      error: lastError ?? 'All retries failed',
    }
  }

  /**
   * Fetch from specific origin
   */
  private async fetchFromOrigin(
    origin: OriginConfig,
    path: string,
    options: FetchOptions,
  ): Promise<OriginFetchResult> {
    const startTime = Date.now()

    switch (origin.type) {
      case 'ipfs':
        return this.fetchFromIPFS(origin, path, options, startTime)
      case 's3':
        return this.fetchFromS3(origin, path, options, startTime)
      case 'r2':
        return this.fetchFromR2(origin, path, options, startTime)
      case 'http':
        return this.fetchFromHTTP(origin, path, options, startTime)
      case 'arweave':
        return this.fetchFromArweave(origin, path, options, startTime)
      case 'vercel':
        return this.fetchFromVercel(origin, path, options, startTime)
      default:
        return {
          success: false,
          status: 500,
          headers: {},
          body: Buffer.from(''),
          latencyMs: 0,
          origin: origin.name,
          error: `Unsupported origin type: ${origin.type}`,
        }
    }
  }

  /**
   * Fetch from IPFS gateway
   */
  private async fetchFromIPFS(
    origin: OriginConfig,
    path: string,
    options: FetchOptions,
    startTime: number,
  ): Promise<OriginFetchResult> {
    // Path could be /ipfs/CID/path or just CID/path
    const url = path.startsWith('/ipfs/')
      ? `${origin.endpoint}${path}`
      : `${origin.endpoint}/ipfs/${path}`

    return this.doFetch(url, origin, options, startTime)
  }

  /**
   * Fetch from S3
   */
  private async fetchFromS3(
    origin: OriginConfig,
    path: string,
    options: FetchOptions,
    startTime: number,
  ): Promise<OriginFetchResult> {
    if (!origin.accessKeyId || !origin.secretAccessKey || !origin.bucket) {
      return {
        success: false,
        status: 500,
        headers: {},
        body: Buffer.from(''),
        latencyMs: 0,
        origin: origin.name,
        error: 'S3 credentials not configured',
      }
    }

    const region = origin.region ?? 'us-east-1'
    const bucket = origin.bucket
    const key = path.startsWith('/') ? path.slice(1) : path

    // Use endpoint if provided, otherwise construct S3 URL
    const host = origin.endpoint
      ? new URL(origin.endpoint).host
      : `${bucket}.s3.${region}.amazonaws.com`
    const url = origin.endpoint
      ? `${origin.endpoint}/${key}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${key}`

    const headers = await this.signS3Request(
      'GET',
      host,
      `/${key}`,
      region,
      origin.accessKeyId,
      origin.secretAccessKey,
    )

    return this.doFetch(
      url,
      origin,
      { ...options, headers: { ...options.headers, ...headers } },
      startTime,
    )
  }

  /**
   * Fetch from Cloudflare R2
   */
  private async fetchFromR2(
    origin: OriginConfig,
    path: string,
    options: FetchOptions,
    startTime: number,
  ): Promise<OriginFetchResult> {
    if (
      !origin.accessKeyId ||
      !origin.secretAccessKey ||
      !origin.accountId ||
      !origin.bucket
    ) {
      return {
        success: false,
        status: 500,
        headers: {},
        body: Buffer.from(''),
        latencyMs: 0,
        origin: origin.name,
        error: 'R2 credentials not configured',
      }
    }

    const bucket = origin.bucket
    const key = path.startsWith('/') ? path.slice(1) : path
    const host = `${origin.accountId}.r2.cloudflarestorage.com`
    const url = `https://${host}/${bucket}/${key}`

    const headers = await this.signS3Request(
      'GET',
      host,
      `/${bucket}/${key}`,
      'auto',
      origin.accessKeyId,
      origin.secretAccessKey,
    )

    return this.doFetch(
      url,
      origin,
      { ...options, headers: { ...options.headers, ...headers } },
      startTime,
    )
  }

  /**
   * Fetch from HTTP origin
   */
  private async fetchFromHTTP(
    origin: OriginConfig,
    path: string,
    options: FetchOptions,
    startTime: number,
  ): Promise<OriginFetchResult> {
    const url = `${origin.endpoint}${path}`
    return this.doFetch(url, origin, options, startTime)
  }

  /**
   * Fetch from Arweave
   */
  private async fetchFromArweave(
    origin: OriginConfig,
    path: string,
    options: FetchOptions,
    startTime: number,
  ): Promise<OriginFetchResult> {
    // Path is transaction ID
    const txId = path.startsWith('/') ? path.slice(1) : path
    const url = `${origin.endpoint}/${txId}`
    return this.doFetch(url, origin, options, startTime)
  }

  /**
   * Fetch from Vercel Blob
   */
  private async fetchFromVercel(
    origin: OriginConfig,
    path: string,
    options: FetchOptions,
    startTime: number,
  ): Promise<OriginFetchResult> {
    if (!origin.token) {
      return {
        success: false,
        status: 500,
        headers: {},
        body: Buffer.from(''),
        latencyMs: 0,
        origin: origin.name,
        error: 'Vercel token not configured',
      }
    }

    const url = `${origin.endpoint}${path}`
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${origin.token}`,
    }

    return this.doFetch(url, origin, { ...options, headers }, startTime)
  }

  /**
   * Perform actual fetch
   */
  private async doFetch(
    url: string,
    origin: OriginConfig,
    options: FetchOptions,
    startTime: number,
  ): Promise<OriginFetchResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), origin.timeout)

    const fetchHeaders: Record<string, string> = {
      ...origin.headers,
      ...options.headers,
      'Accept-Encoding': 'gzip, br, identity',
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: fetchHeaders,
      body: options.body ? new Uint8Array(options.body) : undefined,
      signal: controller.signal,
      redirect: options.followRedirects !== false ? 'follow' : 'manual',
    })
      .catch((e: Error) => {
        return { error: e.message }
      })
      .finally(() => {
        clearTimeout(timeout)
      })

    if ('error' in response) {
      return {
        success: false,
        status: 0,
        headers: {},
        body: Buffer.from(''),
        latencyMs: Date.now() - startTime,
        origin: origin.name,
        error: response.error,
      }
    }

    const latencyMs = Date.now() - startTime

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        headers: this.headersToRecord(response.headers),
        body: Buffer.from(''),
        latencyMs,
        origin: origin.name,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const body = Buffer.from(await response.arrayBuffer())

    return {
      success: true,
      status: response.status,
      headers: this.headersToRecord(response.headers),
      body,
      latencyMs,
      origin: origin.name,
    }
  }

  // ============================================================================
  // S3 Signing (AWS Signature Version 4)
  // ============================================================================

  private async signS3Request(
    method: string,
    host: string,
    path: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
  ): Promise<Record<string, string>> {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const service = 's3'

    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-date'

    const canonicalRequest = [
      method,
      path,
      '', // query string
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digestHex(),
    ].join('\n')

    const signingKey = this.getSignatureKey(
      secretAccessKey,
      dateStamp,
      region,
      service,
    )
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digestHex()

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    return {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      Authorization: authorization,
    }
  }

  private getSignatureKey(
    key: string,
    dateStamp: string,
    region: string,
    service: string,
  ): Uint8Array {
    const kDate = createHmac('sha256', `AWS4${key}`).update(dateStamp).digest()
    const kRegion = createHmac('sha256', kDate).update(region).digest()
    const kService = createHmac('sha256', kRegion).update(service).digest()
    return createHmac('sha256', kService).update('aws4_request').digest()
  }

  // ============================================================================
  // Health Management
  // ============================================================================

  /**
   * Get a healthy origin
   */
  private getHealthyOrigin(): OriginConfig | null {
    // First try to find a healthy origin
    for (const [name, health] of this.healthStatus) {
      if (health.healthy) {
        const origin = this.origins.get(name)
        if (origin) return origin
      }
    }

    // Fall back to default if no healthy origins
    if (this.defaultOrigin) {
      return this.origins.get(this.defaultOrigin) ?? null
    }

    return null
  }

  /**
   * Record successful fetch
   */
  private recordSuccess(name: string, latencyMs: number): void {
    const health = this.healthStatus.get(name)
    if (health) {
      health.healthy = true
      health.latencyMs = latencyMs
      health.lastCheck = Date.now()
      health.consecutiveFailures = 0
    }
  }

  /**
   * Record failed fetch
   */
  private recordFailure(name: string): void {
    const health = this.healthStatus.get(name)
    if (health) {
      health.consecutiveFailures++
      health.lastCheck = Date.now()
      if (health.consecutiveFailures >= 3) {
        health.healthy = false
      }
    }
  }

  /**
   * Check origin health
   */
  async checkHealth(name: string): Promise<OriginHealthCheck> {
    const origin = this.origins.get(name)
    if (!origin) {
      return {
        origin: name,
        healthy: false,
        latencyMs: 0,
        lastCheck: Date.now(),
        consecutiveFailures: 0,
      }
    }

    const startTime = Date.now()
    const result = await this.fetch('/', name, { timeout: 5000 })
    const latencyMs = Date.now() - startTime

    const health: OriginHealthCheck = {
      origin: name,
      healthy: result.success,
      latencyMs,
      lastCheck: Date.now(),
      consecutiveFailures: result.success
        ? 0
        : (this.healthStatus.get(name)?.consecutiveFailures ?? 0) + 1,
    }

    this.healthStatus.set(name, health)
    return health
  }

  /**
   * Get all health statuses
   */
  getAllHealth(): OriginHealthCheck[] {
    return [...this.healthStatus.values()]
  }

  // ============================================================================
  // Utility
  // ============================================================================

  private headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value
    })
    return result
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Add origin at runtime
   */
  addOrigin(origin: OriginConfig): void {
    this.origins.set(origin.name, origin)
    this.healthStatus.set(origin.name, {
      origin: origin.name,
      healthy: true,
      latencyMs: 0,
      lastCheck: 0,
      consecutiveFailures: 0,
    })
  }

  /**
   * Remove origin at runtime
   */
  removeOrigin(name: string): void {
    this.origins.delete(name)
    this.healthStatus.delete(name)
  }

  /**
   * Get origin names
   */
  getOriginNames(): string[] {
    return [...this.origins.keys()]
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalFetcher: OriginFetcher | null = null

export function getOriginFetcher(origins?: OriginConfig[]): OriginFetcher {
  if (!globalFetcher) {
    globalFetcher = new OriginFetcher(origins ?? [])
  }
  return globalFetcher
}

export function resetOriginFetcher(): void {
  globalFetcher = null
}
