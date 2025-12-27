/**
 * Tests for the smoke test infrastructure
 */

import { describe, expect, test } from 'bun:test'
import { SMOKE_TEST_HTML, SMOKE_TEST_PORT, startSmokeTestServer } from './smoke-test-page'

describe('Smoke Test Page', () => {
  test('SMOKE_TEST_HTML contains expected elements', () => {
    expect(SMOKE_TEST_HTML).toContain('Jeju Network')
    expect(SMOKE_TEST_HTML).toContain('E2E Smoke Test')
    expect(SMOKE_TEST_HTML).toContain('data-testid="connect-wallet"')
    expect(SMOKE_TEST_HTML).toContain('Connect Wallet')
    expect(SMOKE_TEST_HTML).toContain('MetaMask')
  })

  test('SMOKE_TEST_PORT is defined', () => {
    expect(SMOKE_TEST_PORT).toBe(19999)
  })

  test('startSmokeTestServer starts and stops correctly', async () => {
    const server = await startSmokeTestServer()

    expect(server.url).toBe(`http://localhost:${SMOKE_TEST_PORT}`)
    expect(server.port).toBe(SMOKE_TEST_PORT)

    // Test health endpoint
    const healthRes = await fetch(`${server.url}/health`)
    expect(healthRes.ok).toBe(true)
    const health = await healthRes.json()
    expect(health.status).toBe('ok')

    // Test main page
    const mainRes = await fetch(server.url)
    expect(mainRes.ok).toBe(true)
    const html = await mainRes.text()
    expect(html).toContain('Jeju Network')

    // Stop server
    server.stop()
  })
})

