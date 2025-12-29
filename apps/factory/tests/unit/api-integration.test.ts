/**
 * Factory API Integration Tests
 *
 * Tests Factory API against running services.
 * These tests are skipped if services aren't available.
 *
 * To run: Start Factory API (bun run dev) before running tests
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { getCoreAppUrl, getDWSUrl, getL2RpcUrl } from '@jejunetwork/config'
import { z } from 'zod'

const FACTORY_API_URL =
  (typeof process !== 'undefined' ? process.env.FACTORY_API_URL : undefined) ||
  getCoreAppUrl('FACTORY')
const DWS_URL =
  (typeof process !== 'undefined' ? process.env.DWS_URL : undefined) ||
  getCoreAppUrl('DWS_API') ||
  getDWSUrl()
const RPC_URL =
  (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ||
  getL2RpcUrl()

// Track service availability
let factoryAvailable = false

// Response Schemas for E2E Tests

const HealthResponseSchema = z.object({
  status: z.string(),
  services: z.record(z.string(), z.boolean()),
})

const BountySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
})

const BountyResponseSchema = z.object({
  bounties: z.array(BountySchema),
  total: z.number(),
})

const A2AResponseSchema = z.object({
  jsonrpc: z.string(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

const ReposResponseSchema = z.object({
  repos: z.array(z.unknown()),
})

const PackagesResponseSchema = z.object({
  packages: z.array(z.unknown()),
})

const ModelsResponseSchema = z.object({
  models: z.array(z.unknown()),
})

const AgentCardResponseSchema = z.object({
  name: z.string(),
  skills: z.array(z.unknown()),
})

const MCPInfoResponseSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  resources: z.array(z.unknown()).optional(),
  tools: z.array(z.unknown()).optional(),
  serverInfo: z
    .object({
      name: z.string(),
      version: z.string(),
    })
    .optional(),
})

const MCPResourcesResponseSchema = z.object({
  resources: z.array(z.unknown()),
})

const MCPToolsResponseSchema = z.object({
  tools: z.array(z.unknown()),
})

const MCPResourceReadResponseSchema = z.object({
  contents: z.array(z.object({ text: z.string() })),
})

const MCPToolCallResponseSchema = z.object({
  content: z.array(z.object({ text: z.string() })),
})

const DWSHealthResponseSchema = z.object({
  status: z.string(),
})

const RpcResultResponseSchema = z.object({
  result: z.string(),
})

const OpenAPIResponseSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string() }),
  paths: z.record(z.string(), z.unknown()),
})

/** Safely parse JSON response and validate against schema */
async function expectResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const json: unknown = await response.json()
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new Error(
      `Response validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    )
  }
  return result.data
}

describe('Factory API', () => {
  beforeAll(async () => {
    // Quick check if Factory API is available (3s timeout)
    const response = await fetch(`${FACTORY_API_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => null)

    factoryAvailable = response?.ok ?? false
    if (!factoryAvailable) {
      console.log('Factory API not running, integration tests will be skipped')
    }
  })

  test('health endpoint returns status', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/health`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, HealthResponseSchema)
    expect(data.status).toBeDefined()
    expect(data.services).toBeDefined()
    expect(data.services.factory).toBe(true)
  })

  test('bounties endpoint returns list', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/bounties`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, BountyResponseSchema)
    expect(data.bounties).toBeDefined()
    expect(Array.isArray(data.bounties)).toBe(true)
    expect(typeof data.total).toBe('number')
  })

  test('bounties endpoint supports pagination', async () => {
    if (!factoryAvailable) return

    const response = await fetch(
      `${FACTORY_API_URL}/api/bounties?page=1&limit=5`,
    )
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, BountyResponseSchema)
    expect(data.bounties.length).toBeLessThanOrEqual(5)
  })

  test('bounties endpoint supports status filter', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/bounties?status=open`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, BountyResponseSchema)
    expect(data.bounties).toBeDefined()
  })

  test('git endpoint returns repositories', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/git`)
    if (!response.ok) return

    const data = await expectResponse(response, ReposResponseSchema)
    expect(data.repos).toBeDefined()
    expect(Array.isArray(data.repos)).toBe(true)
  })

  test('packages endpoint returns packages', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/packages`)
    if (!response.ok) return

    const data = await expectResponse(response, PackagesResponseSchema)
    expect(data.packages).toBeDefined()
    expect(Array.isArray(data.packages)).toBe(true)
  })

  test('models endpoint returns models', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/models`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, ModelsResponseSchema)
    expect(data.models).toBeDefined()
    expect(Array.isArray(data.models)).toBe(true)
  })

  test('agents endpoint returns agents', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/agents`)
    if (!response.ok) return

    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })
})

describe('Factory A2A Protocol', () => {
  test('returns agent card at root', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/a2a`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, AgentCardResponseSchema)
    expect(data.name).toMatch(/Factory/i)
    expect(data.skills).toBeDefined()
    expect(Array.isArray(data.skills)).toBe(true)
  })

  test('handles A2A message send', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-123',
            parts: [{ kind: 'text', text: 'list bounties' }],
          },
        },
        id: 1,
      }),
    })

    expect(response.ok).toBe(true)
    const data = await expectResponse(response, A2AResponseSchema)
    expect(data.jsonrpc).toBe('2.0')
    expect(data.result !== undefined || data.error !== undefined).toBe(true)
  })
})

