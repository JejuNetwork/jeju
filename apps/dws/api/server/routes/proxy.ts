/**
 * DWS Reverse Proxy Router
 *
 * Provides a unified entry point for all Jeju network services with:
 * - Request logging (structured JSON logs)
 * - Rate limiting (tiered by stake)
 * - SSRF protection
 * - Prometheus metrics
 * - Circuit breaker for upstream failures
 */

// Use Web Crypto API instead of node:crypto for workerd compatibility
function randomUUID(): string {
  return crypto.randomUUID()
}

import { createAppConfig } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

interface ProxyTarget {
  name: string
  upstream: string
  pathPrefix: string
  stripPrefix: boolean
  healthPath: string
  timeout: number
  rateLimit: {
    requestsPerMinute: number
    burstSize: number
  }
}

interface CircuitState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
  openedAt: number
}

interface RequestLogEntry {
  timestamp: string
  requestId: string
  method: string
  path: string
  upstream: string
  statusCode: number
  durationMs: number
  clientIp: string
  userAgent: string
  bytesIn: number
  bytesOut: number
  error?: string
}

interface ProxyMetrics {
  totalRequests: number
  totalErrors: number
  totalBytes: number
  latencyHistogram: number[]
  requestsByUpstream: Map<string, number>
  errorsByUpstream: Map<string, number>
}

// ============================================================================
// Configuration
// ============================================================================

interface ProxyRouterConfig {
  indexerUrl?: string
  indexerGraphqlUrl?: string
  monitoringUrl?: string
  prometheusUrl?: string
  gatewayUrl?: string
  [key: string]: string | undefined
}

const { config: proxyConfig, configure: configureProxyRouter } =
  createAppConfig<ProxyRouterConfig>({
    indexerUrl: 'http://127.0.0.1:4352',
    indexerGraphqlUrl: 'http://127.0.0.1:4350',
    monitoringUrl: 'http://127.0.0.1:9091',
    prometheusUrl: 'http://127.0.0.1:9090',
    gatewayUrl: 'http://127.0.0.1:4200',
  })

export function configureProxyRouterConfig(
  config: Partial<ProxyRouterConfig>,
): void {
  configureProxyRouter(config)
}

function getProxyTargets(): ProxyTarget[] {
  return [
    {
      name: 'indexer',
      upstream: proxyConfig.indexerUrl ?? 'http://127.0.0.1:4352',
      pathPrefix: '/indexer',
      stripPrefix: true,
      healthPath: '/health',
      timeout: 30000,
      rateLimit: { requestsPerMinute: 1000, burstSize: 100 },
    },
    {
      name: 'indexer-graphql',
      upstream: proxyConfig.indexerGraphqlUrl ?? 'http://127.0.0.1:4350',
      pathPrefix: '/graphql',
      stripPrefix: false,
      healthPath: '/',
      timeout: 60000,
      rateLimit: { requestsPerMinute: 500, burstSize: 50 },
    },
    {
      name: 'monitoring',
      upstream: proxyConfig.monitoringUrl ?? 'http://127.0.0.1:9091',
      pathPrefix: '/monitoring',
      stripPrefix: true,
      healthPath: '/.well-known/agent-card.json',
      timeout: 30000,
      rateLimit: { requestsPerMinute: 500, burstSize: 50 },
    },
    {
      name: 'prometheus',
      upstream: proxyConfig.prometheusUrl ?? 'http://127.0.0.1:9090',
      pathPrefix: '/prometheus',
      stripPrefix: true,
      healthPath: '/-/healthy',
      timeout: 30000,
      rateLimit: { requestsPerMinute: 200, burstSize: 20 },
    },
    {
      name: 'gateway',
      upstream: proxyConfig.gatewayUrl ?? 'http://127.0.0.1:4200',
      pathPrefix: '/gateway',
      stripPrefix: true,
      healthPath: '/health',
      timeout: 30000,
      rateLimit: { requestsPerMinute: 1000, burstSize: 100 },
    },
  ]
}

const PROXY_TARGETS = getProxyTargets()

