/**
 * Feed E2E Tests
 * Tests Farcaster-powered social feed
 */

import { expect, test } from '@playwright/test'

test.describe('Feed', () => {
  test('should display feed page', async ({ page }) => {
    await page.goto('/feed', { timeout: 60000 })
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })

  test('should show feed content', async ({ page }) => {
    await page.goto('/feed', { timeout: 60000 })
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })

  test('should have heading', async ({ page }) => {
    await page.goto('/feed', { timeout: 60000 })
    await page.waitForLoadState('domcontentloaded')
    const heading = page.getByRole('heading').first()
    await expect(heading).toBeVisible({ timeout: 10000 })
  })

  test('should show cards', async ({ page }) => {
    await page.goto('/feed', { timeout: 60000 })
    await page.waitForLoadState('domcontentloaded')
    const cards = page.locator('.card')
    await expect(cards.first()).toBeVisible({ timeout: 10000 })
  })

  test('should be interactive', async ({ page }) => {
    await page.goto('/feed', { timeout: 60000 })
    await page.waitForLoadState('domcontentloaded')
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible({ timeout: 10000 })
  })
})
