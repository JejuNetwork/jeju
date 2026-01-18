// Check if running against testnet/mainnet
const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

/**
 * Containers E2E Tests
 * Tests container registry listing, detail view, and push flows
 */

import { expect, test } from '@playwright/test'

test.describe('Container Registry', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays containers page with heading', async ({ page }) => {
    await page.goto('/containers')
    await expect(
      page.getByRole('heading', { name: /container/i }),
    ).toBeVisible()
  })

  test('shows push container button', async ({ page }) => {
    await page.goto('/containers')
    await expect(page.getByRole('link', { name: /push|upload/i })).toBeVisible()
  })

  test('has search input', async ({ page }) => {
    await page.goto('/containers')
    const searchInput = page.getByPlaceholder(/search containers/i)
    await expect(searchInput).toBeVisible()
  })

  test('searches containers', async ({ page }) => {
    await page.goto('/containers')
    const searchInput = page.getByPlaceholder(/search containers/i)
    await searchInput.fill('node')
    await expect(searchInput).toHaveValue('node')
  })

  test('displays container cards', async ({ page }) => {
    await page.goto('/containers')
    const containerCards = page.locator('.card')
    await expect(containerCards.first()).toBeVisible()
  })

  test('shows container stats', async ({ page }) => {
    await page.goto('/containers')
    await expect(page.getByText(/total|pulls|images/i).first()).toBeVisible()
  })
})

test.describe('Push Container', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays push page', async ({ page }) => {
    await page.goto('/containers/push')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('shows CLI instructions', async ({ page }) => {
    await page.goto('/containers/push')
    await expect(page.getByText(/docker|push/i).first()).toBeVisible()
  })

  test('shows registry endpoint', async ({ page }) => {
    await page.goto('/containers/push')
    await expect(
      page.getByText(/registry|containers\.jejunetwork/i).first(),
    ).toBeVisible()
  })
})

test.describe('Container Detail', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays container detail page', async ({ page }) => {
    await page.goto('/containers/jeju/node')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('shows tags list', async ({ page }) => {
    await page.goto('/containers/jeju/node')
    await expect(page.getByText(/latest|tag/i).first()).toBeVisible()
  })

  test('shows pull command', async ({ page }) => {
    await page.goto('/containers/jeju/node')
    await expect(page.getByText(/docker pull/i).first()).toBeVisible()
  })

  test('shows container metadata', async ({ page }) => {
    await page.goto('/containers/jeju/node')
    await expect(
      page.getByText(/size|architecture|layers/i).first(),
    ).toBeVisible()
  })
})

test.describe('Container Filters', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('filters by organization', async ({ page }) => {
    await page.goto('/containers')
    const orgFilter = page.locator('select').first()
    if (await orgFilter.isVisible()) {
      await orgFilter.selectOption({ index: 1 })
    }
  })

  test('sorts containers', async ({ page }) => {
    await page.goto('/containers')
    const sortSelect = page.locator('select').filter({ hasText: /sort|order/i })
    if (await sortSelect.isVisible()) {
      await sortSelect.selectOption({ index: 1 })
    }
  })
})
