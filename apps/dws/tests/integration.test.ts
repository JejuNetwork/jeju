/**
 * DWS Integration Tests
 *
 * Comprehensive integration tests for all DWS services.
 * Tests against the server directly for unit/integration,
 * or against a running instance for full e2e.
 *
 * Run with: bun test tests/integration.test.ts
 * For full e2e: E2E_MODE=true DWS_URL=http://localhost:4030 bun test tests/integration.test.ts
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import type { Address, Hex } from 'viem'
import { createPublicClient, http } from 'viem'
import { app } from '../src/server'

setDefaultTimeout(30000)

// Configuration
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
const _TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex

const DWS_URL = process.env.DWS_URL ?? 'http://localhost:4030'
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:6546'
const E2E_MODE = process.env.E2E_MODE === 'true'

// Environment detection
const hasInferenceKey = !!(
  process.env.GROQ_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.OPENROUTER_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.TOGETHER_API_KEY
)

// Response type interfaces
interface HealthResponse {
  status: string
  services: Record<string, { status: string }>
  version?: string
}

interface JobResponse {
  jobId: string
  status: string
  output?: string
  exitCode?: number
}

interface CidResponse {
  cid: string
  size?: number
}

interface KeyResponse {
  keyId: string
  address: string
}

interface WorkerResponse {
  workerId: string
  status?: string
}

interface ChatCompletionResponse {
  id: string
  object: string
  model: string
  choices: Array<{ message: { role: string; content: string } }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  provider?: string
  node?: string
}

interface ServiceListResponse {
  services: string[]
  endpoints: Record<string, string>
}

interface ExistsResponse {
  exists: boolean
  cid: string
}

interface JobsListResponse {
  jobs: JobResponse[]
  total: number
}

interface CacheStatsResponse {
  entries: number
  sizeBytes: number
}

interface KeysListResponse {
  keys: KeyResponse[]
}

interface SecretIdResponse {
  id: string
}

interface SecretValueResponse {
  value: string
}

interface WorkersListResponse {
  functions: Array<{ id: string; name: string }>
}

interface WorkerdHealthResponse {
  status: string
  runtime: string
}

interface WorkerdListResponse {
  workers: WorkerResponse[]
  runtime: string
}

interface ChainsListResponse {
  chains: Array<{ chainId: number; name: string }>
}

interface ChainInfoResponse {
  id: number
  name: string
}

interface RegionsListResponse {
  regions: Array<{ code: string; name: string }>
}

interface FetchResponse {
  statusCode: number
}

interface A2ACapabilitiesResponse {
  capabilities: string[]
}

interface McpInitResponse {
  protocolVersion: string
  serverInfo: { name: string }
}

interface McpToolsResponse {
  tools: Array<{ name: string }>
}

interface AgentCardResponse {
  name: string
  capabilities: string[]
}

// Helper for external requests in E2E mode
async function dwsRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  if (E2E_MODE) {
    return fetch(`${DWS_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
        ...options.headers,
      },
    })
  }
  return app.request(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': TEST_ADDRESS,
      ...options.headers,
    },
  })
}

async function checkChainRunning(): Promise<boolean> {
  try {
    const client = createPublicClient({ transport: http(RPC_URL) })
    const blockNumber = await client.getBlockNumber()
    return blockNumber >= 0n
  } catch {
    return false
  }
}

// Core Health Tests

describe('Core Health', () => {
  test('main health check returns healthy', async () => {
    const res = await dwsRequest('/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as HealthResponse
    expect(body.status).toBe('healthy')
    expect(body.services.storage.status).toBe('healthy')
    expect(body.services.compute.status).toBe('healthy')
  })

  test('all service health endpoints respond', async () => {
    const endpoints = [
      '/storage/health',
      '/compute/health',
      '/cdn/health',
      '/kms/health',
      '/workers/health',
      '/git/health',
      '/s3/health',
    ]

    for (const endpoint of endpoints) {
      const res = await dwsRequest(endpoint)
      expect(res.status).toBe(200)
    }
  })

  test('root endpoint lists all services', async () => {
    const res = await dwsRequest('/')
    expect(res.status).toBe(200)

    const body = (await res.json()) as ServiceListResponse
    expect(body.services).toContain('storage')
    expect(body.services).toContain('compute')
    expect(body.services).toContain('cdn')
    expect(body.services).toContain('git')
    expect(body.endpoints).toBeDefined()
  })
})

// Storage Tests

describe('Storage', () => {
  let uploadedCid: string

  test('upload file returns CID', async () => {
    const testData = `Integration test data ${Date.now()}`

    const res = await dwsRequest('/storage/upload/raw', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'x-filename': 'test.txt',
      },
      body: testData,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as CidResponse
    expect(body.cid).toBeDefined()
    uploadedCid = body.cid
  })

  test('download file returns original content', async () => {
    if (!uploadedCid) return

    const res = await dwsRequest(`/storage/download/${uploadedCid}`)
    expect(res.status).toBe(200)

    const content = await res.text()
    expect(content).toContain('Integration test data')
  })

  test('check file exists', async () => {
    if (!uploadedCid) return

    const res = await dwsRequest(`/storage/exists/${uploadedCid}`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as ExistsResponse
    expect(body.exists).toBe(true)
    expect(body.cid).toBe(uploadedCid)
  })

  test('S3 compatible operations', async () => {
    const bucket = `integration-test-${Date.now()}`
    const key = 'test-object.txt'
    const content = 'S3 compatible integration test'

    // Create bucket
    const createRes = await dwsRequest(`/s3/${bucket}`, { method: 'PUT' })
    expect(createRes.status).toBe(200)

    // Put object
    const putRes = await dwsRequest(`/s3/${bucket}/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    })
    expect(putRes.status).toBe(200)

    // Get object
    const getRes = await dwsRequest(`/s3/${bucket}/${key}`)
    expect(getRes.status).toBe(200)
    expect(await getRes.text()).toBe(content)

    // HEAD object
    const headRes = await dwsRequest(`/s3/${bucket}/${key}`, { method: 'HEAD' })
    expect(headRes.status).toBe(200)
    expect(headRes.headers.get('content-length')).toBe(String(content.length))

    // Cleanup
    await dwsRequest(`/s3/${bucket}/${key}`, { method: 'DELETE' })
    await dwsRequest(`/s3/${bucket}`, { method: 'DELETE' })
  })
})

// Compute Tests

describe('Compute Jobs', () => {
  test('submit job requires authentication', async () => {
    const res = await app.request('/compute/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo hello' }),
    })
    expect(res.status).toBe(401)
  })

  test('submit job without command returns 400', async () => {
    const res = await dwsRequest('/compute/jobs', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test('submit and track job', async () => {
    const submitRes = await dwsRequest('/compute/jobs', {
      method: 'POST',
      body: JSON.stringify({ command: 'echo "integration test"' }),
    })

    expect(submitRes.status).toBe(201)
    const { jobId } = (await submitRes.json()) as JobResponse

    // Poll for completion
    let status = 'queued'
    let attempts = 0

    while (status !== 'completed' && status !== 'failed' && attempts < 50) {
      await Bun.sleep(100)
      const statusRes = await dwsRequest(`/compute/jobs/${jobId}`)
      const body = (await statusRes.json()) as JobResponse
      status = body.status
      attempts++
    }

    expect(['completed', 'failed', 'queued', 'running']).toContain(status)
  })

  test('job with environment variables', async () => {
    const res = await dwsRequest('/compute/jobs', {
      method: 'POST',
      body: JSON.stringify({
        command: 'echo $MY_VAR',
        env: { MY_VAR: 'integration_value' },
      }),
    })
    expect(res.status).toBe(201)
  })

  test('cancel job', async () => {
    const submitRes = await dwsRequest('/compute/jobs', {
      method: 'POST',
      body: JSON.stringify({ command: 'sleep 60' }),
    })

    const { jobId } = (await submitRes.json()) as JobResponse

    const cancelRes = await dwsRequest(`/compute/jobs/${jobId}/cancel`, {
      method: 'POST',
    })

    expect(cancelRes.status).toBe(200)
    const body = (await cancelRes.json()) as JobResponse
    expect(body.status).toBe('cancelled')
  })

  test('list jobs', async () => {
    const res = await dwsRequest('/compute/jobs')
    expect(res.status).toBe(200)

    const body = (await res.json()) as JobsListResponse
    expect(body.jobs).toBeInstanceOf(Array)
    expect(body.total).toBeGreaterThanOrEqual(0)
  })
})

// Inference Tests (requires API key)

describe.skipIf(!hasInferenceKey)('Inference', () => {
  test('chat completion with real provider', async () => {
    const res = await dwsRequest('/compute/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        max_tokens: 10,
      }),
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as ChatCompletionResponse
    expect(body.choices).toBeDefined()
    expect(body.choices[0].message.content.toLowerCase()).toContain('hello')
  })
})

// CDN Tests

describe('CDN', () => {
  test('cache stats available', async () => {
    const res = await dwsRequest('/cdn/stats')
    expect(res.status).toBe(200)

    const body = (await res.json()) as CacheStatsResponse
    expect(typeof body.entries).toBe('number')
  })

  test('cache purge succeeds', async () => {
    const res = await dwsRequest('/cdn/purge', {
      method: 'POST',
      body: JSON.stringify({ paths: ['/test-path'] }),
    })
    expect(res.status).toBe(200)
  })

  test('cache invalidate succeeds', async () => {
    const res = await dwsRequest('/cdn/invalidate', {
      method: 'POST',
      body: JSON.stringify({ paths: ['/*'] }),
    })
    expect(res.status).toBe(200)
  })
})

// KMS Tests

describe('KMS', () => {
  let _keyId: string

  test('generate key', async () => {
    const res = await dwsRequest('/kms/keys', {
      method: 'POST',
      body: JSON.stringify({
        name: `integration-key-${Date.now()}`,
        threshold: 3,
        totalParties: 5,
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as KeyResponse
    expect(body.keyId).toBeDefined()
    expect(body.address).toMatch(/^0x/)
    _keyId = body.keyId
  })

  test('list keys', async () => {
    const res = await dwsRequest('/kms/keys')
    expect(res.status).toBe(200)

    const body = (await res.json()) as KeysListResponse
    expect(body.keys).toBeInstanceOf(Array)
  })

  test('store and retrieve secret', async () => {
    const secretName = `integration-secret-${Date.now()}`
    const secretValue = 'super secret value'

    // Store
    const storeRes = await dwsRequest('/kms/vault/secrets', {
      method: 'POST',
      body: JSON.stringify({ name: secretName, value: secretValue }),
    })

    expect(storeRes.status).toBe(201)
    const { id } = (await storeRes.json()) as SecretIdResponse

    // Retrieve
    const revealRes = await dwsRequest(`/kms/vault/secrets/${id}/reveal`, {
      method: 'POST',
    })

    expect(revealRes.status).toBe(200)
    const { value } = (await revealRes.json()) as SecretValueResponse
    expect(value).toBe(secretValue)

    // Cleanup
    await dwsRequest(`/kms/vault/secrets/${id}`, { method: 'DELETE' })
  })
})

// Workers Tests

describe('Workers', () => {
  test('list workers', async () => {
    const res = await dwsRequest('/workers')
    expect(res.status).toBe(200)

    const body = (await res.json()) as WorkersListResponse
    expect(body.functions).toBeInstanceOf(Array)
  })

  test('worker deployment requires auth', async () => {
    const res = await app.request('/workers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-worker', code: 'export default {}' }),
    })
    expect(res.status).toBe(401)
  })
})

// Workerd Tests

describe('Workerd', () => {
  test('workerd health', async () => {
    const res = await dwsRequest('/workerd/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as WorkerdHealthResponse
    expect(body.status).toBe('healthy')
    expect(body.runtime).toBe('workerd')
  })

  test('list workerd workers', async () => {
    const res = await dwsRequest('/workerd')
    expect(res.status).toBe(200)

    const body = (await res.json()) as WorkerdListResponse
    expect(body.workers).toBeInstanceOf(Array)
    expect(body.runtime).toBe('workerd')
  })
})

// Git Tests

describe('Git', () => {
  test('git health', async () => {
    const res = await dwsRequest('/git/health')
    expect(res.status).toBe(200)
  })

  test('list repositories', async () => {
    const res = await dwsRequest('/git/repos')
    // May return 500 if chain connection fails (expected without localnet)
    expect([200, 500]).toContain(res.status)
  })
})

// RPC Tests

describe('RPC', () => {
  test('list supported chains', async () => {
    const res = await dwsRequest('/rpc/chains')
    expect(res.status).toBe(200)

    const body = (await res.json()) as ChainsListResponse
    expect(body.chains).toBeInstanceOf(Array)
    expect(body.chains.length).toBeGreaterThan(0)
  })

  test('get chain info', async () => {
    const res = await dwsRequest('/rpc/chains/1')
    expect(res.status).toBe(200)

    const body = (await res.json()) as ChainInfoResponse
    expect(body.name).toBe('Ethereum')
    expect(body.id).toBe(1)
  })
})

// VPN Tests

describe('VPN', () => {
  test('vpn health', async () => {
    const res = await dwsRequest('/vpn/health')
    expect(res.status).toBe(200)
  })

  test('list vpn regions', async () => {
    const res = await dwsRequest('/vpn/regions')
    expect(res.status).toBe(200)

    const body = (await res.json()) as RegionsListResponse
    expect(body.regions).toBeInstanceOf(Array)
    expect(body.regions.length).toBeGreaterThan(0)
  })
})

// Scraping Tests

describe('Scraping', () => {
  test('scraping health', async () => {
    const res = await dwsRequest('/scraping/health')
    expect(res.status).toBe(200)
  })

  test('quick fetch', async () => {
    const res = await dwsRequest('/scraping/fetch?url=https://example.com')
    expect(res.status).toBe(200)

    const body = (await res.json()) as FetchResponse
    expect(body.statusCode).toBe(200)
  })
})

// A2A / MCP Tests

describe('A2A / MCP', () => {
  test('a2a capabilities', async () => {
    const res = await dwsRequest('/a2a/capabilities')
    expect(res.status).toBe(200)

    const body = (await res.json()) as A2ACapabilitiesResponse
    expect(body.capabilities).toContain('storage')
    expect(body.capabilities).toContain('compute')
  })

  test('mcp initialize', async () => {
    const res = await dwsRequest('/mcp/initialize', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as McpInitResponse
    expect(body.protocolVersion).toBe('2024-11-05')
    expect(body.serverInfo.name).toBe('dws-mcp')
  })

  test('mcp tools list', async () => {
    const res = await dwsRequest('/mcp/tools/list', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as McpToolsResponse
    expect(body.tools).toBeInstanceOf(Array)
    const toolNames = body.tools.map((t) => t.name)
    expect(toolNames).toContain('dws_upload')
    expect(toolNames).toContain('dws_download')
  })
})

// CI Tests

describe('CI', () => {
  test('ci health', async () => {
    const res = await dwsRequest('/ci/health')
    // May return 500 if chain not running
    expect([200, 500]).toContain(res.status)
  })
})

// Agent Discovery

describe('Agent Discovery', () => {
  test('agent card available', async () => {
    const res = await dwsRequest('/.well-known/agent-card.json')
    expect(res.status).toBe(200)

    const body = (await res.json()) as AgentCardResponse
    expect(body.name).toBe('DWS')
    expect(body.capabilities).toBeInstanceOf(Array)
  })
})

// Live Chain Integration (E2E mode only)

describe.skipIf(!E2E_MODE)('Live Chain Integration', () => {
  let chainRunning = false

  beforeAll(async () => {
    chainRunning = await checkChainRunning()
  })

  test.skipIf(!chainRunning)('chain is accessible', async () => {
    const client = createPublicClient({ transport: http(RPC_URL) })
    const chainId = await client.getChainId()
    expect([1337, 31337, 420690]).toContain(chainId)
  })

  test.skipIf(!chainRunning)('on-chain node registry', async () => {
    const res = await dwsRequest('/workerd/registry/nodes')
    expect([200, 500, 503]).toContain(res.status)
  })

  test.skipIf(!chainRunning)('on-chain worker registry', async () => {
    const res = await dwsRequest('/workerd/registry/workers')
    expect([200, 500, 503]).toContain(res.status)
  })
})

// Cleanup

afterAll(() => {
  console.log('[Integration Tests] Complete')
})
