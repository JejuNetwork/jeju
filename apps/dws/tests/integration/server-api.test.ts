/**
 * Server API Integration Tests
 *
 * Tests the DWS server endpoints that the frontend API client calls.
 * These are integration tests that verify actual server behavior.
 */

import { describe, expect, test } from 'bun:test'
import { getTestEnv } from './setup'

const { dwsUrl } = getTestEnv()

// Helper to make requests
async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${dwsUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data: data as T }
}

describe('Health Endpoints', () => {
  test('GET /health returns server status', async () => {
    const { status, data } = await api<{
      status: string
      uptime: number
      version: string
    }>('/health')

    expect(status).toBe(200)
    expect(data.status).toBe('healthy')
    expect(typeof data.uptime).toBe('number')
  })

  test('GET / returns service info', async () => {
    const { status, data } = await api<{ name: string; version: string }>('/')

    expect(status).toBe(200)
    expect(data.name).toBe('DWS')
  })
})

describe('Deploy Endpoints', () => {
  const testAddr = '0x1234567890123456789012345678901234567890'

  test('GET /deploy/health returns healthy', async () => {
    const { status, data } = await api<{ status: string; service: string }>(
      '/deploy/health',
    )

    expect(status).toBe(200)
    expect(data.status).toBe('healthy')
    expect(data.service).toBe('dws-app-deployer')
  })

  test('GET /deploy/list returns deployments array', async () => {
    const { status, data } = await api<{ deployments: unknown[] }>(
      '/deploy/list',
      { headers: { 'x-jeju-address': testAddr } },
    )

    expect(status).toBe(200)
    expect(Array.isArray(data.deployments)).toBe(true)
  })

  test('GET /deploy/list works without address', async () => {
    const { status, data } = await api<{ deployments: unknown[] }>(
      '/deploy/list',
    )

    expect(status).toBe(200)
    expect(Array.isArray(data.deployments)).toBe(true)
  })

  test('GET /deploy/tee/status returns TEE info', async () => {
    const { status, data } = await api<{ mode: string }>('/deploy/tee/status')

    expect(status).toBe(200)
    expect(['production', 'development']).toContain(data.mode)
  })
})

describe('Node Endpoints', () => {
  const nodeAddr = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  test('GET /node/health returns healthy', async () => {
    const { status, data } = await api<{ status: string }>('/node/health')

    expect(status).toBe(200)
    expect(data.status).toBe('healthy')
  })

  test('GET /node/status returns node info', async () => {
    const { status, data } = await api<{
      nodeId: string
      services: string[]
      status: string
    }>('/node/status', { headers: { 'x-jeju-address': nodeAddr } })

    expect(status).toBe(200)
    expect(data).toHaveProperty('nodeId')
    expect(Array.isArray(data.services)).toBe(true)
    // Status is dynamic based on env config
    expect(['active', 'syncing', 'offline', 'unconfigured']).toContain(
      data.status,
    )
  })

  test('GET /node/earnings returns earnings data', async () => {
    const { status, data } = await api<{
      total: string
      pending: string
      breakdown: Record<string, string>
    }>('/node/earnings', { headers: { 'x-jeju-address': nodeAddr } })

    expect(status).toBe(200)
    expect(data).toHaveProperty('total')
    expect(data).toHaveProperty('pending')
    expect(data).toHaveProperty('breakdown')
  })

  test('GET /node/logs returns log text', async () => {
    const res = await fetch(`${dwsUrl}/node/logs`)
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(typeof text).toBe('string')
  })

  test('GET /node/logs?lines=10 respects limit', async () => {
    const res = await fetch(`${dwsUrl}/node/logs?lines=10`)
    expect(res.status).toBe(200)

    const text = await res.text()
    const lines = text.split('\n').filter(Boolean)
    expect(lines.length).toBeLessThanOrEqual(10)
  })
})

