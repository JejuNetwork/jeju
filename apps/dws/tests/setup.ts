/**
 * DWS Test Setup
 *
 * Provides test infrastructure including:
 * - Anvil (local blockchain) management
 * - DWS server startup
 * - Mock inference server
 * - Contract deployment
 *
 * Works in two modes:
 * 1. Via `jeju test` - infrastructure is already up
 * 2. Standalone - starts required services
 */

import { afterAll, beforeAll } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Subprocess } from 'bun'

// Configuration
const ANVIL_PORT = parseInt(process.env.ANVIL_PORT ?? '9545', 10)
const DWS_PORT = parseInt(process.env.PORT ?? '4030', 10)
const INFERENCE_PORT = parseInt(process.env.INFERENCE_PORT ?? '4031', 10)

const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`
const DWS_URL = `http://127.0.0.1:${DWS_PORT}`
const INFERENCE_URL = `http://127.0.0.1:${INFERENCE_PORT}`

// Process management
let _anvilProcess: Subprocess | null = null
let dwsProcess: Subprocess | null = null
let mockInferenceServer: { stop: () => void } | null = null
let isSetup = false

// =============================================================================
// Utility Functions
// =============================================================================

function findMonorepoRoot(): string {
  let dir = import.meta.dir
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      return dir
    }
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

