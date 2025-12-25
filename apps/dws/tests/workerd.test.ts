/**
 * Workerd Runtime Tests
 * Tests for V8 isolate-based worker execution
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import {
  createWorkerdRouter,
  type WorkerdRouterOptions,
} from '../api/server/routes/workerd'
import { createBackendManager } from '../api/storage/backends'
import {
  generateWorkerConfig,
  wrapHandlerAsWorker,
} from '../api/workers/workerd/config-generator'
import type { WorkerdWorkerDefinition } from '../api/workers/workerd/types'
import { DEFAULT_WORKERD_CONFIG } from '../api/workers/workerd/types'

// Test response types
interface WorkerdHealthResponse {
  status: string
  service: string
  runtime: string
}

interface PoolStatsResponse {
  pool: { totalWorkers: number }
}

interface WorkersListResponse {
  workers: Array<{ name: string }>
  runtime: string
}

interface ErrorResponse {
  error: string
}

interface WorkerDeployResponse {
  workerId: string
  name: string
  status: string
}

interface WorkerStatusResponse {
  status: string
}

interface WorkerInvokeResponse {
  path: string
  method: string
  message: string
}

interface WorkerIdResponse {
  workerId: string
}

interface WorkerEnvResponse {
  secret: string
  config: string
}

interface MetricsResponse {
  invocations: number
}

// Find workerd binary - MUST run synchronously at module load for skipIf to work
function findWorkerd(): string | null {
  const isWindows = process.platform === 'win32'
  const binaryName = isWindows ? 'workerd.exe' : 'workerd'

  // Check node_modules/.bin
  const localBin = join(process.cwd(), 'node_modules', '.bin', binaryName)
  if (existsSync(localBin)) return localBin

  // Check system paths
  const systemPaths = isWindows
    ? ['C:\\Program Files\\workerd\\workerd.exe']
    : [
        '/usr/local/bin/workerd',
        '/usr/bin/workerd',
        join(process.env.HOME || '', '.local', 'bin', 'workerd'),
      ]

  for (const p of systemPaths) {
    if (existsSync(p)) return p
  }

  return null
}

// Detect workerd at module load time (required for test.skipIf to work correctly)
const WORKERD_PATH = findWorkerd()
const WORKERD_AVAILABLE = WORKERD_PATH !== null

if (!WORKERD_AVAILABLE) {
  console.log(
    '[Test] workerd not found - run "bun run install:workerd" to install',
  )
  console.log('[Test] Integration tests will be skipped')
} else {
  console.log(`[Test] workerd found at: ${WORKERD_PATH}`)
}

// Test setup
const backend = createBackendManager()
let app: Elysia

beforeAll(async () => {
  const options: WorkerdRouterOptions = {
    backend,
    workerdConfig: {
      binaryPath: WORKERD_PATH ?? '/usr/local/bin/workerd',
      workDir: '/tmp/dws-workerd-test',
      portRange: { min: 40000, max: 45000 },
    },
    enableDecentralized: false, // Test without on-chain registry
  }

  // createWorkerdRouter() returns Elysia with prefix: '/workerd' built in
  const workerdRouter = createWorkerdRouter(options)
  app = new Elysia().use(workerdRouter)
})

// Helper to make requests
async function request(path: string, options?: RequestInit): Promise<Response> {
  const req = new Request(`http://localhost${path}`, options)
  return app.handle(req)
}

describe('Workerd API', () => {
  describe('Health and Stats', () => {
    test('GET /workerd/health returns healthy status', async () => {
      const res = await request('/workerd/health')
      expect(res.status).toBe(200)

      const data = (await res.json()) as WorkerdHealthResponse
      expect(data.status).toBe('healthy')
      expect(data.service).toBe('dws-workerd')
      expect(data.runtime).toBe('workerd')
    })

    test('GET /workerd/stats returns pool metrics', async () => {
      const res = await request('/workerd/stats')
      expect(res.status).toBe(200)

      const data = (await res.json()) as PoolStatsResponse
      expect(data.pool).toBeDefined()
      expect(typeof data.pool.totalWorkers).toBe('number')
    })
  })

  // Worker deployment tests are integration tests - require workerd to be running
  // Run these with: INTEGRATION=1 bun test tests/workerd.test.ts
  describe('Worker Deployment (Unit)', () => {
    test('GET /workerd lists workers (empty initially)', async () => {
      const res = await request('/workerd')
      expect(res.status).toBe(200)

      const data = (await res.json()) as WorkersListResponse
      expect(data.workers).toBeInstanceOf(Array)
      expect(data.runtime).toBe('workerd')
    })

    test('GET /workerd/:workerId returns 400 for invalid UUID', async () => {
      const res = await request('/workerd/invalid-id')
      expect(res.status).toBe(400)
    })

    test('GET /workerd/:workerId returns 404 for non-existent worker', async () => {
      const res = await request('/workerd/00000000-0000-0000-0000-000000000000')
      expect(res.status).toBe(404)
    })
  })

  describe('Worker Authorization', () => {
    test('requires x-jeju-address header for deployment', async () => {
      const res = await request('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'unauthorized-worker',
          code: Buffer.from('export default {}').toString('base64'),
        }),
      })

      expect(res.status).toBe(401)
      const data = (await res.json()) as ErrorResponse
      expect(data.error).toContain('x-jeju-address')
    })

    test('requires x-jeju-address header for deletion', async () => {
      const res = await request('/workerd/some-worker-id', {
        method: 'DELETE',
        headers: {},
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Input Validation', () => {
    test('validates worker name', async () => {
      const res = await request('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': '0x1234567890123456789012345678901234567890',
        },
        body: JSON.stringify({
          name: '', // Invalid empty name
          code: Buffer.from('export default {}').toString('base64'),
        }),
      })

      expect(res.status).toBe(400)
    })

    test('validates memory limits', async () => {
      const res = await request('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': '0x1234567890123456789012345678901234567890',
        },
        body: JSON.stringify({
          name: 'memory-test',
          code: Buffer.from('export default {}').toString('base64'),
          memoryMb: 9999, // Over limit
        }),
      })

      expect(res.status).toBe(400)
    })

    test('validates timeout limits', async () => {
      const res = await request('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': '0x1234567890123456789012345678901234567890',
        },
        body: JSON.stringify({
          name: 'timeout-test',
          code: Buffer.from('export default {}').toString('base64'),
          timeoutMs: 999999999, // Over limit
        }),
      })

      expect(res.status).toBe(400)
    })
  })
})

describe('Config Generator', () => {
  test('generates valid capnp config', () => {
    const worker: WorkerdWorkerDefinition = {
      id: 'test-123',
      name: 'test-worker',
      owner: '0x1234567890123456789012345678901234567890',
      modules: [
        { name: 'worker.js', type: 'esModule', content: 'export default {}' },
      ],
      bindings: [{ name: 'MY_VAR', type: 'text', value: 'hello' }],
      compatibilityDate: '2024-01-01',
      mainModule: 'worker.js',
      memoryMb: 128,
      cpuTimeMs: 50,
      timeoutMs: 30000,
      codeCid: 'Qm123',
      version: 1,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const config = generateWorkerConfig(worker, 30001)

    expect(config).toContain('using Workerd')
    expect(config).toContain('worker.js')
    expect(config).toContain('MY_VAR')
    expect(config).toContain('2024-01-01')
    expect(config).toContain('30001')
  })

  test('wraps handler as fetch worker', () => {
    const handlerCode = `
function handler(event, env) {
  return { statusCode: 200, body: 'hello' };
}
`

    const wrapped = wrapHandlerAsWorker(handlerCode, 'handler')

    expect(wrapped).toContain('export default')
    expect(wrapped).toContain('async fetch(request, env')
    expect(wrapped).toContain('handler(event, env)')
  })

  test('preserves existing fetch export', () => {
    const fetchCode = `
export default {
  async fetch(request) {
    return new Response('hello');
  }
};
`

    const wrapped = wrapHandlerAsWorker(fetchCode, 'handler')

    // Should not double-wrap
    expect(wrapped).toBe(fetchCode)
  })
})

describe('Types', () => {
  test('WorkerdConfig has required fields', () => {
    expect(DEFAULT_WORKERD_CONFIG.binaryPath).toBeDefined()
    expect(DEFAULT_WORKERD_CONFIG.workDir).toBeDefined()
    expect(DEFAULT_WORKERD_CONFIG.portRange).toBeDefined()
    expect(DEFAULT_WORKERD_CONFIG.portRange.min).toBeLessThan(
      DEFAULT_WORKERD_CONFIG.portRange.max,
    )
    expect(DEFAULT_WORKERD_CONFIG.maxIsolatesPerProcess).toBeGreaterThan(0)
    expect(DEFAULT_WORKERD_CONFIG.isolateMemoryMb).toBeGreaterThan(0)
  })
})

// Integration Tests - require workerd to be installed

describe('Workerd Integration', () => {
  const skipIntegration = !WORKERD_AVAILABLE

  test.skipIf(skipIntegration)(
    'deploy and invoke a simple worker',
    async () => {
      const workerCode = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    return new Response(JSON.stringify({
      path: url.pathname,
      method: request.method,
      message: 'Hello from workerd integration test'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

      // Deploy worker
      const deployRes = await request('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
        body: JSON.stringify({
          name: 'integration-test-worker',
          code: Buffer.from(workerCode).toString('base64'),
          memoryMb: 128,
          timeoutMs: 30000,
        }),
      })

      expect(deployRes.status).toBe(201)
      const deployData = (await deployRes.json()) as WorkerDeployResponse
      expect(deployData.workerId).toBeDefined()
      expect(deployData.name).toBe('integration-test-worker')

      // Wait for worker to be ready
      await new Promise((r) => setTimeout(r, 2000))

      // Check worker status
      const statusRes = await request(`/workerd/${deployData.workerId}`)
      expect(statusRes.status).toBe(200)
      const statusData = (await statusRes.json()) as WorkerStatusResponse
      expect(['active', 'deploying']).toContain(statusData.status)

      // Invoke worker
      if (statusData.status === 'active') {
        const invokeRes = await request(
          `/workerd/${deployData.workerId}/http/test`,
          {
            method: 'GET',
          },
        )

        expect(invokeRes.status).toBe(200)
        const invokeData = (await invokeRes.json()) as WorkerInvokeResponse
        expect(invokeData.path).toBe('/test')
        expect(invokeData.method).toBe('GET')
        expect(invokeData.message).toBe('Hello from workerd integration test')
      }

      // Clean up
      const deleteRes = await request(`/workerd/${deployData.workerId}`, {
        method: 'DELETE',
        headers: {
          'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      })
      expect(deleteRes.status).toBe(200)
    },
  )

  test.skipIf(skipIntegration)('worker with environment bindings', async () => {
    const workerCode = `
export default {
  async fetch(request, env) {
    return new Response(JSON.stringify({
      secret: env.API_KEY,
      config: env.CONFIG_VALUE
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`

    const deployRes = await request('/workerd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        name: 'env-test-worker',
        code: Buffer.from(workerCode).toString('base64'),
        bindings: [
          { name: 'API_KEY', type: 'text', value: 'test-secret-key' },
          { name: 'CONFIG_VALUE', type: 'text', value: 'integration-test' },
        ],
      }),
    })

    expect(deployRes.status).toBe(201)
    const deployData = (await deployRes.json()) as WorkerIdResponse

    // Wait and then invoke
    await new Promise((r) => setTimeout(r, 2000))

    const statusRes = await request(`/workerd/${deployData.workerId}`)
    const statusData = (await statusRes.json()) as WorkerStatusResponse

    if (statusData.status === 'active') {
      const invokeRes = await request(`/workerd/${deployData.workerId}/http/`, {
        method: 'GET',
      })

      expect(invokeRes.status).toBe(200)
      const invokeData = (await invokeRes.json()) as WorkerEnvResponse
      expect(invokeData.secret).toBe('test-secret-key')
      expect(invokeData.config).toBe('integration-test')
    }

    // Cleanup
    await request(`/workerd/${deployData.workerId}`, {
      method: 'DELETE',
      headers: {
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
    })
  })

  test.skipIf(skipIntegration)('worker metrics are tracked', async () => {
    const workerCode = `
export default {
  async fetch(request) {
    return new Response('OK');
  }
};`

    const deployRes = await request('/workerd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        name: 'metrics-test-worker',
        code: Buffer.from(workerCode).toString('base64'),
      }),
    })

    expect(deployRes.status).toBe(201)
    const deployData = (await deployRes.json()) as WorkerIdResponse

    await new Promise((r) => setTimeout(r, 2000))

    // Make a few invocations
    for (let i = 0; i < 3; i++) {
      await request(`/workerd/${deployData.workerId}/http/`)
    }

    // Check metrics
    const metricsRes = await request(`/workerd/${deployData.workerId}/metrics`)
    if (metricsRes.status === 200) {
      const metrics = (await metricsRes.json()) as MetricsResponse
      expect(metrics.invocations).toBeGreaterThanOrEqual(0)
    }

    // Cleanup
    await request(`/workerd/${deployData.workerId}`, {
      method: 'DELETE',
      headers: {
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
    })
  })
})
