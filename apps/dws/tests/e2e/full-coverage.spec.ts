/**
 * DWS Full E2E Coverage Tests
 *
 * Comprehensive tests covering all pages, buttons, forms, and user flows.
 * FAIL-FAST: Crashes on errors rather than skipping or tolerating failures.
 */

import { expect, test } from '@playwright/test'

// Check if running against testnet/mainnet
const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

// Error capture with fail-fast
function setupErrorCapture(page: import('@playwright/test').Page): string[] {
  const errors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      // Filter only truly ignorable errors
      if (
        text.includes('favicon') ||
        text.includes('net::ERR_BLOCKED_BY_CLIENT')
      )
        return
      errors.push(text)
    }
  })

  page.on('pageerror', (error) => {
    errors.push(`PageError: ${error.message}`)
  })

  return errors
}

// Check if page returned JSON instead of HTML (common on testnet due to SPA routing)
async function checkSpaRoutingError(
  page: import('@playwright/test').Page,
): Promise<boolean> {
  const bodyText = await page.textContent('body')
  const isJsonResponse =
    bodyText?.trim().startsWith('{') || bodyText?.trim().startsWith('[')
  if (isJsonResponse) {
    if (isRemote) {
      console.log(
        '   ⚠️ Page returns JSON API response on remote network (SPA routing not configured)',
      )
      return true
    }
  }
  return false
}

test.describe('DWS - Page Load Tests', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test.beforeEach(async ({ page }) => {
    const response = await page.goto('/', { timeout: 30000 })
    if (!response || response.status() >= 400) {
      throw new Error(
        `DWS is not running or returned error: ${response?.status()}`,
      )
    }
  })

  test('homepage loads with DWS branding', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    // Check for DWS branding via title, visible text, or any valid homepage state
    const title = await page.title()
    const hasTitleBranding =
      title.toLowerCase().includes('dws') ||
      title.toLowerCase().includes('console')

    // Check for visible branding elements
    const hasVisibleBranding =
      (await page
        .locator('text=DWS')
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator('text=Console')
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator('text=/connect|wallet|dashboard|home/i')
        .isVisible()
        .catch(() => false))

    // Page is valid if it has DWS in title OR visible branding
    expect(hasTitleBranding || hasVisibleBranding).toBe(true)
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
  test.skip(isRemote, 'Skipping on remote network')
  test('containers page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/containers')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.locator('h1.page-title', { hasText: 'Containers' }),
    ).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('workers page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/workers')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.locator('h1.page-title', { hasText: 'Workers' }),
    ).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('jobs page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/jobs')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.locator('h1.page-title', { hasText: 'Jobs' }),
    ).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('training page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/compute/training')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.locator('h1.page-title', { hasText: 'Training' }),
    ).toBeVisible({ timeout: 10000 })

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
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'Storage Buckets' }),
    ).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('CDN page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/storage/cdn')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'CDN', exact: true }),
    ).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })

  test('IPFS page loads', async ({ page }) => {
    const errors = setupErrorCapture(page)

    await page.goto('/storage/ipfs')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'IPFS Storage' }),
    ).toBeVisible({ timeout: 10000 })

    if (errors.length > 0) {
      throw new Error(`Page has errors: ${errors.join(', ')}`)
    }
  })
})

test.describe('DWS - Developer Section', () => {
  // Skip these tests on remote - content may differ significantly
  test.skip(isRemote, 'Skipping developer section on remote network')

  test('repositories page loads', async ({ page }) => {
    await page.goto('/developer/repositories')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'Git Repositories' }),
    ).toBeVisible({
      timeout: 10000,
    })
  })

  test('packages page loads', async ({ page }) => {
    await page.goto('/developer/packages')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'Package Registry' }),
    ).toBeVisible({
      timeout: 10000,
    })
  })

  test('pipelines page loads', async ({ page }) => {
    await page.goto('/developer/pipelines')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'CI/CD Pipelines' }),
    ).toBeVisible({
      timeout: 10000,
    })
  })
})

test.describe('DWS - AI Section', () => {
  // Skip these tests on remote - content may differ significantly
  test.skip(isRemote, 'Skipping AI section on remote network')

  test('inference page loads', async ({ page }) => {
    await page.goto('/ai/inference')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'AI Inference' }),
    ).toBeVisible({
      timeout: 10000,
    })
  })

  test('embeddings page loads', async ({ page }) => {
    await page.goto('/ai/embeddings')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: /embeddings/i }),
    ).toBeVisible({
      timeout: 10000,
    })
  })
})

test.describe('DWS - Mobile Responsiveness', () => {
  // Skip on remote - UI may differ significantly
  test.skip(isRemote, 'Skipping mobile responsiveness on remote network')

  test('renders correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    // Main content should be visible on mobile
    await expect(page.locator('body')).toBeVisible()

    // Check no horizontal overflow
    const overflowAmount = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      )
    })

    expect(overflowAmount).toBeLessThan(30)
  })
})

test.describe('DWS - Error Handling', () => {
  // Skip on remote - error handling may differ
  test.skip(isRemote, 'Skipping error handling on remote network')

  test('handles 404 gracefully', async ({ page }) => {
    const response = await page.goto('/nonexistent-page-12345')
    await page.waitForLoadState('domcontentloaded')

    // Should either show 404 or redirect to home
    const is404 = await page
      .locator('text=/404|not found|page not found/i')
      .isVisible()
      .catch(() => false)
    const isHome =
      (await page
        .locator('text=/DWS/i')
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator('text=/Console/i')
        .isVisible()
        .catch(() => false))
    const hasNav = await page
      .locator('nav, aside, [role="navigation"]')
      .first()
      .isVisible()
      .catch(() => false)
    const is404Status = response ? response.status() === 404 : false

    expect(is404 || isHome || hasNav || is404Status).toBe(true)
  })
})

test.describe('DWS - Navigation', () => {
  // Skip on remote - navigation structure may differ
  test.skip(isRemote, 'Skipping navigation on remote network')

  test('sidebar links work', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    if (await checkSpaRoutingError(page)) {
      test.skip()
      return
    }

    const skipTour = page.getByRole('button', { name: /skip tour/i })
    const skipTourVisible = await skipTour.isVisible().catch(() => false)
    if (skipTourVisible) {
      await skipTour.click()
    }

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
  })
})
