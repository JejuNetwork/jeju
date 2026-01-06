// Check if running against testnet/mainnet
const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

/**
 * Agents E2E Tests
 * Tests agent listing, deployment, and management flows
 */

import { expect, test } from '@playwright/test'

test.describe('Agents List', () => {
  // Skip on remote - UI structure may differ
  test.skip(isRemote, 'Skipping agents tests on remote network')

  test('displays agents page with heading', async ({ page }) => {
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible()
  })

  test('shows deploy agent button', async ({ page }) => {
    await page.goto('/agents')
    await expect(
      page.getByRole('link', { name: /deploy agent/i }),
    ).toBeVisible()
  })

  test('has search input', async ({ page }) => {
    await page.goto('/agents')
    const searchInput = page.getByPlaceholder(/search agents/i)
    await expect(searchInput).toBeVisible()
  })

  test('searches agents', async ({ page }) => {
    await page.goto('/agents')
    const searchInput = page.getByPlaceholder(/search agents/i)
    await searchInput.fill('validator')
    await expect(searchInput).toHaveValue('validator')
  })

  test('navigates to deploy agent page', async ({ page }) => {
    await page.goto('/agents')
    await page.getByRole('link', { name: /deploy agent/i }).click()
    await expect(page).toHaveURL(/\/agents\/deploy/)
  })
})

test.describe('Deploy Agent', () => {
  test.skip(isRemote, 'Skipping on remote')
  test('displays agent deployment form', async ({ page }) => {
    await page.goto('/agents/deploy')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('has agent type selection', async ({ page }) => {
    await page.goto('/agents/deploy')
    await expect(page.locator('input, select, textarea').first()).toBeVisible()
  })
})

test.describe('Agent Detail', () => {
  test('displays agent detail page', async ({ page }) => {
    await page.goto('/agents/1')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('shows agent status', async ({ page }) => {
    await page.goto('/agents/1')
    await expect(
      page.locator('.badge, [class*="status"]').first(),
    ).toBeVisible()
  })
})

test.describe('Agent Filters', () => {
  test('filters by agent type', async ({ page }) => {
    await page.goto('/agents')
    const filterButtons = page
      .getByRole('button')
      .filter({ hasText: /validator|compute|oracle/i })
    const count = await filterButtons.count()
    if (count > 0) {
      await filterButtons.first().click()
    }
  })

  test('filters by status', async ({ page }) => {
    await page.goto('/agents')
    const statusFilter = page.getByRole('button', { name: /active|offline/i })
    if (await statusFilter.isVisible()) {
      await statusFilter.click()
    }
  })
})
