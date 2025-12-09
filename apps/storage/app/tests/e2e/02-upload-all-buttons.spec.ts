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
  test.describe(`Upload Page - ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('page loads with all elements visible', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      
      // Heading should be visible
      await expect(page.locator('h1').filter({ hasText: /Upload/i })).toBeVisible()
    })

    test('Back to Dashboard link is visible and works', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      
      const backLink = page.locator('a').filter({ hasText: /Back/i }).first()
      await expect(backLink).toBeVisible()
      await backLink.click()
      await expect(page).toHaveURL('/')
    })

    test('Upload zone is visible and clickable', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      
      // Upload zone container
      const uploadContainer = page.locator('main').locator('div').filter({ hasText: /drag/i }).first()
      await expect(uploadContainer).toBeVisible()
    })

    test('Upload zone has file input', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      
      // Input should exist
      const fileInput = page.locator('input[type="file"]')
      await expect(fileInput).toBeAttached()
    })

    test('Upload tips cards are visible', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      
      // Info cards section
      const cards = page.locator('main .grid')
      await expect(cards.first()).toBeVisible()
    })

    test('Info box about storage providers is visible', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      
      // Scroll down to see info box
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(300)
      
      // Info box should exist
      const infoBox = page.locator('main').locator('div').filter({ hasText: /Storage Provider/i }).first()
      await expect(infoBox).toBeVisible()
    })

    test('Header elements are visible', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      
      // Logo
      await expect(page.locator('header a').first()).toBeVisible()
      
      // Theme toggle
      await expect(page.locator('button[aria-label*="mode"]')).toBeVisible()
    })

    test('Theme toggle works on upload page', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      
      const themeBtn = page.locator('button[aria-label*="mode"]')
      
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
  })
}

test.describe('Upload Page - Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('mobile menu works on upload page', async ({ page }) => {
    await page.goto('/upload', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await expect(menuBtn).toBeVisible()
    
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Navigate to Files
    await page.locator('nav.fixed a').filter({ hasText: /File/i }).click()
    await expect(page).toHaveURL('/files')
  })
})
