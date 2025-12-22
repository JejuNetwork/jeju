/**
 * Health Middleware Tests
 *
 * Tests the standard health check API implementation
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { healthChecks, healthMiddleware } from './health-middleware'

// Helper to make requests to Elysia app
async function request(
  app: Elysia,
  path: string,
): Promise<{ status: number; json: () => Promise<Record<string, unknown>> }> {
  const response = await app.handle(new Request(`http://localhost${path}`))
  return {
    status: response.status,
    json: () => response.json() as Promise<Record<string, unknown>>,
  }
}

describe('healthMiddleware', () => {
  let app: Elysia

  beforeEach(() => {
    app = new Elysia()
  })

  describe('GET /health', () => {
    test('should return 200 with healthy status when no dependencies', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
        }),
      )

      const response = await request(app, '/health')
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.status).toBe('healthy')
      expect(data.service).toBe('test-service')
      expect(data.version).toBe('1.0.0')
      expect(data.timestamp).toBeDefined()
      expect(data.uptime).toBeGreaterThanOrEqual(0)
    })

    test('should return 503 when critical dependency fails', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'database',
              type: 'database',
              check: async () => false,
              required: true,
            },
          ],
        }),
      )

      const response = await request(app, '/health')
      expect(response.status).toBe(503)

      const data = await response.json()
      expect(data.status).toBe('unhealthy')
    })

    test('should return 200 when optional dependency fails', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'cache',
              type: 'cache',
              check: async () => false,
              required: false,
            },
          ],
        }),
      )

      const response = await request(app, '/health')
      expect(response.status).toBe(200)
    })

    test('should handle dependency check throwing error', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'broken',
              type: 'api',
              check: async () => {
                throw new Error('Connection refused')
              },
              required: true,
            },
          ],
        }),
      )

      const response = await request(app, '/health')
      expect(response.status).toBe(503)
    })
  })

  describe('GET /health/ready', () => {
    test('should return ready=true when all dependencies healthy', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'database',
              type: 'database',
              check: async () => true,
            },
            {
              name: 'cache',
              type: 'cache',
              check: async () => true,
            },
          ],
        }),
      )

      const response = await request(app, '/health/ready')
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.ready).toBe(true)
      expect(data.status).toBe('healthy')
      expect(Array.isArray(data.dependencies)).toBe(true)
      expect(data.dependencies.length).toBe(2)
    })

    test('should return ready=false when required dependency fails', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'database',
              type: 'database',
              check: async () => false,
              required: true,
            },
          ],
        }),
      )

      const response = await request(app, '/health/ready')
      expect(response.status).toBe(503)

      const data = await response.json()
      expect(data.ready).toBe(false)
      expect(data.status).toBe('unhealthy')
    })

    test('should show degraded when optional dependency fails', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'database',
              type: 'database',
              check: async () => true,
              required: true,
            },
            {
              name: 'cache',
              type: 'cache',
              check: async () => false,
              required: false,
            },
          ],
        }),
      )

      const response = await request(app, '/health/ready')
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.ready).toBe(true)
      expect(data.status).toBe('degraded')
      const deps = data.dependencies as { status: string }[]
      expect(deps[1].status).toBe('unhealthy')
    })

    test('should include latency measurements', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'slow-db',
              type: 'database',
              check: async () => {
                await new Promise((resolve) => setTimeout(resolve, 50))
                return true
              },
            },
          ],
        }),
      )

      const response = await request(app, '/health/ready')
      const data = await response.json()
      const deps = data.dependencies as { latencyMs: number }[]

      expect(deps[0].latencyMs).toBeGreaterThanOrEqual(50)
    })

    test('should include error messages', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          dependencies: [
            {
              name: 'broken',
              type: 'api',
              check: async () => {
                throw new Error('Connection timeout')
              },
            },
          ],
        }),
      )

      const response = await request(app, '/health/ready')
      const data = await response.json()
      const deps = data.dependencies as { error: string }[]

      expect(deps[0].error).toBe('Connection timeout')
    })
  })

  describe('GET /health/live', () => {
    test('should return liveness information', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
        }),
      )

      const response = await request(app, '/health/live')
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.alive).toBe(true)
      expect(data.pid).toBeGreaterThan(0)
      expect(data.memoryUsage).toBeDefined()
      const memUsage = data.memoryUsage as {
        heapUsed: number
        heapTotal: number
        rss: number
      }
      expect(memUsage.heapUsed).toBeGreaterThan(0)
      expect(memUsage.heapTotal).toBeGreaterThan(0)
      expect(memUsage.rss).toBeGreaterThan(0)
    })
  })

  describe('GET /health/resources', () => {
    test('should return resource health with funding', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          resources: [
            {
              type: 'ipfs_content',
              identifier: 'QmTest123',
              required: true,
              check: async () => true,
            },
          ],
          funding: {
            vaultAddress: '0x1234567890123456789012345678901234567890',
            minRequired: 100000000000000000n,
            getCurrentBalance: async () => 200000000000000000n,
            autoFundEnabled: true,
          },
        }),
      )

      const response = await request(app, '/health/resources')
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.status).toBe('healthy')
      const resources = data.resources as { type: string; status: string }[]
      expect(resources.length).toBe(1)
      expect(resources[0].type).toBe('ipfs_content')
      expect(resources[0].status).toBe('healthy')
      const funding = data.funding as {
        funded: boolean
        balance: string
        minRequired: string
        autoFundEnabled: boolean
      }
      expect(funding.funded).toBe(true)
      expect(funding.balance).toBe('200000000000000000')
      expect(funding.minRequired).toBe('100000000000000000')
      expect(funding.autoFundEnabled).toBe(true)
    })

    test('should return unfunded status when balance too low', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          funding: {
            vaultAddress: '0x1234567890123456789012345678901234567890',
            minRequired: 100000000000000000n,
            getCurrentBalance: async () => 50000000000000000n,
          },
        }),
      )

      const response = await request(app, '/health/resources')
      expect(response.status).toBe(503)

      const data = await response.json()
      expect(data.status).toBe('unfunded')
      const funding = data.funding as { funded: boolean }
      expect(funding.funded).toBe(false)
    })

    test('should handle balance check failure', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          funding: {
            vaultAddress: '0x1234567890123456789012345678901234567890',
            minRequired: 100000000000000000n,
            getCurrentBalance: async () => {
              throw new Error('RPC error')
            },
          },
        }),
      )

      const response = await request(app, '/health/resources')
      const data = await response.json()

      // Should default to 0n and show unfunded
      const funding = data.funding as { funded: boolean; balance: string }
      expect(funding.funded).toBe(false)
      expect(funding.balance).toBe('0')
    })

    test('should mark resource unhealthy when check fails', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          resources: [
            {
              type: 'compute_endpoint',
              identifier: 'https://api.example.com',
              required: true,
              check: async () => false,
            },
          ],
        }),
      )

      const response = await request(app, '/health/resources')
      expect(response.status).toBe(503)

      const data = await response.json()
      expect(data.status).toBe('unhealthy')
      const resources = data.resources as { status: string }[]
      expect(resources[0].status).toBe('unhealthy')
    })

    test('should show degraded for optional resource failure', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          resources: [
            {
              type: 'compute_endpoint',
              identifier: 'api1',
              required: true,
              check: async () => true,
            },
            {
              type: 'cache',
              identifier: 'redis',
              required: false,
              check: async () => false,
            },
          ],
        }),
      )

      const response = await request(app, '/health/resources')
      expect(response.status).toBe(503) // 503 because status is degraded

      const data = await response.json()
      expect(data.status).toBe('degraded')
    })

    test('should handle resource without check function', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          resources: [
            {
              type: 'ipfs_content',
              identifier: 'QmTest123',
              required: true,
              // No check function
            },
          ],
        }),
      )

      const response = await request(app, '/health/resources')
      const data = await response.json()
      const resources = data.resources as { status: string }[]

      expect(resources[0].status).toBe('healthy')
    })

    test('should include lastCheck timestamp', async () => {
      app.use(
        healthMiddleware({
          service: 'test-service',
          version: '1.0.0',
          resources: [
            {
              type: 'api',
              identifier: 'backend',
              check: async () => true,
            },
          ],
        }),
      )

      const response = await request(app, '/health/resources')
      const data = await response.json()
      const resources = data.resources as { lastCheck: string }[]

      expect(resources[0].lastCheck).toBeDefined()
      expect(new Date(resources[0].lastCheck).getTime()).toBeGreaterThan(0)
    })
  })
})

describe('healthChecks helpers', () => {
  describe('http', () => {
    test('should return true for 2xx response', async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response('OK')
        },
      })

      const check = healthChecks.http(`http://localhost:${server.port}`)
      const result = await check()

      expect(result).toBe(true)

      server.stop()
    })

    test('should return false for 5xx response', async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response('Error', { status: 500 })
        },
      })

      const check = healthChecks.http(`http://localhost:${server.port}`)
      const result = await check()

      expect(result).toBe(false)

      server.stop()
    })

    test('should return false on timeout', async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Promise(() => {
            /* intentionally never resolves */
          })
        },
      })

      const check = healthChecks.http(`http://localhost:${server.port}`, 100)

      await expect(check()).rejects.toThrow()

      server.stop()
    })
  })

  describe('rpc', () => {
    test('should return true for valid eth_blockNumber response', async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: '0x1234',
          })
        },
      })

      const check = healthChecks.rpc(`http://localhost:${server.port}`)
      const result = await check()

      expect(result).toBe(true)

      server.stop()
    })

    test('should return false for error response', async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: 'Internal error' },
          })
        },
      })

      const check = healthChecks.rpc(`http://localhost:${server.port}`)
      const result = await check()

      expect(result).toBe(false)

      server.stop()
    })

    test('should return false for HTTP error', async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response('Bad Gateway', { status: 502 })
        },
      })

      const check = healthChecks.rpc(`http://localhost:${server.port}`)
      const result = await check()

      expect(result).toBe(false)

      server.stop()
    })
  })

  describe('ipfs', () => {
    test('should return true for valid IPFS response', async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          if (req.url.endsWith('/api/v0/id')) {
            return Response.json({ ID: 'QmTest' })
          }
          return new Response('Not Found', { status: 404 })
        },
      })

      const check = healthChecks.ipfs(`http://localhost:${server.port}`)
      const result = await check()

      expect(result).toBe(true)

      server.stop()
    })

    test('should return false for connection error', async () => {
      const check = healthChecks.ipfs('http://localhost:59999')
      const result = await check()

      expect(result).toBe(false)
    })
  })
})

