/**
 * Indexer - REST API E2E Tests
 *
 * Comprehensive tests for all REST API endpoints:
 * - Health and info endpoints
 * - Search functionality
 * - Agents, blocks, transactions
 * - Contracts, tokens, nodes
 * - Providers, containers
 * - Oracle endpoints
 * - Stats and rate limits
 */

import { expect, test } from '@playwright/test'

const REST_BASE_URL = process.env.REST_URL || 'http://localhost:4352'

test.describe('Health & Info Endpoints', () => {
  test('GET /health should return ok status', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/health`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.status).toBe('ok')
    expect(data.service).toBe('indexer-rest')
    expect(data.port).toBe(4352)
  })

  test('GET / should return API info with all endpoints', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.name).toBe('Indexer REST API')
    expect(data.version).toBe('1.0.0')
    expect(data.endpoints).toBeDefined()
    expect(data.endpoints.health).toBe('/health')
    expect(data.endpoints.search).toBe('/api/search')
    expect(data.endpoints.agents).toBe('/api/agents')
    expect(data.endpoints.blocks).toBe('/api/blocks')
    expect(data.endpoints.transactions).toBe('/api/transactions')
    expect(data.endpoints.contracts).toBe('/api/contracts')
    expect(data.endpoints.tokens).toBe('/api/tokens')
    expect(data.endpoints.nodes).toBe('/api/nodes')
    expect(data.endpoints.providers).toBe('/api/providers')
    expect(data.endpoints.stats).toBe('/api/stats')
    expect(data.graphql).toContain('graphql')
    expect(data.rateLimits).toBeDefined()
  })

  test('GET /api/rate-limits should return tier info', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/rate-limits`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.tiers).toBeDefined()
    expect(data.thresholds).toBeDefined()
    expect(data.note).toContain('Stake')
  })
})

test.describe('Search API', () => {
  test('GET /api/search should accept query parameter', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/search?q=test`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })

  test('GET /api/search should accept type filter', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/search?q=test&type=a2a`,
    )

    expect(response.ok()).toBeTruthy()
  })

  test('GET /api/search should accept pagination', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/search?q=test&limit=10&offset=0`,
    )

    expect(response.ok()).toBeTruthy()
  })

  test('GET /api/search should accept verified filter', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/search?q=test&verified=true`,
    )

    expect(response.ok()).toBeTruthy()
  })
})

test.describe('Tags API', () => {
  test('GET /api/tags should return tags list', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/tags`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.tags).toBeDefined()
    expect(Array.isArray(data.tags)).toBeTruthy()
    expect(data.total).toBeDefined()
  })
})

test.describe('Agents API', () => {
  test('GET /api/agents should return paginated agents', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/agents`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.agents).toBeDefined()
    expect(Array.isArray(data.agents)).toBeTruthy()
    expect(data.total).toBeDefined()
    expect(data.limit).toBeDefined()
    expect(data.offset).toBeDefined()
  })

  test('GET /api/agents should accept pagination params', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/agents?limit=5&offset=0`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.limit).toBe(5)
    expect(data.offset).toBe(0)
  })

  test('GET /api/agents should filter by active status', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/agents?active=true`,
    )

    expect(response.ok()).toBeTruthy()
  })

  test('GET /api/agents/:id with invalid id should return 404', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/agents/nonexistent-agent-id`,
    )

    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })

  test('GET /api/agents/tag/:tag should return agents by tag', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/agents/tag/general`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.tag).toBe('general')
    expect(data.agents).toBeDefined()
    expect(data.count).toBeDefined()
  })
})

test.describe('Blocks API', () => {
  test('GET /api/blocks should return blocks list', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/blocks`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.blocks).toBeDefined()
    expect(Array.isArray(data.blocks)).toBeTruthy()
  })

  test('GET /api/blocks should accept pagination', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/blocks?limit=10&offset=0`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.blocks.length).toBeLessThanOrEqual(10)
  })

  test('GET /api/blocks/:numberOrHash with invalid identifier should return 404', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/blocks/999999999`)

    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })

  test('GET /api/blocks/:numberOrHash with invalid hash format should return error', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/blocks/0xinvalidhash`,
    )

    // Should return 400 or 404
    expect([400, 404]).toContain(response.status())
  })
})

test.describe('Transactions API', () => {
  test('GET /api/transactions should return transactions list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/transactions`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.transactions).toBeDefined()
    expect(Array.isArray(data.transactions)).toBeTruthy()
  })

  test('GET /api/transactions should accept pagination', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/transactions?limit=5&offset=0`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.transactions.length).toBeLessThanOrEqual(5)
  })

  test('GET /api/transactions/:hash with invalid hash should return 404', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/transactions/0x0000000000000000000000000000000000000000000000000000000000000000`,
    )

    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })
})

test.describe('Accounts API', () => {
  test('GET /api/accounts/:address with invalid address should return 404', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/accounts/0x0000000000000000000000000000000000000001`,
    )

    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })

  test('GET /api/accounts/:address with invalid format should return error', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/accounts/notanaddress`,
    )

    // Should return 400 or 404
    expect([400, 404]).toContain(response.status())
  })
})

test.describe('Contracts API', () => {
  test('GET /api/contracts should return contracts list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/contracts`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contracts).toBeDefined()
    expect(Array.isArray(data.contracts)).toBeTruthy()
  })

  test('GET /api/contracts should accept type filter', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/contracts?type=ERC20`,
    )

    expect(response.ok()).toBeTruthy()
  })

  test('GET /api/contracts should accept limit', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/contracts?limit=5`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contracts.length).toBeLessThanOrEqual(5)
  })
})

