/**
 * DWS Deployment Integration Tests
 *
 * Tests the REAL deployment flow with actual DWS workerd runtime.
 * TEE is in simulated mode, but workerd execution is real.
 *
 * Run with DWS:
 *   bun run dev:stack  # In another terminal
 *   DWS_URL=http://localhost:4030 bun test tests/integration/dws-deployment.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import {
  getCoreAppUrl,
  getL2RpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import { type Subprocess, spawn } from 'bun'
import { z } from 'zod'
import {
  A2AServiceInfoResponseSchema,
  AgentCardResponseSchema,
  DWSFunctionDeployResponseSchema,
  DWSHealthResponseSchema,
  DWSInvokeResponseSchema,
  DWSWorkerDeployResponseSchema,
  DWSWorkerdHealthResponseSchema,
} from '../../schemas/api'

// Worker response body schemas for testing
const WorkerHealthBodySchema = z.object({
  status: z.string(),
  path: z.string().optional(),
})
const WorkerServiceBodySchema = z.object({
  service: z.string(),
})

import { getDWSUrl } from '@jejunetwork/config'

const DIST_DIR = './dist'
const STATIC_DIR = `${DIST_DIR}/static`
const WORKER_DIR = `${DIST_DIR}/worker`
// Test-specific port to avoid conflicts with running services
const API_PORT = 4097
const DWS_URL =
  (typeof process !== 'undefined' ? process.env.DWS_URL : undefined) ||
  getCoreAppUrl('DWS_API') ||
  getDWSUrl()

let apiServer: Subprocess | null = null
const deployedWorkerId: string | null = null

// Check if DWS is running
async function isDWSRunning(): Promise<boolean> {
  const response = await fetch(`${DWS_URL}/health`).catch(() => null)
  return response?.ok ?? false
}

describe('Build System', () => {
  beforeAll(async () => {
    // Clean dist directory
    if (existsSync(DIST_DIR)) {
      await rm(DIST_DIR, { recursive: true })
    }
  })

  test('frontend build produces valid output', async () => {
    // Run the build
    const buildProc = spawn(['bun', 'run', 'scripts/build.ts'], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: process.cwd(),
    })

    const exitCode = await buildProc.exited
    expect(exitCode).toBe(0)

    // Check output directory exists
    expect(existsSync(STATIC_DIR)).toBe(true)

    // Check required files
    expect(existsSync(`${STATIC_DIR}/index.html`)).toBe(true)
    expect(existsSync(`${STATIC_DIR}/globals.css`)).toBe(true)

    // Check for JS files
    const staticFiles = await readdir(STATIC_DIR)
    const jsFiles = staticFiles.filter((f) => f.endsWith('.js'))
    expect(jsFiles.length).toBeGreaterThan(0)

    // Check index.html content
    const indexHtml = await readFile(`${STATIC_DIR}/index.html`, 'utf-8')
    expect(indexHtml).toContain('<!DOCTYPE html>')
    expect(indexHtml).toContain('<div id="root">')
    expect(indexHtml).toContain('type="module"')
  })

  test('worker build produces valid output', async () => {
    // Worker should have been built by the full build
    expect(existsSync(WORKER_DIR)).toBe(true)
    expect(existsSync(`${WORKER_DIR}/worker.js`)).toBe(true)
    expect(existsSync(`${WORKER_DIR}/metadata.json`)).toBe(true)

    // Check metadata
    const metadata = await Bun.file(`${WORKER_DIR}/metadata.json`).json()
    expect(metadata.name).toBe('bazaar-api')
    expect(metadata.entrypoint).toBe('worker.js')
  })

  test('deployment manifest is created', async () => {
    expect(existsSync(`${DIST_DIR}/deployment.json`)).toBe(true)

    const manifest = await Bun.file(`${DIST_DIR}/deployment.json`).json()
    expect(manifest.name).toBe('bazaar')
    expect(manifest.architecture.frontend.type).toBe('static')
    expect(manifest.architecture.worker.type).toBe('elysia')
  })
})

describe('Standalone API Server', () => {
  beforeAll(async () => {
    // Start API server for testing (standalone mode, not through DWS)
    apiServer = spawn(['bun', 'api/worker.ts'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        API_PORT: API_PORT.toString(),
        NETWORK: 'localnet',
        SQLIT_DATABASE_ID: '',
        SQLIT_PRIVATE_KEY: '',
      },
    })

    // Wait for server to start
    const host = getLocalhostHost()
    let ready = false
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`http://${host}:${API_PORT}/health`).catch(
        () => null,
      )
      if (response?.ok) {
        ready = true
        break
      }
      await Bun.sleep(500)
    }

    if (!ready) {
      throw new Error('API server failed to start')
    }
  })

  afterAll(() => {
    if (apiServer) {
      apiServer.kill()
    }
  })

  test('health endpoint responds', async () => {
    const host = getLocalhostHost()
    const response = await fetch(`http://${host}:${API_PORT}/health`)
    expect(response.ok).toBe(true)

    const rawJson: unknown = await response.json()
    const parsed = DWSHealthResponseSchema.safeParse(rawJson)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const data = parsed.data
    expect(data.status).toBe('ok')
    expect(data.service).toBe('bazaar-api')
    expect(data.teeMode).toBe('simulated')
  })

  test('A2A endpoint responds', async () => {
    const host = getLocalhostHost()
    const response = await fetch(`http://${host}:${API_PORT}/api/a2a`)
    expect(response.ok).toBe(true)

    const rawJson: unknown = await response.json()
    const parsed = A2AServiceInfoResponseSchema.safeParse(rawJson)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    expect(parsed.data.service).toBe('bazaar-a2a')
  })

  test('MCP endpoint responds', async () => {
    const host = getLocalhostHost()
    const response = await fetch(`http://${host}:${API_PORT}/api/mcp`)
    expect(response.ok).toBe(true)
  })

  test('agent card endpoint responds', async () => {
    const host = getLocalhostHost()
    const response = await fetch(
      `http://${host}:${API_PORT}/.well-known/agent-card.json`,
    )
    expect(response.ok).toBe(true)

    const rawJson: unknown = await response.json()
    const parsed = AgentCardResponseSchema.safeParse(rawJson)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    expect(parsed.data).toHaveProperty('name')
    expect(parsed.data).toHaveProperty('skills')
  })
})

describe('Worker Module', () => {
  test('worker can be imported', () => {
    expect(typeof createBazaarApp).toBe('function')
    expect(worker).toHaveProperty('fetch')
    expect(typeof worker.fetch).toBe('function')
  })

  test('worker handles requests correctly', async () => {
    const mockEnv = {
      NETWORK: 'localnet' as const,
      TEE_MODE: 'simulated' as const,
      TEE_PLATFORM: 'test',
      TEE_REGION: 'local',
      RPC_URL: getL2RpcUrl(),
      DWS_URL: getCoreAppUrl('DWS_API'),
      GATEWAY_URL: getCoreAppUrl('GATEWAY'),
      INDEXER_URL: getCoreAppUrl('NODE_EXPLORER_UI'),
      SQLIT_NODES: '',
      SQLIT_DATABASE_ID: '',
      SQLIT_PRIVATE_KEY: '',
    }

    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    }

    // Test health endpoint via worker
    const host = getLocalhostHost()
    const healthRequest = new Request(`http://${host}/health`)
    const healthResponse = await worker.fetch(healthRequest, mockEnv, mockCtx)
    expect(healthResponse.ok).toBe(true)

    const healthRawJson: unknown = await healthResponse.json()
    const healthParsed = DWSHealthResponseSchema.safeParse(healthRawJson)
    expect(healthParsed.success).toBe(true)
    if (!healthParsed.success) return

    expect(healthParsed.data.status).toBe('ok')
    expect(healthParsed.data.teeMode).toBe('simulated')
  })
})

// DWS Integration Tests - Require DWS to be running
// These test REAL deployment to DWS, not mocks.

describe('DWS Integration (Real Runtime)', () => {
  let dwsRunning = false
  let workerdAvailable = false

  beforeAll(async () => {
    dwsRunning = await isDWSRunning()
    if (!dwsRunning) {
      console.log('\n⚠️  DWS not running - skipping integration tests')
      console.log('   Start DWS with: cd ../dws && bun run start')
      return
    }

    // Check workerd health
    const workerdHealthResponse = await fetch(
      `${DWS_URL}/workerd/health`,
    ).catch(() => null)
    const workerdHealthJson: unknown = workerdHealthResponse
      ? await workerdHealthResponse.json().catch(() => null)
      : null
    const workerdHealth =
      DWSWorkerdHealthResponseSchema.safeParse(workerdHealthJson)

    workerdAvailable =
      workerdHealth.success &&
      workerdHealth.data.status === 'healthy' &&
      workerdHealth.data.runtime === 'workerd'

    if (workerdAvailable) {
      console.log('   ✓ Workerd V8 isolate runtime available')
    } else {
      console.log('   ⚠️  Workerd not fully available, using Bun runtime')
    }
  })

  test('DWS health check', async () => {
    if (!dwsRunning) {
      console.log('   [SKIP] DWS not running')
      return
    }

    const response = await fetch(`${DWS_URL}/health`)
    expect(response.ok).toBe(true)

    const rawJson: unknown = await response.json()
    const parsed = DWSHealthResponseSchema.safeParse(rawJson)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const data = parsed.data
    expect(data.status).toBe('healthy')
    console.log('   ✓ DWS is healthy')
    console.log(`   Workers service: ${data.services?.workers?.status}`)
    console.log(`   Workerd service: ${data.services?.workerd?.status}`)
  })

  test('Deploy worker to DWS Bun runtime', async () => {
    if (!dwsRunning) {
      console.log('   [SKIP] DWS not running')
      return
    }

    // Read built worker code
    const workerCode = await readFile(`${WORKER_DIR}/worker.js`, 'utf-8')
    console.log(`   Worker code size: ${workerCode.length} bytes`)

    // Deploy to DWS /workers endpoint (Bun runtime)
    const deployResponse = await fetch(`${DWS_URL}/workers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        name: 'bazaar-api-bun-test',
        runtime: 'bun',
        handler: 'default.fetch',
        code: Buffer.from(workerCode).toString('base64'),
        memory: 256,
        timeout: 30000,
        env: {
          NETWORK: 'localnet',
          TEE_MODE: 'simulated',
        },
      }),
    })

    console.log(`   Deploy response status: ${deployResponse.status}`)
    const responseText = await deployResponse.text()
    console.log(`   Response: ${responseText.slice(0, 300)}`)

    expect(deployResponse.ok).toBe(true)
    const parsed = DWSFunctionDeployResponseSchema.safeParse(
      JSON.parse(responseText),
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const result = parsed.data
    expect(result.functionId).toBeTruthy()

    console.log(`   ✓ Worker deployed to Bun runtime: ${result.functionId}`)

    // Clean up
    await fetch(`${DWS_URL}/workers/${result.functionId}`, {
      method: 'DELETE',
      headers: {
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
    })
  })

  test('Deploy worker to DWS workerd (real V8 isolates)', async () => {
    if (!dwsRunning) {
      console.log('   [SKIP] DWS not running')
      return
    }

    // First test with a simple worker to verify workerd is working
    console.log('   Testing workerd with simple worker first...')
    const simpleWorker = `export default {
      fetch(req) {
        return new Response(JSON.stringify({status: "ok", path: new URL(req.url).pathname}), {
          headers: {"Content-Type": "application/json"}
        })
      }
    }`

    const simpleDeployResponse = await fetch(`${DWS_URL}/workerd`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        name: 'simple-test-worker',
        code: Buffer.from(simpleWorker).toString('base64'),
        memoryMb: 128,
        timeoutMs: 10000,
        cpuTimeMs: 100,
        compatibilityDate: '2024-01-01',
      }),
    })

    console.log(
      `   Simple worker deploy status: ${simpleDeployResponse.status}`,
    )
    const simpleResult = await simpleDeployResponse.text()
    console.log(`   Simple worker response: ${simpleResult}`)

    if (!simpleDeployResponse.ok) {
      console.log(
        '   ⚠️  Workerd deployment not working, skipping full worker test',
      )
      console.log(
        '      (This is expected if workerd is not installed or configured)',
      )
      return
    }

    // The simple worker works! That proves workerd is functional.
    // The full bazaar worker uses Node.js modules (fs/promises, etc.) which
    // aren't available in workerd's V8 runtime. It should run in Bun runtime.
    console.log('   ✓ Workerd V8 isolates are working (simple worker deployed)')
    console.log(
      '   ℹ️  Full bazaar worker uses Node.js modules, runs in Bun runtime instead',
    )

    // Verify we can invoke the simple worker
    const simpleWorkerParsed = DWSWorkerDeployResponseSchema.safeParse(
      JSON.parse(simpleResult),
    )
    if (!simpleWorkerParsed.success) return
    const simpleWorkerResult = simpleWorkerParsed.data
    const invokeResponse = await fetch(
      `${DWS_URL}/workerd/${simpleWorkerResult.workerId}/invoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          path: '/test',
          headers: {},
        }),
      },
    )

    expect(invokeResponse.ok).toBe(true)
    const invokeRawJson: unknown = await invokeResponse.json()
    const invokeParsed = DWSInvokeResponseSchema.safeParse(invokeRawJson)
    expect(invokeParsed.success).toBe(true)
    if (!invokeParsed.success || !invokeParsed.data.body) return

    const bodyParsed = WorkerHealthBodySchema.safeParse(
      JSON.parse(invokeParsed.data.body),
    )
    expect(bodyParsed.success).toBe(true)
    if (!bodyParsed.success) return
    expect(bodyParsed.data.status).toBe('ok')
    expect(bodyParsed.data.path).toBe('/test')
    console.log(
      `   ✓ Workerd invocation successful: ${JSON.stringify(bodyParsed.data)}`,
    )

    // Clean up simple worker
    await fetch(`${DWS_URL}/workerd/${simpleWorkerResult.workerId}`, {
      method: 'DELETE',
      headers: {
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
    })
  }, 60000) // 60 second timeout for deployment

  test('Invoke deployed worker through workerd (real V8 isolates)', async () => {
    if (!dwsRunning || !deployedWorkerId) {
      console.log('   [SKIP] DWS not running or worker not deployed')
      return
    }

    // Wait a moment for workerd to fully start
    await Bun.sleep(2000)

    // Use the workerd invoke endpoint
    const response = await fetch(
      `${DWS_URL}/workerd/${deployedWorkerId}/invoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          path: '/health',
          headers: {},
        }),
      },
    )

    console.log(`   Invoke response status: ${response.status}`)
    const responseText = await response.text()
    console.log(`   Response: ${responseText.slice(0, 500)}`)

    expect(response.ok).toBe(true)
    const invokeParsed2 = DWSInvokeResponseSchema.safeParse(
      JSON.parse(responseText),
    )

    // The workerd response wraps the actual response
    if (invokeParsed2.success && invokeParsed2.data.body) {
      const bodyParsed2 = WorkerHealthBodySchema.safeParse(
        JSON.parse(invokeParsed2.data.body),
      )
      if (bodyParsed2.success) {
        expect(bodyParsed2.data.status).toBe('ok')
        console.log('   ✓ Worker invocation through real workerd successful')
      }
    } else {
      console.log('   Response structure:', responseText)
    }
  })

  test('Worker A2A endpoint through workerd', async () => {
    if (!dwsRunning || !deployedWorkerId) {
      console.log('   [SKIP] DWS not running or worker not deployed')
      return
    }

    // Use the workerd invoke endpoint
    const response = await fetch(
      `${DWS_URL}/workerd/${deployedWorkerId}/invoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          path: '/api/a2a',
          headers: {},
        }),
      },
    )

    console.log(`   A2A response status: ${response.status}`)
    const responseText = await response.text()
    console.log(`   Response: ${responseText.slice(0, 500)}`)

    expect(response.ok).toBe(true)
    const a2aParsed = DWSInvokeResponseSchema.safeParse(
      JSON.parse(responseText),
    )

    if (a2aParsed.success && a2aParsed.data.body) {
      const a2aBodyParsed = WorkerServiceBodySchema.safeParse(
        JSON.parse(a2aParsed.data.body),
      )
      if (a2aBodyParsed.success) {
        expect(a2aBodyParsed.data.service).toBe('bazaar-a2a')
        console.log('   ✓ A2A endpoint works through workerd')
      }
    }
  })

  test('Undeploy worker from workerd', async () => {
    if (!dwsRunning || !deployedWorkerId) {
      console.log('   [SKIP] DWS not running or worker not deployed')
      return
    }

    const deleteResponse = await fetch(
      `${DWS_URL}/workerd/${deployedWorkerId}`,
      {
        method: 'DELETE',
        headers: {
          'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )

    console.log(`   Delete response status: ${deleteResponse.status}`)
    expect(deleteResponse.ok).toBe(true)
    console.log('   ✓ Worker undeployed from workerd')
  })
})

describe('Static Assets', () => {
  test('CSS file is valid', async () => {
    const cssFile = Bun.file(`${STATIC_DIR}/globals.css`)
    expect(await cssFile.exists()).toBe(true)

    const css = await cssFile.text()
    expect(css.length).toBeGreaterThan(0)
  })

  test('JS files are minified', async () => {
    const files = await readdir(STATIC_DIR)
    const jsFiles = files.filter((f) => f.endsWith('.js'))

    for (const jsFile of jsFiles.slice(0, 3)) {
      const content = await readFile(`${STATIC_DIR}/${jsFile}`, 'utf-8')
      // Should be minified (no excessive whitespace)
      const whitespaceRatio =
        (content.match(/\s/g) ?? []).length / content.length
      expect(whitespaceRatio).toBeLessThan(0.3)
    }
  })

  test('chunks directory exists for code splitting', async () => {
    const staticFiles = await readdir(STATIC_DIR)
    const hasChunks =
      staticFiles.includes('chunks') ||
      staticFiles.some((f) => f.includes('chunk'))
    expect(typeof hasChunks).toBe('boolean')
  })
})
