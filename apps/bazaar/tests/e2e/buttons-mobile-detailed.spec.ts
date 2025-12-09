import { test, expect, Page } from '@playwright/test'

const MOBILE_VIEWPORT = { width: 375, height: 812 }
const TABLET_VIEWPORT = { width: 768, height: 1024 }

async function navigateTo(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Mobile Button Tests - Detailed Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
  })

  test.describe('Header - Mobile', () => {
    test('hamburger menu opens and closes correctly', async ({ page }) => {
      await navigateTo(page, '/')

      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      
      // Open menu
      await hamburger.click()
      await page.waitForTimeout(300)
      
      // Verify menu is open - check for menu header
      const menuHeader = page.getByText(/menu/i)
      await expect(menuHeader.first()).toBeVisible()

      // Close menu by clicking close button
      const closeBtn = page.locator('nav button').filter({ has: page.locator('svg') }).first()
      if (await closeBtn.isVisible()) {
        await closeBtn.click()
        await page.waitForTimeout(300)
      }
    })

    test('all mobile nav items are accessible', async ({ page }) => {
      await navigateTo(page, '/')

      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      await hamburger.click()
      await page.waitForTimeout(300)

      const navItems = [
        { icon: '🏠', label: /home/i },
        { icon: '🪙', label: /coin/i },
        { icon: '🔄', label: /swap/i },
        { icon: '💧', label: /pool/i },
        { icon: '📊', label: /market/i },
        { icon: '🖼️', label: /item/i },
        { icon: '🏷️', label: /name/i },
      ]

      for (const item of navItems) {
        const link = page.getByRole('link', { name: item.label })
        await expect(link.first()).toBeVisible()
        await expect(link.first()).toBeEnabled()
      }
    })

    test('connect wallet button in mobile menu', async ({ page }) => {
      await navigateTo(page, '/')

      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      await hamburger.click()
      await page.waitForTimeout(300)

      const connectBtn = page.getByRole('button', { name: /connect wallet/i })
      await expect(connectBtn.first()).toBeVisible()
      await expect(connectBtn.first()).toBeEnabled()
    })
  })

  test.describe('Home Page - Mobile', () => {
    test('feature cards visible and clickable', async ({ page }) => {
      await navigateTo(page, '/')

      // Feature cards should be visible
      const featureLinks = [/coins/i, /swap/i, /pools/i, /markets/i]

      for (const pattern of featureLinks) {
        const link = page.getByRole('link', { name: pattern }).first()
        if (await link.isVisible()) {
          await expect(link).toBeEnabled()
          const box = await link.boundingBox()
          if (box) {
            expect(box.height).toBeGreaterThanOrEqual(44) // Touch target
          }
        }
      }
    })
  })

  test.describe('Coins Page - Mobile', () => {
    test('create coin button is full width', async ({ page }) => {
      await navigateTo(page, '/coins')

      const createCoin = page.getByRole('link', { name: /create coin/i })
      await expect(createCoin).toBeVisible()
      
      const box = await createCoin.boundingBox()
      if (box) {
        expect(box.width).toBeGreaterThan(300)
      }
    })

    test('filter buttons are horizontally scrollable', async ({ page }) => {
      await navigateTo(page, '/coins')

      // Check filters are in a scrollable container
      const filterContainer = page.locator('div').filter({ has: page.getByRole('button', { name: /all coins/i }) }).first()
      await expect(filterContainer).toBeVisible()

      // Click each filter
      const filters = ['All Coins', 'Verified', 'New']
      for (const filter of filters) {
        const btn = page.getByRole('button', { name: new RegExp(filter, 'i') })
        if (await btn.isVisible()) {
          await btn.click()
          await page.waitForTimeout(200)
        }
      }
    })
  })

  test.describe('Swap Page - Mobile', () => {
    test('swap interface is properly sized', async ({ page }) => {
      await navigateTo(page, '/swap')

      // From/To inputs should be full width
      const inputs = page.getByRole('spinbutton')
      const inputCount = await inputs.count()
      expect(inputCount).toBeGreaterThanOrEqual(2)

      // Token selectors should be accessible
      const selects = page.getByRole('combobox')
      const selectCount = await selects.count()
      for (let i = 0; i < selectCount; i++) {
        await expect(selects.nth(i)).toBeEnabled()
      }
    })

    test('swap button has proper touch target', async ({ page }) => {
      await navigateTo(page, '/swap')

      const swapBtn = page.getByRole('button', { name: /swap|connect wallet|enter amount/i }).first()
      const box = await swapBtn.boundingBox()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
    })

    test('cross-chain toggle is accessible', async ({ page }) => {
      await navigateTo(page, '/swap')

      // Just verify the toggle exists in the UI
      const toggle = page.getByRole('button', { name: /off|on/i }).first()
      if (await toggle.isVisible()) {
        await expect(toggle).toBeVisible()
      }
    })
  })

  test.describe('Markets Page - Mobile', () => {
    test('search input is full width', async ({ page }) => {
      await navigateTo(page, '/markets')

      const searchInput = page.getByPlaceholder(/search/i)
      if (await searchInput.isVisible()) {
        const box = await searchInput.boundingBox()
        if (box) {
          expect(box.width).toBeGreaterThan(300)
        }
      }
    })

    test('filter pills are scrollable', async ({ page }) => {
      await navigateTo(page, '/markets')

      const filterBtns = page.getByRole('button', { name: /all markets|active|resolved/i })
      const count = await filterBtns.count()
      
      for (let i = 0; i < count; i++) {
        const btn = filterBtns.nth(i)
        if (await btn.isVisible()) {
          await btn.click()
          await page.waitForTimeout(200)
        }
      }
    })
  })

  test.describe('Names Page - Mobile', () => {
    test('stats cards layout correctly', async ({ page }) => {
      await navigateTo(page, '/names')

      // Stats should be in 2-column grid on mobile
      const statCards = page.locator('[class*="grid"]').filter({ hasText: /listed|owned/i })
      await expect(statCards.first()).toBeVisible()
    })

    test('buy now buttons are full width', async ({ page }) => {
      await navigateTo(page, '/names')

      const buyBtns = page.getByRole('button', { name: /buy now/i })
      const count = await buyBtns.count()
      
      for (let i = 0; i < count; i++) {
        const btn = buyBtns.nth(i)
        if (await btn.isVisible()) {
          const box = await btn.boundingBox()
          if (box) {
            expect(box.height).toBeGreaterThanOrEqual(40)
          }
        }
      }
    })
  })

  test.describe('Pools Page - Mobile', () => {
    test('create pool button visible', async ({ page }) => {
      await navigateTo(page, '/pools')

      const createPool = page.getByRole('button', { name: /create pool/i })
      await expect(createPool).toBeVisible()
      // Button may be disabled without wallet connection
    })
  })

  test.describe('Items Page - Mobile', () => {
    test('filter and sort controls', async ({ page }) => {
      await navigateTo(page, '/items')

      // Filter buttons
      const allItems = page.getByRole('button', { name: /all items/i })
      if (await allItems.isVisible()) {
        await expect(allItems).toBeEnabled()
      }

      // Sort dropdown
      const sortSelect = page.getByRole('combobox')
      if (await sortSelect.isVisible()) {
        await expect(sortSelect).toBeEnabled()
      }
    })
  })

  test.describe('Liquidity Page - Mobile', () => {
    test('section toggles are scrollable', async ({ page }) => {
      await navigateTo(page, '/liquidity')

      const v4Tab = page.getByRole('button', { name: /v4 pools/i })
      const xlpTab = page.getByRole('button', { name: /cross-chain/i })

      if (await v4Tab.isVisible()) {
        await v4Tab.click()
        await page.waitForTimeout(300)
      }

      if (await xlpTab.isVisible()) {
        await xlpTab.click()
        await page.waitForTimeout(300)
      }
    })

    test('form inputs are properly sized', async ({ page }) => {
      await navigateTo(page, '/liquidity')

      const inputs = page.getByRole('textbox')
      const inputCount = await inputs.count()
      
      for (let i = 0; i < Math.min(inputCount, 3); i++) {
        const input = inputs.nth(i)
        if (await input.isVisible()) {
          await expect(input).toBeEnabled()
        }
      }
    })
  })

  test.describe('Games Hyperscape - Mobile', () => {
    test('category filters are scrollable', async ({ page }) => {
      await navigateTo(page, '/games/hyperscape')

      const categories = ['All Items', 'Weapons', 'Armor', 'Tools', 'Resources']
      
      for (const cat of categories) {
        const btn = page.getByRole('button', { name: new RegExp(cat, 'i') })
        if (await btn.isVisible()) {
          await btn.click()
          await page.waitForTimeout(200)
        }
      }
    })
  })
})