// Circuit breaker settings
const CIRCUIT_FAILURE_THRESHOLD = 5
const CIRCUIT_RESET_TIMEOUT_MS = 30000
const CIRCUIT_HALF_OPEN_REQUESTS = 3

// SSRF protection - blocked hosts and IP ranges
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',
  '169.254.169.254',
])

const BLOCKED_HOST_PATTERNS = [
  /^.*\.local$/i,
  /^.*\.internal$/i,
  /^.*\.localhost$/i,
  /^.*\.svc\.cluster\.local$/i,
]

// ============================================================================
// State
// ============================================================================

const circuitBreakers = new Map<string, CircuitState>()
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()
const metrics: ProxyMetrics = {
  totalRequests: 0,
  totalErrors: 0,
  totalBytes: 0,
  latencyHistogram: new Array(20).fill(0),
  requestsByUpstream: new Map(),
  errorsByUpstream: new Map(),
}

// Request logs buffer for recent requests
const requestLogs: RequestLogEntry[] = []
const MAX_LOG_BUFFER = 1000

// ============================================================================
// Helper Functions
// ============================================================================

function getClientIp(request: Request): string {
  const forwarded = request.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim()
  const realIp = request.headers.get('x-real-ip')
  const cfIp = request.headers.get('cf-connecting-ip')
  return forwarded ?? realIp ?? cfIp ?? 'unknown'
}

function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) {
    return true
  }

  if (BLOCKED_HOST_PATTERNS.some((p) => p.test(hostname))) {
    return true
  }

  // Check for private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 127
    ) {
      return true
    }
  }

  return false
}

function findTarget(path: string): ProxyTarget | null {
  for (const target of PROXY_TARGETS) {
    if (path.startsWith(target.pathPrefix)) {
      return target
    }
  }
  return null
}

function getCircuitState(name: string): CircuitState {
  let state = circuitBreakers.get(name)
  if (!state) {
    state = { failures: 0, lastFailure: 0, state: 'closed', openedAt: 0 }
    circuitBreakers.set(name, state)
  }
  return state
}

function recordCircuitFailure(name: string): void {
  const state = getCircuitState(name)
  state.failures++
  state.lastFailure = Date.now()

  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.state = 'open'
    state.openedAt = Date.now()
    console.warn(
      `[Proxy] Circuit opened for ${name} after ${state.failures} failures`,
    )
  }
}

function recordCircuitSuccess(name: string): void {
  const state = getCircuitState(name)
  state.failures = 0
  state.state = 'closed'
}

function isCircuitOpen(name: string): boolean {
  const state = getCircuitState(name)

  if (state.state === 'closed') {
    return false
  }

  if (state.state === 'open') {
    // Check if we should try half-open
    if (Date.now() - state.openedAt > CIRCUIT_RESET_TIMEOUT_MS) {
      state.state = 'half-open'
      state.failures = 0
      return false
    }
    return true
  }

  // Half-open: allow limited requests
  return state.failures >= CIRCUIT_HALF_OPEN_REQUESTS
}

function checkRateLimit(
  clientIp: string,
  target: ProxyTarget,
): { allowed: boolean; retryAfter?: number } {
  const key = `${clientIp}:${target.name}`
  const now = Date.now()
  const windowMs = 60000

  let entry = rateLimitStore.get(key)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs }
    rateLimitStore.set(key, entry)
  }

  entry.count++

  if (entry.count > target.rateLimit.requestsPerMinute) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  return { allowed: true }
}

function logRequest(entry: RequestLogEntry): void {
  // Console log for real-time streaming
  const logLine = JSON.stringify(entry)
  if (entry.statusCode >= 500) {
    console.error(`[Proxy] ${logLine}`)
  } else if (entry.statusCode >= 400) {
    console.warn(`[Proxy] ${logLine}`)
  } else {
    console.log(`[Proxy] ${logLine}`)
  }

  // Buffer for recent requests endpoint
  requestLogs.push(entry)
  if (requestLogs.length > MAX_LOG_BUFFER) {
    requestLogs.shift()
  }
}

