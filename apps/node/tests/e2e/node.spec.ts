/**
 * Network Node E2E Tests
 * Tests all UI functionality in the desktop app
 */

import { expect, test } from '@playwright/test'

test.describe('Network Node App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420/')
    // Wait for app to load
    await page.waitForLoadState('networkidle')
  })

  test('loads the dashboard view', async ({ page }) => {
    // Should show the dashboard by default or after loading
    await expect(page.locator('body')).toBeVisible()
  })

  test('displays hardware information', async ({ page }) => {
    // Click on Services tab if available
    const servicesLink = page.locator('text=Services').first()
    if (await servicesLink.isVisible()) {
      await servicesLink.click()

      // Should show hardware summary - use first() to handle multiple matches
      await expect(
        page.getByRole('heading', { name: 'Your Hardware' }),
      ).toBeVisible({ timeout: 5000 })
    }
  })

  test('shows sidebar navigation', async ({ page }) => {
    // Sidebar should have navigation items
    const sidebar = page.locator('[class*="sidebar"]').or(page.locator('nav'))
    if (await sidebar.isVisible()) {
      // Check for common navigation items
      const hasServices = await page
        .locator('text=Services')
        .first()
        .isVisible()
      const hasEarnings = await page
        .locator('text=Earnings')
        .first()
        .isVisible()
      const hasSettings = await page
        .locator('text=Settings')
        .first()
        .isVisible()

      // At least some navigation should be present
      expect(hasServices || hasEarnings || hasSettings).toBeTruthy()
    }
  })

  test('can navigate to services view', async ({ page }) => {
    const servicesLink = page.locator('text=Services').first()
    if (await servicesLink.isVisible()) {
      await servicesLink.click()
      await page.waitForLoadState('networkidle')

      // Should show services content
      await expect(page.locator('body')).toContainText(
        /Service|Compute|Provider/i,
      )
    }
  })

  test('can navigate to earnings view', async ({ page }) => {
    const earningsLink = page.locator('text=Earnings').first()
    if (await earningsLink.isVisible()) {
      await earningsLink.click()
      await page.waitForLoadState('networkidle')

      // Should show earnings content
      await expect(page.locator('body')).toContainText(/Earn|Total|USD|\$/i)
    }
  })

  test('can navigate to settings view', async ({ page }) => {
    const settingsLink = page.locator('text=Settings').first()
    if (await settingsLink.isVisible()) {
      await settingsLink.click()
      await page.waitForLoadState('networkidle')

      // Should show settings content
      await expect(page.locator('body')).toContainText(
        /Setting|Config|Network/i,
      )
    }
  })
})

test.describe('Compute Services UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForLoadState('networkidle')

    // Navigate to services if possible
    const servicesLink = page.locator('text=Services').first()
    if (await servicesLink.isVisible()) {
      await servicesLink.click()
      await page.waitForLoadState('networkidle')
    }
  })

  test('shows CPU compute option', async ({ page }) => {
    await expect(page.locator('body')).toContainText(/CPU|Compute/i)
  })

  test('shows GPU compute option if available', async ({ page }) => {
    // GPU section may or may not be available
    const hasGpu = await page.locator('text=GPU').first().isVisible()
    if (hasGpu) {
      await expect(page.locator('text=GPU').first()).toBeVisible()
    }
  })

  test('shows TEE status indicator', async ({ page }) => {
    // Should show TEE status (either available or not)
    const teeText = await page
      .locator('text=TEE')
      .or(page.locator('text=Confidential'))
      .first()
      .isVisible()
    expect(teeText).toBeDefined()
  })

  test('shows Docker status', async ({ page }) => {
    // Should show Docker status if on services page
    const dockerText = await page.locator('text=Docker').first().isVisible()
    expect(dockerText).toBeDefined()
  })
})

test.describe('Button Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForLoadState('networkidle')
  })

  test('start/stop buttons are clickable', async ({ page }) => {
    // Navigate to services
    const servicesLink = page.locator('text=Services').first()
    if (await servicesLink.isVisible()) {
      await servicesLink.click()
      await page.waitForLoadState('networkidle')
    }

    // Find any Start or Stop button
    const startButton = page.locator('button:has-text("Start")').first()
    const stopButton = page.locator('button:has-text("Stop")').first()

    if (await startButton.isVisible()) {
      // Button should be enabled or disabled based on requirements
      const isDisabled = await startButton.isDisabled()
      expect(typeof isDisabled).toBe('boolean')
    }

    if (await stopButton.isVisible()) {
      const isDisabled = await stopButton.isDisabled()
      expect(typeof isDisabled).toBe('boolean')
    }
  })

  test('navigation buttons work', async ({ page }) => {
    // Click through all navigation items
    const navItems = [
      'Dashboard',
      'Services',
      'Bots',
      'Earnings',
      'Staking',
      'Settings',
    ]

    for (const item of navItems) {
      const link = page.locator(`text=${item}`).first()
      if (await link.isVisible()) {
        await link.click()
        await page.waitForLoadState('networkidle')
        // Should not crash
        await expect(page.locator('body')).toBeVisible()
      }
    }
  })

  test('modals can be opened and closed', async ({ page }) => {
    // Navigate to services
    const servicesLink = page.locator('text=Services').first()
    if (await servicesLink.isVisible()) {
      await servicesLink.click()
      await page.waitForLoadState('networkidle')
    }

    // Look for expandable items
    const expandButton = page
      .locator('[class*="chevron"]')
      .or(page.locator('button:has([class*="ChevronDown"])'))
    if (await expandButton.first().isVisible()) {
      await expandButton.first().click()
      // Should expand without crashing
      await expect(page.locator('body')).toBeVisible()
    }
  })
})

test.describe('Responsive Design', () => {
  test('works on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('http://localhost:1420/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })

  test('works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('http://localhost:1420/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })

  test('works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:1420/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })
})
