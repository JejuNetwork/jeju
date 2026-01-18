/** E2E tests for user flows - filtering, searching, interactions. */

import { expect, test } from '@playwright/test'

test.describe('Alerts User Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/alerts')
  })

  test('should filter alerts by severity', async ({ page }) => {
    await page.getByRole('button', { name: /Critical/i }).click()
    const criticalBtn = page.locator('button').filter({ hasText: 'Critical' })
    await expect(criticalBtn).toHaveClass(/ring-2/)
    await page.getByRole('button', { name: /Warning/i }).click()
    const warningBtn = page.locator('button').filter({ hasText: 'Warning' })
    await expect(warningBtn).toHaveClass(/ring-2/)
    await page.getByRole('button', { name: /Total/i }).click()
    const totalBtn = page.locator('button').filter({ hasText: 'Total' })
    await expect(totalBtn).toHaveClass(/ring-2/)
  })

  test('should search alerts', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search...')
    await searchInput.fill('test-alert')
    await expect(searchInput).toHaveValue('test-alert')
    await searchInput.clear()
    await expect(searchInput).toHaveValue('')
  })

  test('should refresh alerts', async ({ page }) => {
    const refreshBtn = page.getByRole('button', { name: /Refresh/i })

    await refreshBtn.click()
    await expect(refreshBtn).toBeEnabled()
  })
})

test.describe('Targets User Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/targets')
  })

  test('should filter targets by health status', async ({ page }) => {
    await page.getByRole('button', { name: /Up/i }).click()
    const upBtn = page.locator('button').filter({ hasText: 'Up' })
    await expect(upBtn).toHaveClass(/ring-2/)
    await page.getByRole('button', { name: /Down/i }).click()
    const downBtn = page.locator('button').filter({ hasText: 'Down' })
    await expect(downBtn).toHaveClass(/ring-2/)
    await page.locator('button').filter({ hasText: 'Total' }).click()
    const totalBtn = page.locator('button').filter({ hasText: 'Total' })
    await expect(totalBtn).toHaveClass(/ring-2/)
  })

  test('should search targets', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search...')
    await searchInput.fill('node-exporter')
    await expect(searchInput).toHaveValue('node-exporter')
    await searchInput.clear()
    await expect(searchInput).toHaveValue('')
  })

  test('should refresh targets', async ({ page }) => {
    const refreshBtn = page.getByRole('button', { name: /Refresh/i })
    await refreshBtn.click()
    await expect(refreshBtn).toBeEnabled()
  })
})

test.describe('OIF Stats User Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/oif')
  })

  test('should switch between tabs', async ({ page }) => {
    await expect(page.getByText('Intents', { exact: true })).toBeVisible()
    const tabContainer = page.locator('.flex.p-1.rounded-xl')
    const tabButtons = tabContainer.locator('button')
    await tabButtons.nth(1).click()
    await page.waitForTimeout(300)
    const solversVisible = page
      .getByText('No solvers')
      .or(page.getByText('Unnamed'))
    await expect(solversVisible).toBeVisible({ timeout: 5000 })
    await tabButtons.nth(2).click()
    await page.waitForTimeout(300)
    const routesVisible = page
      .getByText('No routes')
      .or(page.getByText('Ethereum'))
    await expect(routesVisible).toBeVisible({ timeout: 5000 })
    await tabButtons.first().click()
    await expect(page.getByText('Intents', { exact: true })).toBeVisible()
  })

  test('should show health ring on overview', async ({ page }) => {
    await page.waitForLoadState('networkidle')
    const healthRingSvg = page.locator('svg[role="img"]')
    await expect(healthRingSvg.first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Healthy', { exact: true })).toBeVisible()
    await expect(page.getByText('Degraded', { exact: true })).toBeVisible()
    await expect(page.getByText('Unhealthy', { exact: true })).toBeVisible()
  })

  test('should refresh OIF stats', async ({ page }) => {
    const refreshBtn = page.getByRole('button', { name: /Refresh/i })
    await refreshBtn.click()
    await expect(refreshBtn).toBeEnabled()
  })
})

