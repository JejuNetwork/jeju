/**
 * Smoke Tests - Basic connectivity and health checks
 */

import { getNetworkName } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = 'http://localhost:8010'

test.describe('Smoke Tests', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/health`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.status).toBe('ok')
    expect(data.service).toBe('jeju-council')
    expect(data.tee).toBeDefined()
  })

  test('root endpoint returns service info', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.name).toBe(`${getNetworkName()} AI Council`)
    expect(data.endpoints).toBeDefined()
    expect(data.endpoints.a2a).toBe('/a2a')
    expect(data.endpoints.mcp).toBe('/mcp')
  })

  test('agent card is accessible', async ({ request }) => {
    const response = await request.get(
      `${AUTOCRAT_URL}/a2a/.well-known/agent-card.json`,
    )
    expect(response.ok()).toBeTruthy()

    const card = await response.json()
    expect(card.name).toBe(`${getNetworkName()} AI Council`)
    expect(card.protocolVersion).toBe('0.3.0')
    expect(card.skills).toBeDefined()
    expect(card.skills.length).toBeGreaterThan(0)
  })

  test('MCP server returns resources', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/resources/list`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.resources).toBeDefined()
    expect(data.resources.length).toBeGreaterThan(0)
  })

  test('MCP server returns tools', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/tools/list`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.tools).toBeDefined()
    expect(data.tools.length).toBeGreaterThan(0)
  })
})
