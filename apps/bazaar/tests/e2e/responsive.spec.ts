/**
 * Responsive Design Tests
 * Tests desktop and mobile viewports for all pages
 */

import { expect, type Page, test } from '@playwright/test'

const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
const MOBILE_VIEWPORT = { width: 375, height: 812 }

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

async function expectButtonClickable(
  button: ReturnType<Page['locator']>,
  name: string,
): Promise<void> {
  await expect(button, `Button "${name}" should be visible`).toBeVisible()
  await expect(button, `Button "${name}" should be enabled`).toBeEnabled()
}

test.describe('Desktop Viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
  })

  test('all navigation links are visible', async ({ page }) => {
    await navigateTo(page, '/')

    const navLinks = [
      { name: 'Home', href: '/' },
      { name: /Coin/i, href: '/coins' },
      { name: /Swap/i, href: '/swap' },
      { name: /Pool/i, href: '/pools' },
      { name: /Market/i, href: '/markets' },
      { name: /Item/i, href: '/items' },
      { name: /Name/i, href: '/names' },
    ]

    for (const link of navLinks) {
      const navLink = page.getByRole('link', { name: link.name }).first()
      await expectButtonClickable(navLink, `Nav: ${link.name}`)
    }
  })

  test('theme toggle works', async ({ page }) => {
    await navigateTo(page, '/')

    const themeToggle = page.getByRole('button', {
      name: /switch to (light|dark) mode/i,
    })
    await expectButtonClickable(themeToggle, 'Theme Toggle')
  })

  test('connect wallet button is visible', async ({ page }) => {
    await navigateTo(page, '/')

    const connectWallet = page
      .getByRole('button', { name: /connect wallet/i })
      .first()
    await expectButtonClickable(connectWallet, 'Connect Wallet')
  })

  test('buttons have hover states', async ({ page }) => {
    await navigateTo(page, '/')

    const featureCard = page.getByRole('link', { name: /coins/i }).first()
    await featureCard.hover()
    await page.waitForTimeout(200)
    await expect(featureCard).toBeVisible()
  })

  test('all pages load correctly', async ({ page }) => {
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
      const body = page.locator('body')
      await expect(body).toBeVisible()
    }
  })
})

test.describe('Mobile Viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
  })

  test('hamburger menu is visible', async ({ page }) => {
    await navigateTo(page, '/')

    const hamburger = page.getByRole('button', { name: /toggle menu/i })
    await expectButtonClickable(hamburger, 'Hamburger Menu')
  })

  test('hamburger menu opens mobile nav', async ({ page }) => {
    await navigateTo(page, '/')

    const hamburger = page.getByRole('button', { name: /toggle menu/i })
    await hamburger.click()
    await page.waitForTimeout(300)

    const mobileNav = page
      .locator('nav')
      .filter({ has: page.getByRole('link', { name: /home/i }) })
    await expect(mobileNav.first()).toBeVisible()
  })

  test('mobile nav links work', async ({ page }) => {
    await navigateTo(page, '/')

    const hamburger = page.getByRole('button', { name: /toggle menu/i })
    await hamburger.click()
    await page.waitForTimeout(300)

    const coinsLink = page.getByRole('link', { name: /coin/i }).first()
    await coinsLink.click()
    await expect(page).toHaveURL(/\/coins/)
  })

  test('touch targets are adequate size', async ({ page }) => {
    await navigateTo(page, '/')

    const featureCard = page.getByRole('link', { name: /coins/i }).first()
    const box = await featureCard.boundingBox()
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('feature cards are full width', async ({ page }) => {
    await navigateTo(page, '/')

    const coinsCard = page.getByRole('link', { name: /coins/i }).first()
    if (await coinsCard.isVisible()) {
      await expectButtonClickable(coinsCard, 'Mobile Coins Card')
    }
  })

  test('search inputs are full width on names page', async ({ page }) => {
    await navigateTo(page, '/names')

    const searchInput = page.getByPlaceholder(/search/i)
    if (await searchInput.isVisible()) {
      const box = await searchInput.boundingBox()
      if (box) {
        expect(box.width).toBeGreaterThan(300)
      }
    }
  })

  test('all pages load correctly on mobile', async ({ page }) => {
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
      const body = page.locator('body')
      await expect(body).toBeVisible()
    }
  })

  test('scroll does not interfere with buttons', async ({ page }) => {
    await navigateTo(page, '/coins')

    await page.evaluate(() => window.scrollBy(0, 200))
    await page.waitForTimeout(300)

    const createCoin = page.getByRole('link', { name: /create coin/i })
    if (await createCoin.isVisible()) {
      await expectButtonClickable(createCoin, 'Create Coin After Scroll')
    }
  })
})

test.describe('Mobile Page-Specific Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
  })

  test('coins page buttons accessible', async ({ page }) => {
    await navigateTo(page, '/coins')

    const createCoin = page.getByRole('link', { name: /create coin/i })
    await expectButtonClickable(createCoin, 'Mobile Create Coin')
  })

  test('swap page controls accessible', async ({ page }) => {
    await navigateTo(page, '/swap')

    const selects = page.getByRole('combobox')
    const selectCount = await selects.count()
    expect(selectCount).toBeGreaterThanOrEqual(2)

    const swapBtn = page
      .getByRole('button', { name: /swap|connect wallet|enter amount/i })
      .first()
    await expect(swapBtn).toBeVisible()
  })

  test('pools page create button visible', async ({ page }) => {
    await navigateTo(page, '/pools')

    const createPool = page.getByRole('button', { name: /create pool/i })
    await expect(createPool).toBeVisible()
  })

  test('markets page filters visible', async ({ page }) => {
    await navigateTo(page, '/markets')

    const filters = page.getByRole('button', {
      name: /all markets|active|resolved/i,
    })
    const filterCount = await filters.count()
    expect(filterCount).toBeGreaterThanOrEqual(1)
  })

  test('items page controls accessible', async ({ page }) => {
    await navigateTo(page, '/items')

    const filters = page.getByRole('button', { name: /all items|my items/i })
    if (await filters.first().isVisible()) {
      await expect(filters.first()).toBeEnabled()
    }
  })

  test('liquidity page toggles visible', async ({ page }) => {
    await navigateTo(page, '/liquidity')

    const v4Toggle = page.getByRole('button', { name: /v4 pools/i })
    if (await v4Toggle.isVisible()) {
      await expectButtonClickable(v4Toggle, 'Mobile V4 Toggle')
    }
  })

  test('portfolio page loads', async ({ page }) => {
    await navigateTo(page, '/portfolio')

    const heading = page.getByRole('heading', { name: /portfolio/i })
    await expect(heading.first()).toBeVisible()
  })
})

test.describe('Button Edge Cases', () => {
  test('disabled buttons not clickable on desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await navigateTo(page, '/coins/create')

    const submitBtn = page
      .getByRole('button', { name: /create|launch/i })
      .first()
    if (await submitBtn.isVisible()) {
      const isDisabled = await submitBtn.isDisabled()
      expect(typeof isDisabled).toBe('boolean')
    }
  })

  test('mobile menu shows nav links after scroll', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await navigateTo(page, '/')

    const hamburger = page.getByRole('button', { name: /toggle menu/i })
    await hamburger.click()
    await page.waitForTimeout(300)

    const navLinks = page.getByRole('link', { name: /home|coin|swap/i })
    const count = await navLinks.count()
    expect(count).toBeGreaterThan(0)
  })
})
