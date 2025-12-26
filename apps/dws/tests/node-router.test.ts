import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  addNodeLog,
  createNodeRouter,
  recordEarning,
} from '../api/server/routes/node'

const NODE_A: Address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NODE_B: Address = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

let app: Elysia

beforeAll(() => {
  app = new Elysia().use(createNodeRouter())
  addNodeLog('info', 'Test log message 1')
  addNodeLog('warn', 'Test warning message')
  addNodeLog('error', 'Test error message')
  recordEarning(NODE_A, 'cdn', 1000000000000000000n)
  recordEarning(NODE_A, 'storage', 500000000000000000n)
  recordEarning(NODE_B, 'compute', 2000000000000000000n)
})

describe('Node Router', () => {
  describe('GET /node/health', () => {
    test('returns healthy status', async () => {
      const res = await app.handle(new Request('http://localhost/node/health'))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('healthy')
      expect(data.service).toBe('dws-node')
    })
  })

  describe('GET /node/status', () => {
    test('returns node status with address header', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/status', {
          headers: { 'x-jeju-address': NODE_A },
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('nodeId')
      expect(data).toHaveProperty('address')
      expect(data).toHaveProperty('services')
      expect(data).toHaveProperty('status')
      expect(data.address).toBe(NODE_A)
    })

    test('returns unknown address when header missing', async () => {
      const res = await app.handle(new Request('http://localhost/node/status'))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.address).toBe('unknown')
    })

    test('returns correct services from env', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/status', {
          headers: { 'x-jeju-address': NODE_A },
        }),
      )
      const data = await res.json()
      expect(Array.isArray(data.services)).toBe(true)
    })

    test('uptime is a positive number', async () => {
      const res = await app.handle(new Request('http://localhost/node/status'))
      const data = await res.json()
      expect(typeof data.uptime).toBe('number')
      expect(data.uptime).toBeGreaterThan(0)
    })
  })

  describe('GET /node/earnings', () => {
    test('returns earnings for node with recorded earnings', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/earnings', {
          headers: { 'x-jeju-address': NODE_A },
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('total')
      expect(data).toHaveProperty('pending')
      expect(data).toHaveProperty('breakdown')
    })

    test('returns zero earnings for node without earnings', async () => {
      const newNode: Address = '0xcccccccccccccccccccccccccccccccccccccccc'
      const res = await app.handle(
        new Request('http://localhost/node/earnings', {
          headers: { 'x-jeju-address': newNode },
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.total).toBe('0')
      expect(data.pending).toBe('0')
      expect(data.breakdown).toEqual({})
    })

    test('returns error when address header missing', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/earnings'),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('error')
      expect(data.error).toContain('Missing')
    })

    test('earnings breakdown includes all services', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/earnings', {
          headers: { 'x-jeju-address': NODE_A },
        }),
      )
      const data = await res.json()
      expect(data.breakdown).toHaveProperty('cdn')
      expect(data.breakdown).toHaveProperty('storage')
    })

    test('handles address case insensitively', async () => {
      const res1 = await app.handle(
        new Request('http://localhost/node/earnings', {
          headers: { 'x-jeju-address': NODE_A.toLowerCase() },
        }),
      )
      const res2 = await app.handle(
        new Request('http://localhost/node/earnings', {
          headers: { 'x-jeju-address': NODE_A.toUpperCase() },
        }),
      )
      const data1 = await res1.json()
      const data2 = await res2.json()
      expect(data1.pending).toBe(data2.pending)
    })
  })

  describe('GET /node/logs', () => {
    test('returns recent logs', async () => {
      const res = await app.handle(new Request('http://localhost/node/logs'))
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain('Test log message')
    })

    test('respects lines parameter', async () => {
      for (let i = 0; i < 20; i++) addNodeLog('info', `Bulk log ${i}`)
      const res = await app.handle(
        new Request('http://localhost/node/logs?lines=5'),
      )
      const text = await res.text()
      const lines = text.split('\n').filter(Boolean)
      expect(lines.length).toBeLessThanOrEqual(5)
    })

    test('caps lines at 1000', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/logs?lines=10000'),
      )
      expect(res.status).toBe(200)
    })

    test('handles invalid lines parameter gracefully', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/logs?lines=invalid'),
      )
      expect(res.status).toBe(200)
    })

    test('handles negative lines parameter', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/logs?lines=-10'),
      )
      expect(res.status).toBe(200)
    })

    test('logs include timestamp, level, and message', async () => {
      const res = await app.handle(new Request('http://localhost/node/logs'))
      const text = await res.text()
      const lines = text.split('\n').filter(Boolean)
      for (const line of lines) {
        expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T.*\[(?:INFO|WARN|ERROR)\]/)
      }
    })
  })

  describe('GET /node/logs/stream', () => {
    test('returns SSE stream', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/logs/stream'),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      expect(res.headers.get('cache-control')).toBe('no-cache')
    })

    test('stream body is readable', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/logs/stream'),
      )
      expect(res.body).toBeDefined()
    })
  })

  describe('POST /node/withdraw', () => {
    test('returns error when address header missing', async () => {
      const res = await app.handle(
        new Request('http://localhost/node/withdraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toHaveProperty('error')
      expect(data.error).toContain('Missing')
    })

    test('returns error when no pending earnings', async () => {
      const newNode: Address = '0xdddddddddddddddddddddddddddddddddddddddd'
      const res = await app.handle(
        new Request('http://localhost/node/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': newNode,
          },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toHaveProperty('error')
      expect(data.error).toContain('No pending earnings')
    })

    test('withdraws full pending amount by default', async () => {
      const testNode: Address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      recordEarning(testNode, 'test', 1000000000000000000n)
      const res = await app.handle(
        new Request('http://localhost/node/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': testNode,
          },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data).toHaveProperty('amount')
      expect(data.mode).toBe('development')
      expect(data.message).toContain('Local balance updated')
    })

    test('withdraws specific amount when provided', async () => {
      const testNode: Address = '0xfffffffffffffffffffffffffffffffffffffffF'
      recordEarning(testNode, 'test', 2000000000000000000n)
      const res = await app.handle(
        new Request('http://localhost/node/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': testNode,
          },
          body: JSON.stringify({ amount: '1' }),
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })

    test('returns error when amount exceeds pending', async () => {
      const testNode: Address = '0x1234567890123456789012345678901234567891'
      recordEarning(testNode, 'test', 1000000000000000000n)
      const res = await app.handle(
        new Request('http://localhost/node/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': testNode,
          },
          body: JSON.stringify({ amount: '10' }),
        }),
      )
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toHaveProperty('error')
      expect(data.error).toContain('Insufficient')
    })
  })
})

