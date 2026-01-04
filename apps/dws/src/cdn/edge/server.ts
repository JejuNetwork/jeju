/**
 * CDN Edge Node Server
 *
 * High-performance edge node that:
 * - Serves cached content with low latency
 * - Fetches from origin on cache miss
 * - Handles cache invalidation
 * - Reports metrics and usage
 * - Integrates with the coordinator for routing
 */

import { cors } from '@elysiajs/cors'
import type { CacheStatus, EdgeNodeStatus } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import { type EdgeCache, getEdgeCache } from '../cache/edge-cache'
import { getOriginFetcher, type OriginFetcher } from '../cache/origin-fetcher'
import type {
  EdgeNodeConfig,
  EdgeNodeMetrics,
  IncomingRequest,
  InvalidationRequest,
} from '../types'

// ============================================================================
// ABI
// ============================================================================

const CDN_REGISTRY_ABI = parseAbi([
  'function updateNodeStatus(bytes32 nodeId, uint8 status) external',
  'function reportNodeMetrics(bytes32 nodeId, uint256 currentLoad, uint256 bandwidthUsage, uint256 activeConnections, uint256 requestsPerSecond, uint256 bytesServedTotal, uint256 requestsTotal, uint256 cacheHitRate, uint256 avgResponseTime) external',
  'function reportUsage(bytes32 nodeId, uint256 periodStart, uint256 periodEnd, uint256 bytesEgress, uint256 bytesIngress, uint256 requests, uint256 cacheHits, uint256 cacheMisses, bytes signature) external',
])

// ============================================================================
// Chain Inference Helper
// ============================================================================

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base
  }
  return localhost
}

// ============================================================================
// Edge Node Server
// ============================================================================

export class EdgeNodeServer {
  private app: Elysia
  private config: EdgeNodeConfig
  private cache: EdgeCache
  private originFetcher: OriginFetcher
  private account: PrivateKeyAccount
  private publicClient!: PublicClient
  private walletClient!: WalletClient
  private chain: Chain
  private registryAddress: Address
  private nodeIdBytes: string

  // Metrics
  private startTime: number = Date.now()
  private requestCount: number = 0
  private bytesServed: number = 0
  private cacheHits: number = 0
  private cacheMisses: number = 0
  private errorCount: number = 0
  private activeConnections: number = 0
  private latencies: number[] = []
  private status: EdgeNodeStatus = 'healthy'

  // Usage tracking
  private usagePeriodStart: number = Date.now()
  private periodBytesEgress: number = 0
  private periodBytesIngress: number = 0
  private periodRequests: number = 0
  private periodCacheHits: number = 0
  private periodCacheMisses: number = 0

