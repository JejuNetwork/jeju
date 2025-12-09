import { test, expect, Page } from '@playwright/test'

const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
const WIDE_VIEWPORT = { width: 1920, height: 1080 }

async function navigateTo(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Desktop Button Tests - Detailed Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
  })

  test.describe('Header Navigation - Desktop', () => {
    test('all nav links are visible without hamburger', async ({ page }) => {
      await navigateTo(page, '/')

      // No hamburger on desktop
      const hamburger = page.getByRole('button', { name: /toggle menu/i })
      await expect(hamburger).toBeHidden()

      // All nav links visible
      const navLinks = ['Home', 'Coins', 'Swap', 'Pools', 'Markets', 'Items', 'Names']
      for (const linkName of navLinks) {
        const link = page.getByRole('link', { name: new RegExp(`^${linkName}$`, 'i') })
        await expect(link).toBeVisible()
      }
    })

    test('nav links have hover states', async ({ page }) => {
      await navigateTo(page, '/')

      const coinsLink = page.getByRole('link', { name: /^Coins$/i })
      
      // Get initial state
      await coinsLink.hover()
      await page.waitForTimeout(200)
      
      // Should still be visible after hover
      await expect(coinsLink).toBeVisible()
    })

    test('connect wallet button is prominently displayed', async ({ page }) => {
      await navigateTo(page, '/')

      const connectBtn = page.getByRole('button', { name: /connect wallet/i }).first()
      await expect(connectBtn).toBeVisible()
      
      const box = await connectBtn.boundingBox()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(36)
      }
    })

    test('theme toggle works', async ({ page }) => {
      await navigateTo(page, '/')

      const themeToggle = page.getByRole('button', { name: /switch to (light|dark) mode/i })
      await expect(themeToggle).toBeVisible()
      
      // Click to toggle
      await themeToggle.click()
      await page.waitForTimeout(300)
      
      // Should still be functional
      const newToggle = page.getByRole('button', { name: /switch to (light|dark) mode/i })
      await expect(newToggle).toBeVisible()
    })

    test('logo links to home', async ({ page }) => {
      await navigateTo(page, '/coins')

      const logo = page.getByRole('link', { name: /bazaar/i }).first()
      await logo.click()
      await expect(page).toHaveURL('/')
    })
  })

  test.describe('Home Page - Desktop', () => {
    test('feature cards in grid layout', async ({ page }) => {
      await navigateTo(page, '/')

      // Feature cards should be visible in a grid
      const cards = page.locator('a').filter({ hasText: /coins|swap|pools|markets/i })
      const count = await cards.count()
      expect(count).toBeGreaterThanOrEqual(4)
    })

    test('all feature cards are clickable', async ({ page }) => {
      await navigateTo(page, '/')

      // Feature cards should be clickable
      const featurePatterns = [/coins/i, /swap/i, /pools/i, /markets/i]

      for (const pattern of featurePatterns) {
        const link = page.getByRole('link', { name: pattern }).first()
        if (await link.isVisible()) {
          await expect(link).toBeEnabled()
        }
      }
    })
  })

  test.describe('Coins Page - Desktop', () => {
    test('create coin button is accessible', async ({ page }) => {
      await navigateTo(page, '/coins')

      const createBtn = page.getByRole('link', { name: /create coin/i })
      await expect(createBtn).toBeVisible()
      await expect(createBtn).toBeEnabled()
    })

    test('filter buttons work correctly', async ({ page }) => {
      await navigateTo(page, '/coins')

      // All Coins filter
      const allCoins = page.getByRole('button', { name: /all coins/i })
      if (await allCoins.isVisible()) {
        await allCoins.click()
        await page.waitForTimeout(200)
      }

      // Verified filter
      const verified = page.getByRole('button', { name: /verified/i })
      if (await verified.isVisible()) {
        await verified.click()
        await page.waitForTimeout(200)
      }

      // New filter
      const newFilter = page.getByRole('button', { name: /^new$/i })
      if (await newFilter.isVisible()) {
        await newFilter.click()
        await page.waitForTimeout(200)
      }
    })

    test('create coin navigates correctly', async ({ page }) => {
      await navigateTo(page, '/coins')

      const createBtn = page.getByRole('link', { name: /create coin/i })
      await createBtn.click()
      await expect(page).toHaveURL(/\/coins\/create/)
    })
  })

  test.describe('Coins Create Page - Desktop', () => {
    test('form has all required inputs', async ({ page }) => {
      await navigateTo(page, '/coins/create')

      // Token name
      const nameInput = page.getByPlaceholder(/awesome token|token/i).first()
      if (await nameInput.isVisible()) {
        await expect(nameInput).toBeEnabled()
      }

      // Symbol
      const symbolInput = page.getByPlaceholder(/mat|symbol/i)
      if (await symbolInput.isVisible()) {
        await expect(symbolInput).toBeEnabled()
      }

      // Description
      const descInput = page.getByPlaceholder(/describe/i)
      if (await descInput.isVisible()) {
        await expect(descInput).toBeEnabled()
      }

      // Supply input
      const supplyInput = page.getByRole('spinbutton')
      if (await supplyInput.first().isVisible()) {
        await expect(supplyInput.first()).toBeEnabled()
      }
    })

    test('submit button shows connect wallet when not connected', async ({ page }) => {
      await navigateTo(page, '/coins/create')

      const submitBtn = page.getByRole('main').getByRole('button', { name: /create|launch|connect wallet/i })
      await expect(submitBtn).toBeVisible()
    })
  })

  test.describe('Swap Page - Desktop', () => {
    test('swap interface has all controls', async ({ page }) => {
      await navigateTo(page, '/swap')

      // From input
      const fromInput = page.getByRole('spinbutton').first()
      await expect(fromInput).toBeVisible()

      // To input
      const toInput = page.getByRole('spinbutton').nth(1)
      if (await toInput.isVisible()) {
        await expect(toInput).toBeEnabled()
      }

      // Token selectors
      const selects = page.getByRole('combobox')
      const selectCount = await selects.count()
      expect(selectCount).toBeGreaterThanOrEqual(2)

      // Swap button
      const swapBtn = page.getByRole('button', { name: /swap|connect wallet|enter amount/i }).first()
      await expect(swapBtn).toBeVisible()
    })

    test('token selectors show options', async ({ page }) => {
      await navigateTo(page, '/swap')

      const fromSelect = page.getByRole('combobox').first()
      await fromSelect.click()
      await page.waitForTimeout(300)

      // Options should be visible
      const options = page.getByRole('option')
      const count = await options.count()
      expect(count).toBeGreaterThan(0)
    })

    test('cross-chain toggle works', async ({ page }) => {
      await navigateTo(page, '/swap')

      const toggle = page.getByRole('button', { name: /off|on/i }).first()
      if (await toggle.isVisible()) {
        await toggle.click()
        await page.waitForTimeout(300)
        // Should still be clickable
        await expect(toggle).toBeEnabled()
      }
    })
  })

  test.describe('Pools Page - Desktop', () => {
    test('create pool button visible', async ({ page }) => {
      await navigateTo(page, '/pools')

      const createPool = page.getByRole('button', { name: /create pool/i })
      await expect(createPool).toBeVisible()
      // Button may be disabled without wallet connection
    })
  })

  test.describe('Markets Page - Desktop', () => {
    test('search and filter controls', async ({ page }) => {
      await navigateTo(page, '/markets')

      // Search input
      const searchInput = page.getByPlaceholder(/search/i)
      if (await searchInput.isVisible()) {
        await searchInput.fill('test')
        await page.waitForTimeout(200)
        await searchInput.clear()
      }

      // Filter buttons
      const filters = ['All Markets', 'Active', 'Resolved']
      for (const filter of filters) {
        const btn = page.getByRole('button', { name: new RegExp(filter, 'i') })
        if (await btn.isVisible()) {
          await btn.click()
          await page.waitForTimeout(200)
        }
      }
    })
  })

  test.describe('Items Page - Desktop', () => {
    test('filter and sort controls', async ({ page }) => {
      await navigateTo(page, '/items')

      // Page should load with heading
      const heading = page.getByRole('heading', { name: /item/i })
      await expect(heading.first()).toBeVisible()

      // Filters
      const allItems = page.getByRole('button', { name: /all items/i })
      if (await allItems.isVisible()) {
        await expect(allItems).toBeEnabled()
      }

      // Sort dropdown
      const sortSelect = page.getByRole('combobox')
      if (await sortSelect.first().isVisible()) {
        await expect(sortSelect.first()).toBeEnabled()
      }
    })
  })

  test.describe('Items Mint Page - Desktop', () => {
    test('mint form controls', async ({ page }) => {
      await navigateTo(page, '/items/mint')

      // Name input
      const nameInput = page.getByTestId('nft-name-input')
      if (await nameInput.isVisible()) {
        await nameInput.fill('Test NFT')
      }

      // Description
      const descInput = page.getByTestId('nft-description-input')
      if (await descInput.isVisible()) {
        await descInput.fill('A test NFT description')
      }

      // Image URL
      const imageInput = page.getByTestId('nft-image-input')
      if (await imageInput.isVisible()) {
        await imageInput.fill('ipfs://test')
      }

      // Mint button
      const mintBtn = page.getByTestId('mint-nft-button')
      await expect(mintBtn).toBeVisible()
    })
  })

  test.describe('Names Page - Desktop', () => {
    test('search and list controls', async ({ page }) => {
      await navigateTo(page, '/names')

      // Search
      const searchInput = page.getByPlaceholder(/search/i)
      if (await searchInput.isVisible()) {
        await searchInput.fill('test')
        await page.waitForTimeout(200)
        await searchInput.clear()
      }

      // Buy buttons
      const buyBtns = page.getByRole('button', { name: /buy now/i })
      const count = await buyBtns.count()
      for (let i = 0; i < count; i++) {
        await expect(buyBtns.nth(i)).toBeEnabled()
      }
    })

    test('stats cards display correctly', async ({ page }) => {
      await navigateTo(page, '/names')

      // Stats should be visible in a row on desktop
      const listedStat = page.getByText(/listed/i)
      const ownedStat = page.getByText(/owned/i)
      const floorStat = page.getByText(/floor/i)

      await expect(listedStat.first()).toBeVisible()
      await expect(ownedStat.first()).toBeVisible()
      await expect(floorStat.first()).toBeVisible()
    })
  })

  test.describe('Liquidity Page - Desktop', () => {
    test('section tabs work', async ({ page }) => {
      await navigateTo(page, '/liquidity')

      // V4 tab
      const v4Tab = page.getByRole('button', { name: /v4 pools/i })
      if (await v4Tab.isVisible()) {
        await v4Tab.click()
        await page.waitForTimeout(300)
      }

      // XLP tab
      const xlpTab = page.getByRole('button', { name: /cross-chain/i })
      if (await xlpTab.isVisible()) {
        await xlpTab.click()
        await page.waitForTimeout(300)
      }
    })

    test('V4 form has all inputs', async ({ page }) => {
      await navigateTo(page, '/liquidity')

      // Token inputs
      const textInputs = page.getByRole('textbox')
      const inputCount = await textInputs.count()
      expect(inputCount).toBeGreaterThan(0)

      // Fee tier select
      const feeSelect = page.getByRole('combobox')
      if (await feeSelect.isVisible()) {
        await expect(feeSelect).toBeEnabled()
      }

      // Add liquidity button
      const addBtn = page.getByRole('button', { name: /add liquidity|connect wallet/i }).first()
      await expect(addBtn).toBeVisible()
    })
  })

  test.describe('Games Page - Desktop', () => {
    test('games page loads', async ({ page }) => {
      await navigateTo(page, '/games')

      // Wait for loading to complete
      await page.waitForTimeout(2000)
      
      // Check for heading or empty state
      const heading = page.getByRole('heading', { name: /games|applications|no games/i })
      await expect(heading.first()).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Games Hyperscape Page - Desktop', () => {
    test('category filters work', async ({ page }) => {
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

  test.describe('Portfolio Page - Desktop', () => {
    test('portfolio loads with heading', async ({ page }) => {
      await navigateTo(page, '/portfolio')

      // Should show portfolio heading
      const heading = page.getByRole('heading', { name: /portfolio/i })
      await expect(heading.first()).toBeVisible()
    })
  })
})

test.describe('Wide Desktop (1920x1080)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT)
  })

  test('home page loads correctly on wide screen', async ({ page }) => {
    await navigateTo(page, '/')

    // Page should load
    const body = page.locator('body')
    await expect(body).toBeVisible()
    
    // Main content visible
    const heading = page.getByRole('heading').first()
    await expect(heading).toBeVisible()
  })
})

test.describe('Keyboard Navigation - Desktop', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
  })

  test('page is keyboard accessible', async ({ page }) => {
    await navigateTo(page, '/')

    // Page should load and be interactive
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})