function recordLatency(durationMs: number): void {
  // Bucket latencies: 0-10, 10-20, ... 180-190, 190+
  const bucket = Math.min(Math.floor(durationMs / 10), 19)
  metrics.latencyHistogram[bucket]++
}

function recordMetrics(
  target: string,
  bytesOut: number,
  isError: boolean,
): void {
  metrics.totalRequests++
  metrics.totalBytes += bytesOut

  const current = metrics.requestsByUpstream.get(target) ?? 0
  metrics.requestsByUpstream.set(target, current + 1)

  if (isError) {
    metrics.totalErrors++
    const errors = metrics.errorsByUpstream.get(target) ?? 0
    metrics.errorsByUpstream.set(target, errors + 1)
  }
}

// ============================================================================
// Proxy Handler
// ============================================================================

/**
 * Check if the upstream URL is from a pre-configured trusted target.
 * This prevents SSRF while allowing our known upstreams.
 */
function isConfiguredUpstream(url: URL): boolean {
  const urlString = url.origin
  return PROXY_TARGETS.some(
    (t) => t.upstream === urlString || t.upstream.startsWith(urlString),
  )
}

async function proxyRequest(
  request: Request,
  target: ProxyTarget,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url)
  let targetPath = url.pathname

  if (target.stripPrefix) {
    targetPath = targetPath.slice(target.pathPrefix.length) || '/'
  }

  const targetUrl = new URL(targetPath + url.search, target.upstream)

  // SSRF check - ONLY block if NOT a pre-configured upstream
  // This allows our known upstreams (localhost for dev, internal services for prod)
  // while blocking user-controllable redirects or injections
  if (!isConfiguredUpstream(targetUrl) && isBlockedHost(targetUrl.hostname)) {
    throw new Error('Blocked upstream host - potential SSRF attempt')
  }

  // Copy headers, add proxy headers
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('X-Request-ID', requestId)
  headers.set('X-Forwarded-For', getClientIp(request))
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''))
  headers.set('X-Forwarded-Host', url.host)

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    signal: AbortSignal.timeout(target.timeout),
    redirect: 'manual',
  })

  // Copy response headers, add proxy headers
  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('X-Request-ID', requestId)
  responseHeaders.set('X-Upstream', target.name)

  // Add security headers
  responseHeaders.set('X-Content-Type-Options', 'nosniff')
  responseHeaders.set('X-Frame-Options', 'DENY')

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  })
}

// ============================================================================
// Router
// ============================================================================

const proxyTargetsQuerySchema = z.object({
  includeHealth: z.coerce.boolean().optional(),
})

const proxyLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  upstream: z.string().optional(),
  minStatus: z.coerce.number().int().optional(),
})