describe('Node Log Management', () => {
  test('addNodeLog adds entries to buffer', async () => {
    const uniqueMsg = `unique-test-${Date.now()}`
    addNodeLog('info', uniqueMsg)
    const res = await app.handle(new Request('http://localhost/node/logs'))
    const text = await res.text()
    expect(text).toContain(uniqueMsg)
  })

  test('log buffer trims when exceeding max', async () => {
    const initialRes = await app.handle(
      new Request('http://localhost/node/logs?lines=10000'),
    )
    const initialCount = (await initialRes.text())
      .split('\n')
      .filter(Boolean).length
    for (let i = 0; i < 100; i++) addNodeLog('info', `Trim test ${i}`)
    const res = await app.handle(
      new Request('http://localhost/node/logs?lines=10000'),
    )
    const newCount = (await res.text()).split('\n').filter(Boolean).length
    expect(newCount).toBeGreaterThanOrEqual(initialCount)
  })
})

describe('Earnings Management', () => {
  test('recordEarning accumulates amounts', async () => {
    const testNode: Address = '0x9999999999999999999999999999999999999999'
    recordEarning(testNode, 'cdn', 1000000000000000000n)
    recordEarning(testNode, 'cdn', 1000000000000000000n)
    const res = await app.handle(
      new Request('http://localhost/node/earnings', {
        headers: { 'x-jeju-address': testNode },
      }),
    )
    const data = await res.json()
    expect(parseFloat(data.pending)).toBeGreaterThanOrEqual(2)
  })

  test('recordEarning tracks multiple services separately', async () => {
    const testNode: Address = '0x8888888888888888888888888888888888888888'
    recordEarning(testNode, 'cdn', 1000000000000000000n)
    recordEarning(testNode, 'storage', 2000000000000000000n)
    const res = await app.handle(
      new Request('http://localhost/node/earnings', {
        headers: { 'x-jeju-address': testNode },
      }),
    )
    const data = await res.json()
    expect(Object.keys(data.breakdown)).toContain('cdn')
    expect(Object.keys(data.breakdown)).toContain('storage')
  })
})
