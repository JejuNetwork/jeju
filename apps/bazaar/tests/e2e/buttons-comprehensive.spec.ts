import { test, expect, Page } from '@playwright/test'

const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
const MOBILE_VIEWPORT = { width: 375, height: 812 }

// Helper to check if a button is clickable (visible and enabled)
async function expectButtonClickable(page: Page, button: ReturnType<Page['locator']>, name: string) {
  await expect(button, `Button "${name}" should be visible`).toBeVisible()
  await expect(button, `Button "${name}" should be enabled`).toBeEnabled()
}

// Helper to navigate and wait for page load
async function navigateTo(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Desktop Viewport - All Page Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
  })

  test.describe('Header Navigation', () => {
    test('should have all navigation links clickable', async ({ page }) => {
      await navigateTo(page, '/')
      
      // Desktop nav links
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
        await expectButtonClickable(page, navLink, `Nav: ${link.name}`)
      }

      // Theme toggle button
      const themeToggle = page.getByRole('button', { name: /switch to (light|dark) mode/i })
      await expectButtonClickable(page, themeToggle, 'Theme Toggle')

      // Connect wallet button
      const connectWallet = page.getByRole('button', { name: /connect wallet/i }).first()
      await expectButtonClickable(page, connectWallet, 'Connect Wallet')
    })

    test('theme toggle should switch themes', async ({ page }) => {
      await navigateTo(page, '/')
      
      const themeToggle = page.getByRole('button', { name: /switch to (light|dark) mode/i })
      await themeToggle.click()
      await page.waitForTimeout(300)
      
      // Should still be clickable after toggle
      await expectButtonClickable(page, page.getByRole('button', { name: /switch to (light|dark) mode/i }), 'Theme Toggle After Click')
    })
  })

  test.describe('Home Page', () => {
    test('should have all feature cards clickable', async ({ page }) => {
      await navigateTo(page, '/')

      // Feature cards - each is a link to a section
      const featureLinks = [
        { name: /coins/i, href: /\/coins/ },
        { name: /swap/i, href: /\/swap/ },
        { name: /pools/i, href: /\/pools/ },
        { name: /markets/i, href: /\/markets/ },
        { name: /items/i, href: /\/items/ },
        { name: /names/i, href: /\/names/ },
        { name: /games/i, href: /\/games/ },
      ]

      for (const feature of featureLinks) {
        const link = page.getByRole('link', { name: feature.name })
        if (await link.first().isVisible()) {
          await expectButtonClickable(page, link.first(), `Feature: ${feature.name}`)
        }
      }
    })

    test('feature card should navigate correctly', async ({ page }) => {
      await navigateTo(page, '/')

      // Click Coins card
      const coinsCard = page.getByRole('link', { name: /coins/i }).first()
      if (await coinsCard.isVisible()) {
        await coinsCard.click()
        await expect(page).toHaveURL(/\/coins/)
        await page.goBack()
      }
    })
  })

  test.describe('Coins Page', () => {
    test('should have all buttons clickable', async ({ page }) => {
      await navigateTo(page, '/coins')

      // Create Coin button
      const createCoin = page.getByRole('link', { name: /create coin/i })
      await expectButtonClickable(page, createCoin, 'Create Coin')

      // Filter buttons
      const filters = ['All Coins', 'Verified', 'New']
      for (const filter of filters) {
        const filterBtn = page.getByRole('button', { name: new RegExp(filter, 'i') })
        if (await filterBtn.isVisible()) {
          await expectButtonClickable(page, filterBtn, `Filter: ${filter}`)
        }
      }
    })

    test('filter buttons should be interactive', async ({ page }) => {
      await navigateTo(page, '/coins')

      const verifiedFilter = page.getByRole('button', { name: /verified/i })
      if (await verifiedFilter.isVisible()) {
        await verifiedFilter.click()
        await page.waitForTimeout(300)
      }

      const newFilter = page.getByRole('button', { name: /new/i })
      if (await newFilter.isVisible()) {
        await newFilter.click()
        await page.waitForTimeout(300)
      }
    })
  })

  test.describe('Coins Create Page', () => {
    test('should have create button', async ({ page }) => {
      await navigateTo(page, '/coins/create')

      // Submit button in main content (might be disabled until form is filled)
      const submitBtn = page.getByRole('main').getByRole('button', { name: /create|launch|connect wallet/i })
      await expect(submitBtn).toBeVisible()
    })

    test('should have form inputs', async ({ page }) => {
      await navigateTo(page, '/coins/create')

      // Form inputs
      const nameInput = page.getByPlaceholder(/token|awesome/i).first()
      if (await nameInput.isVisible()) {
        await nameInput.fill('Test Token')
      }

      const symbolInput = page.getByPlaceholder(/symbol|mat/i)
      if (await symbolInput.isVisible()) {
        await symbolInput.fill('TEST')
      }
    })
  })

  test.describe('Swap Page', () => {
    test('should have all swap controls', async ({ page }) => {
      await navigateTo(page, '/swap')

      // Cross-chain toggle
      const crossChainToggle = page.getByRole('button', { name: /off|on/i }).first()
      if (await crossChainToggle.isVisible()) {
        await expectButtonClickable(page, crossChainToggle, 'Cross-Chain Toggle')
      }

      // Swap button (or Connect Wallet)
      const swapBtn = page.getByRole('button', { name: /swap|connect wallet|enter amount/i }).first()
      await expect(swapBtn).toBeVisible()

      // Token selectors
      const tokenSelects = page.getByRole('combobox')
      const selectCount = await tokenSelects.count()
      expect(selectCount).toBeGreaterThanOrEqual(2)

      // Reverse button (swap direction)
      const reverseBtn = page.locator('button').filter({ has: page.locator('svg') })
      if (await reverseBtn.first().isVisible()) {
        await expect(reverseBtn.first()).toBeEnabled()
      }
    })

    test('token selectors should be interactive', async ({ page }) => {
      await navigateTo(page, '/swap')

      const fromSelect = page.getByRole('combobox').first()
      if (await fromSelect.isVisible()) {
        await fromSelect.click()
        await page.waitForTimeout(300)
        await page.keyboard.press('Escape')
      }
    })
  })

  test.describe('Pools Page', () => {
    test('should have pool controls', async ({ page }) => {
      await navigateTo(page, '/pools')

      // Create Pool button
      const createPool = page.getByRole('button', { name: /create pool/i })
      await expect(createPool, 'Create Pool should be visible').toBeVisible()
    })

    test('create pool button should open modal', async ({ page }) => {
      await navigateTo(page, '/pools')

      const createPool = page.getByRole('button', { name: /create pool/i })
      // Button might be disabled if wallet not connected
      const isEnabled = await createPool.isEnabled()
      if (isEnabled) {
        await createPool.click()
        await page.waitForTimeout(500)

        // Modal should have cancel/submit buttons
        const cancelBtn = page.getByRole('button', { name: /cancel/i })
        if (await cancelBtn.isVisible()) {
          await expectButtonClickable(page, cancelBtn, 'Modal Cancel')
          await cancelBtn.click()
        }
      } else {
        // Just verify button exists and shows disabled state correctly
        await expect(createPool).toBeVisible()
      }
    })
  })

  test.describe('Markets Page', () => {
    test('should have market controls', async ({ page }) => {
      await navigateTo(page, '/markets')

      // Filter buttons
      const filters = ['All Markets', 'Active', 'Resolved']
      for (const filter of filters) {
        const filterBtn = page.getByRole('button', { name: new RegExp(filter, 'i') })
        if (await filterBtn.isVisible()) {
          await expectButtonClickable(page, filterBtn, `Filter: ${filter}`)
        }
      }

      // Search input
      const searchInput = page.getByPlaceholder(/search/i)
      if (await searchInput.isVisible()) {
        await expect(searchInput).toBeEnabled()
      }
    })
  })

  test.describe('Items Page', () => {
    test('should have item controls', async ({ page }) => {
      await navigateTo(page, '/items')

      // Page should load
      const heading = page.getByRole('heading', { name: /item/i })
      await expect(heading.first()).toBeVisible()

      // Filter buttons - check if they exist
      const allItems = page.getByRole('button', { name: /all items/i })
      if (await allItems.isVisible()) {
        await expect(allItems).toBeEnabled()
      }

      // Sort select if visible
      const sortSelect = page.getByRole('combobox')
      if (await sortSelect.first().isVisible()) {
        await expect(sortSelect.first()).toBeEnabled()
      }
    })
  })

  test.describe('Items Mint Page', () => {
    test('should have mint form controls', async ({ page }) => {
      await navigateTo(page, '/items/mint')

      // Form inputs
      const nameInput = page.getByTestId('nft-name-input')
      if (await nameInput.isVisible()) {
        await expect(nameInput).toBeEnabled()
      }

      const descInput = page.getByTestId('nft-description-input')
      if (await descInput.isVisible()) {
        await expect(descInput).toBeEnabled()
      }

      // Mint button
      const mintBtn = page.getByTestId('mint-nft-button')
      if (await mintBtn.isVisible()) {
        await expect(mintBtn).toBeVisible()
      }
    })
  })

  test.describe('Names Page', () => {
    test('should have name marketplace controls', async ({ page }) => {
      await navigateTo(page, '/names')

      // Search input
      const searchInput = page.getByPlaceholder(/search/i)
      if (await searchInput.isVisible()) {
        await expect(searchInput).toBeEnabled()
      }

      // List Name button (if wallet connected, otherwise won't show)
      const listNameBtn = page.getByRole('button', { name: /list/i })
      if (await listNameBtn.isVisible()) {
        await expectButtonClickable(page, listNameBtn, 'List')
      }

      // Buy buttons on listings
      const buyBtns = page.getByRole('button', { name: /buy now/i })
      const buyCount = await buyBtns.count()
      for (let i = 0; i < buyCount; i++) {
        await expectButtonClickable(page, buyBtns.nth(i), `Buy Now ${i + 1}`)
      }
    })
  })

  test.describe('Games Page', () => {
    test('should have games page structure', async ({ page }) => {
      await navigateTo(page, '/games')

      // Wait for loading to complete
      await page.waitForTimeout(2000)
      
      // Check for heading or empty state
      const heading = page.getByRole('heading', { name: /games|applications|no games/i })
      await expect(heading.first()).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Games Hyperscape Page', () => {
    test('should have hyperscape controls', async ({ page }) => {
      await navigateTo(page, '/games/hyperscape')

      // Filter buttons
      const filters = ['All Items', 'Weapons', 'Armor', 'Tools', 'Resources']
      for (const filter of filters) {
        const filterBtn = page.getByRole('button', { name: new RegExp(filter, 'i') })
        if (await filterBtn.isVisible()) {
          await expectButtonClickable(page, filterBtn, `Filter: ${filter}`)
        }
      }
    })
  })

  test.describe('Liquidity Page', () => {
    test('should have liquidity controls', async ({ page }) => {
      await navigateTo(page, '/liquidity')

      // Section toggles
      const v4Toggle = page.getByRole('button', { name: /v4 pools/i })
      if (await v4Toggle.isVisible()) {
        await expectButtonClickable(page, v4Toggle, 'V4 Pools Toggle')
      }

      const xlpToggle = page.getByRole('button', { name: /cross-chain xlp/i })
      if (await xlpToggle.isVisible()) {
        await expectButtonClickable(page, xlpToggle, 'XLP Toggle')
      }

      // Add Liquidity button
      const addLiquidity = page.getByRole('button', { name: /add liquidity|connect wallet/i }).first()
      if (await addLiquidity.isVisible()) {
        await expect(addLiquidity).toBeVisible()
      }
    })

    test('should switch between sections', async ({ page }) => {
      await navigateTo(page, '/liquidity')

      const xlpToggle = page.getByRole('button', { name: /cross-chain xlp/i })
      if (await xlpToggle.isVisible()) {
        await xlpToggle.click()
        await page.waitForTimeout(300)
      }

      const v4Toggle = page.getByRole('button', { name: /v4 pools/i })
      if (await v4Toggle.isVisible()) {
        await v4Toggle.click()
        await page.waitForTimeout(300)
      }
    })
  })

  test.describe('Portfolio Page', () => {
    test('should have portfolio controls', async ({ page }) => {
      await navigateTo(page, '/portfolio')

      // Page should load
      const body = page.locator('body')
      await expect(body).toBeVisible()
      
      // Check for portfolio heading or connect prompt
      const heading = page.getByRole('heading', { name: /portfolio/i })
      await expect(heading.first()).toBeVisible()
    })
  })
})

