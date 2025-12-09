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
  test.describe(`Settings Page - ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('page loads with all sections visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      // Heading should be visible
      await expect(page.locator('h1').filter({ hasText: /Setting/i })).toBeVisible()
    })

    test('Back to Dashboard link is visible and works', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      const backLink = page.locator('a').filter({ hasText: /Back/i }).first()
      await expect(backLink).toBeVisible()
      await backLink.click()
      await expect(page).toHaveURL('/')
    })

    test('Account section is visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      // Account section heading
      await expect(page.locator('h2').filter({ hasText: /Account/i })).toBeVisible()
    })

    test('Storage Backends section is visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      // Scroll to see all sections
      await page.evaluate(() => window.scrollTo(0, 300))
      await page.waitForTimeout(300)
      
      await expect(page.locator('h2').filter({ hasText: /Storage/i })).toBeVisible()
    })

    test('Backend Selection info box is visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      await page.evaluate(() => window.scrollTo(0, 500))
      await page.waitForTimeout(300)
      
      // Info box about backends
      const infoText = page.locator('main').locator('div').filter({ hasText: /Backend/i }).first()
      await expect(infoText).toBeVisible()
    })

    test('Payment Options section is visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      await page.evaluate(() => window.scrollTo(0, 700))
      await page.waitForTimeout(300)
      
      await expect(page.locator('h2').filter({ hasText: /Payment/i })).toBeVisible()
    })

    test('API Integration section is visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      await page.evaluate(() => window.scrollTo(0, 1000))
      await page.waitForTimeout(300)
      
      await expect(page.locator('h2').filter({ hasText: /API/i })).toBeVisible()
    })

    test('Agent Card link is visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      await page.evaluate(() => window.scrollTo(0, 1200))
      await page.waitForTimeout(300)
      
      const agentCardLink = page.locator('a').filter({ hasText: /agent-card/i })
      await expect(agentCardLink).toBeVisible()
    })

    test('Service Information section is visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(300)
      
      await expect(page.locator('h2').filter({ hasText: /Service/i })).toBeVisible()
    })

    test('Header theme toggle works', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      
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
  })
}

test.describe('Settings Page - Mobile Menu', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('mobile menu works on settings page', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await expect(menuBtn).toBeVisible()
    
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Settings should be visible in menu
    await expect(page.locator('nav.fixed a').filter({ hasText: /Setting/i })).toBeVisible()
    
    // Navigate to Dashboard
    await page.locator('nav.fixed a').filter({ hasText: /Dashboard/i }).click()
    await expect(page).toHaveURL('/')
  })
})

test.describe('Settings Page - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('desktop nav shows Settings as active', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    
    const settingsLink = page.locator('header nav a').filter({ hasText: /Setting/i })
    await expect(settingsLink).toBeVisible()
  })
})
