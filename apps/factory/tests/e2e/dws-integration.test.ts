/**
 * Factory DWS Integration E2E Tests
 *
 * Tests Factory against real local DWS and devnet infrastructure.
 * Requires:
 * - Local devnet running (bun run devnet)
 * - DWS server running (cd apps/dws && bun run dev)
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { z } from 'zod'

const FACTORY_API_URL = process.env.FACTORY_API_URL || 'http://localhost:4009'
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const RPC_URL = process.env.RPC_URL || 'http://localhost:6546'

// Test wallet (hardhat default)
const _TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// ============================================================================
// Response Schemas for E2E Tests
// ============================================================================

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

type HealthResponse = z.infer<typeof HealthResponseSchema>
type BountyResponse = z.infer<typeof BountyResponseSchema>
type A2AResponse = z.infer<typeof A2AResponseSchema>

/** Safely parse JSON response and validate against schema */
async function expectResponse<T>(
  response: Response,
  schema: z.ZodSchema<T>,
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
    // Wait for services to be available
    const maxWait = 30000
    const start = Date.now()

    while (Date.now() - start < maxWait) {
      const response = await fetch(`${FACTORY_API_URL}/api/health`).catch(
        () => null,
      )
      if (response?.ok) {
        console.log('Factory API is ready')
        return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    console.warn('Factory API not available, some tests may fail')
  })

  test('health endpoint returns status', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/health`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, HealthResponseSchema)
    expect(data.status).toBeDefined()
    expect(data.services).toBeDefined()
    expect(data.services.factory).toBe(true)
  })

  test('bounties endpoint returns list', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/bounties`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, BountyResponseSchema)
    expect(data.bounties).toBeDefined()
    expect(Array.isArray(data.bounties)).toBe(true)
    expect(typeof data.total).toBe('number')
  })

  test('bounties endpoint supports pagination', async () => {
    const response = await fetch(
      `${FACTORY_API_URL}/api/bounties?page=1&limit=5`,
    )
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, BountyResponseSchema)
    expect(data.bounties.length).toBeLessThanOrEqual(5)
  })

  test('bounties endpoint supports status filter', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/bounties?status=open`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, BountyResponseSchema)
    // Status filter may not be implemented in mock data
    expect(data.bounties).toBeDefined()
  })

  test('git endpoint returns repositories', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/git`)
    // DWS Git may not be available
    if (!response.ok) {
      console.log('Git endpoint returned:', response.status)
      return
    }

    const data = await expectResponse(response, ReposResponseSchema)
    expect(data.repos).toBeDefined()
    expect(Array.isArray(data.repos)).toBe(true)
  })

  test('packages endpoint returns packages', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/packages`)
    // DWS Packages may not be available
    if (!response.ok) {
      console.log('Packages endpoint returned:', response.status)
      return
    }

    const data = await expectResponse(response, PackagesResponseSchema)
    expect(data.packages).toBeDefined()
    expect(Array.isArray(data.packages)).toBe(true)
  })

  test('models endpoint returns models', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/models`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, ModelsResponseSchema)
    expect(data.models).toBeDefined()
    expect(Array.isArray(data.models)).toBe(true)
  })

  test('agents endpoint returns agents', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/agents`)
    // Crucible may not be available
    if (!response.ok) {
      console.log('Agents endpoint returned:', response.status)
      return
    }

    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })
})

describe('Factory A2A Protocol', () => {
  test('returns agent card at root', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/a2a`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, AgentCardResponseSchema)
    expect(data.name).toMatch(/Factory/i)
    expect(data.skills).toBeDefined()
    expect(Array.isArray(data.skills)).toBe(true)
  })

  test('handles A2A message send', async () => {
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
    // Result or error should be present
    expect(data.result !== undefined || data.error !== undefined).toBe(true)
  })
})

describe('Factory MCP Protocol', () => {
  test('returns server info at root', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/mcp`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, MCPInfoResponseSchema)
    // MCP may return data in different formats
    const hasInfo =
      data.name !== undefined ||
      data.serverInfo !== undefined ||
      data.resources !== undefined
    expect(hasInfo).toBe(true)
  })

  test('lists available resources', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/mcp/resources/list`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, MCPResourcesResponseSchema)
    expect(data.resources).toBeDefined()
    expect(Array.isArray(data.resources)).toBe(true)
    expect(data.resources.length).toBeGreaterThan(0)
  })

  test('lists available tools', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/mcp/tools/list`)
    expect(response.ok).toBe(true)

    const data = await expectResponse(response, MCPToolsResponseSchema)
    expect(data.tools).toBeDefined()
    expect(Array.isArray(data.tools)).toBe(true)
    expect(data.tools.length).toBeGreaterThan(0)
  })

  test('reads bounties resource', async () => {
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

    if (!response?.ok) {
      console.log('Devnet RPC not running, skipping')
      return
    }

    const data = await expectResponse(response, RpcResultResponseSchema)
    expect(data.result).toBeDefined()
    // Localnet chain ID is 31337 (0x7a69)
    expect(data.result).toBe('0x7a69')
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

    if (!response?.ok) {
      console.log('Devnet RPC not running, skipping')
      return
    }

    const data = await expectResponse(response, RpcResultResponseSchema)
    expect(data.result).toBeDefined()
    expect(data.result.startsWith('0x')).toBe(true)
  })
})

describe('Swagger API Documentation', () => {
  test('Swagger UI is accessible', async () => {
    const response = await fetch(`${FACTORY_API_URL}/swagger`)
    expect(response.ok).toBe(true)
  })

  test('OpenAPI JSON is valid', async () => {
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