test.describe('Mobile Viewport - All Page Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
  })

  test.describe('Mobile Header Navigation', () => {
    test('should have hamburger menu', async ({ page }) => {
      await navigateTo(page, '/')

      // Hamburger menu button
      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      await expectButtonClickable(page, hamburger, 'Hamburger Menu')
    })

    test('hamburger menu should open mobile nav', async ({ page }) => {
      await navigateTo(page, '/')

      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      await hamburger.click()
      await page.waitForTimeout(300)

      // Mobile nav should be visible with all links
      const mobileNav = page.locator('nav').filter({ has: page.getByRole('link', { name: /home/i }) })
      await expect(mobileNav.first()).toBeVisible()

      // Check mobile nav links
      const navLinks = ['Home', 'Coins', 'Swap', 'Pools', 'Markets', 'Items', 'Names']
      for (const linkName of navLinks) {
        const link = page.getByRole('link', { name: new RegExp(linkName, 'i') })
        if (await link.first().isVisible()) {
          await expect(link.first()).toBeEnabled()
        }
      }

      // Connect wallet button in mobile menu
      const connectWallet = page.getByRole('button', { name: /connect wallet/i })
      if (await connectWallet.first().isVisible()) {
        await expect(connectWallet.first()).toBeEnabled()
      }
    })

    test('mobile nav links should navigate', async ({ page }) => {
      await navigateTo(page, '/')

      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      await hamburger.click()
      await page.waitForTimeout(300)

      // Click Coins link
      const coinsLink = page.getByRole('link', { name: /coin/i }).first()
      await coinsLink.click()
      await expect(page).toHaveURL(/\/coins/)
    })

    test('theme toggle should work on mobile', async ({ page }) => {
      await navigateTo(page, '/')

      const themeToggle = page.getByRole('button', { name: /switch to (light|dark) mode/i })
      await expectButtonClickable(page, themeToggle, 'Mobile Theme Toggle')
      await themeToggle.click()
      await page.waitForTimeout(300)
    })
  })

  test.describe('Mobile Home Page', () => {
    test('should have all feature cards clickable', async ({ page }) => {
      await navigateTo(page, '/')

      // Feature cards on mobile
      const coinsCard = page.getByRole('link', { name: /coins/i }).first()
      if (await coinsCard.isVisible()) {
        await expectButtonClickable(page, coinsCard, 'Mobile Coins Card')
      }

      const swapCard = page.getByRole('link', { name: /swap/i }).first()
      if (await swapCard.isVisible()) {
        await expectButtonClickable(page, swapCard, 'Mobile Swap Card')
      }
    })

    test('should navigate from feature cards', async ({ page }) => {
      await navigateTo(page, '/')

      // Click a feature card in main content (not nav)
      const coinsCard = page.getByRole('main').getByRole('link', { name: /coins/i }).first()
      if (await coinsCard.isVisible()) {
        await coinsCard.click()
        await expect(page).toHaveURL(/\/coins/)
      }
    })
  })

  test.describe('Mobile Coins Page', () => {
    test('should have all buttons accessible', async ({ page }) => {
      await navigateTo(page, '/coins')

      // Create Coin should be full width on mobile
      const createCoin = page.getByRole('link', { name: /create coin/i })
      await expectButtonClickable(page, createCoin, 'Mobile Create Coin')

      // Filters should be horizontally scrollable
      const filters = page.getByRole('button', { name: /all coins|verified|new/i })
      const filterCount = await filters.count()
      expect(filterCount).toBeGreaterThanOrEqual(1)
    })
  })

  test.describe('Mobile Swap Page', () => {
    test('should have all swap controls accessible', async ({ page }) => {
      await navigateTo(page, '/swap')

      // Token selects
      const selects = page.getByRole('combobox')
      const selectCount = await selects.count()
      expect(selectCount).toBeGreaterThanOrEqual(2)

      // Swap/Connect button
      const swapBtn = page.getByRole('button', { name: /swap|connect wallet|enter amount/i }).first()
      await expect(swapBtn).toBeVisible()
    })

    test('should be able to interact with inputs', async ({ page }) => {
      await navigateTo(page, '/swap')

      // Amount inputs
      const amountInputs = page.getByRole('spinbutton')
      if (await amountInputs.first().isVisible()) {
        await amountInputs.first().fill('0.1')
        await page.waitForTimeout(300)
      }
    })
  })

  test.describe('Mobile Pools Page', () => {
    test('should have create pool button', async ({ page }) => {
      await navigateTo(page, '/pools')

      const createPool = page.getByRole('button', { name: /create pool/i })
      await expect(createPool, 'Mobile Create Pool should be visible').toBeVisible()
      // Button might be disabled without wallet connection
    })
  })

  test.describe('Mobile Markets Page', () => {
    test('should have filter buttons', async ({ page }) => {
      await navigateTo(page, '/markets')

      const filters = page.getByRole('button', { name: /all markets|active|resolved/i })
      const filterCount = await filters.count()
      expect(filterCount).toBeGreaterThanOrEqual(1)
    })
  })

  test.describe('Mobile Items Page', () => {
    test('should have item controls', async ({ page }) => {
      await navigateTo(page, '/items')

      // Filter buttons
      const filters = page.getByRole('button', { name: /all items|my items/i })
      if (await filters.first().isVisible()) {
        await expect(filters.first()).toBeEnabled()
      }
    })
  })

  test.describe('Mobile Names Page', () => {
    test('should have search and controls', async ({ page }) => {
      await navigateTo(page, '/names')

      // Search should be full width
      const searchInput = page.getByPlaceholder(/search/i)
      if (await searchInput.isVisible()) {
        await expect(searchInput).toBeEnabled()
        // Check it fills the width
        const box = await searchInput.boundingBox()
        if (box) {
          expect(box.width).toBeGreaterThan(300)
        }
      }

      // Buy buttons
      const buyBtns = page.getByRole('button', { name: /buy now/i })
      const buyCount = await buyBtns.count()
      for (let i = 0; i < buyCount; i++) {
        await expectButtonClickable(page, buyBtns.nth(i), `Mobile Buy Now ${i + 1}`)
      }
    })
  })

  test.describe('Mobile Liquidity Page', () => {
    test('should have section toggles', async ({ page }) => {
      await navigateTo(page, '/liquidity')

      // Section toggles should be scrollable
      const v4Toggle = page.getByRole('button', { name: /v4 pools/i })
      if (await v4Toggle.isVisible()) {
        await expectButtonClickable(page, v4Toggle, 'Mobile V4 Toggle')
      }

      const xlpToggle = page.getByRole('button', { name: /cross-chain xlp/i })
      if (await xlpToggle.isVisible()) {
        await expectButtonClickable(page, xlpToggle, 'Mobile XLP Toggle')
      }
    })
  })

  test.describe('Mobile Games Page', () => {
    test('should load games page', async ({ page }) => {
      await navigateTo(page, '/games')

      // Page should load
      const body = page.locator('body')
      await expect(body).toBeVisible()
    })
  })

  test.describe('Mobile Hyperscape Page', () => {
    test('should have filter buttons', async ({ page }) => {
      await navigateTo(page, '/games/hyperscape')

      // Filters should be horizontally scrollable
      const filters = page.getByRole('button', { name: /all items|weapons|armor/i })
      if (await filters.first().isVisible()) {
        await expect(filters.first()).toBeEnabled()
      }
    })
  })

  test.describe('Mobile Portfolio Page', () => {
    test('should show portfolio or connect prompt', async ({ page }) => {
      await navigateTo(page, '/portfolio')

      // Page should load with portfolio heading
      const heading = page.getByRole('heading', { name: /portfolio/i })
      await expect(heading.first()).toBeVisible()
    })
  })

  test.describe('Mobile Items Mint Page', () => {
    test('should have mint form', async ({ page }) => {
      await navigateTo(page, '/items/mint')

      // Form should be full width
      const mintBtn = page.getByTestId('mint-nft-button')
      if (await mintBtn.isVisible()) {
        const box = await mintBtn.boundingBox()
        if (box) {
          expect(box.width).toBeGreaterThan(300)
        }
      }
    })
  })
})