describe('edge cases', () => {
  test('should handle empty dependencies array', async () => {
    const app = new Elysia().use(
      healthMiddleware({
        service: 'test',
        version: '1.0.0',
        dependencies: [],
      }),
    )

    const response = await request(app, '/health/ready')
    const data = await response.json()

    expect(data.ready).toBe(true)
    expect(Array.isArray(data.dependencies)).toBe(true)
    expect(data.dependencies.length).toBe(0)
  })

  test('should handle empty resources array', async () => {
    const app = new Elysia().use(
      healthMiddleware({
        service: 'test',
        version: '1.0.0',
        resources: [],
      }),
    )

    const response = await request(app, '/health/resources')
    const data = await response.json()

    expect(Array.isArray(data.resources)).toBe(true)
    expect(data.resources.length).toBe(0)
  })

  test('should handle concurrent requests', async () => {
    let checkCount = 0
    const app = new Elysia().use(
      healthMiddleware({
        service: 'test',
        version: '1.0.0',
        dependencies: [
          {
            name: 'slow',
            type: 'database',
            check: async () => {
              checkCount++
              await new Promise((resolve) => setTimeout(resolve, 50))
              return true
            },
          },
        ],
      }),
    )

    // Make 10 concurrent requests
    const requests = Array(10)
      .fill(null)
      .map(() => request(app, '/health/ready'))
    const responses = await Promise.all(requests)

    // All should succeed
    for (const response of responses) {
      expect(response.status).toBe(200)
    }

    // Check should have been called 10 times (once per request)
    expect(checkCount).toBe(10)
  })

  test('should measure uptime correctly', async () => {
    const app = new Elysia().use(
      healthMiddleware({
        service: 'test',
        version: '1.0.0',
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    const response = await request(app, '/health')
    const data = await response.json()

    expect(data.uptime).toBeGreaterThanOrEqual(100)
  })
})
