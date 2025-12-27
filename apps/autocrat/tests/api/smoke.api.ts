/**
 * Smoke Tests - Basic connectivity and health checks
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_API.get()}`

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
    expect(data.name).toBe('Jeju Autocrat')
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
    expect(card.name).toBeDefined()
    expect(card.protocolVersion).toBeDefined()
    expect(card.skills).toBeDefined()
    expect(card.skills.length).toBeGreaterThan(0)
  })

  test('MCP server root endpoint works', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/mcp`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.server).toBe('jeju-council')
    expect(data.version).toBeDefined()
    expect(data.resources).toBeDefined()
    expect(data.tools).toBeDefined()
  })
})
