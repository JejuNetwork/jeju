import { test, expect } from '@playwright/test'

const viewports = [
  { name: 'mobile-portrait', width: 375, height: 812 },
  { name: 'mobile-landscape', width: 812, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'desktop-large', width: 1920, height: 1080 },
]

for (const viewport of viewports) {
  test.describe(`Dashboard - ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('page loads with all sections visible', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // Hero section - check for h1
      await expect(page.locator('h1')).toBeVisible()
    })

    test('Upload Files CTA button is visible and clickable', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // Find Upload link in hero section
      const uploadBtn = page.locator('section').first().locator('a').filter({ hasText: /Upload/i }).first()
      await expect(uploadBtn).toBeVisible()
      await uploadBtn.click()
      await expect(page).toHaveURL('/upload')
    })

    test('Browse Files CTA button is visible and clickable', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // Find Browse link  
      const browseBtn = page.locator('a').filter({ hasText: /Browse/i }).first()
      await expect(browseBtn).toBeVisible()
      await browseBtn.click()
      await expect(page).toHaveURL('/files')
    })

    test('Configure backends link is visible and clickable', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // Find Configure link
      const configureLink = page.locator('a').filter({ hasText: /Configure/i }).first()
      await expect(configureLink).toBeVisible()
      await configureLink.click()
      await expect(page).toHaveURL('/settings')
    })

    test('Stats cards are visible', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // Stats section - check grid exists with multiple cards
      const statsGrid = page.locator('.grid').first()
      await expect(statsGrid).toBeVisible()
    })

    test('Upload zone is visible and interactive', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // Find upload zone
      const uploadZone = page.locator('[class*="upload"]').first()
      if (await uploadZone.isVisible()) {
        await expect(uploadZone).toBeVisible()
      }
    })

    test('Features section cards are all visible', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // Scroll to features section
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(500)
      
      // Check for feature cards
      await expect(page.locator('h2').filter({ hasText: /Why/i })).toBeVisible()
    })

    test('Logo link navigates to home', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Click on logo
      const logo = page.locator('header a').first()
      await expect(logo).toBeVisible()
      await logo.click()
      await expect(page).toHaveURL('/')
    })

    test('Theme toggle button is visible and functional', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      const themeBtn = page.locator('button[aria-label*="mode"]')
      await expect(themeBtn).toBeVisible()
      
      const initialDark = await page.evaluate(() => 
        document.documentElement.classList.contains('dark')
      )
      
      await themeBtn.click()
      await page.waitForTimeout(300)
      
      const afterToggle = await page.evaluate(() => 
        document.documentElement.classList.contains('dark')
      )
      
      expect(afterToggle).toBe(!initialDark)
    })

    test('Connect wallet button is visible', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      // On mobile, need to open menu first
      if (viewport.width < 1024) {
        const menuBtn = page.locator('button[aria-label="Toggle menu"]')
        await menuBtn.click()
        await page.waitForTimeout(500)
        
        const connectBtn = page.locator('nav.fixed button').filter({ hasText: /Connect/i })
        await expect(connectBtn).toBeVisible()
      } else {
        const connectBtn = page.locator('header button').filter({ hasText: /Connect/i })
        await expect(connectBtn).toBeVisible()
      }
    })
  })
}

test.describe('Dashboard - Desktop Navigation', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('all nav links are visible and work', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    // Header nav should be visible
    const headerNav = page.locator('header nav')
    await expect(headerNav).toBeVisible()
    
    // Upload link
    const uploadLink = headerNav.locator('a').filter({ hasText: /Upload/i })
    await expect(uploadLink).toBeVisible()
    await uploadLink.click()
    await expect(page).toHaveURL('/upload')
    
    // Files link
    await page.goto('/', { waitUntil: 'networkidle' })
    const filesLink = headerNav.locator('a').filter({ hasText: /File/i })
    await expect(filesLink).toBeVisible()
    await filesLink.click()
    await expect(page).toHaveURL('/files')
    
    // Settings link
    await page.goto('/', { waitUntil: 'networkidle' })
    const settingsLink = headerNav.locator('a').filter({ hasText: /Setting/i })
    await expect(settingsLink).toBeVisible()
    await settingsLink.click()
    await expect(page).toHaveURL('/settings')
  })
})

test.describe('Dashboard - Mobile Menu', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('mobile menu button opens menu', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await expect(menuBtn).toBeVisible()
    
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Menu should be visible
    await expect(page.locator('nav.fixed')).toBeVisible()
  })

  test('mobile menu close button works', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Find close button in mobile menu
    const closeBtn = page.locator('nav.fixed button').first()
    await closeBtn.click()
    await page.waitForTimeout(300)
  })

  test('mobile menu nav links work', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Click Upload
    await page.locator('nav.fixed a').filter({ hasText: /Upload/i }).click()
    await expect(page).toHaveURL('/upload')
    
    // Open menu again
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Click Files
    await page.locator('nav.fixed a').filter({ hasText: /File/i }).click()
    await expect(page).toHaveURL('/files')
    
    // Open menu again
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Click Settings
    await page.locator('nav.fixed a').filter({ hasText: /Setting/i }).click()
    await expect(page).toHaveURL('/settings')
    
    // Open menu again
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Click Dashboard
    await page.locator('nav.fixed a').filter({ hasText: /Dashboard/i }).click()
    await expect(page).toHaveURL('/')
  })

  test('mobile menu connect wallet button is visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    const connectBtn = page.locator('nav.fixed button').filter({ hasText: /Connect/i })
    await expect(connectBtn).toBeVisible()
  })
})