  constructor(config: EdgeNodeConfig) {
    this.config = config
    this.app = new Elysia()

    // Initialize components
    this.cache = getEdgeCache({
      maxSizeBytes: config.maxCacheSizeMB * 1024 * 1024,
      maxEntries: config.maxCacheEntries,
      defaultTTL: config.defaultTTL,
    })

    this.originFetcher = getOriginFetcher(config.origins)

    // Initialize wallet and contract
    this.chain = inferChainFromRpcUrl(config.rpcUrl)
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    // Use privateKey (development) or KMS (production)
    if (config.privateKey) {
      if (!config.privateKey.startsWith('0x')) {
        throw new Error('privateKey must be a hex string starting with 0x')
      }
      this.account = privateKeyToAccount(config.privateKey as `0x${string}`)
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
        transport: http(config.rpcUrl),
      })
    } else if (config.kmsKeyId && config.ownerAddress) {
      // KMS mode - account will be set up via KMS
      // For now, we'll create a dummy account that delegates signing to KMS
      // The actual signing happens via KMS in the coordinator
      console.log('[CDN Edge] Using KMS-backed signing')
      throw new Error(
        'KMS integration for CDN Edge requires implementation. ' +
        'Set up PRIVATE_KEY for development or implement KMS wallet client.',
      )
    } else {
      throw new Error(
        'CDN Edge requires either privateKey or kmsKeyId+ownerAddress configuration',
      )
    }
    this.registryAddress = config.registryAddress

    // Convert nodeId to bytes32
    this.nodeIdBytes = config.nodeId.startsWith('0x')
      ? config.nodeId
      : `0x${config.nodeId.padStart(64, '0')}`

    this.setupMiddleware()
    this.setupRoutes()
    this.startMetricsReporting()
    this.startUsageReporting()
  }

  // ============================================================================
  // Middleware
  // ============================================================================

  private setupMiddleware(): void {
    // CORS
    this.app.use(
      cors({
        origin: '*',
        methods: ['GET', 'HEAD', 'OPTIONS'],
        allowedHeaders: ['*'],
        exposeHeaders: [
          'X-Cache',
          'X-Cache-Status',
          'X-Served-By',
          'X-Response-Time',
        ],
        maxAge: 86400,
      }),
    )

    // Request tracking
    this.app.onRequest(() => {
      this.activeConnections++
    })

    this.app.onAfterHandle(({ set }) => {
      this.activeConnections--
      const startTime = (set as { startTime?: number }).startTime ?? Date.now()
      const latency = Date.now() - startTime
      this.latencies.push(latency)
      if (this.latencies.length > 1000) {
        this.latencies.shift()
      }
    })
  }

  // ============================================================================
  // Routes
  // ============================================================================

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', () => {
      return {
        status: this.status,
        nodeId: this.config.nodeId,
        region: this.config.region,
        uptime: Date.now() - this.startTime,
        cacheStats: this.cache.getStats(),
      }
    })

    // Metrics endpoint
    this.app.get('/metrics', () => {
      return this.getMetrics()
    })

    // Prometheus metrics
    this.app.get('/metrics/prometheus', () => {
      const metrics = this.getMetrics()
      const lines = [
        '# HELP cdn_requests_total Total requests served',
        '# TYPE cdn_requests_total counter',
        `cdn_requests_total{node="${this.config.nodeId}"} ${metrics.requestsTotal}`,
        '# HELP cdn_bytes_served_total Total bytes served',
        '# TYPE cdn_bytes_served_total counter',
        `cdn_bytes_served_total{node="${this.config.nodeId}"} ${metrics.bytesServedTotal}`,
        '# HELP cdn_cache_hit_rate Cache hit rate',
        '# TYPE cdn_cache_hit_rate gauge',
        `cdn_cache_hit_rate{node="${this.config.nodeId}"} ${metrics.cacheHitRate}`,
        '# HELP cdn_latency_ms Average latency',
        '# TYPE cdn_latency_ms gauge',
        `cdn_latency_ms{node="${this.config.nodeId}"} ${metrics.avgLatencyMs}`,
        '# HELP cdn_active_connections Current active connections',
        '# TYPE cdn_active_connections gauge',
        `cdn_active_connections{node="${this.config.nodeId}"} ${metrics.activeConnections}`,
        '# HELP cdn_cache_size_bytes Current cache size',
        '# TYPE cdn_cache_size_bytes gauge',
        `cdn_cache_size_bytes{node="${this.config.nodeId}"} ${metrics.cacheSizeBytes}`,
      ]
      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/plain; version=0.0.4' },
      })
    })

    // Cache invalidation
    this.app.post('/invalidate', ({ body }) => {
      const { paths } = body as InvalidationRequest
      const count = this.invalidate(paths)
      return { success: true, pathsInvalidated: count }
    })

    // Purge entire cache
    this.app.post('/purge', () => {
      this.cache.clear()
      return { success: true }
    })

    // Warmup cache
    this.app.post('/warmup', async ({ body }) => {
      const { urls } = body as { urls: string[] }
      const results = await this.warmup(urls)
      return results
    })

    // Cache status for specific key
    this.app.get('/cache/:key', ({ params, set }) => {
      const { entry, status } = this.cache.get(decodeURIComponent(params.key))
      if (!entry) {
        set.status = 404
        return { found: false, status }
      }
      return {
        found: true,
        status,
        metadata: entry.metadata,
        expiresAt: entry.expiresAt,
        accessCount: entry.accessCount,
      }
    })

    // Main content serving - catch all
    this.app.all('/*', async ({ request, set }) => {
      return this.handleRequest(request, set)
    })
  }

  // ============================================================================
  // Request Handling
  // ============================================================================

  private async handleRequest(
    request: Request,
    set: { status?: number | string; headers?: Record<string, unknown> },
  ): Promise<Response> {
    const startTime = Date.now()
    const parsedRequest = this.parseRequest(request)

    // Only handle GET and HEAD
    if (parsedRequest.method !== 'GET' && parsedRequest.method !== 'HEAD') {
      set.status = 405
      return new Response('Method Not Allowed', { status: 405 })
    }

    this.requestCount++
    this.periodRequests++

    // Generate cache key
    const cacheKey = this.cache.generateKey({
      path: parsedRequest.path,
      query: new URLSearchParams(parsedRequest.query).toString() || undefined,
      varyHeaders: this.getVaryHeaders(parsedRequest.headers),
    })

    // Try cache first
    const ifNoneMatch = parsedRequest.headers['if-none-match']
    const ifModifiedSince = parsedRequest.headers['if-modified-since']
      ? new Date(parsedRequest.headers['if-modified-since']).getTime()
      : undefined

    const { entry, status, notModified } = this.cache.getConditional(
      cacheKey,
      ifNoneMatch,
      ifModifiedSince,
    )

    // 304 Not Modified
    if (notModified && entry) {
      this.cacheHits++
      this.periodCacheHits++
      return this.buildResponse(
        entry.data,
        entry.metadata.headers,
        304,
        'REVALIDATED',
        startTime,
      )
    }

    // Cache hit
    if (entry && (status === 'HIT' || status === 'STALE')) {
      this.cacheHits++
      this.periodCacheHits++
      this.bytesServed += entry.data.length
      this.periodBytesEgress += entry.data.length

      // Start background revalidation for stale entries
      if (status === 'STALE' && !this.cache.isRevalidating(cacheKey)) {
        this.revalidateInBackground(cacheKey, parsedRequest.path)
      }

      return this.buildResponse(
        entry.data,
        entry.metadata.headers,
        200,
        status,
        startTime,
      )
    }

    // Cache miss - fetch from origin
    this.cacheMisses++
    this.periodCacheMisses++

    const originResult = await this.originFetcher.fetch(parsedRequest.path)

    if (!originResult.success) {
      this.errorCount++

      // Try to serve stale content on error
      const staleEntry = this.cache.get(cacheKey)
      if (staleEntry.entry) {
        return this.buildResponse(
          staleEntry.entry.data,
          staleEntry.entry.metadata.headers,
          200,
          'ERROR',
          startTime,
        )
      }

      set.status = originResult.status || 502
      return new Response(
        JSON.stringify({
          error: originResult.error,
          origin: originResult.origin,
        }),
        {
          status: originResult.status || 502,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Cache the response
    const shouldCache = this.shouldCache(originResult.headers)
    if (shouldCache) {
      this.cache.set(cacheKey, originResult.body, {
        contentType: originResult.headers['content-type'],
        etag: originResult.headers.etag,
        lastModified: originResult.headers['last-modified']
          ? new Date(originResult.headers['last-modified']).getTime()
          : undefined,
        cacheControl: originResult.headers['cache-control'],
        headers: originResult.headers,
        origin: originResult.origin,
        immutable: this.isImmutable(parsedRequest.path, originResult.headers),
      })
    }

    this.bytesServed += originResult.body.length
    this.periodBytesEgress += originResult.body.length
    this.periodBytesIngress += originResult.body.length

    return this.buildResponse(
      originResult.body,
      originResult.headers,
      originResult.status,
      'MISS',
      startTime,
      originResult.latencyMs,
    )
  }

  /**
   * Build response with CDN headers
   */
  private buildResponse(
    body: Buffer,
    headers: Record<string, string>,
    status: number,
    cacheStatus: CacheStatus,
    startTime: number,
    originLatencyMs?: number,
  ): Response {
    const latencyMs = Date.now() - startTime

    const responseHeaders: Record<string, string> = {
      ...headers,
      'X-Cache': cacheStatus,
      'X-Cache-Status': cacheStatus,
      'X-Served-By': this.config.nodeId,
      'X-Response-Time': `${latencyMs}ms`,
      'X-CDN-Region': this.config.region,
    }

    if (originLatencyMs !== undefined) {
      responseHeaders['X-Origin-Time'] = `${originLatencyMs}ms`
    }

    // Add cache control for immutable content
    if (
      cacheStatus === 'HIT' &&
      headers['cache-control'].includes('immutable')
    ) {
      responseHeaders['Cache-Control'] = 'public, max-age=31536000, immutable'
    }

    return new Response(status === 304 ? null : new Uint8Array(body), {
      status,
      headers: responseHeaders,
    })
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Check if response should be cached
   */
  private shouldCache(headers: Record<string, string>): boolean {
    const cacheControl = headers['cache-control'] ?? ''

    // Don't cache if explicitly forbidden
    if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
      return false
    }

    // Cache if has explicit cache directive
    if (cacheControl.includes('max-age') || cacheControl.includes('s-maxage')) {
      return true
    }

    // Cache based on content type
    const contentType = headers['content-type'] ?? ''
    const cacheableTypes = [
      'text/html',
      'text/css',
      'application/javascript',
      'application/json',
      'image/',
      'font/',
      'application/wasm',
    ]

    return cacheableTypes.some((type) => contentType.includes(type))
  }

  /**
   * Check if content is immutable
   */
  private isImmutable(path: string, headers: Record<string, string>): boolean {
    // Check cache-control header
    if (headers['cache-control'].includes('immutable')) {
      return true
    }

    // Check for content hash in path
    if (/[.-][a-f0-9]{8,}\.[a-z]+$/i.test(path)) {
      return true
    }

    if (path.includes('/assets/')) {
      return true
    }

    return false
  }

  /**
   * Get vary headers from request
   */
  private getVaryHeaders(
    headers: Record<string, string>,
  ): Record<string, string> | undefined {
    // Common headers that affect caching
    const varyKeys = ['accept-encoding', 'accept-language', 'accept']
    const result: Record<string, string> = {}

    for (const key of varyKeys) {
      if (headers[key]) {
        result[key] = headers[key]
      }
    }

    return Object.keys(result).length > 0 ? result : undefined
  }

  /**
   * Background revalidation
   */
  private async revalidateInBackground(
    cacheKey: string,
    path: string,
  ): Promise<void> {
    this.cache.startRevalidation(cacheKey)

    const result = await this.originFetcher.fetch(path)

    if (result.success) {
      this.cache.set(cacheKey, result.body, {
        contentType: result.headers['content-type'],
        etag: result.headers.etag,
        cacheControl: result.headers['cache-control'],
        headers: result.headers,
        origin: result.origin,
        immutable: this.isImmutable(path, result.headers),
      })
    }

    this.cache.completeRevalidation(cacheKey)
  }

  /**
   * Invalidate cache entries
   */
  invalidate(paths: string[]): number {
    let count = 0
    for (const path of paths) {
      count += this.cache.purge(path)
    }
    return count
  }

  /**
   * Warmup cache with URLs
   */
  async warmup(
    urls: string[],
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0
    let failed = 0
    const errors: string[] = []

    for (const url of urls) {
      const path = new URL(url).pathname
      const result = await this.originFetcher.fetch(path)

      if (result.success) {
        const cacheKey = this.cache.generateKey({ path })
        this.cache.set(cacheKey, result.body, {
          contentType: result.headers['content-type'],
          headers: result.headers,
          origin: result.origin,
        })
        success++
      } else {
        failed++
        errors.push(`${url}: ${result.error}`)
      }
    }

    return { success, failed, errors }
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  /**
   * Parse incoming request
   */
  private parseRequest(request: Request): IncomingRequest {
    const url = new URL(request.url)
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    return {
      id: crypto.randomUUID(),
      method: request.method,
      url: request.url,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      clientIp:
        headers['x-forwarded-for'].split(',')[0].trim() ??
        headers['x-real-ip'] ??
        'unknown',
      timestamp: Date.now(),
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): EdgeNodeMetrics {
    const cacheStats = this.cache.getStats()
    const total = this.cacheHits + this.cacheMisses
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b)

    return {
      nodeId: this.config.nodeId,
      region: this.config.region,
      uptime: Date.now() - this.startTime,

      requestsTotal: this.requestCount,
      requestsPerSecond:
        this.requestCount / ((Date.now() - this.startTime) / 1000),
      bytesServedTotal: this.bytesServed,
      bandwidthMbps:
        (this.bytesServed * 8) /
        ((Date.now() - this.startTime) / 1000) /
        1_000_000,

      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: total > 0 ? this.cacheHits / total : 0,
      cacheSizeBytes: cacheStats.sizeBytes,
      cacheEntries: cacheStats.entries,

      avgLatencyMs:
        sortedLatencies.length > 0
          ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
          : 0,
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),

      errorCount: this.errorCount,
      errorRate:
        this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0,

      currentLoad: this.calculateLoad(),
      cpuUsage: 0, // Would need OS-level metrics
      memoryUsage:
        (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) *
        100,
      activeConnections: this.activeConnections,

      status: this.status,
      lastUpdated: Date.now(),
    }
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0
    const index = Math.ceil((p / 100) * arr.length) - 1
    return arr[Math.max(0, index)] ?? 0
  }

  /**
   * Calculate current load as a percentage (0-100)
   * Based on: connections, memory, cache size
   */
  private calculateLoad(): number {
    const connectionLoad = Math.min(
      100,
      (this.activeConnections / this.config.maxConnections) * 100,
    )
    const memoryLoad =
      (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100
    const cacheLoad =
      (this.cache.getSizeInfo().sizeBytes /
        (this.config.maxCacheSizeMB * 1024 * 1024)) *
      100

    // Weighted average: connections 40%, memory 35%, cache 25%
    return Math.min(
      100,
      connectionLoad * 0.4 + memoryLoad * 0.35 + cacheLoad * 0.25,
    )
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  /**
   * Start periodic metrics reporting
   */
  private startMetricsReporting(): void {
    const intervalMs = 60000 // 1 minute

    setInterval(async () => {
      const metrics = this.getMetrics()

      const hash = await this.walletClient.writeContract({
        address: this.registryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'reportNodeMetrics',
        args: [
          this.nodeIdBytes as `0x${string}`,
          BigInt(Math.round(metrics.currentLoad)),
          BigInt(Math.round(metrics.bandwidthMbps * 1000)), // Convert to kbps
          BigInt(metrics.activeConnections),
          BigInt(Math.round(metrics.requestsPerSecond)),
          BigInt(metrics.bytesServedTotal),
          BigInt(metrics.requestsTotal),
          BigInt(Math.round(metrics.cacheHitRate * 10000)),
          BigInt(Math.round(metrics.avgLatencyMs)),
        ],
        chain: this.chain,
        account: this.account,
      })
      await this.publicClient
        .waitForTransactionReceipt({ hash })
        .catch((e: Error) => {
          console.error('[EdgeNode] Failed to report metrics:', e.message)
        })
    }, intervalMs)
  }

  /**
   * Start periodic usage reporting
   */
  private startUsageReporting(): void {
    const intervalMs = 3600000 // 1 hour

    setInterval(async () => {
      const periodEnd = Date.now()

      // Create usage signature
      const usageData = `${this.nodeIdBytes}:${this.usagePeriodStart}:${periodEnd}:${this.periodBytesEgress}:${this.periodRequests}`
      const signature = await this.walletClient.signMessage({
        account: this.account,
        message: usageData,
      })

      const hash = await this.walletClient.writeContract({
        address: this.registryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'reportUsage',
        args: [
          this.nodeIdBytes as `0x${string}`,
          BigInt(Math.floor(this.usagePeriodStart / 1000)),
          BigInt(Math.floor(periodEnd / 1000)),
          BigInt(this.periodBytesEgress),
          BigInt(this.periodBytesIngress),
          BigInt(this.periodRequests),
          BigInt(this.periodCacheHits),
          BigInt(this.periodCacheMisses),
          signature,
        ],
        chain: this.chain,
        account: this.account,
      })
      await this.publicClient
        .waitForTransactionReceipt({ hash })
        .catch((e: Error) => {
          console.error('[EdgeNode] Failed to report usage:', e.message)
        })

      // Reset period counters
      this.usagePeriodStart = periodEnd
      this.periodBytesEgress = 0
      this.periodBytesIngress = 0
      this.periodRequests = 0
      this.periodCacheHits = 0
      this.periodCacheMisses = 0
    }, intervalMs)
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start the server
   */
  start(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    CDN Edge Node                               ║
║              Decentralized Content Delivery                    ║
╠═══════════════════════════════════════════════════════════════╣
║  Node ID:     ${this.config.nodeId.slice(0, 42).padEnd(42)}   ║
║  Region:      ${this.config.region.padEnd(42)}   ║
║  Port:        ${this.config.port.toString().padEnd(42)}   ║
║  Cache Size:  ${(`${this.config.maxCacheSizeMB} MB`).padEnd(42)}   ║
╚═══════════════════════════════════════════════════════════════╝
`)

    this.app.listen(this.config.port)

    console.log(`[EdgeNode] Listening on port ${this.config.port}`)
  }

  /**
   * Get the Elysia app (for testing)
   */
  getApp(): Elysia {
    return this.app
  }
}
