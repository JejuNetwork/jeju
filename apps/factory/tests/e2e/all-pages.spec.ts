/**
 * Complete Page Verification Tests
 * Visits every page in the Factory app and verifies they load correctly
 */

import { expect, test } from '@playwright/test'

// Check if running against testnet/mainnet where UI may differ
const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('All Pages Load Test', () => {
  // Skip on remote - page structure may differ significantly
  test.skip(isRemote, 'Skipping all pages tests on remote network')
  test.describe('Main Pages', () => {
    const pages = [
      { path: '/', name: 'Home', heading: /factory/i },
      { path: '/bounties', name: 'Bounties', heading: /bounties/i },
      { path: '/jobs', name: 'Jobs', heading: /jobs/i },
      { path: '/git', name: 'Repositories', heading: /repositories/i },
      { path: '/packages', name: 'Packages', heading: /packages/i },
      { path: '/models', name: 'Models', heading: /model/i },
      { path: '/containers', name: 'Containers', heading: /container/i },
      { path: '/projects', name: 'Projects', heading: /project/i },
      { path: '/ci', name: 'CI/CD', heading: /ci/i },
      { path: '/agents', name: 'Agents', heading: /agent/i },
      { path: '/feed', name: 'Feed', heading: /feed/i },
    ]

    for (const { path, name, heading } of pages) {
      test(`loads ${name} page at ${path}`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('main')).toBeVisible()
        await expect(
          page.getByRole('heading', { name: heading }).first(),
        ).toBeVisible()
      })
    }
  })

  test.describe('Sub-Pages', () => {
    const subPages = [
      { path: '/bounties/create', name: 'Create Bounty' },
      { path: '/jobs/create', name: 'Post Job' },
      { path: '/git/new', name: 'New Repository' },
      { path: '/packages/publish', name: 'Publish Package' },
      { path: '/models/upload', name: 'Upload Model' },
      { path: '/projects/new', name: 'New Project' },
      { path: '/agents/deploy', name: 'Deploy Agent' },
    ]

    for (const { path, name } of subPages) {
      test(`loads ${name} page at ${path}`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('main')).toBeVisible()
      })
    }
  })

  test.describe('Detail Pages', () => {
    test('loads bounty detail page', async ({ page }) => {
      await page.goto('/bounties/0x1234')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('loads repository detail page', async ({ page }) => {
      await page.goto('/git/jeju/factory')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('loads package detail page', async ({ page }) => {
      await page.goto('/packages/@jeju/sdk')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('loads model detail page', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('loads container detail page', async ({ page }) => {
      await page.goto('/containers/jeju/node')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('loads project detail page', async ({ page }) => {
      await page.goto('/projects/1')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('loads agent detail page', async ({ page }) => {
      await page.goto('/agents/1')
      await expect(page.getByRole('main')).toBeVisible()
    })
  })

  test.describe('Settings Pages', () => {
    test('loads repository settings', async ({ page }) => {
      await page.goto('/git/jeju/factory/settings')
      await expect(page.getByRole('main')).toBeVisible()
    })

    test('loads package settings', async ({ page }) => {
      await page.goto('/packages/@jeju/sdk/settings')
      await expect(page.getByRole('main')).toBeVisible()
    })
  })
})

test.describe('Page Elements Verification', () => {
  test('home page has navigation and wallet button', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /connect wallet/i }),
    ).toBeVisible()
  })

  test('all pages have consistent layout', async ({ page }) => {
    const paths = ['/', '/bounties', '/git', '/packages', '/models']

    for (const path of paths) {
      await page.goto(path)
      await expect(page.getByRole('navigation')).toBeVisible()
      await expect(page.getByRole('main')).toBeVisible()
    }
  })

  test('search functionality is available on list pages', async ({ page }) => {
    const listPages = [
      '/bounties',
      '/git',
      '/packages',
      '/models',
      '/jobs',
      '/agents',
    ]

    for (const path of listPages) {
      await page.goto(path)
      const searchInput = page.getByPlaceholder(/search/i)
      await expect(searchInput).toBeVisible()
    }
  })
})

test.describe('Responsive Layout', () => {
  test('mobile layout shows mobile nav', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await expect(page.locator('header.lg\\:hidden')).toBeVisible()
  })

  test('desktop layout shows sidebar nav', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('nav.fixed')).toBeVisible()
  })
})
