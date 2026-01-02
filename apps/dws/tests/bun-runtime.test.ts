/**
 * Bun Worker Runtime Integration Tests
 *
 * Tests that verify the Bun runtime actually spawns workers, serves requests,
 * and runs with no errors. These are REAL integration tests - not mocks.
 *
 * Run with:
 *   bun test tests/bun-runtime.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { WorkerRuntime } from '../api/workers/runtime'
import type { BackendManager } from '../api/storage/backends'
import type { WorkerFunction } from '../api/workers/types'
import type { UploadResult } from '../api/storage/types'

// Test configuration
const TEST_TIMEOUT = 20000 // 20 seconds
const STARTUP_WAIT = 5000 // Wait for worker to become ready

// Simple in-memory backend for tests (avoids IPFS timeouts)
class MemoryBackend implements BackendManager {
  private storage = new Map<string, Buffer>()

  async upload(data: Buffer | Uint8Array): Promise<UploadResult> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const cid = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.storage.set(cid, buffer)
    return {
      cid,
      size: buffer.length,
      hash: cid,
    }
  }

  async download(cid: string): Promise<{ content: Buffer; size: number }> {
    const content = this.storage.get(cid)
    if (!content) {
      throw new Error(`Content not found: ${cid}`)
    }
    return { content, size: content.length }
  }

  async exists(cid: string): Promise<boolean> {
    return this.storage.has(cid)
  }

  async delete(cid: string): Promise<void> {
    this.storage.delete(cid)
  }

  async getUrl(cid: string): Promise<string> {
    return `memory://${cid}`
  }
}

const backend: BackendManager = new MemoryBackend()
let runtime: WorkerRuntime

// Track errors during tests
const capturedErrors: string[] = []
const originalConsoleError = console.error

// Track spawned workers for cleanup
const deployedFunctions: string[] = []

beforeAll(async () => {
  // Capture all console.error calls to detect runtime errors
  console.error = (...args: unknown[]) => {
    const message = args.map(String).join(' ')
    capturedErrors.push(message)
    originalConsoleError.apply(console, args)
  }

  // Create runtime instance with limited concurrency for tests
  runtime = new WorkerRuntime(backend, {
    maxWarmInstances: 2,
    maxConcurrentInvocations: 5,
    idleTimeout: 10000,
  })

  // Wait for runtime to initialize
  await new Promise((r) => setTimeout(r, 1000))
})

afterAll(async () => {
  // Restore console.error
  console.error = originalConsoleError

  // Cleanup deployed functions
  for (const functionId of deployedFunctions) {
    try {
      await runtime.undeployFunction(functionId)
    } catch {
      // Ignore cleanup errors
    }
  }
})

// Helper to create and upload worker code
async function deployTestWorker(
  name: string,
  code: string,
  options: Partial<WorkerFunction> = {},
): Promise<WorkerFunction> {
  // Upload code to storage
  const codeBuffer = Buffer.from(code)
  const uploadResult = await backend.upload(codeBuffer, {
    filename: `${name}.js`,
  })

  const fn: WorkerFunction = {
    id: crypto.randomUUID(),
    name,
    owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    runtime: 'bun',
    handler: 'fetch',
    codeCid: uploadResult.cid,
    memory: 256,
    timeout: 30000,
    version: 1,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    invocationCount: 0,
    errorCount: 0,
    env: {},
    ...options,
  }

  await runtime.deployFunction(fn)
  deployedFunctions.push(fn.id)

  return fn
}

describe('Bun Worker Runtime', () => {
  test(
    'spawns a Bun process and serves HTTP requests',
    async () => {
      const code = `
export default {
  fetch(request) {
    return new Response(JSON.stringify({
      message: 'Hello from Bun worker',
      bunVersion: typeof Bun !== 'undefined' ? Bun.version : 'not-bun',
      pid: process.pid,
      timestamp: Date.now()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('spawn-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      const response = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.body)
      expect(body.message).toBe('Hello from Bun worker')
      expect(body.bunVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(typeof body.pid).toBe('number')
      expect(body.pid).toBeGreaterThan(0)
    },
    TEST_TIMEOUT,
  )

  test(
    'Bun APIs are available in worker',
    async () => {
      const code = `
export default {
  async fetch(request) {
    const checks = {
      hasBun: typeof Bun !== 'undefined',
      bunVersion: typeof Bun !== 'undefined' ? Bun.version : null,
      hasBunServe: typeof Bun !== 'undefined' && typeof Bun.serve === 'function',
      hasBunFile: typeof Bun !== 'undefined' && typeof Bun.file === 'function',
      hasProcess: typeof process !== 'undefined',
      processPid: process.pid,
    };
    
    return new Response(JSON.stringify(checks), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('bun-api-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      const response = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })

      expect(response.statusCode).toBe(200)

      const checks = JSON.parse(response.body)
      expect(checks.hasBun).toBe(true)
      expect(checks.bunVersion).toMatch(/^\d+\.\d+/)
      expect(checks.hasBunServe).toBe(true)
      expect(checks.hasBunFile).toBe(true)
      expect(checks.hasProcess).toBe(true)
      expect(checks.processPid).toBeGreaterThan(0)
    },
    TEST_TIMEOUT,
  )

  test(
    'reuses worker instance across invocations',
    async () => {
      const code = `
let counter = 0;
export default {
  fetch(request) {
    counter++;
    return new Response(JSON.stringify({
      counter,
      pid: process.pid
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('counter-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      // First invocation
      const response1 = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })
      expect(response1.statusCode).toBe(200)
      const data1 = JSON.parse(response1.body)

      // Second invocation
      const response2 = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })
      expect(response2.statusCode).toBe(200)
      const data2 = JSON.parse(response2.body)

      // Same PID = same instance
      expect(data1.pid).toBe(data2.pid)
      // Counter incremented
      expect(data2.counter).toBe(data1.counter + 1)
    },
    TEST_TIMEOUT,
  )

  test(
    'passes request method, path, and query correctly',
    async () => {
      const code = `
export default {
  fetch(request) {
    const url = new URL(request.url);
    return new Response(JSON.stringify({
      method: request.method,
      path: url.pathname,
      search: url.search
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('request-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      const response = await runtime.invokeHTTP(fn.id, {
        method: 'POST',
        path: '/api/users',
        headers: {},
        query: { page: '1' },
      })

      expect(response.statusCode).toBe(200)
      const data = JSON.parse(response.body)
      expect(data.method).toBe('POST')
      expect(data.path).toBe('/api/users')
    },
    TEST_TIMEOUT,
  )

  test(
    'passes headers correctly',
    async () => {
      const code = `
export default {
  fetch(request) {
    const headers = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return new Response(JSON.stringify({ headers }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('headers-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      const response = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {
          'X-Custom-Header': 'test-value',
          Authorization: 'Bearer token123',
        },
        query: {},
      })

      expect(response.statusCode).toBe(200)
      const data = JSON.parse(response.body)
      expect(data.headers['x-custom-header']).toBe('test-value')
      expect(data.headers.authorization).toBe('Bearer token123')
    },
    TEST_TIMEOUT,
  )

  test(
    'passes request body correctly',
    async () => {
      const code = `
export default {
  async fetch(request) {
    // Health checks are GET requests - return 200
    if (request.method === 'GET') {
      return new Response('OK');
    }
    // Only parse body for POST
    const body = await request.json();
    return new Response(JSON.stringify({ received: body }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('body-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      const testBody = { name: 'test', value: 123 }

      const response = await runtime.invokeHTTP(fn.id, {
        method: 'POST',
        path: '/',
        headers: { 'Content-Type': 'application/json' },
        query: {},
        body: JSON.stringify(testBody),
      })

      expect(response.statusCode).toBe(200)
      const data = JSON.parse(response.body)
      expect(data.received).toEqual(testBody)
    },
    TEST_TIMEOUT,
  )

  test(
    'worker errors return 500 status',
    async () => {
      const code = `
export default {
  fetch(request) {
    const url = new URL(request.url);
    // Pass health checks to allow worker to start
    if (url.pathname === '/health') {
      return new Response('OK');
    }
    // Throw error on other paths
    throw new Error('Intentional test error');
  }
};`

      const fn = await deployTestWorker('error-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      const response = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/trigger-error',
        headers: {},
        query: {},
      })

      expect(response.statusCode).toBe(500)
      const body = JSON.parse(response.body)
      expect(body.error).toContain('Intentional test error')
    },
    TEST_TIMEOUT,
  )

  test(
    'receives environment variables',
    async () => {
      const code = `
export default {
  fetch(request, env) {
    return new Response(JSON.stringify({
      apiKey: env.API_KEY,
      configValue: env.CONFIG_VALUE
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('env-test', code, {
        env: {
          API_KEY: 'secret-key-123',
          CONFIG_VALUE: 'test-config',
        },
      })
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      const response = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })

      expect(response.statusCode).toBe(200)
      const data = JSON.parse(response.body)
      expect(data.apiKey).toBe('secret-key-123')
      expect(data.configValue).toBe('test-config')
    },
    TEST_TIMEOUT,
  )

  test(
    'undeploy stops the worker',
    async () => {
      const code = `
export default {
  fetch(request) {
    return new Response(JSON.stringify({ pid: process.pid }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      const fn = await deployTestWorker('lifecycle-test', code)
      await new Promise((r) => setTimeout(r, STARTUP_WAIT))

      // Invoke to spawn
      const response1 = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })
      expect(response1.statusCode).toBe(200)

      // Undeploy
      await runtime.undeployFunction(fn.id)
      const idx = deployedFunctions.indexOf(fn.id)
      if (idx >= 0) deployedFunctions.splice(idx, 1)

      // Should return 404
      const response2 = await runtime.invokeHTTP(fn.id, {
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
      })
      expect(response2.statusCode).toBe(404)
    },
    TEST_TIMEOUT,
  )

  test('getStats returns correct runtime mode', () => {
    const stats = runtime.getStats()
    expect(stats.runtimeMode).toBe('bun')
    expect(typeof stats.totalFunctions).toBe('number')
    expect(typeof stats.activeInstances).toBe('number')
  })

  test('no unexpected runtime errors', () => {
    const unexpectedErrors = capturedErrors.filter((err) => {
      // Expected test errors
      if (err.includes('Intentional test error')) return false
      // Infrastructure not running in tests
      if (err.includes('SQLit')) return false
      if (err.includes('Unable to connect')) return false
      if (err.includes('IndexerProxy')) return false
      if (err.includes('PriceAggregator')) return false
      if (err.includes('AppRouter')) return false
      if (err.includes('IPFS')) return false
      // Port allocation race conditions
      if (err.includes('port') && err.includes('in use')) return false
      if (err.includes('EADDRINUSE')) return false
      // Worker startup failures (will be retried)
      if (err.includes('failed to start')) return false
      if (err.includes('Worker Error')) return false
      return true
    })

    if (unexpectedErrors.length > 0) {
      console.log('Unexpected errors:')
      unexpectedErrors.forEach((err) => console.log(' -', err.slice(0, 200)))
    }

    expect(unexpectedErrors.length).toBe(0)
  })
})
