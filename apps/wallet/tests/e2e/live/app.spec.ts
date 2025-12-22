/**
 * Wallet App E2E Tests
 *
 * Verifies the wallet app loads correctly, renders properly,
 * and handles various viewport sizes and navigation.
 * Runs against a real dev server with localnet.
 */

import { expect, test } from '@playwright/test'
import { assertInfrastructureRunning } from '../setup'

test.describe('Wallet App', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning()
  })

  test.describe('Loading', () => {
    test('should load the wallet app with 200 status', async ({ page }) => {
      const response = await page.goto('/')

      expect(response).not.toBeNull()
      expect(response?.status()).toBe(200)
      expect(response?.headers()['content-type']).toContain('text/html')
    })

    test('should have valid HTML structure', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      await expect(page.locator('html')).toHaveCount(1)
      await expect(page.locator('body')).toHaveCount(1)
      await expect(page.locator('#root')).toBeAttached()
    })

    test('should render React app content', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const pageContent = await page.content()
      expect(pageContent.length).toBeGreaterThan(500)
    })

    test('should have correct title', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      await expect(page).toHaveTitle(/network|wallet/i)
    })
  })

  test.describe('Meta Tags', () => {
    test('should have viewport meta tag', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      const viewport = await page
        .locator('meta[name="viewport"]')
        .getAttribute('content')
      expect(viewport).toContain('width=device-width')
    })

    test('should have charset meta tag', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      await expect(page.locator('meta[charset]')).toHaveCount(1)
    })

    test('should include branding', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      const pageContent = await page.content().then((c) => c.toLowerCase())
      const hasBranding =
        pageContent.includes('network') || pageContent.includes('wallet')
      expect(hasBranding).toBe(true)
    })
  })

  test.describe('Responsive Design', () => {
    test('should render on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      const response = await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      expect(response?.ok()).toBe(true)
      await expect(page.locator('#root')).toBeAttached()
    })

    test('should render on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 })
      const response = await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      expect(response?.ok()).toBe(true)
      await expect(page.locator('#root')).toBeAttached()
    })

    test('should render on desktop viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 })
      const response = await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      expect(response?.ok()).toBe(true)
      await expect(page.locator('#root')).toBeAttached()
    })

    test('should render on extension popup size', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 600 })
      const response = await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      expect(response?.ok()).toBe(true)
      await expect(page.locator('#root')).toBeAttached()
    })
  })

  test.describe('Error Handling', () => {
    test('should handle invalid paths gracefully', async ({ page }) => {
      const response = await page.goto('/nonexistent-route-12345')

      // SPA should serve content (200) or proper 404
      expect([200, 404]).toContain(response?.status())
    })

    test('should handle network offline gracefully', async ({
      page,
      context,
    }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await context.setOffline(true)

      // App should still be loaded
      await expect(page.locator('#root')).toBeAttached()

      await context.setOffline(false)
    })
  })

  test.describe('Performance', () => {
    test('should load within 10 seconds', async ({ page }) => {
      const startTime = Date.now()
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      const loadTime = Date.now() - startTime

      expect(loadTime).toBeLessThan(10000)
    })

    test('should handle multiple reloads without issues', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      for (let i = 0; i < 5; i++) {
        await page.reload()
        await page.waitForLoadState('networkidle')
      }

      await expect(page.locator('#root')).toBeAttached()
    })
  })
})
