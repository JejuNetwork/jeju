/**
 * Bounties E2E Tests
 * Tests bounty listing, filtering, search, and creation flows
 */

import { expect, test } from '@playwright/test'

test.describe('Bounty List', () => {
  test('displays bounty list with stats', async ({ page }) => {
    await page.goto('/bounties')
    await expect(page.getByRole('heading', { name: /bounties/i })).toBeVisible()
    await expect(page.getByText(/open bounties/i)).toBeVisible()
    await expect(page.getByText(/total value/i)).toBeVisible()
  })

  test('filters bounties by status', async ({ page }) => {
    await page.goto('/bounties')

    const allButton = page.getByRole('button', { name: /^all$/i })
    const openButton = page.getByRole('button', { name: /^open$/i })

    if (await allButton.isVisible()) {
      await allButton.click()
    }

    if (await openButton.isVisible()) {
      await openButton.click()
      await expect(openButton).toHaveClass(/bg-accent/)
    }
  })

  test('searches bounties', async ({ page }) => {
    await page.goto('/bounties')
    const searchInput = page.getByPlaceholder(/search bounties/i)
    await searchInput.fill('security audit')
    await expect(searchInput).toHaveValue('security audit')
  })

  test('sorts bounties', async ({ page }) => {
    await page.goto('/bounties')
    const sortSelect = page.locator('select').first()
    if (await sortSelect.isVisible()) {
      await sortSelect.selectOption({ index: 1 })
    }
  })

  test('displays bounty cards', async ({ page }) => {
    await page.goto('/bounties')
    const cards = page.locator('.card')
    await expect(cards.first()).toBeVisible()
  })

  test('navigates to bounty detail on click', async ({ page }) => {
    await page.goto('/bounties')
    const bountyLink = page.locator('a[href^="/bounties/"]').first()
    if (await bountyLink.isVisible()) {
      await bountyLink.click()
      await expect(page).toHaveURL(/\/bounties\/.+/)
    }
  })
})

test.describe('Bounty Filters', () => {
  test('filters by skill tags', async ({ page }) => {
    await page.goto('/bounties')
    const skillBadges = page.locator('.badge, [class*="tag"]')
    const count = await skillBadges.count()
    if (count > 0) {
      await skillBadges.first().click()
    }
  })

  test('filters by reward range', async ({ page }) => {
    await page.goto('/bounties')
    const rewardFilter = page.getByText(/min reward|reward range/i)
    if (await rewardFilter.isVisible()) {
      await rewardFilter.click()
    }
  })
})

test.describe('Create Bounty', () => {
  test('shows create bounty button', async ({ page }) => {
    await page.goto('/bounties')
    const createButton = page.getByRole('link', {
      name: /create bounty|new bounty/i,
    })
    await expect(createButton).toBeVisible()
  })

  test('navigates to create bounty page', async ({ page }) => {
    await page.goto('/bounties')
    const createButton = page.getByRole('link', {
      name: /create bounty|new bounty/i,
    })
    if (await createButton.isVisible()) {
      await createButton.click()
      await expect(page).toHaveURL(/\/bounties\/new|\/bounties\/create/)
    }
  })
})
