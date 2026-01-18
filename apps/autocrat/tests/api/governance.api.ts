/**
 * Governance Tests - ERC8004 agent registry and futarchy
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_API.get()}`

test.describe('ERC-8004 Agent Registry API', () => {
  test('get total agents count', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/api/v1/agents/count`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(typeof data.count).toBe('number')
    expect(data.count).toBeGreaterThanOrEqual(0)
  })

  test('register agent returns agentId or error if not deployed', async ({
    request,
  }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/agents/register`,
      {
        data: {
          name: 'Test Board Agent',
          role: 'TREASURY',
          a2aEndpoint: `${AUTOCRAT_URL}/a2a`,
          mcpEndpoint: `${AUTOCRAT_URL}/mcp`,
        },
      },
    )

    const data = await response.json()
    if (response.ok()) {
      expect(typeof data.agentId).toBe('string')
      expect(typeof data.registered).toBe('boolean')
    } else {
      expect(response.status()).toBe(400)
      expect(data.error).toBeDefined()
      expect(data.registered).toBe(false)
    }
  })

  test('missing name returns error', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/agents/register`,
      {
        data: { role: 'TREASURY' },
      },
    )

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('name')
  })

  test('get agent by id handles not found', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/api/v1/agents/999999`)

    const data = await response.json()
    if (response.status() === 404) {
      expect(data.error).toContain('not found')
    } else {
      expect(response.ok()).toBeTruthy()
    }
  })

  test('submit feedback requires score and tag', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/agents/1/feedback`,
      {
        data: { score: 85 },
      },
    )

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('tag')
  })

  test('submit feedback returns success or error if not deployed', async ({
    request,
  }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/agents/1/feedback`,
      {
        data: {
          score: 85,
          tag: 'decision_quality',
          details: 'Made good governance decisions',
        },
      },
    )

    const data = await response.json()
    expect(typeof data.success).toBe('boolean')
    if (!data.success) {
      expect(data.error).toBeDefined()
    }
  })
})

test.describe('Futarchy API', () => {
  test('get vetoed proposals list', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/api/v1/futarchy/vetoed`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data.proposals)).toBe(true)
  })

  test('get pending futarchy proposals', async ({ request }) => {
    const response = await request.get(
      `${AUTOCRAT_URL}/api/v1/futarchy/pending`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data.proposals)).toBe(true)
  })

  test('get futarchy parameters returns data or 404 if not deployed', async ({
    request,
  }) => {
    const response = await request.get(
      `${AUTOCRAT_URL}/api/v1/futarchy/parameters`,
    )
    const data = await response.json()

    if (response.ok()) {
      expect(typeof data.votingPeriod).toBe('number')
      expect(typeof data.liquidity).toBe('string')
    } else {
      expect(response.status()).toBe(404)
      expect(data.error).toContain('not deployed')
    }
  })

  test('get market for non-existent proposal returns 404', async ({
    request,
  }) => {
    const response = await request.get(
      `${AUTOCRAT_URL}/api/v1/futarchy/market/0x${'0'.repeat(64)}`,
    )

    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data.error).toContain('No futarchy market')
  })

  test('escalate requires proposalId', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/futarchy/escalate`,
      {
        data: {},
      },
    )

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('proposalId')
  })

  test('resolve requires proposalId', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/futarchy/resolve`,
      {
        data: {},
      },
    )

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('proposalId')
  })

  test('execute requires proposalId', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/futarchy/execute`,
      {
        data: {},
      },
    )

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('proposalId')
  })
})

test.describe('Health Endpoint - Governance Features', () => {
  test('health includes ERC8004 status', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/health`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.erc8004).toBeDefined()
    expect(typeof data.erc8004.identity).toBe('boolean')
    expect(typeof data.erc8004.reputation).toBe('boolean')
    expect(typeof data.erc8004.validation).toBe('boolean')
  })

  test('health includes futarchy status', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/health`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.futarchy).toBeDefined()
    expect(typeof data.futarchy.board).toBe('boolean')
    expect(typeof data.futarchy.predictionMarket).toBe('boolean')
  })

  test('health includes all endpoint groups', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/health`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.endpoints).toBeDefined()
    expect(data.endpoints.agents).toBe('/api/v1/agents')
    expect(data.endpoints.futarchy).toBe('/api/v1/futarchy')
    expect(data.endpoints.moderation).toBe('/api/v1/moderation')
  })
})
