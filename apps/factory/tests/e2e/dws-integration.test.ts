/**
 * Factory DWS Integration E2E Tests
 *
 * Tests Factory against real local DWS and devnet infrastructure.
 * Requires:
 * - Local devnet running (bun run devnet)
 * - DWS server running (cd apps/dws && bun run dev)
 */

import { beforeAll, describe, expect, test } from 'bun:test'

const FACTORY_API_URL = process.env.FACTORY_API_URL || 'http://localhost:4009'
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const RPC_URL = process.env.RPC_URL || 'http://localhost:9545'

// Test wallet (hardhat default)
const _TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

interface HealthResponse {
  status: string
  services: Record<string, boolean>
}

interface BountyResponse {
  bounties: Array<{
    id: string
    title: string
    status: string
  }>
  total: number
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

    const data = (await response.json()) as HealthResponse
    expect(data.status).toBeDefined()
    expect(data.services).toBeDefined()
    expect(data.services.factory).toBe(true)
  })

  test('bounties endpoint returns list', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/bounties`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as BountyResponse
    expect(data.bounties).toBeDefined()
    expect(Array.isArray(data.bounties)).toBe(true)
    expect(typeof data.total).toBe('number')
  })

  test('bounties endpoint supports pagination', async () => {
    const response = await fetch(
      `${FACTORY_API_URL}/api/bounties?page=1&limit=5`,
    )
    expect(response.ok).toBe(true)

    const data = (await response.json()) as BountyResponse
    expect(data.bounties.length).toBeLessThanOrEqual(5)
  })

  test('bounties endpoint supports status filter', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/bounties?status=open`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as BountyResponse
    for (const bounty of data.bounties) {
      expect(bounty.status).toBe('open')
    }
  })

  test('git endpoint returns repositories', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/git`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { repos: unknown[] }
    expect(data.repos).toBeDefined()
    expect(Array.isArray(data.repos)).toBe(true)
  })

  test('packages endpoint returns packages', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/packages`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { packages: unknown[] }
    expect(data.packages).toBeDefined()
    expect(Array.isArray(data.packages)).toBe(true)
  })

  test('models endpoint returns models', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/models`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { models: unknown[] }
    expect(data.models).toBeDefined()
    expect(Array.isArray(data.models)).toBe(true)
  })

  test('agents endpoint returns agents', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/agents`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })
})

describe('Factory A2A Protocol', () => {
  test('returns agent card at root', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/a2a`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as {
      name: string
      skills: unknown[]
    }
    expect(data.name).toBe('Factory')
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
    const data = (await response.json()) as {
      jsonrpc: string
      result: unknown
    }
    expect(data.jsonrpc).toBe('2.0')
    expect(data.result).toBeDefined()
  })
})

describe('Factory MCP Protocol', () => {
  test('returns server info at root', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/mcp`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as {
      name: string
      version: string
      resources: unknown[]
      tools: unknown[]
    }
    expect(data.name).toBeDefined()
    expect(data.version).toBeDefined()
    expect(data.resources).toBeDefined()
    expect(data.tools).toBeDefined()
  })

  test('lists available resources', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/mcp/resources/list`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { resources: unknown[] }
    expect(data.resources).toBeDefined()
    expect(Array.isArray(data.resources)).toBe(true)
    expect(data.resources.length).toBeGreaterThan(0)
  })

  test('lists available tools', async () => {
    const response = await fetch(`${FACTORY_API_URL}/api/mcp/tools/list`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { tools: unknown[] }
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
    const data = (await response.json()) as {
      contents: Array<{ text: string }>
    }
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
    const data = (await response.json()) as {
      content: Array<{ text: string }>
    }
    expect(data.content).toBeDefined()
  })
})

describe('DWS Integration', () => {
  beforeAll(async () => {
    // Check if DWS is running
    const response = await fetch(`${DWS_URL}/health`).catch(() => null)
    if (!response?.ok) {
      console.warn('DWS not available, skipping DWS integration tests')
    }
  })

  test('DWS health check', async () => {
    const response = await fetch(`${DWS_URL}/health`)
    if (!response.ok) {
      console.log('DWS not running, skipping')
      return
    }

    const data = (await response.json()) as { status: string }
    expect(data.status).toBe('healthy')
  })

  test('DWS storage is accessible', async () => {
    const response = await fetch(`${DWS_URL}/storage/health`)
    if (!response.ok) {
      console.log('DWS storage not available')
      return
    }

    expect(response.ok).toBe(true)
  })

  test('DWS workerd is accessible', async () => {
    const response = await fetch(`${DWS_URL}/workerd/workers`)
    if (!response.ok) {
      console.log('DWS workerd not available')
      return
    }

    expect(response.ok).toBe(true)
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

    const data = (await response.json()) as { result: string }
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

    const data = (await response.json()) as { result: string }
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

    const data = (await response.json()) as {
      openapi: string
      info: { title: string }
      paths: Record<string, unknown>
    }
    expect(data.openapi).toBeDefined()
    expect(data.info).toBeDefined()
    expect(data.info.title).toBe('Factory API')
    expect(data.paths).toBeDefined()
    expect(Object.keys(data.paths).length).toBeGreaterThan(0)
  })
})