test.describe('Token Transfers API', () => {
  test('GET /api/tokens/transfers should return transfers list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/tokens/transfers`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.transfers).toBeDefined()
    expect(Array.isArray(data.transfers)).toBeTruthy()
  })

  test('GET /api/tokens/transfers should accept token filter', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/tokens/transfers?token=0x0000000000000000000000000000000000000001`,
    )

    expect(response.ok()).toBeTruthy()
  })
})

test.describe('Nodes API', () => {
  test('GET /api/nodes should return nodes list', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/nodes`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.nodes).toBeDefined()
    expect(Array.isArray(data.nodes)).toBeTruthy()
    expect(data.total).toBeDefined()
  })

  test('GET /api/nodes should accept active filter', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/nodes?active=true`)

    expect(response.ok()).toBeTruthy()
  })
})

test.describe('Providers API', () => {
  test('GET /api/providers should return providers list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/providers`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })

  test('GET /api/providers should accept type filter', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/providers?type=compute`,
    )

    expect(response.ok()).toBeTruthy()
  })
})

test.describe('Containers API', () => {
  test('GET /api/containers should return containers list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/containers`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.containers).toBeDefined()
    expect(Array.isArray(data.containers)).toBeTruthy()
    expect(data.total).toBeDefined()
    expect(data.limit).toBeDefined()
    expect(data.offset).toBeDefined()
  })

  test('GET /api/containers should accept filters', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/containers?verified=true&gpu=true&tee=false`,
    )

    expect(response.ok()).toBeTruthy()
  })

  test('GET /api/containers/:cid with invalid cid should return error', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/containers/invalidcid`,
    )

    // Should return 400 or 404
    expect([400, 404]).toContain(response.status())
  })
})

test.describe('Cross-Service API', () => {
  test('GET /api/cross-service/requests should return requests list', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/cross-service/requests`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.requests).toBeDefined()
    expect(Array.isArray(data.requests)).toBeTruthy()
    expect(data.total).toBeDefined()
  })

  test('GET /api/cross-service/requests should accept filters', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/cross-service/requests?status=PENDING&type=COMPUTE`,
    )

    expect(response.ok()).toBeTruthy()
  })
})

test.describe('Marketplace API', () => {
  test('GET /api/marketplace/stats should return stats', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/marketplace/stats`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })

  test('GET /api/full-stack should return full-stack providers', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/full-stack`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })
})

test.describe('Oracle API', () => {
  test('GET /api/oracle/feeds should return feeds list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/feeds`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.feeds).toBeDefined()
    expect(Array.isArray(data.feeds)).toBeTruthy()
    expect(data.total).toBeDefined()
  })

  test('GET /api/oracle/feeds should accept filters', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/oracle/feeds?active=true&category=SPOT_PRICE`,
    )

    expect(response.ok()).toBeTruthy()
  })

  test('GET /api/oracle/feeds/:feedId with invalid id should return error', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/oracle/feeds/nonexistent`,
    )

    // Should return 400 or 404
    expect([400, 404]).toContain(response.status())
  })

  test('GET /api/oracle/operators should return operators list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/operators`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.operators).toBeDefined()
    expect(Array.isArray(data.operators)).toBeTruthy()
    expect(data.total).toBeDefined()
  })

  test('GET /api/oracle/operators should accept filters', async ({
    request,
  }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/oracle/operators?active=true&jailed=false`,
    )

    expect(response.ok()).toBeTruthy()
  })

  test('GET /api/oracle/reports should return reports list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/reports`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.reports).toBeDefined()
    expect(Array.isArray(data.reports)).toBeTruthy()
    expect(data.total).toBeDefined()
  })

  test('GET /api/oracle/disputes should return disputes list', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/disputes`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.disputes).toBeDefined()
    expect(Array.isArray(data.disputes)).toBeTruthy()
    expect(data.total).toBeDefined()
  })

  test('GET /api/oracle/stats should return oracle stats', async ({
    request,
  }) => {
    const response = await request.get(`${REST_BASE_URL}/api/oracle/stats`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
  })
})

test.describe('Stats API', () => {
  test('GET /api/stats should return network stats', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/stats`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data).toBeDefined()
    expect(data.rateLimitStats).toBeDefined()
  })
})

test.describe('Error Handling', () => {
  test('should handle invalid JSON gracefully', async ({ request }) => {
    const response = await request.post(`${REST_BASE_URL}/api/search`, {
      headers: { 'Content-Type': 'application/json' },
      data: 'invalid json{',
    })

    // Should return 400 or 404 (no POST handler)
    expect([400, 404, 405]).toContain(response.status())
  })

  test('should return 404 for unknown endpoints', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/nonexistent-endpoint`,
    )

    expect(response.status()).toBe(404)
  })
})

test.describe('CORS Headers', () => {
  test('should have CORS headers on API responses', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/health`)

    const headers = response.headers()
    expect(headers['access-control-allow-origin']).toBeDefined()
  })
})

test.describe('Pagination Validation', () => {
  test('should handle negative offset gracefully', async ({ request }) => {
    const response = await request.get(`${REST_BASE_URL}/api/blocks?offset=-1`)

    // Should either return 400 or default to 0
    expect([200, 400]).toContain(response.status())
  })

  test('should handle very large limit gracefully', async ({ request }) => {
    const response = await request.get(
      `${REST_BASE_URL}/api/blocks?limit=10000`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    // Should cap the limit
    expect(data.blocks.length).toBeLessThanOrEqual(100)
  })
})