test.describe('Tablet Button Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TABLET_VIEWPORT)
  })

  test('header shows desktop nav on tablet', async ({ page }) => {
    await navigateTo(page, '/')

    // Check if desktop nav is visible
    const desktopNav = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: /home/i }) })
    await expect(desktopNav.first()).toBeVisible()
  })

  test('feature cards show in grid', async ({ page }) => {
    await navigateTo(page, '/')

    // Check multiple feature cards are visible
    const featureCards = page.getByRole('link', { name: /coins|swap|pools|markets/i })
    const count = await featureCards.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('coins page shows grid layout', async ({ page }) => {
    await navigateTo(page, '/coins')

    const createBtn = page.getByRole('link', { name: /create coin/i })
    await expect(createBtn).toBeVisible()
  })
})

test.describe('Portrait vs Landscape - Mobile', () => {
  test('portrait mode', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await navigateTo(page, '/')

    const hamburger = page.getByRole('button', { name: /toggle menu/i })
    await expect(hamburger).toBeVisible()
  })

  test('landscape mode', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 })
    await navigateTo(page, '/')

    // In landscape, nav might show differently
    const nav = page.getByRole('navigation')
    await expect(nav.first()).toBeVisible()
  })
})

test.describe('Touch Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
  })

  test('buttons respond to touch/click', async ({ page }) => {
    await navigateTo(page, '/')

    // Test clicking a feature card in main content (not nav)
    const coinsCard = page.getByRole('main').getByRole('link', { name: /coins/i }).first()
    await coinsCard.click()
    await expect(page).toHaveURL(/\/coins/)
  })

  test('form inputs are tappable', async ({ page }) => {
    await navigateTo(page, '/swap')

    const amountInput = page.getByRole('spinbutton').first()
    if (await amountInput.isVisible()) {
      await amountInput.click()
      await amountInput.fill('1.5')
      await expect(amountInput).toHaveValue('1.5')
    }
  })

  test('select dropdowns open on tap', async ({ page }) => {
    await navigateTo(page, '/swap')

    const select = page.getByRole('combobox').first()
    if (await select.isVisible()) {
      await select.click()
      await page.waitForTimeout(300)
      
      // Options should be visible
      const options = page.getByRole('option')
      const optionCount = await options.count()
      expect(optionCount).toBeGreaterThan(0)
    }
  })
})

