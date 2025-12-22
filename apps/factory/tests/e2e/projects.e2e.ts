/**
 * Projects E2E Tests
 * Tests project boards and management
 */

import { expect, test } from '@playwright/test'

test.describe('Projects', () => {
  test('should display projects page', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('heading').first()).toBeVisible()
  })

  test('should show project content', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('should show filter buttons', async ({ page }) => {
    await page.goto('/projects')
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible()
  })

  test('should show project cards', async ({ page }) => {
    await page.goto('/projects')
    const cards = page.locator('.card')
    await expect(cards.first()).toBeVisible()
  })

  test('should have interactive elements', async ({ page }) => {
    await page.goto('/projects')
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible()
  })
})
