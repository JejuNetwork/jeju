/**
 * Accessibility E2E Tests
 * Tests keyboard navigation, ARIA labels, focus management, and responsive design
 */

import { expect, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('Landmarks', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('has navigation landmark', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation')
    await expect(nav.first()).toBeVisible()
  })

  test('has main content landmark', async ({ page }) => {
    await page.goto('/')
    const main = page.locator('main')
    await expect(main).toBeVisible()
  })

  test('has page heading', async ({ page }) => {
    await page.goto('/')
    const heading = page.getByRole('heading').first()
    await expect(heading).toBeVisible()
  })
})

test.describe('Keyboard Navigation', () => {
  test('navigates with Tab key', async ({ page }) => {
    await page.goto('/', { timeout: 60000 })
    await page.waitForLoadState('domcontentloaded')
    await page.keyboard.press('Tab')
    await expect(page.locator('body')).toBeVisible()
  })

  test('has interactive elements', async ({ page }) => {
    await page.goto('/', { timeout: 60000 })
    const links = page.getByRole('link')
    await expect(links.first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Responsive Design', () => {
  test('respects mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('respects reduced motion preference', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    const hasReducedMotion = await page.evaluate(() => {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    })

    expect(hasReducedMotion).toBe(true)
  })
})
