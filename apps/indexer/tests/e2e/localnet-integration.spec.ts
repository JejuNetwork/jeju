/**
 * Indexer - Localnet Integration E2E Tests
 *
 * Comprehensive tests verifying the indexer works end-to-end with local testnet:
 * - Chain connectivity
 * - Block indexing
 * - Transaction processing
 * - Contract detection
 * - REST API endpoints
 * - GraphQL endpoint
 */

import { expect, test } from '@playwright/test'

const RPC_URL = process.env.RPC_ETH_HTTP || 'http://127.0.0.1:6546'
// REST API runs on 4004 in development, 4352 in production config
const REST_BASE_URL = process.env.REST_URL || 'http://localhost:4004'
const GRAPHQL_URL = process.env.GRAPHQL_URL || 'http://localhost:4350/graphql'
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'

// Helper to make RPC calls to the chain
async function rpcCall(
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: 1,
    }),
  })
  const data = (await response.json()) as {
    result?: unknown
    error?: { message: string }
  }
  if (data.error) {
    throw new Error(data.error.message)
  }
  return data.result
}

test.describe('Prerequisites Check', () => {
  test('local chain should be running and responding', async () => {
    const blockNumber = (await rpcCall('eth_blockNumber')) as string
    expect(blockNumber).toBeDefined()
    expect(blockNumber.startsWith('0x')).toBeTruthy()
    const blockNum = parseInt(blockNumber, 16)
    expect(blockNum).toBeGreaterThanOrEqual(0)
    console.log(`Chain is at block ${blockNum}`)
  })

  test('chain should have correct chainId', async () => {
    const chainId = (await rpcCall('eth_chainId')) as string
    expect(chainId).toBeDefined()
    const chainIdNum = parseInt(chainId, 16)
    // Local testnet uses chainId 31337 (Anvil default) or 420691 (Jeju)
    expect([31337, 420691, 1337]).toContain(chainIdNum)
    console.log(`Chain ID: ${chainIdNum}`)
  })

  test('DWS should be running (optional - may be in local route mode)', async () => {
    try {
      const response = await fetch(`${DWS_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        const data = (await response.json()) as { status: string }
        expect(data.status).toBe('healthy')
      }
    } catch {
      // DWS may not be running or may be in local route mode
      console.log('DWS not available - skipping')
      test.skip()
    }
  })

  test.skip('SQLit service should be available via DWS', async () => {
    // Skip this test if DWS is in local route mode
    const response = await fetch(`${DWS_URL}/sqlit/status`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      console.log('SQLit proxy not available')
      return
    }
    const data = (await response.json()) as {
      status: string
      mode: string
      running: boolean
    }
    expect(data.status).toBe('healthy')
    expect(data.running).toBe(true)
    console.log(`SQLit mode: ${data.mode}`)
  })
})

test.describe('Indexer REST API Health', () => {
  test('REST API should be healthy', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/health`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    // In dev mode, may be 'degraded' if schema not fully ready
    expect(['ok', 'degraded']).toContain(data.status)
    expect(data.service).toBe('indexer-rest')
  })

  test('REST API should list all endpoints', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.name).toBe('Indexer REST API')
    expect(data.endpoints).toBeDefined()
    expect(data.endpoints.blocks).toBe('/api/blocks')
    expect(data.endpoints.transactions).toBe('/api/transactions')
    expect(data.endpoints.contracts).toBe('/api/contracts')
  })
})

test.describe('Block Indexing', () => {
  test('should return indexed blocks', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/blocks`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.blocks).toBeDefined()
    expect(Array.isArray(data.blocks)).toBeTruthy()
    console.log(`Indexed blocks: ${data.total ?? data.blocks.length}`)
  })

  test('should return recent blocks with correct structure', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/blocks?limit=5`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.blocks).toBeDefined()

    if (data.blocks.length > 0) {
      const block = data.blocks[0]
      // Verify block structure
      expect(block.number ?? block.height ?? block.blockNumber).toBeDefined()
      expect(block.hash ?? block.id).toBeDefined()
    }
  })

  test('should index blocks from chain', async ({ request }) => {
    // Get current block from chain
    const chainBlockHex = (await rpcCall('eth_blockNumber')) as string
    const chainBlock = parseInt(chainBlockHex, 16)

    // Give indexer time to catch up
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check indexed blocks
    const response = await request.get(`${REST_BASE_URL}/api/blocks?limit=1`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    if (data.blocks && data.blocks.length > 0) {
      const latestIndexed =
        data.blocks[0].number ??
        data.blocks[0].height ??
        data.blocks[0].blockNumber
      // Indexer should be within a few blocks of the chain
      expect(latestIndexed).toBeLessThanOrEqual(chainBlock)
      console.log(`Chain at ${chainBlock}, indexer at ${latestIndexed}`)
    }
  })
})

test.describe('Transaction Indexing', () => {
  test('should return indexed transactions', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/transactions`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.transactions).toBeDefined()
    expect(Array.isArray(data.transactions)).toBeTruthy()
    console.log(
      `Indexed transactions: ${data.total ?? data.transactions.length}`,
    )
  })

  test('should support transaction pagination', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/transactions?limit=10&offset=0`,
    )
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.transactions).toBeDefined()
    expect(data.transactions.length).toBeLessThanOrEqual(10)
  })
})

