/**
 * DWS Test Setup
 *
 * App-specific test setup that runs AFTER the shared infrastructure setup.
 * The shared setup (@jejunetwork/tests/bun-global-setup) handles:
 * - Starting jeju dev --minimal if needed
 * - Verifying localnet (L1/L2) is running
 * - Setting environment variables for RPC, DWS, etc.
 *
 * This file adds DWS-specific setup:
 * - Mock inference server for AI completions
 * - DWS server startup (if needed)
 * - Mock node registration
 */

import { afterAll, beforeAll } from 'bun:test'
import {
  CORE_PORTS,
  getDwsApiUrl,
  getL2RpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import type { Subprocess } from 'bun'

// Configuration
const DWS_PORT = CORE_PORTS.DWS_API.get()
const INFERENCE_PORT = CORE_PORTS.DWS_INFERENCE.get()

const RPC_URL = getL2RpcUrl()
const DWS_URL = getDwsApiUrl()
const INFERENCE_URL =
  (typeof process !== 'undefined' ? process.env.INFERENCE_URL : undefined) ||
  `http://${getLocalhostHost()}:${INFERENCE_PORT}`

// Process management
let dwsProcess: Subprocess | null = null
let mockInferenceServer: { stop: () => void } | null = null
let isSetup = false

// =============================================================================
// Service Checks
// =============================================================================

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

// =============================================================================
// Mock Inference Server
// =============================================================================

async function startMockInferenceServer(): Promise<boolean> {
  console.log('[DWS Setup] Starting mock inference server...')

  if (await waitForService(INFERENCE_URL, '/health', 3)) {
    console.log('[DWS Setup] Mock inference server already running')
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
          model: body.model ?? 'mock-model',
          provider: 'mock',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: `Mock response to: ${body.messages?.[0]?.content ?? 'test'}`,
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
  console.log('[DWS Setup] Mock inference server started')
  return true
}

// =============================================================================
// DWS Server
// =============================================================================

async function startDWS(): Promise<boolean> {
  console.log('[DWS Setup] Checking DWS...')

  if (await waitForService(DWS_URL, '/health', 5)) {
    console.log('[DWS Setup] DWS already running')
    return true
  }

  // Find monorepo root
  let rootDir = process.cwd()
  const { existsSync } = await import('node:fs')
  const { join } = await import('node:path')

  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(rootDir, 'bun.lock')) &&
      existsSync(join(rootDir, 'packages'))
    ) {
      break
    }
    rootDir = join(rootDir, '..')
  }

  const dwsDir = join(rootDir, 'apps', 'dws')

  console.log('[DWS Setup] Starting DWS...')
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
    console.log('[DWS Setup] DWS started')
    return true
  }

  console.error('[DWS Setup] Failed to start DWS')
  return false
}

async function registerMockInferenceNode(): Promise<boolean> {
  console.log('[DWS Setup] Registering mock inference node...')

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
        '[DWS Setup] Failed to register mock node:',
        await response.text(),
      )
      return false
    }

    console.log('[DWS Setup] Mock inference node registered')
    return true
  } catch (error) {
    console.warn(
      '[DWS Setup] Could not register mock node:',
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

  console.log('\n[DWS Setup] Setting up DWS test environment...\n')

  // Chain should already be running from shared setup
  // Just start DWS-specific services

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
  console.log('\n[DWS Setup] Environment ready\n')
}

export async function teardown(): Promise<void> {
  console.log('[DWS Setup] Cleaning up...')

  if (dwsProcess) {
    dwsProcess.kill()
    dwsProcess = null
  }

  if (mockInferenceServer) {
    mockInferenceServer.stop()
    mockInferenceServer = null
  }

  isSetup = false
}

export function isReady(): boolean {
  return isSetup
}

export interface InfraStatus {
  dws: boolean
  inference: boolean
  rpcUrl: string
  dwsUrl: string
  inferenceUrl: string
}

export async function getStatus(): Promise<InfraStatus> {
  const [dws, inference] = await Promise.all([
    waitForService(DWS_URL, '/health', 3).catch(() => false),
    waitForService(INFERENCE_URL, '/health', 3).catch(() => false),
  ])

  return {
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
    dwsUrl:
      (typeof process !== 'undefined' ? process.env.DWS_URL : undefined) ??
      DWS_URL,
    rpcUrl: RPC_URL,
    inferenceUrl:
      (typeof process !== 'undefined'
        ? process.env.INFERENCE_URL
        : undefined) ?? INFERENCE_URL,
  }
}

// Export URLs for direct usage
export { RPC_URL, DWS_URL, INFERENCE_URL }

/**
 * Make a request to DWS with default configuration
 */
export async function dwsRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${DWS_URL}${path.startsWith('/') ? path : `/${path}`}`

  // Don't set Content-Type for FormData (browser will set multipart/form-data with boundary)
  const isFormData = options.body instanceof FormData
  const headers: HeadersInit = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers }

  const response = await fetch(url, {
    ...options,
    headers,
  })
  return response
}

// Auto-setup when file is imported in test context
if (process.env.BUN_TEST === 'true') {
  beforeAll(setup)
  afterAll(teardown)
}
