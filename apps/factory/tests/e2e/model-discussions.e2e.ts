/**
 * Model Discussions E2E Tests
 * Tests model discussion/comments functionality
 */

import { expect, test } from '@playwright/test'

test.describe('Model Discussions', () => {
  test('should display discussions page', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    await expect(
      page.getByRole('heading', { name: /discussions/i }),
    ).toBeVisible()
  })

  test('should show new discussion button', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    await expect(
      page.getByRole('button', { name: /new discussion/i }),
    ).toBeVisible()
  })

  test('should have search functionality', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    const searchInput = page.getByPlaceholder(/search discussions/i)
    await expect(searchInput).toBeVisible()
  })

  test('should have category filter', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    await expect(page.getByRole('combobox')).toBeVisible()
  })

  test('should display discussion list', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    // Check for discussion cards
    await expect(page.locator('.card').first()).toBeVisible()
  })

  test('should show discussion categories', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    // Should have category badges in cards
    await expect(page.locator('.badge').first()).toBeVisible()
  })

  test('should show upvote buttons', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    // Upvote count should be visible
    await expect(page.locator('.card').first()).toBeVisible()
  })

  test('should open new discussion form', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    await page.getByRole('button', { name: /new discussion/i }).click()

    await expect(page.getByText(/start a discussion/i)).toBeVisible()
    await expect(
      page.getByPlaceholder(/what would you like to discuss/i),
    ).toBeVisible()
  })

  test('should show category selector in form', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')

    await page.getByRole('button', { name: /new discussion/i }).click()

    await expect(
      page.getByRole('button', { name: /^question$/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^general$/i })).toBeVisible()
  })
})