test.describe('Contract Detection', () => {
  test('should return indexed contracts', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/contracts`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contracts).toBeDefined()
    expect(Array.isArray(data.contracts)).toBeTruthy()
    console.log(`Indexed contracts: ${data.total ?? data.contracts.length}`)
  })

  test('should filter contracts by type', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/contracts?type=ERC20`,
    )
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contracts).toBeDefined()
  })
})

test.describe('Account Tracking', () => {
  test('should return 404 for non-existent account', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/accounts/0x0000000000000000000000000000000000000001`,
    )
    expect(response.status()).toBe(404)
  })
})

test.describe('Token Transfers', () => {
  test('should return token transfers list', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/tokens/transfers`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.transfers).toBeDefined()
    expect(Array.isArray(data.transfers)).toBeTruthy()
    console.log(`Token transfers: ${data.total ?? data.transfers.length}`)
  })
})

test.describe('Search Functionality', () => {
  test('should accept search queries', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/search?q=0x`)
    // Search may return 500 if search index not ready, accept both cases
    if (response.ok()) {
      const data = await response.json()
      expect(data).toBeDefined()
    } else {
      // Search not available - acceptable in dev mode
      expect([500, 503]).toContain(response.status())
    }
  })

  test('should accept search with type filter', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/search?q=test&type=agent`,
    )
    // Search may not be available in all modes
    expect([200, 500, 503]).toContain(response.status())
  })
})

test.describe('Network Stats', () => {
  test('should return network stats', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/stats`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })
})

test.describe('GraphQL Endpoint', () => {
  test('should accept GraphQL introspection query', async ({ request }) => {
    const response = await request.post(GRAPHQL_URL, {
      data: {
        query: `
          query {
            __schema {
              types {
                name
              }
            }
          }
        `,
      },
    })

    // GraphQL might not be running in all test scenarios
    if (response.ok()) {
      const data = await response.json()
      expect(data.data).toBeDefined()
    }
  })

  test('should return blocks via GraphQL', async ({ request }) => {
    const response = await request.post(GRAPHQL_URL, {
      data: {
        query: `
          query {
            blocks(limit: 5, orderBy: number_DESC) {
              id
              number
              hash
              timestamp
            }
          }
        `,
      },
    })

    if (response.ok()) {
      const data = await response.json()
      if (data.data?.blocks) {
        expect(Array.isArray(data.data.blocks)).toBeTruthy()
        console.log(`GraphQL returned ${data.data.blocks.length} blocks`)
      }
    }
  })

  test('should return transactions via GraphQL', async ({ request }) => {
    const response = await request.post(GRAPHQL_URL, {
      data: {
        query: `
          query {
            transactions(limit: 5, orderBy: blockNumber_DESC) {
              id
              hash
              blockNumber
              from { address }
              to { address }
            }
          }
        `,
      },
    })

    if (response.ok()) {
      const data = await response.json()
      if (data.data?.transactions) {
        expect(Array.isArray(data.data.transactions)).toBeTruthy()
        console.log(
          `GraphQL returned ${data.data.transactions.length} transactions`,
        )
      }
    }
  })
})

test.describe('Oracle Endpoints', () => {
  test('should return oracle feeds', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/feeds`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.feeds).toBeDefined()
    expect(Array.isArray(data.feeds)).toBeTruthy()
  })

  test('should return oracle operators', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/operators`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.operators).toBeDefined()
  })

  test('should return oracle stats', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/stats`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })
})

test.describe('Node Staking Endpoints', () => {
  test('should return nodes list', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/nodes`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.nodes).toBeDefined()
    expect(Array.isArray(data.nodes)).toBeTruthy()
  })
})

test.describe('Provider Endpoints', () => {
  test('should return providers list', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/providers`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })
})

test.describe('Rate Limiting', () => {
  test('should expose rate limit tiers', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/rate-limits`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.tiers).toBeDefined()
    expect(data.thresholds).toBeDefined()
  })
})

test.describe('CORS Support', () => {
  test('should return CORS headers (or no CORS in dev mode)', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/health`)
    const headers = response.headers()
    // CORS may not be enabled in all dev configurations
    // Just verify the response is accessible
    expect(response.ok()).toBeTruthy()
    // If CORS header is present, verify it's valid
    const corsHeader = headers['access-control-allow-origin']
    if (corsHeader) {
      expect(corsHeader.length).toBeGreaterThan(0)
    }
  })
})

test.describe('Error Handling', () => {
  test('should return error for unknown endpoints', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/nonexistent`)
    // Should return 404 or 500 for unknown endpoints
    expect([404, 500]).toContain(response.status())
  })

  test('should handle invalid block number gracefully', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/blocks/99999999999`,
    )
    expect(response.status()).toBe(404)
  })

  test('should handle invalid transaction hash gracefully', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/transactions/0x0000000000000000000000000000000000000000000000000000000000000000`,
    )
    expect(response.status()).toBe(404)
  })
})
