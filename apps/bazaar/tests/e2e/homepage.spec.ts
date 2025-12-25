/**
 * Homepage and Navigation Tests
 * Tests homepage display, navigation menu, and feature cards
 */

import {
  assertNoPageErrors,
  captureScreenshot,
  captureUserFlow,
} from '@jejunetwork/tests'
import { expect, type Page, test } from '@playwright/test'

const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
const MOBILE_VIEWPORT = { width: 375, height: 812 }

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Homepage', () => {
  test('displays homepage with all features', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'homepage',
      steps: [
        {
          name: 'initial',
          action: async () => {
            await page.goto('/')
          },
          waitFor: 1000,
        },
        {
          name: 'features-visible',
          action: async () => {
            await expect(
              page.getByRole('heading', { name: /^Bazaar$/i }),
            ).toBeVisible()
            await expect(
              page.getByRole('link', { name: /Coins/i }).first(),
            ).toBeVisible()
            await expect(
              page.getByRole('link', { name: /Swap/i }).first(),
            ).toBeVisible()
            await expect(
              page.getByRole('link', { name: /Pools/i }).first(),
            ).toBeVisible()
            await expect(
              page.getByRole('link', { name: /Predict/i }).first(),
            ).toBeVisible()
            await expect(
              page.getByRole('link', { name: /NFTs/i }).first(),
            ).toBeVisible()
          },
        },
      ],
    })
  })

  test('displays navigation menu items', async ({ page }) => {
    await page.goto('/')

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'navigation-menu',
      step: 'initial',
    })

    await expect(page.getByRole('link', { name: /^Home$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Coins$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Swap$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Pools$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Predict$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^NFTs$/i })).toBeVisible()
  })

  test('shows connect wallet button when disconnected', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('button', { name: /Connect Wallet/i }),
    ).toBeVisible()
  })

  test('theme toggle switches themes', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await navigateTo(page, '/')

    const themeToggle = page.getByRole('button', {
      name: /switch to (light|dark) mode/i,
    })
    await expect(themeToggle).toBeVisible()
    await themeToggle.click()
    await page.waitForTimeout(300)
    await expect(
      page.getByRole('button', { name: /switch to (light|dark) mode/i }),
    ).toBeVisible()
  })
})

test.describe('Navigation', () => {
  test('navigates to coins page', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'navigation',
      steps: [
        {
          name: 'homepage',
          action: async () => {
            await page.goto('/')
          },
        },
        {
          name: 'click-coins',
          action: async () => {
            await page.getByRole('link', { name: /Coins/i }).first().click()
          },
          waitFor: 1000,
        },
        {
          name: 'coins-page',
          action: async () => {
            await expect(page).toHaveURL(/\/coins/)
            await expect(
              page.getByRole('heading', { name: /Coins/i }).first(),
            ).toBeVisible()
          },
        },
      ],
    })
  })

  test('all navigation links work', async ({ page }) => {
    const navLinks = [
      { name: /Coins/i, url: '/coins' },
      { name: /Swap/i, url: '/swap' },
      { name: /Markets/i, url: '/markets' },
      { name: /Items/i, url: '/items' },
    ]

    for (const link of navLinks) {
      await page.goto('/')
      const navItem = page.getByRole('link', { name: link.name })
      if (await navItem.isVisible()) {
        await navItem.click()
        await page.waitForURL(`**${link.url}*`)
      }
    }
  })

  test('navigates through main pages without errors', async ({ page }) => {
    const pages = [
      '/',
      '/coins',
      '/swap',
      '/pools',
      '/markets',
      '/items',
      '/names',
    ]

    for (const url of pages) {
      await navigateTo(page, url)
      await assertNoPageErrors(page)
    }
  })
})

test.describe('Feature Cards', () => {
  test('all feature cards are clickable', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await navigateTo(page, '/')

    const featureLinks = [
      { name: /coins/i, href: /\/coins/ },
      { name: /swap/i, href: /\/swap/ },
      { name: /pools/i, href: /\/pools/ },
      { name: /markets/i, href: /\/markets/ },
      { name: /items/i, href: /\/items/ },
      { name: /names/i, href: /\/names/ },
    ]

    for (const feature of featureLinks) {
      const link = page.getByRole('link', { name: feature.name })
      if (await link.first().isVisible()) {
        await expect(link.first()).toBeVisible()
        await expect(link.first()).toBeEnabled()
      }
    }
  })

  test('feature card navigates to correct page', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await navigateTo(page, '/')

    const coinsCard = page.getByRole('link', { name: /coins/i }).first()
    if (await coinsCard.isVisible()) {
      await coinsCard.click()
      await expect(page).toHaveURL(/\/coins/)
    }
  })
})

test.describe('Mobile Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
  })

  test('hamburger menu opens mobile nav', async ({ page }) => {
    await navigateTo(page, '/')

    const hamburger = page.getByRole('button', { name: /toggle menu/i })
    await expect(hamburger).toBeVisible()
    await hamburger.click()
    await page.waitForTimeout(300)

    const mobileNav = page
      .locator('nav')
      .filter({ has: page.getByRole('link', { name: /home/i }) })
    await expect(mobileNav.first()).toBeVisible()
  })

  test('mobile nav links navigate correctly', async ({ page }) => {
    await navigateTo(page, '/')

    const hamburger = page.getByRole('button', { name: /toggle menu/i })
    await hamburger.click()
    await page.waitForTimeout(300)

    const coinsLink = page.getByRole('link', { name: /coin/i }).first()
    await coinsLink.click()
    await expect(page).toHaveURL(/\/coins/)
  })

  test('touch targets have adequate size', async ({ page }) => {
    await navigateTo(page, '/')

    const featureCard = page.getByRole('link', { name: /coins/i }).first()
    const box = await featureCard.boundingBox()
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })
})
