/**
 * Package Settings E2E Tests
 * Tests package management functionality
 */

import { expect, test } from '@playwright/test'

test.describe('Package Settings', () => {
  test('should display settings page', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await expect(
      page.getByRole('heading', { name: /package settings/i }),
    ).toBeVisible()
  })

  test('should show package name', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await expect(page.getByRole('main')).toBeVisible()
  })

  test('should have settings tabs', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await expect(page.getByRole('button', { name: /^general$/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /maintainers/i }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /access tokens/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /versions/i })).toBeVisible()
  })

  test('should show description field', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible()
  })

  test('should show keywords', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await expect(page.getByText(/keywords/i).first()).toBeVisible()
  })

  test('should show maintainers tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await page.getByRole('button', { name: /maintainers/i }).click()

    await expect(page.getByText(/package maintainers/i)).toBeVisible()
    await expect(page.getByPlaceholder(/add maintainer/i)).toBeVisible()
  })

  test('should show access tokens tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await page.getByRole('button', { name: /access tokens/i }).click()

    await expect(
      page.getByRole('button', { name: /create token/i }),
    ).toBeVisible()
  })

  test('should show versions tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await page.getByRole('button', { name: /versions/i }).click()

    await expect(page.getByText(/version management/i)).toBeVisible()
  })

  test('should show danger zone', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')

    await page.getByRole('button', { name: /danger zone/i }).click()

    await expect(page.getByText(/deprecate/i).first()).toBeVisible()
  })
})
