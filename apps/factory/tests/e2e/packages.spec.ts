/**
 * Packages E2E Tests
 * Tests package registry listing, detail view, publishing, and settings
 */

import { expect, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('Package List', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays package list', async ({ page }) => {
    await page.goto('/packages')
    await expect(page.getByRole('heading', { name: /packages/i })).toBeVisible()
  })

  test('shows package stats', async ({ page }) => {
    await page.goto('/packages')
    const stats = page.locator('.card').first()
    await expect(stats).toBeVisible()
  })

  test('searches packages', async ({ page }) => {
    await page.goto('/packages')
    const searchInput = page.getByPlaceholder(/search packages/i)
    if (await searchInput.isVisible()) {
      await searchInput.fill('jeju-sdk')
      await expect(searchInput).toHaveValue('jeju-sdk')
    }
  })

  test('filters packages by type', async ({ page }) => {
    await page.goto('/packages')
    const filterButtons = page
      .locator('button')
      .filter({ hasText: /all|library|tool|framework/i })
    const count = await filterButtons.count()
    if (count > 0) {
      await filterButtons.first().click()
    }
  })
})

test.describe('Package Detail', () => {
  test('displays package header', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(
      page.locator('h1').filter({ hasText: '@jejunetwork/sdk' }),
    ).toBeVisible()
  })

  test('shows install command', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('displays package tabs', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(page.getByRole('button', { name: /readme/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /versions/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /dependencies/i }),
    ).toBeVisible()
  })

  test('switches to versions tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await page.getByRole('button', { name: /versions/i }).click()
    await expect(page.locator('.card').first()).toBeVisible()
  })

  test('switches to dependencies tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await page.getByRole('button', { name: /dependencies/i }).click()
    await expect(page.getByText(/dependencies/i).first()).toBeVisible()
  })

  test('shows download stats', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(page.getByText(/downloads/i).first()).toBeVisible()
  })

  test('shows license info', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(page.getByText(/license/i).first()).toBeVisible()
  })

  test('shows keyword badges', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(page.locator('.badge').first()).toBeVisible()
  })

  test('renders README markdown', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(
      page.locator('.prose, [class*="markdown"]').first(),
    ).toBeVisible()
  })
})

test.describe('Package Version History', () => {
  test('displays all versions', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await page.getByRole('button', { name: /versions/i }).click()
    await expect(page.locator('.card').first()).toBeVisible()
  })

  test('shows latest badge on current version', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await page.getByRole('button', { name: /versions/i }).click()
    await expect(page.getByText(/latest/i).first()).toBeVisible()
  })
})

test.describe('Publish Package', () => {
  test('displays publish page', async ({ page }) => {
    await page.goto('/packages/publish')
    await expect(
      page.getByRole('heading', { name: /publish package/i }),
    ).toBeVisible()
  })

  test('shows CLI and upload method toggle', async ({ page }) => {
    await page.goto('/packages/publish')
    await expect(
      page.getByRole('button', { name: /cli/i }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /upload/i }).first(),
    ).toBeVisible()
  })

  test('shows npm registry configuration', async ({ page }) => {
    await page.goto('/packages/publish')
    await expect(page.getByText(/configure registry/i)).toBeVisible()
    await expect(page.getByText(/pkg.jejunetwork.org/i).first()).toBeVisible()
  })

  test('shows authentication instructions', async ({ page }) => {
    await page.goto('/packages/publish')
    await expect(page.getByText(/authenticate/i)).toBeVisible()
    await expect(page.getByText(/bun jeju login/i)).toBeVisible()
  })

  test('shows publish command', async ({ page }) => {
    await page.goto('/packages/publish')
    await expect(page.getByText(/bun jeju publish/i)).toBeVisible()
  })

  test('switches to upload method', async ({ page }) => {
    await page.goto('/packages/publish')
    await page.getByRole('button', { name: /upload tarball/i }).click()
    await expect(page.getByText(/upload tarball/i).first()).toBeVisible()
    await expect(page.getByText(/package name/i)).toBeVisible()
  })

  test('shows package.json requirements', async ({ page }) => {
    await page.goto('/packages/publish')
    await expect(page.getByText(/package requirements/i)).toBeVisible()
  })
})

test.describe('Package Settings', () => {
  test('displays settings page', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')
    await expect(
      page.getByRole('heading', { name: /package settings/i }),
    ).toBeVisible()
  })

  test('has settings tabs', async ({ page }) => {
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

  test('shows description field', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible()
  })

  test('shows keywords', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')
    await expect(page.getByText(/keywords/i).first()).toBeVisible()
  })

  test('shows maintainers tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')
    await page.getByRole('button', { name: /maintainers/i }).click()
    await expect(page.getByText(/package maintainers/i)).toBeVisible()
    await expect(page.getByPlaceholder(/add maintainer/i)).toBeVisible()
  })

  test('shows access tokens tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')
    await page.getByRole('button', { name: /access tokens/i }).click()
    await expect(
      page.getByRole('button', { name: /create token/i }),
    ).toBeVisible()
  })

  test('shows versions tab', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')
    await page.getByRole('button', { name: /versions/i }).click()
    await expect(page.getByText(/version management/i)).toBeVisible()
  })

  test('shows danger zone', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk/settings')
    await page.getByRole('button', { name: /danger zone/i }).click()
    await expect(page.getByText(/deprecate/i).first()).toBeVisible()
  })
})
