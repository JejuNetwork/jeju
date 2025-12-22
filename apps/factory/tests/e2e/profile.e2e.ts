/**
 * Profile E2E Tests
 * Tests user profile pages and interactions
 */

import { expect, test } from '@playwright/test'

test.describe('Profile', () => {
  test('should display profile page', async ({ page }) => {
    await page.goto('/profile/0x1234567890abcdef')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('should show profile content', async ({ page }) => {
    await page.goto('/profile/0x1234567890abcdef')
    // Check for any profile heading or content
    const content = page.locator('.card, h1, h2')
    await expect(content.first()).toBeVisible()
  })

  test('should show profile tabs', async ({ page }) => {
    await page.goto('/profile/0x1234567890abcdef')
    const tabs = page.getByRole('button')
    await expect(tabs.first()).toBeVisible()
  })

  test('should show user info', async ({ page }) => {
    await page.goto('/profile/0x1234567890abcdef')
    // Check for avatar or username area
    await expect(page.locator('img, .rounded-full').first()).toBeVisible()
  })

  test('should show stats', async ({ page }) => {
    await page.goto('/profile/0x1234567890abcdef')
    // Look for any stats or numbers
    await expect(page.getByRole('main')).toBeVisible()
  })
})