export function createProxyRouter() {
  const router = new Elysia({ name: 'proxy', prefix: '/proxy' })

  // Health check
  router.get('/health', () => ({
    status: 'healthy',
    service: 'dws-proxy',
    targets: PROXY_TARGETS.map((t) => ({
      name: t.name,
      pathPrefix: t.pathPrefix,
      circuitState: getCircuitState(t.name).state,
    })),
    metrics: {
      totalRequests: metrics.totalRequests,
      totalErrors: metrics.totalErrors,
      errorRate:
        metrics.totalRequests > 0
          ? ((metrics.totalErrors / metrics.totalRequests) * 100).toFixed(2) +
            '%'
          : '0%',
    },
  }))

  // List proxy targets
  router.get('/targets', async ({ query }) => {
    const validated = proxyTargetsQuerySchema.parse(query)

    const targets = await Promise.all(
      PROXY_TARGETS.map(async (t) => {
        const circuit = getCircuitState(t.name)
        let healthy: boolean | null = null

        if (validated.includeHealth) {
          const healthUrl = new URL(t.healthPath, t.upstream)
          healthy = await fetch(healthUrl, {
            signal: AbortSignal.timeout(5000),
          })
            .then((r) => r.ok)
            .catch(() => false)
        }

        return {
          name: t.name,
          pathPrefix: t.pathPrefix,
          upstream: t.upstream,
          rateLimit: t.rateLimit,
          circuitState: circuit.state,
          circuitFailures: circuit.failures,
          healthy,
        }
      }),
    )

    return { targets }
  })

  // Prometheus metrics endpoint
  router.get('/metrics', () => {
    const lines: string[] = []

    lines.push('# HELP dws_proxy_requests_total Total proxy requests')
    lines.push('# TYPE dws_proxy_requests_total counter')
    lines.push(`dws_proxy_requests_total ${metrics.totalRequests}`)

    lines.push('# HELP dws_proxy_errors_total Total proxy errors')
    lines.push('# TYPE dws_proxy_errors_total counter')
    lines.push(`dws_proxy_errors_total ${metrics.totalErrors}`)

    lines.push('# HELP dws_proxy_bytes_total Total bytes proxied')
    lines.push('# TYPE dws_proxy_bytes_total counter')
    lines.push(`dws_proxy_bytes_total ${metrics.totalBytes}`)

    lines.push('# HELP dws_proxy_requests_by_upstream Requests by upstream')
    lines.push('# TYPE dws_proxy_requests_by_upstream counter')
    for (const [upstream, count] of metrics.requestsByUpstream) {
      lines.push(
        `dws_proxy_requests_by_upstream{upstream="${upstream}"} ${count}`,
      )
    }

    lines.push('# HELP dws_proxy_errors_by_upstream Errors by upstream')
    lines.push('# TYPE dws_proxy_errors_by_upstream counter')
    for (const [upstream, count] of metrics.errorsByUpstream) {
      lines.push(
        `dws_proxy_errors_by_upstream{upstream="${upstream}"} ${count}`,
      )
    }

    // Prometheus histograms must be cumulative
    lines.push('# HELP dws_proxy_latency_seconds Request latency histogram')
    lines.push('# TYPE dws_proxy_latency_seconds histogram')
    let cumulativeCount = 0
    let totalLatencyMs = 0
    const bucketBoundaries = [
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
      170, 180, 190,
    ]
    for (let i = 0; i < metrics.latencyHistogram.length; i++) {
      cumulativeCount += metrics.latencyHistogram[i]
      // Approximate total latency for _sum (midpoint of bucket * count)
      const midpoint = i < 19 ? i * 10 + 5 : 200
      totalLatencyMs += metrics.latencyHistogram[i] * midpoint

      if (i < 19) {
        lines.push(
          `dws_proxy_latency_seconds_bucket{le="${bucketBoundaries[i] / 1000}"} ${cumulativeCount}`,
        )
      }
    }
    lines.push(`dws_proxy_latency_seconds_bucket{le="+Inf"} ${cumulativeCount}`)
    lines.push(`dws_proxy_latency_seconds_sum ${totalLatencyMs / 1000}`)
    lines.push(`dws_proxy_latency_seconds_count ${cumulativeCount}`)

    lines.push(
      '# HELP dws_proxy_circuit_state Circuit breaker state (0=closed, 1=half-open, 2=open)',
    )
    lines.push('# TYPE dws_proxy_circuit_state gauge')
    for (const target of PROXY_TARGETS) {
      const state = getCircuitState(target.name)
      const stateNum =
        state.state === 'closed' ? 0 : state.state === 'half-open' ? 1 : 2
      lines.push(
        `dws_proxy_circuit_state{upstream="${target.name}"} ${stateNum}`,
      )
    }

    // Rate limiter stats
    lines.push('# HELP dws_proxy_rate_limit_active Active rate limit entries')
    lines.push('# TYPE dws_proxy_rate_limit_active gauge')
    lines.push(`dws_proxy_rate_limit_active ${rateLimitStore.size}`)

    return new Response(lines.join('\n'), {
      headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    })
  })

  // Recent request logs
  router.get('/logs', ({ query }) => {
    const validated = proxyLogsQuerySchema.parse(query)

    let logs = [...requestLogs].reverse()

    if (validated.upstream) {
      logs = logs.filter((l) => l.upstream === validated.upstream)
    }
    if (validated.minStatus !== undefined) {
      const minStatus = validated.minStatus
      logs = logs.filter((l) => l.statusCode >= minStatus)
    }

    return {
      logs: logs.slice(0, validated.limit),
      total: logs.length,
    }
  })

  // Catch-all proxy handler for registered targets
  router.all('/*', async ({ request, set }) => {
    const url = new URL(request.url)
    const requestId = request.headers.get('x-request-id') ?? randomUUID()
    const startTime = Date.now()
    const clientIp = getClientIp(request)

    // Find matching target - strip /proxy prefix first
    const proxyPath = url.pathname.replace(/^\/proxy/, '')
    const target = findTarget(proxyPath)

    if (!target) {
      set.status = 404
      return {
        error: 'No upstream found for path',
        path: proxyPath,
        availableTargets: PROXY_TARGETS.map((t) => t.pathPrefix),
      }
    }

    // Check circuit breaker
    if (isCircuitOpen(target.name)) {
      set.status = 503
      set.headers['Retry-After'] = String(
        Math.ceil(CIRCUIT_RESET_TIMEOUT_MS / 1000),
      )
      return {
        error: 'Service temporarily unavailable',
        upstream: target.name,
        retryAfter: Math.ceil(CIRCUIT_RESET_TIMEOUT_MS / 1000),
      }
    }

    // Check rate limit
    const rateCheck = checkRateLimit(clientIp, target)

    // Always set rate limit headers
    const rateLimitEntry = rateLimitStore.get(`${clientIp}:${target.name}`)
    if (rateLimitEntry) {
      set.headers['X-RateLimit-Limit'] = String(
        target.rateLimit.requestsPerMinute,
      )
      set.headers['X-RateLimit-Remaining'] = String(
        Math.max(0, target.rateLimit.requestsPerMinute - rateLimitEntry.count),
      )
      set.headers['X-RateLimit-Reset'] = String(
        Math.ceil(rateLimitEntry.resetAt / 1000),
      )
    }

    if (!rateCheck.allowed) {
      set.status = 429
      set.headers['Retry-After'] = String(rateCheck.retryAfter)
      return {
        error: 'Rate limit exceeded',
        retryAfter: rateCheck.retryAfter,
      }
    }

    // Create a modified request with the correct path (strip /proxy prefix)
    const modifiedUrl = new URL(request.url)
    modifiedUrl.pathname = proxyPath
    const modifiedRequest = new Request(modifiedUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })

    let response: Response
    let bytesOut = 0
    let isError = false
    let errorMessage: string | undefined

    try {
      response = await proxyRequest(modifiedRequest, target, requestId)
      bytesOut = parseInt(response.headers.get('content-length') ?? '0', 10)
      isError = response.status >= 500

      if (isError) {
        recordCircuitFailure(target.name)
      } else {
        recordCircuitSuccess(target.name)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      errorMessage = error.message
      recordCircuitFailure(target.name)
      isError = true

      set.status = 502
      response = new Response(
        JSON.stringify({
          error: 'Bad Gateway',
          message:
            error.name === 'TimeoutError'
              ? 'Upstream timeout'
              : 'Upstream unavailable',
          upstream: target.name,
          requestId,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    const durationMs = Date.now() - startTime

    // Log request
    logRequest({
      timestamp: new Date().toISOString(),
      requestId,
      method: request.method,
      path: proxyPath,
      upstream: target.name,
      statusCode: response.status,
      durationMs,
      clientIp,
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      bytesIn: parseInt(request.headers.get('content-length') ?? '0', 10),
      bytesOut,
      error: errorMessage,
    })

    // Record metrics
    recordLatency(durationMs)
    recordMetrics(target.name, bytesOut, isError)

    return response
  })

  return router
}

// ============================================================================
// Cleanup
// ============================================================================

// Clean up stale rate limit entries
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key)
    }
  }
}, 60000)

export { PROXY_TARGETS, metrics as proxyMetrics }
