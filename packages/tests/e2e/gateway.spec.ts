/**
 * Gateway E2E Tests
 *
 * Tests the Gateway portal web application.
 * Requires: Gateway running on port 4001
 */

import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { expect, test } from '@playwright/test'

const GATEWAY_URL = process.env.GATEWAY_URL || getCoreAppUrl('GATEWAY')

test.describe('Gateway Portal', () => {
  test.beforeEach(async ({ page: _page }) => {
    // Check if gateway is running
    try {
      const response = await fetch(GATEWAY_URL, {
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) {
        test.skip()
      }
    } catch {
      test.skip()
    }
  })

  test('should load homepage', async ({ page }) => {
    await page.goto(GATEWAY_URL)
    await expect(page).toHaveTitle(/Jeju|Gateway/i)
  })

  test('should show navigation', async ({ page }) => {
    await page.goto(GATEWAY_URL)

    // Check for main navigation elements
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()
  })

  test('should have connect wallet button', async ({ page }) => {
    await page.goto(GATEWAY_URL)

    // Look for connect button
    const connectButton = page.locator(
      'button:has-text("Connect"), [data-testid="connect-wallet"]',
    )
    await expect(connectButton).toBeVisible()
  })

  test('should navigate to apps page', async ({ page }) => {
    await page.goto(GATEWAY_URL)

    // Click apps link if exists
    const appsLink = page.locator('a:has-text("Apps"), a[href*="apps"]')
    if (await appsLink.isVisible()) {
      await appsLink.click()
      await expect(page.url()).toContain('apps')
    }
  })
})