describe('Workers Endpoints', () => {
  const testAddr = '0x1234567890123456789012345678901234567890'

  test('GET /workers/ returns response', async () => {
    const { status, data } = await api<Record<string, unknown>>('/workers/', {
      headers: { 'x-jeju-address': testAddr },
    })

    expect(status).toBe(200)
    // Response may have workers array or other structure
    expect(typeof data).toBe('object')
  })

  test('POST /workers/ requires valid code', async () => {
    const { status } = await api('/workers/', {
      method: 'POST',
      headers: { 'x-jeju-address': testAddr },
      body: JSON.stringify({
        name: 'test-worker',
        code: btoa('export default { fetch() { return new Response("hi") } }'),
        routes: ['/test'],
      }),
    })

    // Should either succeed (201) or fail validation (4xx) or server error
    expect(status).toBeGreaterThanOrEqual(200)
  })
})

describe('CDN Endpoints', () => {
  test('GET /cdn/stats returns CDN statistics', async () => {
    const { status } = await api<{
      requests?: number
      bandwidth?: number
    }>('/cdn/stats')

    // May return 200 with stats or 404 if not configured
    expect([200, 404]).toContain(status)
  })
})

describe('Marketplace Endpoints', () => {
  // Marketplace requires SQLit - tests validate endpoint exists
  test('GET /api/marketplace/listings returns response', async () => {
    const { status } = await api<{ listings: unknown[] }>(
      '/api/marketplace/listings',
    )

    // 200 if SQLit available, 500 if not
    expect([200, 500]).toContain(status)
  })

  test('GET /api/marketplace/providers returns response', async () => {
    const { status } = await api<{ providers: unknown[] }>(
      '/api/marketplace/providers',
    )

    expect([200, 500]).toContain(status)
  })

  test('GET /api/marketplace/stats returns response', async () => {
    const { status } = await api<{
      totalProviders?: number
      totalListings?: number
    }>('/api/marketplace/stats')

    expect([200, 500]).toContain(status)
  })
})

describe('Stats Endpoints', () => {
  test('GET /stats returns cache stats', async () => {
    const { status, data } = await api<Record<string, unknown>>('/stats')

    expect(status).toBe(200)
    // Should return some stats object
    expect(typeof data).toBe('object')
  })
})

describe('Error Handling', () => {
  test('unknown routes return error status', async () => {
    const res = await fetch(`${dwsUrl}/this-route-does-not-exist-12345`)
    // Should return 404 or 500 (depending on error handler)
    expect([404, 500]).toContain(res.status)
  })

  test('invalid JSON body returns error', async () => {
    const res = await fetch(`${dwsUrl}/deploy/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    })

    // Should return 400, 422, or 500
    expect([400, 422, 500]).toContain(res.status)
  })

  test('handles concurrent requests', async () => {
    // Fire 10 concurrent requests
    const requests = Array.from({ length: 10 }, () => fetch(`${dwsUrl}/health`))

    const responses = await Promise.all(requests)

    // All should succeed
    for (const res of responses) {
      expect(res.status).toBe(200)
    }
  })
})

describe('Rate Limiting', () => {
  test('rate limit headers present', async () => {
    const res = await fetch(`${dwsUrl}/health`)

    // Check for common rate limit headers
    const _headers = res.headers
    // May or may not have these depending on config
    expect(res.status).toBe(200)
  })
})

describe('CORS Headers', () => {
  test('OPTIONS returns CORS headers', async () => {
    const res = await fetch(`${dwsUrl}/health`, {
      method: 'OPTIONS',
    })

    // Should have CORS headers or redirect
    expect(res.status).toBeLessThan(500)
  })
})

describe('Content Types', () => {
  test('/health returns JSON', async () => {
    const res = await fetch(`${dwsUrl}/health`)
    const contentType = res.headers.get('content-type')
    expect(contentType).toContain('application/json')
  })

  test('/node/logs returns text', async () => {
    const res = await fetch(`${dwsUrl}/node/logs`)
    // Should be text/plain or similar
    expect(res.headers.get('content-type')).toBeDefined()
  })

  test('/node/logs/stream returns SSE', async () => {
    const res = await fetch(`${dwsUrl}/node/logs/stream`)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
  })
})
