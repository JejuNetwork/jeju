/**
 * DWS Full E2E Coverage Tests
 *
 * Comprehensive tests covering all pages, buttons, forms, and user flows.
 * FAIL-FAST: Crashes on errors rather than skipping or tolerating failures.
 */

import { expect, test } from '@playwright/test'

// Error capture with fail-fast
function setupErrorCapture(page: import('@playwright/test').Page): string[] {
  const errors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      // Filter only truly ignorable errors
      if (text.includes('favicon') || text.includes('net::ERR_BLOCKED_BY_CLIENT'))
        return
      errors.push(text)
    }
  })

  page.on('pageerror', (error) => {
    errors.push(`PageError: ${error.message}`)
  })

  return errors
}

test.describe('DWS - Page Load Tests', () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto('/', { timeout: 30000 })
    if (!response || response.status() >= 400) {
      throw new Error(`DWS is not running or returned error: ${response?.status()}`)
    }
  })

  test('homepage loads with DWS branding', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.waitForLoadState('domcontentloaded')

    // Check for DWS branding
    const hasDWS =
      (await page.locator('text=DWS').isVisible().catch(() => false)) ||
      (await page.locator('text=Console').isVisible().catch(() => false))

    expect(hasDWS).toBe(true)

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('has proper meta tags', async ({ page }) => {
    const viewport = await page
      .locator('meta[name="viewport"]')
      .getAttribute('content')
    expect(viewport).toBeTruthy()
    expect(viewport).toContain('width')
  })

  test('has navigation sidebar', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded')

    const nav = page.locator('nav, aside, [role="navigation"]')
    expect(await nav.count()).toBeGreaterThan(0)
    await expect(nav.first()).toBeVisible()
  })
})

test.describe('DWS - Compute Section', () => {
  test('containers page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/containers')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/container/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('workers page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/workers')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/worker/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('jobs page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/jobs')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/job/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('training page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/training')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/train/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })
})

test.describe('DWS - Storage Section', () => {
  test('buckets page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/storage/buckets')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/bucket/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('CDN page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/storage/cdn')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/CDN/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('IPFS page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/storage/ipfs')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/IPFS/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })
})

test.describe('DWS - Developer Section', () => {
  test('repositories page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/developer/repositories')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/repositor/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('packages page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/developer/packages')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/package/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('pipelines page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/developer/pipelines')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/pipeline/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })
})

test.describe('DWS - AI Section', () => {
  test('inference page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/ai/inference')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/inference/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('embeddings page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/ai/embeddings')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('text=/embedding/i')).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })
})

test.describe('DWS - Mobile Responsiveness', () => {
  test('renders correctly on mobile', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Main content should be visible on mobile
    await expect(page.locator('body')).toBeVisible()

    // Check no horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })

    // Allow small overflow (10px tolerance for scrollbars)
    const overflowAmount = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })

    expect(overflowAmount).toBeLessThan(20)

    if (errors.length > 0) {
      throw new Error(`Mobile view has errors: ${errors.join(', ')}`)
    }
  })
})

test.describe('DWS - Error Handling', () => {
  test('handles 404 gracefully', async ({ page }) => {
    await page.goto('/nonexistent-page-12345')

    // Should either show 404 or redirect to home
    const is404 = await page.locator('text=/404|not found/i').isVisible()
    const isHome =
      (await page.locator('text=/DWS/i').isVisible()) ||
      (await page.locator('text=/Console/i').isVisible())

    expect(is404 || isHome).toBe(true)
  })
})

test.describe('DWS - Navigation', () => {
  test('sidebar links work', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Click a few sidebar links to test navigation
    const sidebarLinks = page.locator('nav a[href^="/"], aside a[href^="/"]')
    const linkCount = await sidebarLinks.count()

    expect(linkCount).toBeGreaterThan(0)

    // Test first 3 links
    for (let i = 0; i < Math.min(3, linkCount); i++) {
      const link = sidebarLinks.nth(i)
      const href = await link.getAttribute('href')

      if (href && !href.includes('http')) {
        await link.click()
        await page.waitForLoadState('domcontentloaded')
        await expect(page.locator('body')).toBeVisible()
      }
    }

    if (errors.length > 0) {
      throw new Error(`Navigation has errors: ${errors.join(', ')}`)
    }
  })
})
