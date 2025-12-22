/**
 * Jobs E2E Tests
 * Tests job listings and applications
 */

import { expect, test } from '@playwright/test'

test.describe('Jobs', () => {
  test('should display jobs page', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { name: /jobs/i })).toBeVisible()
  })

  test('should show job content', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('should show filter buttons', async ({ page }) => {
    await page.goto('/jobs')
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible()
  })

  test('should show job cards', async ({ page }) => {
    await page.goto('/jobs')
    const cards = page.locator('.card')
    await expect(cards.first()).toBeVisible()
  })

  test('should have interactive elements', async ({ page }) => {
    await page.goto('/jobs')
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible()
  })

  test('should show post job button', async ({ page }) => {
    await page.goto('/jobs')
    const postButton = page.getByRole('link', { name: /post job/i })
    await expect(postButton).toBeVisible()
  })
})
