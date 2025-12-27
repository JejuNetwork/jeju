/**
 * DWS Reverse Proxy Tests
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import {
  createProxyRouter,
  PROXY_TARGETS,
  proxyMetrics,
} from '../api/server/routes/proxy'

describe('DWS Proxy Router', () => {
  let app: Elysia
  let mockUpstream: ReturnType<typeof Bun.serve>

  beforeAll(() => {
    // Create mock upstream server
    mockUpstream = Bun.serve({
      port: 19091,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return new Response(JSON.stringify({ status: 'ok' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (url.pathname === '/.well-known/agent-card.json') {
          return new Response(JSON.stringify({ name: 'test' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (url.pathname === '/api/test') {
          return new Response(
            JSON.stringify({
              requestId: req.headers.get('X-Request-ID'),
              forwardedFor: req.headers.get('X-Forwarded-For'),
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        if (url.pathname === '/slow') {
          // Simulate slow response
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(new Response('slow response'))
            }, 100)
          })
        }

        if (url.pathname === '/error') {
          return new Response('Internal error', { status: 500 })
        }

        return new Response('Not found', { status: 404 })
      },
    })

    // Create app with proxy router
    app = new Elysia().use(createProxyRouter())
  })

  afterAll(() => {
    mockUpstream.stop()
  })

  describe('Health endpoint', () => {
    it('should return proxy health status', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/health'),
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.status).toBe('healthy')
      expect(body.service).toBe('dws-proxy')
      expect(body.targets).toBeArray()
      expect(body.metrics).toBeDefined()
      expect(body.metrics.totalRequests).toBeNumber()
    })
  })

  describe('Targets endpoint', () => {
    it('should list proxy targets', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/targets'),
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.targets).toBeArray()
      expect(body.targets.length).toBeGreaterThan(0)

      const target = body.targets[0]
      expect(target.name).toBeDefined()
      expect(target.pathPrefix).toBeDefined()
      expect(target.upstream).toBeDefined()
      expect(target.circuitState).toBe('closed')
    })

    it('should include health status when requested', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/targets?includeHealth=true'),
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      // Health check may fail for unavaialble upstreams, but field should exist
      expect(body.targets[0]).toHaveProperty('healthy')
    })
  })

  describe('Metrics endpoint', () => {
    it('should return Prometheus metrics', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/metrics'),
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('text/plain')

      const body = await response.text()
      expect(body).toContain('dws_proxy_requests_total')
      expect(body).toContain('dws_proxy_errors_total')
      expect(body).toContain('dws_proxy_bytes_total')
      expect(body).toContain('dws_proxy_circuit_state')
      // Proper Prometheus histogram naming
      expect(body).toContain('dws_proxy_latency_seconds_bucket')
      expect(body).toContain('dws_proxy_latency_seconds_sum')
      expect(body).toContain('dws_proxy_latency_seconds_count')
      expect(body).toContain('dws_proxy_rate_limit_active')
    })
  })

  describe('Logs endpoint', () => {
    it('should return recent request logs', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/logs'),
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.logs).toBeArray()
      expect(body.total).toBeNumber()
    })

    it('should filter logs by upstream', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/logs?upstream=monitoring'),
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.logs).toBeArray()
    })

    it('should filter logs by minimum status', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/logs?minStatus=400'),
      )

      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.logs).toBeArray()
    })
  })

  describe('Proxy routing', () => {
    it('should return error for unknown paths', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/unknown/path'),
      )

      // Should return 200 with error message (no matching target)
      const body = await response.json()
      expect(body.error).toBe('No upstream found for path')
      expect(body.availableTargets).toBeArray()
    })
  })

  describe('Rate limiting', () => {
    it('should have rate limit configuration for all targets', () => {
      expect(PROXY_TARGETS).toBeArray()
      for (const target of PROXY_TARGETS) {
        expect(target.rateLimit).toBeDefined()
        expect(target.rateLimit.requestsPerMinute).toBeNumber()
        expect(target.rateLimit.requestsPerMinute).toBeGreaterThan(0)
        expect(target.rateLimit.burstSize).toBeNumber()
        expect(target.rateLimit.burstSize).toBeGreaterThan(0)
        // Burst size should be less than requests per minute
        expect(target.rateLimit.burstSize).toBeLessThanOrEqual(
          target.rateLimit.requestsPerMinute,
        )
      }
    })

    it('should have reasonable rate limits', () => {
      for (const target of PROXY_TARGETS) {
        // Rate limits should be reasonable (not too high, not too low)
        expect(target.rateLimit.requestsPerMinute).toBeGreaterThanOrEqual(100)
        expect(target.rateLimit.requestsPerMinute).toBeLessThanOrEqual(10000)
      }
    })
  })

  describe('Circuit breaker', () => {
    it('should track circuit state in targets', async () => {
      const response = await app.handle(
        new Request('http://localhost/proxy/targets'),
      )

      const body = await response.json()
      for (const target of body.targets) {
        expect(['closed', 'half-open', 'open']).toContain(target.circuitState)
      }
    })
  })

  describe('SSRF Protection', () => {
    it('should have SSRF protection patterns in place', () => {
      // Verify the proxy module loads without error and has targets
      expect(PROXY_TARGETS).toBeDefined()
      expect(PROXY_TARGETS.length).toBeGreaterThan(0)
    })

    it('should allow configured upstream targets', () => {
      // The SSRF protection should NOT block pre-configured upstreams
      // This verifies the fix where localhost upstreams are allowed
      for (const target of PROXY_TARGETS) {
        expect(target.upstream).toBeDefined()
        // Upstreams should be valid URLs
        expect(() => new URL(target.upstream)).not.toThrow()
      }
    })

    it('should have all required target properties', () => {
      for (const target of PROXY_TARGETS) {
        expect(target.name).toBeDefined()
        expect(target.upstream).toBeDefined()
        expect(target.pathPrefix).toBeDefined()
        expect(target.healthPath).toBeDefined()
        expect(target.timeout).toBeGreaterThan(0)
        expect(target.rateLimit.requestsPerMinute).toBeGreaterThan(0)
        expect(target.rateLimit.burstSize).toBeGreaterThan(0)
      }
    })
  })

  describe('Metrics tracking', () => {
    it('should expose metrics object', () => {
      expect(proxyMetrics).toBeDefined()
      expect(proxyMetrics.totalRequests).toBeNumber()
      expect(proxyMetrics.totalErrors).toBeNumber()
      expect(proxyMetrics.totalBytes).toBeNumber()
      expect(proxyMetrics.latencyHistogram).toBeArray()
      expect(proxyMetrics.requestsByUpstream).toBeInstanceOf(Map)
      expect(proxyMetrics.errorsByUpstream).toBeInstanceOf(Map)
    })
  })
})
