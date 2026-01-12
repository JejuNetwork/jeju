/**
 * TEE Health Service
 *
 * Provides health check, metrics, and attestation endpoints for TEE containers.
 */

import { serve } from 'bun'

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  uptime: number
  version: string
  tee: TEEStatus
  checks: Record<string, CheckResult>
}

interface TEEStatus {
  enabled: boolean
  platform: string
  attestationValid: boolean
  attestationExpires: string | null
  mrEnclave: string | null
}

interface CheckResult {
  status: 'pass' | 'warn' | 'fail'
  message: string
  duration: number
}

interface Metrics {
  requestsTotal: number
  requestsSuccessful: number
  requestsFailed: number
  attestationsTotal: number
  attestationsSuccessful: number
  uptimeSeconds: number
  memoryUsageMb: number
  cpuUsagePercent: number
}

// State
const startTime = Date.now()
let lastAttestation: {
  quote: string
  mrEnclave: string
  timestamp: number
  expiresAt: number
} | null = null

const metrics: Metrics = {
  requestsTotal: 0,
  requestsSuccessful: 0,
  requestsFailed: 0,
  attestationsTotal: 0,
  attestationsSuccessful: 0,
  uptimeSeconds: 0,
  memoryUsageMb: 0,
  cpuUsagePercent: 0,
}

// Configuration
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT ?? '8080', 10)
const METRICS_PORT = parseInt(process.env.METRICS_PORT ?? '9090', 10)
const TEE_ENABLED = process.env.TEE_ENABLED === 'true'
const ATTESTATION_REFRESH_INTERVAL = parseInt(
  process.env.ATTESTATION_REFRESH_INTERVAL ?? '43200000',
  10,
)
const VERSION = process.env.VERSION ?? '1.0.0'

// ============================================================================
// Health Check Logic
// ============================================================================

async function getHealthStatus(): Promise<HealthStatus> {
  const now = Date.now()
  const uptimeMs = now - startTime
  const checks: Record<string, CheckResult> = {}

  // Memory check
  const memUsage = process.memoryUsage()
  const memMb = Math.round(memUsage.heapUsed / 1024 / 1024)
  checks.memory = {
    status: memMb < 1000 ? 'pass' : memMb < 1500 ? 'warn' : 'fail',
    message: `Heap usage: ${memMb}MB`,
    duration: 0,
  }

  // Attestation check
  if (TEE_ENABLED) {
    const attestationStart = Date.now()
    if (lastAttestation && lastAttestation.expiresAt > now) {
      checks.attestation = {
        status: 'pass',
        message: `Valid until ${new Date(lastAttestation.expiresAt).toISOString()}`,
        duration: Date.now() - attestationStart,
      }
    } else {
      checks.attestation = {
        status: 'warn',
        message: 'Attestation expired or not available',
        duration: Date.now() - attestationStart,
      }
    }
  }

  // External service check (if applicable)
  if (process.env.EXTERNAL_SERVICE_URL) {
    const serviceStart = Date.now()
    try {
      const response = await fetch(process.env.EXTERNAL_SERVICE_URL, {
        signal: AbortSignal.timeout(5000),
      })
      checks.external_service = {
        status: response.ok ? 'pass' : 'warn',
        message: `Status: ${response.status}`,
        duration: Date.now() - serviceStart,
      }
    } catch {
      checks.external_service = {
        status: 'fail',
        message: 'Service unreachable',
        duration: Date.now() - serviceStart,
      }
    }
  }

  // Determine overall status
  const checkValues = Object.values(checks)
  const hasFailure = checkValues.some((c) => c.status === 'fail')
  const hasWarning = checkValues.some((c) => c.status === 'warn')

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
  if (hasFailure) {
    overallStatus = 'unhealthy'
  } else if (hasWarning) {
    overallStatus = 'degraded'
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptimeMs / 1000),
    version: VERSION,
    tee: {
      enabled: TEE_ENABLED,
      platform: process.env.TEE_PLATFORM ?? 'unknown',
      attestationValid: !!lastAttestation && lastAttestation.expiresAt > now,
      attestationExpires: lastAttestation
        ? new Date(lastAttestation.expiresAt).toISOString()
        : null,
      mrEnclave: lastAttestation?.mrEnclave ?? null,
    },
    checks,
  }
}

// ============================================================================
// Metrics
// ============================================================================

function updateMetrics(): void {
  const memUsage = process.memoryUsage()
  metrics.memoryUsageMb = Math.round(memUsage.heapUsed / 1024 / 1024)
  metrics.uptimeSeconds = Math.round((Date.now() - startTime) / 1000)

  // CPU usage would require additional instrumentation
  // For now, approximate based on event loop lag
}

function formatPrometheusMetrics(): string {
  updateMetrics()

  const lines: string[] = [
    '# HELP tee_requests_total Total number of requests',
    '# TYPE tee_requests_total counter',
    `tee_requests_total{status="total"} ${metrics.requestsTotal}`,
    `tee_requests_total{status="successful"} ${metrics.requestsSuccessful}`,
    `tee_requests_total{status="failed"} ${metrics.requestsFailed}`,
    '',
    '# HELP tee_attestations_total Total attestation operations',
    '# TYPE tee_attestations_total counter',
    `tee_attestations_total{status="total"} ${metrics.attestationsTotal}`,
    `tee_attestations_total{status="successful"} ${metrics.attestationsSuccessful}`,
    '',
    '# HELP tee_uptime_seconds Service uptime in seconds',
    '# TYPE tee_uptime_seconds gauge',
    `tee_uptime_seconds ${metrics.uptimeSeconds}`,
    '',
    '# HELP tee_memory_usage_mb Memory usage in megabytes',
    '# TYPE tee_memory_usage_mb gauge',
    `tee_memory_usage_mb ${metrics.memoryUsageMb}`,
    '',
    '# HELP tee_attestation_valid Whether attestation is currently valid',
    '# TYPE tee_attestation_valid gauge',
    `tee_attestation_valid ${lastAttestation && lastAttestation.expiresAt > Date.now() ? 1 : 0}`,
  ]

  return lines.join('\n')
}

