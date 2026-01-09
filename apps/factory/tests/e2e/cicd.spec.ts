// Check if running against testnet/mainnet
const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

/**
 * CI/CD E2E Tests
 * Tests workflow runs, logs, deployments, and build details
 */

import { expect, test } from '@playwright/test'

test.describe('CI/CD Dashboard', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays CI/CD page', async ({ page }) => {
    await page.goto('/ci')
    await expect(page.getByRole('heading', { name: /ci\/cd/i })).toBeVisible()
  })

  test('shows pipeline stats', async ({ page }) => {
    await page.goto('/ci')
    await expect(page.getByText(/total runs/i)).toBeVisible()
    await expect(page.getByText(/running/i).first()).toBeVisible()
  })

  test('filters by status', async ({ page }) => {
    await page.goto('/ci')

    const filters = ['All Runs', 'in progress', 'queued', 'completed', 'failed']

    for (const filter of filters) {
      const button = page.getByRole('button', {
        name: new RegExp(filter, 'i'),
      })
      if (await button.isVisible()) {
        await button.click()
        await expect(button).toHaveClass(/bg-accent/)
        break
      }
    }
  })

  test('displays workflow run list', async ({ page }) => {
    await page.goto('/ci')
    const runCards = page.locator('.card, a[href^="/ci/runs/"]')
    await expect(runCards.first()).toBeVisible()
  })

  test('shows run status indicators', async ({ page }) => {
    await page.goto('/ci')
    const statusIcons = page.locator(
      'svg[class*="text-green"], svg[class*="text-blue"], svg[class*="text-red"]',
    )
    await expect(statusIcons.first()).toBeVisible()
  })

  test('shows trigger workflow button', async ({ page }) => {
    await page.goto('/ci')
    await expect(
      page.getByRole('link', { name: /trigger workflow/i }),
    ).toBeVisible()
  })

  test('shows refresh button', async ({ page }) => {
    await page.goto('/ci')
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible()
  })
})

test.describe('Workflow Run Detail', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('navigates to run detail', async ({ page }) => {
    await page.goto('/ci')
    const runLink = page.locator('a[href^="/ci/runs/"]').first()
    if (await runLink.isVisible()) {
      await runLink.click()
      await expect(page).toHaveURL(/\/ci\/runs\/.+/)
    }
  })
})

test.describe('Deployments', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays deployment cards', async ({ page }) => {
    await page.goto('/ci')
    await expect(
      page.getByText(/production|staging|preview/i).first(),
    ).toBeVisible()
  })

  test('shows deployment status', async ({ page }) => {
    await page.goto('/ci')
    const deployCards = page
      .locator('.card')
      .filter({ hasText: /production|staging|preview/i })
    await expect(deployCards.first()).toBeVisible()
  })

  test('shows version tags', async ({ page }) => {
    await page.goto('/ci')
    await expect(page.getByText(/v\d+\.\d+\.\d+/i).first()).toBeVisible()
  })
})
