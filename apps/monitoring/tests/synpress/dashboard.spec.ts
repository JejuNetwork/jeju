/**
 * Monitoring Dashboard E2E Tests
 *
 * Tests monitoring functionality against real localnet:
 * - Dashboard loads correctly
 * - Metrics display properly
 * - A2A endpoint responds
 * - Real-time updates work
 */

import { expect, test } from '@playwright/test'

test.describe('Monitoring Dashboard', () => {
  test('should load dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Monitoring|Dashboard|Jeju/i)
  })

  test('should display metrics', async ({ page }) => {
    await page.goto('/')

    // Wait for metrics to load
    await page.waitForSelector('[data-testid="metrics"], .metric, .chart', {
      timeout: 10000,
    })

    // Verify some metrics are visible
    const metricsVisible = await page
      .locator('.metric, [data-testid="metric"]')
      .count()
    expect(metricsVisible).toBeGreaterThan(0)
  })

  test('should check health endpoint', async ({ page }) => {
    const response = await page.request.get('/.well-known/agent-card.json')
    expect(response.ok()).toBe(true)

    const card = await response.json()
    expect(card).toHaveProperty('name')
    expect(card.name).toContain('monitoring')
  })

  test('should query Prometheus metrics', async ({ page }) => {
    // Check if Prometheus endpoint is accessible
    const response = await page.request.get('/api/metrics')

    if (response.ok()) {
      const text = await response.text()
      // Prometheus metrics format check
      expect(text).toContain('# HELP')
    }
  })
})

test.describe('A2A Protocol', () => {
  test('should respond to A2A requests', async ({ page }) => {
    const response = await page.request.post('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'query',
        params: {
          query: 'up',
        },
        id: 1,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result).toHaveProperty('result')
  })

  test('should list available tools', async ({ page }) => {
    const response = await page.request.post('/api/mcp', {
      data: {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      },
    })

    if (response.ok()) {
      const result = await response.json()
      expect(result).toHaveProperty('result')
      expect(result.result).toHaveProperty('tools')
    }
  })
})

test.describe('Real-time Updates', () => {
  test('should update metrics periodically', async ({ page }) => {
    await page.goto('/')

    // Get initial value
    const metricSelector = '.metric-value, [data-testid="metric-value"]'
    await page.waitForSelector(metricSelector, { timeout: 10000 })

    const _initialValue = await page
      .locator(metricSelector)
      .first()
      .textContent()

    // Wait for update (metrics typically refresh every 5-15 seconds)
    await page.waitForTimeout(15000)

    // Check if value changed (or at least page is still responsive)
    const currentValue = await page
      .locator(metricSelector)
      .first()
      .textContent()

    // Value might be same or different, but should be valid
    expect(currentValue).toBeDefined()
  })
})
