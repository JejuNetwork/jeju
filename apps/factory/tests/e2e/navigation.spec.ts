/**
 * Navigation E2E Tests
 * Tests all navigation routes, menu interactions, and page accessibility
 */

import { expect, test } from '@playwright/test'

test.describe('Desktop Navigation', () => {
  test('displays main navigation', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation')
    await expect(nav.first()).toBeVisible()
  })

  test('shows nav section buttons', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /work/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /code/i })).toBeVisible()
  })

  test('toggles nav section on click', async ({ page }) => {
    await page.goto('/')

    const bountiesLink = page.getByRole('link', { name: /bounties/i })
    await expect(bountiesLink).toBeVisible()

    await page.getByRole('button', { name: /work/i }).click()
    await expect(bountiesLink).not.toBeVisible()
  })

  test('navigates to bounties', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /bounties/i }).click()
    await expect(page).toHaveURL('/bounties')
  })

  test('navigates to repositories', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /repositories/i }).click()
    await expect(page).toHaveURL('/git')
  })

  test('navigates to packages', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /packages/i }).click()
    await expect(page).toHaveURL('/packages')
  })

  test('navigates to models', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /models/i }).click()
    await expect(page).toHaveURL('/models')
  })

  test('navigates to feed', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Feed', exact: true }).click()
    await expect(page).toHaveURL('/feed')
  })

  test('shows search input', async ({ page }) => {
    await page.goto('/')
    const searchInput = page.getByPlaceholder(/search/i)
    await expect(searchInput).toBeVisible()
  })

  test('shows settings link', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible()
  })

  test('highlights active link', async ({ page }) => {
    await page.goto('/bounties')
    const bountiesLink = page.getByRole('link', { name: /bounties/i })
    await expect(bountiesLink).toHaveClass(/text-accent/)
  })
})

test.describe('Page Routes', () => {
  test('loads home page', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1 }),
    ).toBeVisible()
    await expect(page.getByRole('navigation')).toBeVisible()
  })

  test('loads bounties page', async ({ page }) => {
    await page.goto('/bounties')
    await expect(page.getByRole('heading', { name: /bounties/i })).toBeVisible()
  })

  test('loads repositories page', async ({ page }) => {
    await page.goto('/git')
    await expect(
      page.getByRole('heading', { name: /repositories/i }),
    ).toBeVisible()
  })

  test('loads packages page', async ({ page }) => {
    await page.goto('/packages')
    await expect(page.getByRole('heading', { name: /packages/i })).toBeVisible()
  })

  test('loads containers page', async ({ page }) => {
    await page.goto('/containers')
    await expect(
      page.getByRole('heading', { name: /container/i }),
    ).toBeVisible()
  })

  test('loads models page', async ({ page }) => {
    await page.goto('/models')
    await expect(page.getByRole('heading', { name: /model/i })).toBeVisible()
  })

  test('loads jobs page', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { name: /jobs/i })).toBeVisible()
  })

  test('loads projects page', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('heading').first()).toBeVisible()
  })

  test('loads feed page', async ({ page }) => {
    await page.goto('/feed')
    await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible()
  })

  test('loads agents page', async ({ page }) => {
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: /agent/i })).toBeVisible()
  })

  test('loads CI/CD page', async ({ page }) => {
    await page.goto('/ci')
    await expect(page.getByRole('heading', { name: /ci/i })).toBeVisible()
  })

  test('loads model upload page', async ({ page }) => {
    await page.goto('/models/upload')
    await expect(page.getByRole('heading', { name: /upload/i })).toBeVisible()
  })

  test('loads user profile page', async ({ page }) => {
    await page.goto('/profile/0x1234567890abcdef')
    await expect(page.getByRole('main')).toBeVisible()
  })
})

test.describe('Detail Pages', () => {
  test('loads repository detail page', async ({ page }) => {
    await page.goto('/git/jeju/factory')
    await expect(page.locator('h1').filter({ hasText: 'jeju' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /code/i }).first(),
    ).toBeVisible()
  })

  test('loads package detail page', async ({ page }) => {
    await page.goto('/packages/%40jeju/sdk')
    await expect(
      page.locator('h1').filter({ hasText: '@jejunetwork/sdk' }),
    ).toBeVisible()
  })

  test('loads model detail page', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await expect(
      page.getByRole('heading', { name: /llama-3-jeju-ft/i }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /model card/i }),
    ).toBeVisible()
  })
})

test.describe('Mobile Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
  })

  test('shows mobile header', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('header.lg\\:hidden')).toBeVisible()
  })

  test('shows mobile menu button', async ({ page }) => {
    await page.goto('/')
    const menuButton = page.locator('header.lg\\:hidden button')
    await expect(menuButton.first()).toBeVisible()
  })

  test('main content is accessible on mobile', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toBeVisible()
  })
})

test.describe('Navigation Links Flow', () => {
  test('navigation links work correctly', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation')
      .getByRole('link', { name: /bounties/i })
      .click()
    await expect(page).toHaveURL('/bounties')

    await page
      .getByRole('navigation')
      .getByRole('link', { name: /repositories|git/i })
      .click()
    await expect(page).toHaveURL('/git')

    await page
      .getByRole('navigation')
      .getByRole('link', { name: /packages/i })
      .click()
    await expect(page).toHaveURL('/packages')
  })
})
