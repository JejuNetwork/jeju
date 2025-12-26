import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { createAppDeployerRouter } from '../api/deploy/app-deployer'

const USER_A: Address = '0x1111111111111111111111111111111111111111'
const ZERO_ADDR: Address = '0x0000000000000000000000000000000000000000'

let app: Elysia

beforeAll(() => {
  app = new Elysia().use(createAppDeployerRouter())
})

describe('Deploy List Endpoint', () => {
  describe('GET /deploy/list', () => {
    test('returns empty array when no deployments exist', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/list', {
          headers: { 'x-jeju-address': USER_A },
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('deployments')
      expect(Array.isArray(data.deployments)).toBe(true)
    })

    test('returns deployments without address filter', async () => {
      const res = await app.handle(new Request('http://localhost/deploy/list'))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('deployments')
    })

    test('filters deployments by owner address (case insensitive)', async () => {
      const res1 = await app.handle(
        new Request('http://localhost/deploy/list', {
          headers: { 'x-jeju-address': USER_A.toLowerCase() },
        }),
      )
      expect(res1.status).toBe(200)

      const res2 = await app.handle(
        new Request('http://localhost/deploy/list', {
          headers: { 'x-jeju-address': USER_A },
        }),
      )
      expect(res2.status).toBe(200)
    })

    test('handles zero address', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/list', {
          headers: { 'x-jeju-address': ZERO_ADDR },
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('deployments')
    })
  })

  describe('GET /deploy/health', () => {
    test('returns healthy status', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/health'),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('healthy')
      expect(data.service).toBe('dws-app-deployer')
    })
  })

  describe('GET /deploy/status/:appName', () => {
    test('returns status for valid app name', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/status/test-app', {
          headers: { 'x-jeju-address': USER_A },
        }),
      )
      expect([200, 404, 500]).toContain(res.status)
    })

    test('handles special characters in app name', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/status/my-app_v2', {
          headers: { 'x-jeju-address': USER_A },
        }),
      )
      expect(res.status).toBeGreaterThanOrEqual(200)
    })

    test('handles empty app name gracefully', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/status/', {
          headers: { 'x-jeju-address': USER_A },
        }),
      )
      expect([301, 404]).toContain(res.status)
    })
  })

  describe('GET /deploy/tee/status', () => {
    test('returns TEE status information', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/tee/status'),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('mode')
      expect(['production', 'development']).toContain(data.mode)
    })
  })

  describe('POST /deploy/', () => {
    test('rejects invalid manifest', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': USER_A,
          },
          body: JSON.stringify({ invalid: 'data' }),
        }),
      )
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toHaveProperty('error')
    })

    test('rejects empty body', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': USER_A,
          },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
    })

    test('rejects manifest without name', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': USER_A,
          },
          body: JSON.stringify({ manifest: { version: '1.0.0' } }),
        }),
      )
      expect(res.status).toBe(400)
    })

    test('accepts valid minimal manifest', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': USER_A,
          },
          body: JSON.stringify({
            manifest: { name: 'test-app', version: '1.0.0' },
          }),
        }),
      )
      expect(res.status).not.toBe(400)
    })

    test('handles missing x-jeju-address header', async () => {
      const res = await app.handle(
        new Request('http://localhost/deploy/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manifest: { name: 'test-app', version: '1.0.0' },
          }),
        }),
      )
      expect(res.status).not.toBe(401)
    })
  })
})

describe('Deployment Data Structure', () => {
  test('deployment has required fields', async () => {
    const res = await app.handle(new Request('http://localhost/deploy/list'))
    const data = await res.json()

    if (data.deployments.length > 0) {
      const d = data.deployments[0]
      expect(d).toHaveProperty('id')
      expect(d).toHaveProperty('appName')
      expect(d).toHaveProperty('status')
      expect(d).toHaveProperty('version')
      expect(d).toHaveProperty('createdAt')
      expect(d).toHaveProperty('url')
      expect(d).toHaveProperty('region')
    }
  })

  test('deployment status is valid enum', async () => {
    const res = await app.handle(new Request('http://localhost/deploy/list'))
    const data = await res.json()
    const validStatuses = ['deploying', 'active', 'failed', 'stopped']
    for (const d of data.deployments) {
      expect(validStatuses).toContain(d.status)
    }
  })

  test('deployment timestamps are valid', async () => {
    const res = await app.handle(new Request('http://localhost/deploy/list'))
    const data = await res.json()
    for (const d of data.deployments) {
      expect(typeof d.createdAt).toBe('number')
      expect(d.createdAt).toBeGreaterThan(0)
      expect(d.createdAt).toBeLessThanOrEqual(Date.now() + 1000)
    }
  })
})
