import { test, expect } from '@playwright/test'

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 720 },
]

for (const viewport of viewports) {
  test.describe(`Full Navigation Flow - ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('complete navigation through all pages', async ({ page }) => {
      // Start at home
      await page.goto('/', { waitUntil: 'networkidle' })
      await expect(page.locator('h1')).toBeVisible()
      
      // Navigate to Upload via CTA
      await page.locator('main a').filter({ hasText: /Upload/i }).first().click()
      await expect(page).toHaveURL('/upload')
      await expect(page.locator('h1').filter({ hasText: /Upload/i })).toBeVisible()
      
      // Navigate back to Dashboard
      await page.locator('a').filter({ hasText: /Back/i }).first().click()
      await expect(page).toHaveURL('/')
      
      // Navigate to Files via CTA
      await page.locator('main a').filter({ hasText: /Browse/i }).first().click()
      await expect(page).toHaveURL('/files')
      await expect(page.locator('h1').filter({ hasText: /File/i })).toBeVisible()
      
      // Navigate to Upload from Files page
      await page.locator('main a').filter({ hasText: /Upload/i }).first().click()
      await expect(page).toHaveURL('/upload')
      
      // Go back to Files
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Navigate to Dashboard via Back link
      await page.locator('a').filter({ hasText: /Back/i }).first().click()
      await expect(page).toHaveURL('/')
      
      // Navigate to Settings via Configure link
      await page.locator('a').filter({ hasText: /Configure/i }).first().click()
      await expect(page).toHaveURL('/settings')
      await expect(page.locator('h1').filter({ hasText: /Setting/i })).toBeVisible()
      
      // Navigate back to Dashboard
      await page.locator('a').filter({ hasText: /Back/i }).first().click()
      await expect(page).toHaveURL('/')
    })

    test('theme persists across navigation', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      
      const themeBtn = page.locator('button[aria-label*="mode"]')
      
      // Set to dark mode
      const isDark = await page.evaluate(() => 
        document.documentElement.classList.contains('dark')
      )
      
      if (!isDark) {
        await themeBtn.click()
        await page.waitForTimeout(300)
      }
      
      // Navigate to upload
      await page.locator('main a').filter({ hasText: /Upload/i }).first().click()
      await expect(page).toHaveURL('/upload')
      
      // Theme should persist
      expect(await page.evaluate(() => 
        document.documentElement.classList.contains('dark')
      )).toBe(true)
      
      // Navigate to files
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Theme should still persist
      expect(await page.evaluate(() => 
        document.documentElement.classList.contains('dark')
      )).toBe(true)
      
      // Navigate to settings
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      // Theme should still persist
      expect(await page.evaluate(() => 
        document.documentElement.classList.contains('dark')
      )).toBe(true)
    })
  })
}

test.describe('Mobile Navigation Flow', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('navigate using mobile menu through all pages', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    
    // Open menu and go to Upload
    await menuBtn.click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed a').filter({ hasText: /Upload/i }).click()
    await expect(page).toHaveURL('/upload')
    
    // Open menu and go to Files
    await menuBtn.click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed a').filter({ hasText: /File/i }).click()
    await expect(page).toHaveURL('/files')
    
    // Open menu and go to Settings
    await menuBtn.click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed a').filter({ hasText: /Setting/i }).click()
    await expect(page).toHaveURL('/settings')
    
    // Open menu and go to Dashboard
    await menuBtn.click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed a').filter({ hasText: /Dashboard/i }).click()
    await expect(page).toHaveURL('/')
  })

  test('mobile menu closes after navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    
    // Open menu
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Navigate
    await page.locator('nav.fixed a').filter({ hasText: /Upload/i }).click()
    await expect(page).toHaveURL('/upload')
    
    // Menu should be closed (not visible)
    await page.waitForTimeout(300)
    
    // Menu button should be visible (menu is closed)
    await expect(menuBtn).toBeVisible()
  })
})

test.describe('Desktop Navigation Flow', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('navigate using header nav through all pages', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    // Use header nav
    const headerNav = page.locator('header nav')
    
    // Go to Upload
    await headerNav.locator('a').filter({ hasText: /Upload/i }).click()
    await expect(page).toHaveURL('/upload')
    
    // Go to Files
    await headerNav.locator('a').filter({ hasText: /File/i }).click()
    await expect(page).toHaveURL('/files')
    
    // Go to Settings
    await headerNav.locator('a').filter({ hasText: /Setting/i }).click()
    await expect(page).toHaveURL('/settings')
    
    // Go to Dashboard
    await headerNav.locator('a').filter({ hasText: /Dashboard/i }).click()
    await expect(page).toHaveURL('/')
  })

  test('active nav item is highlighted', async ({ page }) => {
    // Check Dashboard is active
    await page.goto('/', { waitUntil: 'networkidle' })
    const dashboardLink = page.locator('header nav a').filter({ hasText: /Dashboard/i })
    await expect(dashboardLink).toBeVisible()
    
    // Check Upload is active
    await page.goto('/upload', { waitUntil: 'networkidle' })
    const uploadLink = page.locator('header nav a').filter({ hasText: /Upload/i })
    await expect(uploadLink).toBeVisible()
    
    // Check Files is active
    await page.goto('/files', { waitUntil: 'networkidle' })
    const filesLink = page.locator('header nav a').filter({ hasText: /File/i })
    await expect(filesLink).toBeVisible()
    
    // Check Settings is active
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const settingsLink = page.locator('header nav a').filter({ hasText: /Setting/i })
    await expect(settingsLink).toBeVisible()
  })
})
