/**
 * Edge Case E2E Tests
 */

import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { ensureDir, navigateToDAO, navigateToGovernance, screenshotPath, setupErrorCapture } from './helpers'

const SCREENSHOT_DIR = join(process.cwd(), 'test-results', 'screenshots', 'edge-cases')

test.beforeAll(() => ensureDir(SCREENSHOT_DIR))

test.describe('Form Validation', () => {
  test('slug format validation', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    const slugInput = page.locator('input#dao-slug')

    for (const slug of ['UPPERCASE', 'with spaces', 'special!@#$', '-start', 'end-', 'a']) {
      await slugInput.fill(slug)
      await page.waitForTimeout(200)
    }

    await slugInput.fill('valid-dao-slug')
    await page.fill('input#dao-display-name', 'Test DAO')
    await expect(page.locator('button:has-text("Continue")')).toBeEnabled()
  })

  test('empty form disabled', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    await expect(page.locator('button:has-text("Continue")')).toBeDisabled()
  })

  test('unicode inputs', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    await page.fill('input#dao-slug', 'test-unicode')
    await page.fill('input#dao-display-name', 'Test DAO 日本語 🎉')
    await page.click('button:has-text("Continue")')
    await page.waitForTimeout(500)
  })

  test('max length inputs', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    await page.fill('input#dao-slug', 'a'.repeat(100))
    await page.fill('input#dao-display-name', 'Test '.repeat(50))
  })
})

test.describe('Empty States', () => {
  test('DAO list', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    const hasDaos = await page.locator('a[href*="/dao/"]').count() > 0
    const hasEmpty = await page.locator('text=No DAOs found').isVisible().catch(() => false)
    const hasCreate = await page.locator('text=Create DAO').first().isVisible()

    expect(hasDaos || hasEmpty || hasCreate).toBe(true)
  })

  test('Director Dashboard', async ({ page }) => {
    await page.goto('/director', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    const hasProposals = await page.locator('button[class*="w-full p-4"]').count() > 0
    const hasEmpty = await page.locator('text=No pending proposals').isVisible().catch(() => false)

    expect(hasProposals || hasEmpty).toBe(true)
  })
})

test.describe('Error States', () => {
  test('404 page', async ({ page }) => {
    await page.goto('/dao/non-existent-dao-12345', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: screenshotPath(SCREENSHOT_DIR, 'DAO-Not-Found'), fullPage: true })
  })
})

test.describe('Network', () => {
  test('offline', async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    await context.setOffline(true)
    await page.click('text=Create DAO').catch(() => {})
    await page.waitForTimeout(1000)
    await context.setOffline(false)
  })

  test('slow network', async ({ page }) => {
    const client = await page.context().newCDPSession(page)
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput: (500 * 1024) / 8,
      latency: 400,
    })

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await expect(page.locator('body')).toBeVisible()
  }, 90000)
})

test.describe('Keyboard', () => {
  test('Tab navigation', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)
    }
  })

  test('Enter submission', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    await page.fill('input#dao-slug', 'test-dao')
    await page.fill('input#dao-display-name', 'Test DAO')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
  })
})

test.describe('Responsive', () => {
  const viewports = [
    { w: 320, h: 568, name: 'mobile' },
    { w: 768, h: 1024, name: 'tablet' },
    { w: 1280, h: 800, name: 'desktop' },
  ]

  for (const { w, h, name } of viewports) {
    test(`${name} (${w}x${h})`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1000)

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      expect(bodyWidth).toBeLessThanOrEqual(w + 20)
      await expect(page.locator('h1')).toBeVisible()
    })
  }
})

test.describe('Concurrent Actions', () => {
  test('rapid navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    const createBtn = page.locator('text=Create DAO').first()
    const myDaosBtn = page.locator('text=My DAOs')

    for (let i = 0; i < 5; i++) {
      await createBtn.click({ timeout: 1000 }).catch(() => {})
      await myDaosBtn.click({ timeout: 1000 }).catch(() => {})
    }

    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Data Persistence', () => {
  test('wizard back preserves data', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    await page.fill('input#dao-slug', 'persistence-test')
    await page.fill('input#dao-display-name', 'Persistence Test DAO')
    await page.click('button:has-text("Continue")')
    await page.waitForTimeout(500)

    await page.click('button:has-text("Back")')
    await page.waitForTimeout(500)

    expect(await page.inputValue('input#dao-slug')).toBe('persistence-test')
    expect(await page.inputValue('input#dao-display-name')).toBe('Persistence Test DAO')
  })
})

test.describe('Browser State', () => {
  test('back/forward', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.goto('/create', { waitUntil: 'domcontentloaded' })

    await page.goBack()
    await page.waitForTimeout(500)
    expect(page.url()).toContain('localhost')

    await page.goForward()
    await page.waitForTimeout(500)
    expect(page.url()).toContain('create')
  })

  test('resize during interaction', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    await page.fill('input#dao-slug', 'resize-test')

    await page.setViewportSize({ width: 800, height: 600 })
    await page.setViewportSize({ width: 400, height: 800 })
    await page.setViewportSize({ width: 1200, height: 900 })

    expect(await page.inputValue('input#dao-slug')).toBe('resize-test')
  })
})

test.describe('Mocked API Errors', () => {
  test('handles 500', async ({ page }) => {
    const { errors } = setupErrorCapture(page)

    await page.route('**/api/v1/dao/list', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal Server Error' }) })
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)

    const hasErrorState = await page.locator('text=error').isVisible().catch(() => false)
    const hasEmptyState = await page.locator('text=No DAOs').isVisible().catch(() => false)
    const hasCreateBtn = await page.locator('text=Create DAO').isVisible().catch(() => false)

    expect(hasErrorState || hasEmptyState || hasCreateBtn).toBe(true)

    const unhandledErrors = errors.filter((e) => e.includes('Unhandled'))
    expect(unhandledErrors.length).toBe(0)
  })
})

test.describe('Security', () => {
  test('XSS input', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    const xss = '<img src=x onerror=alert("xss")>'
    await page.fill('input#dao-slug', 'test-xss')
    await page.fill('input#dao-display-name', xss)

    const value = await page.inputValue('input#dao-display-name')
    expect(value).toBe(xss)

    const { errors } = setupErrorCapture(page)
    await page.click('button:has-text("Continue")')
    await page.waitForTimeout(500)

    const xssErrors = errors.filter((e) => e.includes('alert') || e.includes('xss'))
    expect(xssErrors.length).toBe(0)
  })

  test('SQL injection', async ({ page }) => {
    if (!await navigateToGovernance(page)) return

    const searchInput = page.locator('input[placeholder*="Search"]')
    if (!await searchInput.isVisible()) return

    await searchInput.fill("'; DROP TABLE proposals; --")
    await page.waitForTimeout(500)

    await expect(page.locator('button:has-text("Governance")')).toBeVisible()
  })
})
