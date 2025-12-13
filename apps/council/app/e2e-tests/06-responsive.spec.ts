import { test, expect } from '@playwright/test'

test.describe('Responsive Layout', () => {
  test('dashboard loads and displays correctly', async ({ page }) => {
    await page.goto('/')
    
    // Stats should be visible
    await expect(page.locator('.stat-card').first()).toBeVisible()
    
    // Main content should be visible
    await expect(page.locator('main')).toBeVisible()
    
    // Header should be visible
    await expect(page.locator('header')).toBeVisible()
  })

  test('navigation works on current viewport', async ({ page }) => {
    await page.goto('/')
    
    const viewport = page.viewportSize()
    const isMobileViewport = viewport ? viewport.width < 768 : false
    
    if (isMobileViewport) {
      // Open mobile menu
      await page.locator('button[aria-label="Toggle menu"]').click()
      await page.waitForTimeout(200)
      await page.locator('header nav').getByRole('link', { name: 'Proposals' }).click()
    } else {
      await page.locator('header').getByRole('link', { name: 'Proposals' }).click()
    }
    
    await expect(page).toHaveURL('/proposals')
  })

  test('create page form is usable', async ({ page }) => {
    await page.goto('/create')
    
    // New wizard form elements should be visible
    await expect(page.getByText('Draft Your Proposal')).toBeVisible()
    await expect(page.locator('input[placeholder*="Clear, descriptive title"]')).toBeVisible()
    await expect(page.locator('textarea[placeholder*="1-2 sentence summary"]')).toBeVisible()
    
    // Navigation buttons should be visible
    const continueBtn = page.getByRole('button', { name: /Continue/i })
    await expect(continueBtn).toBeVisible()
  })

  test('proposals page is usable', async ({ page }) => {
    await page.goto('/proposals')
    
    // Search should be visible
    await expect(page.getByPlaceholder(/Search/)).toBeVisible()
    
    // Filter buttons should be visible
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Active' })).toBeVisible()
  })

  test('touch targets are adequate size', async ({ page }) => {
    await page.goto('/')
    
    // Check buttons have adequate size (at least 28px height)
    const buttons = page.locator('button, a.btn-primary, a.btn-secondary')
    const count = await buttons.count()
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = buttons.nth(i)
      const box = await btn.boundingBox()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(28)
      }
    }
  })

  test('no horizontal scroll on page', async ({ page }) => {
    await page.goto('/')
    
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    
    // Allow 1px tolerance for rounding
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  })

  test('theme toggle works', async ({ page }) => {
    await page.goto('/')
    
    const themeBtn = page.locator('button[aria-label="Toggle theme"]')
    await expect(themeBtn).toBeVisible()
    
    // Toggle theme
    await themeBtn.click()
    
    // Check dark class is added or removed
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    
    // Toggle again
    await themeBtn.click()
    
    const isDarkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    expect(isDark).not.toBe(isDarkAfter)
  })

  test('stats cards are visible and properly sized', async ({ page }) => {
    await page.goto('/')
    
    const statCards = page.locator('.stat-card')
    await expect(statCards.first()).toBeVisible()
    
    const count = await statCards.count()
    expect(count).toBe(4)
    
    // All should be visible
    for (let i = 0; i < count; i++) {
      await expect(statCards.nth(i)).toBeVisible()
    }
  })
})