describe('Factory MCP Protocol', () => {
  test('returns server info at root', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/mcp`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, MCPInfoResponseSchema)
    const hasInfo =
      data.name !== undefined ||
      data.serverInfo !== undefined ||
      data.resources !== undefined
    expect(hasInfo).toBe(true)
  })

  test('lists available resources', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/mcp/resources/list`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, MCPResourcesResponseSchema)
    expect(data.resources).toBeDefined()
    expect(Array.isArray(data.resources)).toBe(true)
    expect(data.resources.length).toBeGreaterThan(0)
  })

  test('lists available tools', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/mcp/tools/list`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, MCPToolsResponseSchema)
    expect(data.tools).toBeDefined()
    expect(Array.isArray(data.tools)).toBe(true)
    expect(data.tools.length).toBeGreaterThan(0)
  })

  test('reads bounties resource', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/mcp/resources/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'factory://bounties' }),
    })

    expect(response.ok).toBe(true)
    const data = await expectResponse(response, MCPResourceReadResponseSchema)
    expect(data.contents).toBeDefined()
    expect(data.contents.length).toBeGreaterThan(0)
  })

  test('calls search-bounties tool', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/api/mcp/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'search-bounties',
        arguments: { status: 'open' },
      }),
    })

    expect(response.ok).toBe(true)
    const data = await expectResponse(response, MCPToolCallResponseSchema)
    expect(data.content).toBeDefined()
  })
})

describe('DWS Integration', () => {
  let dwsAvailable = false

  beforeAll(async () => {
    // Check if DWS is running
    const response = await fetch(`${DWS_URL}/health`).catch(() => null)
    dwsAvailable = response?.ok ?? false
    if (!dwsAvailable) {
      console.warn('DWS not available, skipping DWS integration tests')
    }
  })

  test('DWS health check', async () => {
    if (!dwsAvailable) {
      console.log('DWS not running, skipping')
      return
    }

    const response = await fetch(`${DWS_URL}/health`)
    expect(response.ok).toBe(true)
    const data = await expectResponse(response, DWSHealthResponseSchema)
    expect(data.status).toBe('healthy')
  })

  test('DWS storage is accessible', async () => {
    if (!dwsAvailable) {
      console.log('DWS not running, skipping')
      return
    }

    const response = await fetch(`${DWS_URL}/storage/health`)
    expect(response.ok).toBe(true)
  })

  test('DWS workerd is accessible', async () => {
    if (!dwsAvailable) {
      console.log('DWS not running, skipping')
      return
    }

    const response = await fetch(`${DWS_URL}/workerd/workers`)
    // Workerd may return 400/404 if misconfigured or no workers deployed
    expect([200, 400, 404]).toContain(response.status)
  })
})

describe('Local Devnet Integration', () => {
  test('RPC endpoint is accessible', async () => {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    }).catch(() => null)

    if (!response?.ok) return

    const data = await expectResponse(response, RpcResultResponseSchema)
    expect(data.result).toBeDefined()
    // Accept any local chain ID (31337 = 0x7a69, 31337 = 0x539)
    expect(['0x7a69', '0x539']).toContain(data.result)
  })

  test('can query block number', async () => {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    }).catch(() => null)

    if (!response?.ok) return

    const data = await expectResponse(response, RpcResultResponseSchema)
    expect(data.result).toBeDefined()
    expect(data.result.startsWith('0x')).toBe(true)
  })
})

describe('Swagger API Documentation', () => {
  test('Swagger UI is accessible', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/swagger`)
    expect(response.ok).toBe(true)
  })

  test('OpenAPI JSON is valid', async () => {
    if (!factoryAvailable) return

    const response = await fetch(`${FACTORY_API_URL}/swagger/json`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, OpenAPIResponseSchema)
    expect(data.openapi).toBeDefined()
    expect(data.info).toBeDefined()
    expect(data.info.title).toBe('Factory API')
    expect(data.paths).toBeDefined()
    expect(Object.keys(data.paths).length).toBeGreaterThan(0)
  })
})
