/**
 * Containers E2E Tests
 * Tests container registry interactions
 */

import { expect, test } from '@playwright/test'

test.describe('Containers', () => {
  test('should display containers page', async ({ page }) => {
    await page.goto('/containers')
    await expect(
      page.getByRole('heading', { name: /container/i }),
    ).toBeVisible()
  })

  test('should show container content', async ({ page }) => {
    await page.goto('/containers')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('should show filter buttons', async ({ page }) => {
    await page.goto('/containers')
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible()
  })

  test('should show container cards', async ({ page }) => {
    await page.goto('/containers')
    const cards = page.locator('.card')
    await expect(cards.first()).toBeVisible()
  })

  test('should have interactive elements', async ({ page }) => {
    await page.goto('/containers')
    // Check for any interactive elements
    const buttons = page.getByRole('button')
    await expect(buttons.first()).toBeVisible()
  })
})