async function waitForService(
  url: string,
  path = '/health',
  maxAttempts = 60,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}${path}`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return true
    } catch {
      // Keep trying
    }
    await Bun.sleep(500)
  }
  return false
}

async function waitForAnvil(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return true
    } catch {
      // Keep trying
    }
    await Bun.sleep(500)
  }
  return false
}

// =============================================================================
// Service Management
// =============================================================================

async function startAnvil(): Promise<boolean> {
  console.log('[Test Setup] Checking Anvil...')

  if (await waitForAnvil()) {
    console.log('[Test Setup] Anvil already running')
    return true
  }

  const anvil = Bun.which('anvil')
  if (!anvil) {
    console.error(
      '[Test Setup] Anvil not found. Install: curl -L https://foundry.paradigm.xyz | bash',
    )
    return false
  }

  console.log('[Test Setup] Starting Anvil...')
  _anvilProcess = Bun.spawn(
    [anvil, '--port', String(ANVIL_PORT), '--chain-id', '1337', '--silent'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  if (await waitForAnvil()) {
    console.log('[Test Setup] Anvil started')
    return true
  }

  console.error('[Test Setup] Failed to start Anvil')
  return false
}

async function deployContracts(): Promise<boolean> {
  const rootDir = findMonorepoRoot()
  const bootstrapScript = join(
    rootDir,
    'scripts',
    'bootstrap',
    'bootstrap-localnet-complete.ts',
  )

  if (!existsSync(bootstrapScript)) {
    console.warn(
      '[Test Setup] No bootstrap script found, skipping contract deployment',
    )
    return true
  }

  console.log('[Test Setup] Deploying contracts...')
  const proc = Bun.spawn(['bun', 'run', bootstrapScript], {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      JEJU_RPC_URL: RPC_URL,
      L2_RPC_URL: RPC_URL,
    },
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error('[Test Setup] Contract deployment failed')
    return false
  }

  console.log('[Test Setup] Contracts deployed')
  return true
}

async function startMockInferenceServer(): Promise<boolean> {
  console.log('[Test Setup] Starting mock inference server...')

  if (await waitForService(INFERENCE_URL, '/health', 3)) {
    console.log('[Test Setup] Mock inference server already running')
    return true
  }

  interface ChatCompletionRequest {
    model?: string
    messages?: Array<{ content: string }>
  }

  const server = Bun.serve({
    port: INFERENCE_PORT,
    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === '/health') {
        return Response.json({ status: 'healthy', provider: 'mock' })
      }

      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const body = (await req.json()) as ChatCompletionRequest
        return Response.json({
          id: `chatcmpl-test-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model || 'mock-model',
          provider: 'mock',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: `Mock response to: ${body.messages?.[0]?.content || 'test'}`,
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        })
      }

      if (url.pathname === '/v1/embeddings' && req.method === 'POST') {
        return Response.json({
          object: 'list',
          data: [
            { object: 'embedding', index: 0, embedding: Array(1536).fill(0) },
          ],
          model: 'mock-embeddings',
          usage: { prompt_tokens: 10, total_tokens: 10 },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  mockInferenceServer = server
  console.log('[Test Setup] Mock inference server started')
  return true
}

async function startDWS(): Promise<boolean> {
  console.log('[Test Setup] Checking DWS...')

  if (await waitForService(DWS_URL, '/health', 5)) {
    console.log('[Test Setup] DWS already running')
    return true
  }

  const rootDir = findMonorepoRoot()
  const dwsDir = join(rootDir, 'apps', 'dws')

  console.log('[Test Setup] Starting DWS...')
  dwsProcess = Bun.spawn(['bun', 'run', 'src/server/index.ts'], {
    cwd: dwsDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(DWS_PORT),
      L2_RPC_URL: RPC_URL,
      JEJU_RPC_URL: RPC_URL,
      BOOTSTRAP_CONTRACTS: 'false',
    },
  })

  if (await waitForService(DWS_URL, '/health', 30)) {
    console.log('[Test Setup] DWS started')
    return true
  }

  console.error('[Test Setup] Failed to start DWS')
  return false
}

async function registerMockInferenceNode(): Promise<boolean> {
  console.log('[Test Setup] Registering mock inference node...')

  try {
    const response = await fetch(`${DWS_URL}/compute/nodes/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: 'test-inference-node',
        endpoint: INFERENCE_URL,
        gpuTier: 1,
        capabilities: ['inference', 'embeddings'],
        provider: 'mock',
        models: ['*'],
        region: 'test',
        maxConcurrent: 100,
      }),
    })

    if (!response.ok) {
      console.warn(
        '[Test Setup] Failed to register mock node:',
        await response.text(),
      )
      return false
    }

    console.log('[Test Setup] Mock inference node registered')
    return true
  } catch (error) {
    console.warn(
      '[Test Setup] Could not register mock node:',
      (error as Error).message,
    )
    return false
  }
}

// =============================================================================
// Public API
// =============================================================================

export async function setup(): Promise<void> {
  if (isSetup) return

  console.log('\n[Test Setup] Setting up test environment...\n')

  // Start anvil
  if (!(await startAnvil())) {
    throw new Error('Failed to start Anvil')
  }

  // Deploy contracts (optional)
  await deployContracts().catch(() => {
    console.warn('[Test Setup] Contract deployment failed, continuing anyway')
  })

  // Start mock inference server
  await startMockInferenceServer()

  // Start DWS
  if (!(await startDWS())) {
    throw new Error('Failed to start DWS')
  }

  // Wait for DWS to fully initialize
  await Bun.sleep(1000)

  // Register mock inference node
  await registerMockInferenceNode()

  isSetup = true
  console.log('\n[Test Setup] Environment ready\n')
}

export async function teardown(): Promise<void> {
  console.log('[Test Setup] Cleaning up...')

  if (dwsProcess) {
    dwsProcess.kill()
    dwsProcess = null
  }

  if (mockInferenceServer) {
    mockInferenceServer.stop()
    mockInferenceServer = null
  }

  // Don't kill anvil - let it run for faster test iterations

  isSetup = false
}

export function isReady(): boolean {
  return isSetup
}

export interface InfraStatus {
  anvil: boolean
  dws: boolean
  inference: boolean
  rpcUrl: string
  dwsUrl: string
  inferenceUrl: string
}

export async function getStatus(): Promise<InfraStatus> {
  const [anvil, dws, inference] = await Promise.all([
    waitForAnvil().catch(() => false),
    waitForService(DWS_URL, '/health', 3).catch(() => false),
    waitForService(INFERENCE_URL, '/health', 3).catch(() => false),
  ])

  return {
    anvil,
    dws,
    inference,
    rpcUrl: RPC_URL,
    dwsUrl: DWS_URL,
    inferenceUrl: INFERENCE_URL,
  }
}

export function getTestEnv(): {
  dwsUrl: string
  rpcUrl: string
  inferenceUrl: string
} {
  return {
    dwsUrl: process.env.DWS_URL || DWS_URL,
    rpcUrl: process.env.L2_RPC_URL || RPC_URL,
    inferenceUrl: process.env.INFERENCE_URL || INFERENCE_URL,
  }
}

// Export URLs for direct usage
export { RPC_URL, DWS_URL, INFERENCE_URL }

// Auto-setup when file is imported in test context
if (process.env.BUN_TEST === 'true') {
  beforeAll(setup)
  afterAll(teardown)
}
