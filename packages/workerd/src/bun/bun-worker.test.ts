// Copyright (c) 2024 Jeju Network
// Integration tests for Bun worker runtime in workerd
// Licensed under the Apache 2.0 license
//
// These tests verify the Bun compatibility layer works correctly when
// running as a worker in workerd. Requires workerd to be running on port 9123:
//   cd samples/bun-hello && workerd serve config.capnp
//
// To run these tests with workerd:
//   Terminal 1: cd samples/bun-hello && workerd serve config.capnp
//   Terminal 2: WORKERD_RUNNING=1 bun test src/bun/bun-worker.test.ts

import { beforeAll, describe, expect, test } from 'bun:test'

const WORKERD_URL = 'http://localhost:9123'

// Check if workerd is expected to be running (set via env var or actual check)
const EXPECT_WORKERD = process.env.WORKERD_RUNNING === '1'

let workerdAvailable = false

async function checkWorkerdRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKERD_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

describe('Bun Worker in Workerd', () => {
  beforeAll(async () => {
    workerdAvailable = await checkWorkerdRunning()

    if (!workerdAvailable) {
      console.warn(
        `
⚠️  Workerd is not running on ${WORKERD_URL}
   Start it with: cd samples/bun-hello && workerd serve config.capnp
   
   Tests will be skipped. To run integration tests:
   1. Start workerd in one terminal
   2. Run: WORKERD_RUNNING=1 bun test src/bun/bun-worker.test.ts
`,
      )

      // If we expected workerd to be running, fail hard
      if (EXPECT_WORKERD) {
        throw new Error(
          'WORKERD_RUNNING=1 but workerd is not available. Start workerd first.',
        )
      }
    }
  })

  test('GET / returns JSON response', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const response = await fetch(`${WORKERD_URL}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')

    const data = (await response.json()) as {
      message: string
      runtime: string
      uptime: number
      timestamp: string
    }
    expect(data.message).toBe('Hello from Bun worker!')
    expect(data.runtime).toBe('workerd')
    expect(typeof data.uptime).toBe('number')
    expect(data.timestamp).toBeTruthy()
  })

  test('GET /health returns OK', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const response = await fetch(`${WORKERD_URL}/health`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('OK')
  })

  test('GET /hash computes SHA-256', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const response = await fetch(`${WORKERD_URL}/hash?data=test`)
    expect(response.status).toBe(200)

    const data = (await response.json()) as { input: string; sha256: string }
    expect(data.input).toBe('test')
    // SHA-256 of "test" is known
    expect(data.sha256).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    )
  })

  test('POST /echo returns request details', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const body = JSON.stringify({ test: 'data', number: 42 })
    const response = await fetch(`${WORKERD_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      method: string
      body: string
      headers: Record<string, string>
    }
    expect(data.method).toBe('POST')
    expect(data.body).toBe(body)
    expect(data.headers['content-type']).toBe('application/json')
  })

  test('GET /headers returns custom headers', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const response = await fetch(`${WORKERD_URL}/headers`)
    expect(response.status).toBe(200)

    // Check custom headers in response
    expect(response.headers.get('x-custom-header')).toBe('Bun Worker')
    expect(response.headers.get('x-request-id')).toBeTruthy()

    const data = (await response.json()) as {
      customHeaders: Record<string, string>
    }
    expect(data.customHeaders['x-custom-header']).toBe('Bun Worker')
  })

  test('GET /stream returns streaming response', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const response = await fetch(`${WORKERD_URL}/stream`)
    expect(response.status).toBe(200)

    const text = await response.text()
    expect(text).toBe('Hello from streaming response!')
  })

  test('GET /notfound returns 404 with available routes', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const response = await fetch(`${WORKERD_URL}/notfound`)
    expect(response.status).toBe(404)

    const data = (await response.json()) as {
      error: string
      path: string
      availableRoutes: string[]
    }
    expect(data.error).toBe('Not Found')
    expect(data.path).toBe('/notfound')
    expect(Array.isArray(data.availableRoutes)).toBe(true)
    expect(data.availableRoutes).toContain('/')
    expect(data.availableRoutes).toContain('/health')
  })

  test('multiple sequential requests are handled correctly', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    // Test sequential requests
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${WORKERD_URL}/health`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('OK')
    }
  })

  test('request with different HTTP methods', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const

    for (const method of methods) {
      const response = await fetch(`${WORKERD_URL}/echo`, { method })
      expect(response.status).toBe(200)

      const data = (await response.json()) as { method: string }
      expect(data.method).toBe(method)
    }
  })

  test('crypto.randomUUID generates unique IDs', async () => {
    if (!workerdAvailable) {
      console.log('  [SKIPPED] workerd not running')
      return
    }

    const ids = new Set<string>()

    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${WORKERD_URL}/headers`)
      const requestId = response.headers.get('x-request-id')
      expect(requestId).toBeTruthy()
      expect(ids.has(requestId as string)).toBe(false)
      ids.add(requestId as string)
    }

    expect(ids.size).toBe(5)
  })
})