// ============================================================================
// Attestation
// ============================================================================

async function refreshAttestation(): Promise<void> {
  if (!TEE_ENABLED) {
    return
  }

  console.log('[Attestation] Refreshing TEE attestation...')
  metrics.attestationsTotal++

  const dstackEndpoint = process.env.DSTACK_ATTESTATION_ENDPOINT

  if (!dstackEndpoint) {
    // In production, TEE_ENABLED=true requires a real attestation endpoint
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction) {
      console.error(
        '[Attestation] FATAL: TEE_ENABLED=true but DSTACK_ATTESTATION_ENDPOINT not set. ' +
          'Cannot provide attestation in production without real TEE.',
      )
      lastAttestation = null
      return
    }

    // Development mode - warn loudly but allow mock
    console.warn('⚠️'.repeat(20))
    console.warn(
      '[Attestation] WARNING: Using MOCK attestation - NOT FOR PRODUCTION',
    )
    console.warn(
      '[Attestation] Set DSTACK_ATTESTATION_ENDPOINT for real TEE attestation',
    )
    console.warn('⚠️'.repeat(20))

    lastAttestation = {
      quote: `MOCK-DEVELOPMENT-ONLY-${Date.now().toString(36)}`,
      mrEnclave: `0x${'MOCK'.repeat(16)}`,
      timestamp: Date.now(),
      expiresAt: Date.now() + ATTESTATION_REFRESH_INTERVAL,
    }
    metrics.attestationsSuccessful++
    return
  }

  try {
    const response = await fetch(`${dstackEndpoint}/attestation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report_data: Buffer.from(Date.now().toString()).toString('hex'),
      }),
    })

    if (response.ok) {
      const data = (await response.json()) as {
        quote: string
        mr_enclave: string
        timestamp: number
        expires_at: number
      }
      lastAttestation = {
        quote: data.quote,
        mrEnclave: data.mr_enclave,
        timestamp: data.timestamp,
        expiresAt: data.expires_at,
      }
      metrics.attestationsSuccessful++
      console.log('[Attestation] Refreshed successfully')
    } else {
      console.error('[Attestation] Failed:', response.status)
      lastAttestation = null
    }
  } catch (error) {
    console.error('[Attestation] Error:', error)
    lastAttestation = null
  }
}

// ============================================================================
// HTTP Servers
// ============================================================================

// Health server
serve({
  port: HEALTH_PORT,
  async fetch(request) {
    const url = new URL(request.url)
    metrics.requestsTotal++

    try {
      if (url.pathname === '/health' || url.pathname === '/') {
        const status = await getHealthStatus()
        const httpStatus = status.status === 'unhealthy' ? 503 : 200
        metrics.requestsSuccessful++
        return new Response(JSON.stringify(status, null, 2), {
          status: httpStatus,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/ready') {
        const status = await getHealthStatus()
        const ready = status.status !== 'unhealthy'
        metrics.requestsSuccessful++
        return new Response(JSON.stringify({ ready }), {
          status: ready ? 200 : 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/live') {
        metrics.requestsSuccessful++
        return new Response(JSON.stringify({ alive: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/attestation') {
        if (!lastAttestation) {
          await refreshAttestation()
        }
        metrics.requestsSuccessful++
        return new Response(
          JSON.stringify(
            lastAttestation ?? { error: 'No attestation available' },
          ),
          {
            status: lastAttestation ? 200 : 503,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (
        url.pathname === '/attestation/refresh' &&
        request.method === 'POST'
      ) {
        await refreshAttestation()
        metrics.requestsSuccessful++
        return new Response(
          JSON.stringify(lastAttestation ?? { error: 'Attestation failed' }),
          {
            status: lastAttestation ? 200 : 500,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      metrics.requestsFailed++
      return new Response('Not Found', { status: 404 })
    } catch (error) {
      metrics.requestsFailed++
      console.error('[Health] Request error:', error)
      return new Response('Internal Server Error', { status: 500 })
    }
  },
})

// Metrics server (separate port for Prometheus scraping)
if (METRICS_PORT !== HEALTH_PORT) {
  serve({
    port: METRICS_PORT,
    fetch(request) {
      const url = new URL(request.url)

      if (url.pathname === '/metrics') {
        return new Response(formatPrometheusMetrics(), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })
}

// ============================================================================
// Startup
// ============================================================================

console.log(`[TEE Health Service] Starting...`)
console.log(
  `[TEE Health Service] Health endpoint: http://0.0.0.0:${HEALTH_PORT}`,
)
console.log(
  `[TEE Health Service] Metrics endpoint: http://0.0.0.0:${METRICS_PORT}/metrics`,
)
console.log(`[TEE Health Service] TEE enabled: ${TEE_ENABLED}`)

// Initial attestation
if (TEE_ENABLED) {
  refreshAttestation()

  // Schedule periodic refresh
  setInterval(refreshAttestation, ATTESTATION_REFRESH_INTERVAL / 2)
}

console.log(`[TEE Health Service] Ready`)

export { getHealthStatus, refreshAttestation, metrics }
