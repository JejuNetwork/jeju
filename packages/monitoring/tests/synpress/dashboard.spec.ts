/**
 * Monitoring Dashboard E2E Tests
 *
 * Tests monitoring functionality against real localnet:
 * - Dashboard loads correctly
 * - Health indicators display properly
 * - A2A endpoint responds
 * - Real-time updates work
 */

import { expect, test } from '@playwright/test'

test.describe('Monitoring Dashboard', () => {
  test('should load dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Monitoring|Network/i)
  })

  test('should display health ring', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const healthRing = page.locator('svg[role="img"]').first()
    await expect(healthRing).toBeVisible({ timeout: 10000 })
  })

  test('should display stat cards', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Targets', { exact: true })).toBeVisible()
    await expect(page.getByText('Alerts', { exact: true })).toBeVisible()
  })

  test('should display quick link cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main a[href="/alerts"]').first()).toBeVisible()
    await expect(page.locator('main a[href="/targets"]').first()).toBeVisible()
    await expect(page.locator('main a[href="/oif"]').first()).toBeVisible()
  })

  test('should check agent card endpoint', async ({ page }) => {
    const response = await page.request.get('/.well-known/agent-card.json')
    expect(response.ok()).toBe(true)

    const card = await response.json()
    expect(card).toHaveProperty('name')
    expect(card).toHaveProperty('skills')
    expect(Array.isArray(card.skills)).toBe(true)
  })
})

test.describe('A2A Protocol', () => {
  test('should respond to A2A message/send requests', async ({ page }) => {
    const response = await page.request.post('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-1',
            parts: [{ kind: 'data', data: { skillId: 'get-alerts' } }],
          },
        },
        id: 1,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result).toHaveProperty('jsonrpc', '2.0')
    expect(result).toHaveProperty('result')
  })

  test('should handle query-metrics skill', async ({ page }) => {
    const response = await page.request.post('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-2',
            parts: [
              { kind: 'data', data: { skillId: 'query-metrics', query: 'up' } },
            ],
          },
        },
        id: 2,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result.jsonrpc).toBe('2.0')
  })
})

test.describe('Navigation', () => {
  test('should navigate to alerts page', async ({ page }) => {
    await page.goto('/')
    await page.locator('main a[href="/alerts"]').first().click()
    await expect(page).toHaveURL('/alerts')
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
  })

  test('should navigate to targets page', async ({ page }) => {
    await page.goto('/')
    await page.locator('main a[href="/targets"]').first().click()
    await expect(page).toHaveURL('/targets')
    await expect(page.getByRole('heading', { name: 'Targets' })).toBeVisible()
  })

  test('should navigate to OIF page', async ({ page }) => {
    await page.goto('/')
    await page.locator('main a[href="/oif"]').first().click()
    await expect(page).toHaveURL('/oif')
    await expect(page.getByRole('heading', { name: 'OIF' })).toBeVisible()
  })

  test('should navigate to query page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Query' }).first().click()
    await expect(page).toHaveURL('/query')
    await expect(page.getByRole('heading', { name: 'Query' })).toBeVisible()
  })
})

test.describe('Real-time Updates', () => {
  test('should refresh alerts when clicking refresh button', async ({
    page,
  }) => {
    await page.goto('/alerts')
    const refreshBtn = page.getByRole('button', { name: /Refresh/i })
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()
    await expect(refreshBtn).toBeEnabled()
  })

  test('should refresh targets when clicking refresh button', async ({
    page,
  }) => {
    await page.goto('/targets')
    const refreshBtn = page.getByRole('button', { name: /Refresh/i })
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()
    await expect(refreshBtn).toBeEnabled()
  })
})
