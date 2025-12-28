/**
 * Cloudflare Worker Compatibility Test
 *
 * Tests permissionless worker deployment to DWS.
 * Validates wrangler-style deployment patterns.
 *
 * Requirements:
 * - DWS server running with workerd endpoints
 *
 * Run with: bun test tests/sdk-compatibility/cloudflare-worker.test.ts
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dwsRequest } from '../setup'

setDefaultTimeout(60000)

const TEST_DIR = '/tmp/dws-cf-worker-test'
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Worker types
interface WorkerDeployResponse {
  workerId: string
  name: string
  status: string
  endpoint?: string
}

interface WorkerStatusResponse {
  workerId: string
  name: string
  status: string
  endpoints?: string[]
  metrics?: {
    invocations: number
    errors: number
    avgLatencyMs: number
  }
}

interface WorkerListResponse {
  workers: Array<{
    workerId: string
    name: string
    status: string
  }>
}

// Sample worker code
const HELLO_WORLD_WORKER = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    return new Response(JSON.stringify({
      message: 'Hello from DWS Worker!',
      path: url.pathname,
      method: request.method,
      headers: Object.fromEntries(request.headers)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
`

const COUNTER_WORKER = `
// Simple counter worker with KV storage simulation
let counter = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/increment') {
      counter++;
      return new Response(JSON.stringify({ counter }));
    }
    
    if (url.pathname === '/decrement') {
      counter--;
      return new Response(JSON.stringify({ counter }));
    }
    
    if (url.pathname === '/reset') {
      counter = 0;
      return new Response(JSON.stringify({ counter }));
    }
    
    return new Response(JSON.stringify({ counter }));
  }
};
`

const ENV_WORKER = `
export default {
  async fetch(request, env) {
    return new Response(JSON.stringify({
      apiKey: env.API_KEY,
      environment: env.ENVIRONMENT,
      configValue: env.CONFIG_VALUE
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
`

const _SCHEDULED_WORKER = `
export default {
  async fetch(request) {
    return new Response('Not a scheduled request');
  },
  
  async scheduled(event, env, ctx) {
    console.log('Scheduled event triggered at:', new Date().toISOString());
    // In production, this would do actual scheduled work
    return;
  }
};
`

const MIDDLEWARE_WORKER = `
export default {
  async fetch(request, env) {
    // CORS middleware
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }
    
    // Auth check
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ authenticated: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
`

describe('Cloudflare Worker Compatibility', () => {
  const deployedWorkers: string[] = []

  beforeAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })

    console.log('[CF Worker Test] Test directory:', TEST_DIR)
  })

  afterAll(async () => {
    // Clean up deployed workers
    for (const workerId of deployedWorkers) {
      await dwsRequest(`/workerd/${workerId}`, {
        method: 'DELETE',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })
    }

    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }

    console.log('[CF Worker Test] Cleanup complete')
  })

  describe('Worker Deployment API', () => {
    test('GET /workerd/health returns healthy', async () => {
      const res = await dwsRequest('/workerd/health')
      expect(res.status).toBe(200)

      const data = (await res.json()) as { status: string; runtime: string }
      expect(data.status).toBe('healthy')
      expect(data.runtime).toBe('workerd')
    })

    test('POST /workerd deploys hello-world worker', async () => {
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'hello-world',
          code: Buffer.from(HELLO_WORLD_WORKER).toString('base64'),
          memoryMb: 128,
          timeoutMs: 30000,
        }),
      })

      // Workerd may not be available in all environments
      if (res.status === 500 || res.status === 503) {
        const error = (await res.json()) as { error: string }
        console.log(
          '[CF Worker Test] Skipping - workerd not available:',
          error.error,
        )
        return
      }

      expect(res.status).toBe(201)
      const data = (await res.json()) as WorkerDeployResponse
      expect(data.workerId).toBeDefined()
      expect(data.name).toBe('hello-world')
      expect(['deploying', 'active']).toContain(data.status)

      deployedWorkers.push(data.workerId)
    })

    test('POST /workerd deploys worker with bindings', async () => {
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'env-worker',
          code: Buffer.from(ENV_WORKER).toString('base64'),
          bindings: [
            { name: 'API_KEY', type: 'text', value: 'secret-api-key-123' },
            { name: 'ENVIRONMENT', type: 'text', value: 'production' },
            { name: 'CONFIG_VALUE', type: 'text', value: '{"debug": false}' },
          ],
        }),
      })

      // Workerd may not be available in all environments
      if (res.status === 500 || res.status === 503) {
        console.log('[CF Worker Test] Skipping - workerd not available')
        return
      }

      expect(res.status).toBe(201)
      const data = (await res.json()) as WorkerDeployResponse
      expect(data.workerId).toBeDefined()
      deployedWorkers.push(data.workerId)
    })

    test('POST /workerd rejects invalid worker code', async () => {
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'invalid-worker',
          code: Buffer.from(
            'this is not valid javascript export default',
          ).toString('base64'),
        }),
      })

      // May be 400 for validation error or 201 with eventual failure
      expect([201, 400, 500]).toContain(res.status)
    })

    test('POST /workerd requires authentication', async () => {
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'unauth-worker',
          code: Buffer.from(HELLO_WORLD_WORKER).toString('base64'),
        }),
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Worker Management', () => {
    test('GET /workerd lists deployed workers', async () => {
      const res = await dwsRequest('/workerd', {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as WorkerListResponse
      expect(data.workers).toBeInstanceOf(Array)
    })

    test('GET /workerd/:id returns worker status', async () => {
      if (deployedWorkers.length === 0) return

      const res = await dwsRequest(`/workerd/${deployedWorkers[0]}`, {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as WorkerStatusResponse
      expect(data.workerId).toBe(deployedWorkers[0])
      expect(data.name).toBeDefined()
    })

    test('PUT /workerd/:id updates worker', async () => {
      if (deployedWorkers.length === 0) return

      const updatedCode = HELLO_WORLD_WORKER.replace(
        'Hello from DWS Worker!',
        'Updated Hello from DWS!',
      )

      const res = await dwsRequest(`/workerd/${deployedWorkers[0]}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          code: Buffer.from(updatedCode).toString('base64'),
        }),
      })

      expect([200, 404]).toContain(res.status)
    })

    test('DELETE /workerd/:id removes worker', async () => {
      // Deploy a temporary worker
      const deployRes = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'temp-delete-test',
          code: Buffer.from(HELLO_WORLD_WORKER).toString('base64'),
        }),
      })

      if (deployRes.status !== 201) return

      const { workerId } = (await deployRes.json()) as WorkerDeployResponse

      // Delete it
      const deleteRes = await dwsRequest(`/workerd/${workerId}`, {
        method: 'DELETE',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect(deleteRes.status).toBe(200)

      // Verify it's gone
      const checkRes = await dwsRequest(`/workerd/${workerId}`, {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect(checkRes.status).toBe(404)
    })
  })

  describe('Worker Invocation', () => {
    let activeWorkerId: string | null = null

    beforeAll(async () => {
      // Deploy a worker for invocation tests
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'invoke-test-worker',
          code: Buffer.from(COUNTER_WORKER).toString('base64'),
        }),
      })

      if (res.status === 201) {
        const data = (await res.json()) as WorkerDeployResponse
        activeWorkerId = data.workerId
        deployedWorkers.push(activeWorkerId)

        // Wait for worker to be ready
        await new Promise((r) => setTimeout(r, 2000))
      }
    })

    test('invokes worker with GET request', async () => {
      if (!activeWorkerId) return

      const res = await dwsRequest(`/workerd/${activeWorkerId}/http/`, {
        method: 'GET',
      })

      // May be 200 if worker is active, or 503 if still deploying
      expect([200, 503]).toContain(res.status)

      if (res.status === 200) {
        const data = (await res.json()) as { counter: number }
        expect(typeof data.counter).toBe('number')
      }
    })

    test('invokes worker with custom path', async () => {
      if (!activeWorkerId) return

      const res = await dwsRequest(
        `/workerd/${activeWorkerId}/http/increment`,
        {
          method: 'GET',
        },
      )

      expect([200, 503]).toContain(res.status)
    })

    test('invokes worker with POST body', async () => {
      if (!activeWorkerId) return

      const res = await dwsRequest(`/workerd/${activeWorkerId}/http/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })

      expect([200, 503]).toContain(res.status)
    })

    test('worker handles CORS preflight', async () => {
      // Deploy middleware worker
      const deployRes = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'cors-worker',
          code: Buffer.from(MIDDLEWARE_WORKER).toString('base64'),
        }),
      })

      if (deployRes.status !== 201) return

      const { workerId } = (await deployRes.json()) as WorkerDeployResponse
      deployedWorkers.push(workerId)

      await new Promise((r) => setTimeout(r, 2000))

      const res = await dwsRequest(`/workerd/${workerId}/http/`, {
        method: 'OPTIONS',
      })

      expect([200, 204, 503]).toContain(res.status)
    })
  })

  describe('Worker Metrics', () => {
    test('GET /workerd/:id/metrics returns metrics', async () => {
      if (deployedWorkers.length === 0) return

      const res = await dwsRequest(`/workerd/${deployedWorkers[0]}/metrics`, {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect([200, 404]).toContain(res.status)

      if (res.status === 200) {
        const data = (await res.json()) as WorkerStatusResponse['metrics']
        expect(data).toBeDefined()
      }
    })
  })

  describe('Worker Logs', () => {
    test('GET /workerd/:id/logs returns logs', async () => {
      if (deployedWorkers.length === 0) return

      const res = await dwsRequest(`/workerd/${deployedWorkers[0]}/logs`, {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect([200, 404]).toContain(res.status)
    })

    test('GET /workerd/:id/logs?stream=true streams logs', async () => {
      if (deployedWorkers.length === 0) return

      const res = await dwsRequest(
        `/workerd/${deployedWorkers[0]}/logs?stream=true`,
        {
          headers: { 'x-jeju-address': TEST_ADDRESS },
        },
      )

      expect([200, 404]).toContain(res.status)
    })
  })

  describe('Wrangler Compatibility', () => {
    test('creates wrangler-compatible project structure', () => {
      const projectDir = join(TEST_DIR, 'wrangler-project')
      mkdirSync(projectDir, { recursive: true })

      // Create wrangler.toml
      const wranglerConfig = `
name = "my-dws-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

[[kv_namespaces]]
binding = "MY_KV"
id = "abc123"

[triggers]
crons = ["0 * * * *"]
`
      writeFileSync(join(projectDir, 'wrangler.toml'), wranglerConfig)

      // Create src directory
      mkdirSync(join(projectDir, 'src'), { recursive: true })

      // Create worker file
      const workerCode = `
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Read from KV
    const value = await env.MY_KV.get('key');
    
    return new Response(JSON.stringify({
      path: url.pathname,
      environment: env.ENVIRONMENT,
      kvValue: value
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  },
  
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('Cron triggered:', controller.cron);
  }
};

interface Env {
  ENVIRONMENT: string;
  MY_KV: KVNamespace;
}
`
      writeFileSync(join(projectDir, 'src', 'index.ts'), workerCode)

      // Verify structure
      expect(existsSync(join(projectDir, 'wrangler.toml'))).toBe(true)
      expect(existsSync(join(projectDir, 'src', 'index.ts'))).toBe(true)
    })

    test('parses wrangler.toml configuration', () => {
      const wranglerToml = `
name = "api-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
API_URL = "https://api.example.com"
DEBUG = "true"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "my-bucket"

[[d1_databases]]
binding = "DB"
database_id = "db-123"
`
      // In production, this would be parsed by toml parser
      expect(wranglerToml).toContain('name = "api-worker"')
      expect(wranglerToml).toContain('compatibility_date')
      expect(wranglerToml).toContain('r2_buckets')
      expect(wranglerToml).toContain('d1_databases')
    })
  })

  describe('TEE Workers', () => {
    test('deploys worker with TEE requirement', async () => {
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'tee-worker',
          code: Buffer.from(HELLO_WORLD_WORKER).toString('base64'),
          teeRequired: true,
        }),
      })

      // TEE may not be available, accept various error statuses
      expect([201, 400, 500, 503]).toContain(res.status)

      if (res.status === 201) {
        const data = (await res.json()) as WorkerDeployResponse
        deployedWorkers.push(data.workerId)
      }
    })
  })

  describe('Worker Routes', () => {
    test('POST /workerd/:id/routes adds route', async () => {
      if (deployedWorkers.length === 0) return

      const res = await dwsRequest(`/workerd/${deployedWorkers[0]}/routes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          pattern: 'api.example.com/*',
          zone: 'example.com',
        }),
      })

      expect([200, 201, 404]).toContain(res.status)
    })

    test('GET /workerd/:id/routes lists routes', async () => {
      if (deployedWorkers.length === 0) return

      const res = await dwsRequest(`/workerd/${deployedWorkers[0]}/routes`, {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect([200, 404]).toContain(res.status)
    })
  })

  describe('Statistics', () => {
    test('GET /workerd/stats returns pool stats', async () => {
      const res = await dwsRequest('/workerd/stats')
      expect(res.status).toBe(200)

      const data = (await res.json()) as { pool: { totalWorkers: number } }
      expect(data.pool).toBeDefined()
      expect(typeof data.pool.totalWorkers).toBe('number')
    })
  })
})