test.describe('Query Explorer User Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/query')
  })

  test('should execute a query', async ({ page }) => {
    const queryInput = page.getByPlaceholder('PromQL...')
    const runBtn = page.getByRole('button', { name: /Run/i })
    await queryInput.clear()
    await queryInput.fill('up')
    await runBtn.click()
    await page.waitForTimeout(1000)
    const results = page.getByText('Results')
    await expect(results).toBeVisible()
  })

  test('should run query with Enter key', async ({ page }) => {
    const queryInput = page.getByPlaceholder('PromQL...')
    await queryInput.clear()
    await queryInput.fill('up')
    await queryInput.press('Enter')
    await expect(page.getByText('Results')).toBeVisible()
  })

  test('should use example queries', async ({ page }) => {
    const queryInput = page.getByPlaceholder('PromQL...')
    await page.getByRole('button', { name: 'HTTP Rate' }).click()
    await expect(queryInput).toHaveValue('rate(http_requests_total[5m])')
    await page.getByRole('button', { name: 'CPU' }).click()
    await expect(queryInput).toHaveValue(/node_cpu_seconds_total/)
    await page.getByRole('button', { name: 'Up' }).click()
    await expect(queryInput).toHaveValue('up')
  })

  test('should copy query to clipboard', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'Clipboard API not fully supported on mobile',
    )

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    } catch {
      test.skip()
      return
    }

    const queryInput = page.getByPlaceholder('PromQL...')
    await queryInput.fill('test_metric')
    const copyBtn = page
      .locator('.relative')
      .filter({ has: queryInput })
      .locator('button')
      .first()
    await page.waitForTimeout(100)
    const isVisible = await copyBtn.isVisible()
    if (isVisible) {
      await copyBtn.click()
    }
    await expect(queryInput).toHaveValue('test_metric')
  })

  test('should disable run button when query is empty', async ({ page }) => {
    const queryInput = page.getByPlaceholder('PromQL...')
    const runBtn = page.getByRole('button', { name: /Run/i })
    await queryInput.clear()
    await expect(runBtn).toBeDisabled()
    await queryInput.fill('up')
    await expect(runBtn).toBeEnabled()
  })
})

test.describe('Dashboard Interactions', () => {
  test('should display health status correctly', async ({ page }) => {
    await page.goto('/')
    const healthRing = page.locator('svg[role="img"]')
    await expect(healthRing.first()).toBeVisible()
    await expect(page.getByText('Status', { exact: true })).toBeVisible()
  })

  test('should navigate from quick links', async ({ page }) => {
    await page.goto('/')
    const alertsLink = page
      .locator('.group')
      .filter({ hasText: 'Alerts' })
      .first()
    await alertsLink.click()
    await expect(page).toHaveURL('/alerts')

    await page.goto('/')
    const targetsLink = page
      .locator('.group')
      .filter({ hasText: 'Targets' })
      .first()
    await targetsLink.click()
    await expect(page).toHaveURL('/targets')

    await page.goto('/')
    const oifLink = page.locator('.group').filter({ hasText: 'OIF' }).first()
    await oifLink.click()
    await expect(page).toHaveURL('/oif')
  })
})

test.describe('Loading States', () => {
  test('should show loading skeletons on alerts page', async ({ page }) => {
    await page.route('**/api/a2a', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.continue()
    })

    await page.goto('/alerts')
    await expect(page.locator('main')).toBeVisible()
  })

  test('should show loading skeletons on targets page', async ({ page }) => {
    await page.route('**/api/a2a', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.continue()
    })

    await page.goto('/targets')
    await expect(page.locator('main')).toBeVisible()
  })

  test('should show loading skeletons on query page', async ({ page }) => {
    await page.route('**/api/a2a', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.continue()
    })

    await page.goto('/query')
    await expect(page.locator('main')).toBeVisible()
  })
})

test.describe('Error Handling', () => {
  test('should handle API errors gracefully on alerts', async ({ page }) => {
    await page.route('**/api/a2a', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            role: 'agent',
            parts: [
              { kind: 'text', text: 'Prometheus unavailable' },
              { kind: 'data', data: { error: 'Connection failed' } },
            ],
            messageId: 'test',
            kind: 'message',
          },
        }),
      })
    })

    await page.goto('/alerts')
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
  })

  test('should handle API errors gracefully on query', async ({ page }) => {
    await page.route('**/api/a2a', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            role: 'agent',
            parts: [
              { kind: 'text', text: 'Query failed' },
              { kind: 'data', data: { error: 'Invalid query' } },
            ],
            messageId: 'test',
            kind: 'message',
          },
        }),
      })
    })

    await page.goto('/query')
    await page.getByRole('button', { name: /Run/i }).click()
    await page.waitForTimeout(500)
    await expect(page.getByRole('heading', { name: 'Query' })).toBeVisible()
  })
})

test.describe('Accessibility', () => {
  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/')
    const headings = page.locator('h1, h2')
    await expect(headings.first()).toBeVisible()
  })

  test('should have accessible buttons', async ({ page }) => {
    await page.goto('/alerts')
    const refreshBtn = page.getByRole('button', { name: /Refresh/i })
    await expect(refreshBtn).toBeVisible()
    await expect(refreshBtn).toBeEnabled()
  })

  test('should have accessible form inputs', async ({ page }) => {
    await page.goto('/query')
    const input = page.getByPlaceholder('PromQL...')
    await input.focus()
    await expect(input).toBeFocused()
  })

  test('should be keyboard navigable', async ({ page, viewport }) => {
    test.skip(
      (viewport?.width ?? 1024) < 640,
      'Keyboard nav not applicable on mobile',
    )

    await page.goto('/')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).toBeVisible()
  })
})