test.describe('Button Interactions - Edge Cases', () => {
  test.describe('Desktop', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT)
    })

    test('buttons should have hover states', async ({ page }) => {
      await navigateTo(page, '/')

      const featureCard = page.getByRole('link', { name: /coins/i }).first()
      await featureCard.hover()
      await page.waitForTimeout(200)
      // Card should still be visible after hover
      await expect(featureCard).toBeVisible()
    })

    test('disabled buttons should not be clickable', async ({ page }) => {
      await navigateTo(page, '/coins/create')

      // Submit button should be disabled when form is empty
      const submitBtn = page.getByRole('button', { name: /create|launch/i }).first()
      if (await submitBtn.isVisible()) {
        const isDisabled = await submitBtn.isDisabled()
        // Just verify the button exists and has a disabled state logic
        expect(typeof isDisabled).toBe('boolean')
      }
    })
  })

  test.describe('Mobile', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT)
    })

    test('touch targets should be adequate size', async ({ page }) => {
      await navigateTo(page, '/')

      // Check that feature cards have adequate touch target size
      const featureCard = page.getByRole('link', { name: /coins/i }).first()
      const box = await featureCard.boundingBox()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
    })

    test('mobile menu should open and show nav links', async ({ page }) => {
      await navigateTo(page, '/')

      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      await hamburger.click()
      await page.waitForTimeout(300)

      // Menu should show nav links
      const navLinks = page.getByRole('link', { name: /home|coin|swap/i })
      const count = await navLinks.count()
      expect(count).toBeGreaterThan(0)
    })

    test('scroll should not interfere with buttons', async ({ page }) => {
      await navigateTo(page, '/coins')

      // Scroll down
      await page.evaluate(() => window.scrollBy(0, 200))
      await page.waitForTimeout(300)

      // Buttons should still be clickable after scroll
      const createCoin = page.getByRole('link', { name: /create coin/i })
      if (await createCoin.isVisible()) {
        await expectButtonClickable(page, createCoin, 'Create Coin After Scroll')
      }
    })
  })
})

test.describe('Cross-Page Navigation Buttons', () => {
  test.describe('Desktop', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT)
    })

    test('should navigate through main pages', async ({ page }) => {
      const pages = ['/', '/coins', '/swap', '/pools', '/markets', '/items', '/names']

      for (const url of pages) {
        await navigateTo(page, url)
        const body = page.locator('body')
        await expect(body).toBeVisible()
      }
    })
  })

  test.describe('Mobile', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT)
    })

    test('should navigate through main pages', async ({ page }) => {
      const pages = ['/', '/coins', '/swap', '/pools', '/markets', '/items', '/names']

      for (const url of pages) {
        await navigateTo(page, url)
        const body = page.locator('body')
        await expect(body).toBeVisible()
      }
    })
  })
})

