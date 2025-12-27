/**
 * Otto Health & Status Tests
 * Tests health, status, chains, and info endpoints
 */

import { expect, test } from '@playwright/test'

test.describe('Health Endpoint', () => {
  test('returns healthy status', async ({ request }) => {
    const response = await request.get('/health')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.status).toBe('healthy')
    expect(data.agent).toBe('otto')
    expect(data.version).toBeDefined()
    expect(data.runtime).toBe('elizaos')
  })
})

test.describe('Status Endpoint', () => {
  test('returns platform info', async ({ request }) => {
    const response = await request.get('/status')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.name).toBe('Otto Trading Agent')
    expect(data.version).toBeDefined()
    expect(data.runtime).toBe('elizaos')
    expect(data.platforms).toBeDefined()
    expect(data.platforms.discord).toBeDefined()
    expect(data.platforms.telegram).toBeDefined()
    expect(data.chains).toBeInstanceOf(Array)
  })
})

test.describe('Chains Endpoint', () => {
  test('returns supported chains', async ({ request }) => {
    const response = await request.get('/api/chains')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.chains).toBeInstanceOf(Array)
    expect(data.chains.length).toBeGreaterThan(0)
    expect(data.chains).toContain(420691) // Jeju
    expect(data.defaultChainId).toBeDefined()
  })
})

test.describe('Info Endpoint', () => {
  test('returns agent info', async ({ request }) => {
    const response = await request.get('/api/info')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.name).toBe('Otto')
    expect(data.description).toBeDefined()
    expect(data.platforms).toContain('discord')
    expect(data.platforms).toContain('telegram')
    expect(data.platforms).toContain('web')
    expect(data.features).toContain('swap')
    expect(data.features).toContain('bridge')
    expect(data.miniapps).toBeDefined()
    expect(data.miniapps.web).toBeDefined()
    expect(data.miniapps.telegram).toBeDefined()
    expect(data.frame).toBeDefined()
  })
})
