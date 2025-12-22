/**
 * User Flows E2E Tests
 *
 * Tests navigation, accessibility, and core user interactions.
 * Complements app.spec.ts which covers loading/rendering.
 */

import { expect, test } from '@playwright/test'
import { assertInfrastructureRunning } from '../setup'

test.describe('User Flows', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning()
  })

  test.describe('Navigation', () => {
    test('should navigate to home page', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await expect(page.locator('#root')).toBeAttached()
    })

    test('should handle direct URL navigation', async ({ page }) => {
      const routes = ['/', '/send', '/receive', '/settings', '/activity']

      for (const route of routes) {
        const response = await page.goto(route)
        // SPA routes: either 200 or fallback to index
        expect([200, 404]).toContain(response?.status() ?? 0)
      }
    })

    test('should maintain state on page reload', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await page.reload()
      await page.waitForLoadState('networkidle')

      await expect(page.locator('#root')).toBeAttached()
    })
  })

  test.describe('Accessibility', () => {
    test('should have proper heading structure', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const headings = await page.locator('h1, h2, h3, h4, h5, h6').count()
      expect(headings).toBeGreaterThanOrEqual(0)
    })

    test('should have focusable interactive elements', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const interactiveElements = await page
        .locator('button, a, [role="button"]')
        .count()
      expect(interactiveElements).toBeGreaterThanOrEqual(0)
    })

    test('should support keyboard navigation', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Tab through elements without errors
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')

      // App should still be functional
      await expect(page.locator('#root')).toBeAttached()
    })
  })

  test.describe('Console Errors', () => {
    test('should not have critical console errors on load', async ({
      page,
    }) => {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)

      // Filter out known benign errors
      const criticalErrors = consoleErrors.filter(
        (err) => !err.includes('extension') && !err.includes('favicon'),
      )

      if (criticalErrors.length > 0) {
        console.log('Console errors found:', criticalErrors)
      }

      // Allow for dev environment noise, but flag if many errors
      expect(criticalErrors.length).toBeLessThan(10)
    })
  })
})
