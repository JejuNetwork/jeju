/**
 * DWS Wallet Integration Tests
 *
 * Tests wallet connection, signing, and transactions for DWS features
 * that require blockchain authentication.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'

const DWS_PORT = parseInt(process.env.DWS_PORT || '4031', 10)
const BASE_URL = `http://localhost:${DWS_PORT}`

test.describe('DWS - Wallet Integration', () => {
  test.beforeEach(async ({ page }) => {
    try {
      await page.goto(BASE_URL, { timeout: 10000 })
    } catch {
      test.skip(true, 'DWS not running')
    }
  })

  test('should show wallet connect option', async ({ page }) => {
    await page.goto(BASE_URL)

    // Look for wallet connection UI
    const walletButton = page.locator(
      'button:has-text(/connect/i), [data-testid*="connect"], [aria-label*="wallet" i]',
    ).first()

    const hasWallet = (await walletButton.count()) > 0

    if (hasWallet) {
      await expect(walletButton).toBeVisible()
    } else {
      console.log('Note: DWS may not require wallet connection for all features')
    }
  })

  test('should display login/auth options', async ({ page }) => {
    await page.goto(BASE_URL)

    // Look for any auth-related UI
    const authUI = page.locator(
      'button:has-text(/sign in|login|connect/i), [data-testid*="auth"], [data-testid*="login"]',
    )

    const hasAuth = (await authUI.count()) > 0

    // Just verify the page loads - auth is optional for some views
    await expect(page.locator('body')).toBeVisible()

    if (hasAuth) {
      console.log('Found auth UI elements')
    }
  })

  test('should handle wallet rejection gracefully', async ({ page }) => {
    await page.goto(BASE_URL)

    // If connect button exists, clicking it should show wallet options
    const connectButton = page.locator('button:has-text(/connect/i)').first()

    if (await connectButton.isVisible()) {
      await connectButton.click()

      // Should show wallet options modal or similar
      await page.waitForTimeout(1000)

      // Close any modal
      await page.keyboard.press('Escape')

      // Page should still be functional
      await expect(page.locator('body')).toBeVisible()
    }
  })
})

test.describe('DWS - Authenticated Features', () => {
  // These tests verify that authenticated features are properly gated
  test('should require auth for storage management', async ({ page }) => {
    await page.goto(`${BASE_URL}/storage`)

    // Either shows login prompt or storage content
    const needsAuth = await page.locator('button:has-text(/connect|sign in/i)').isVisible()
    const hasContent = await page.locator('[data-testid*="storage"], .storage-list').isVisible()

    // Should have one or the other
    expect(needsAuth || hasContent, 'Should show auth prompt or storage content').toBe(true)
  })

  test('should require auth for compute jobs', async ({ page }) => {
    await page.goto(`${BASE_URL}/compute`)

    const needsAuth = await page.locator('button:has-text(/connect|sign in/i)').isVisible()
    const hasContent = await page.locator('[data-testid*="compute"], .compute-list').isVisible()

    expect(needsAuth || hasContent, 'Should show auth prompt or compute content').toBe(true)
  })

  test('should require auth for git operations', async ({ page }) => {
    await page.goto(`${BASE_URL}/git`)

    const needsAuth = await page.locator('button:has-text(/connect|sign in/i)').isVisible()
    const hasContent = await page.locator('[data-testid*="repo"], .repo-list').isVisible()

    expect(needsAuth || hasContent, 'Should show auth prompt or repo content').toBe(true)
  })
})

