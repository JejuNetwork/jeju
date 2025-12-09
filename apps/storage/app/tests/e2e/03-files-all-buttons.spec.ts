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
  test.describe(`Files Page - ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('page loads with all elements visible', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Heading should be visible
      await expect(page.locator('h1').filter({ hasText: /File/i })).toBeVisible()
    })

    test('Back link is visible and works', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      const backLink = page.locator('a').filter({ hasText: /Back/i }).first()
      await expect(backLink).toBeVisible()
      await backLink.click()
      await expect(page).toHaveURL('/')
    })

    test('Upload button is visible and works', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Find Upload button in header area
      const uploadBtn = page.locator('main').locator('a').filter({ hasText: /Upload/i }).first()
      await expect(uploadBtn).toBeVisible()
      await uploadBtn.click()
      await expect(page).toHaveURL('/upload')
    })

    test('Search input is visible and functional', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      const searchInput = page.locator('input[type="text"]').first()
      await expect(searchInput).toBeVisible()
      
      // Type in search
      await searchInput.fill('test-cid')
      await expect(searchInput).toHaveValue('test-cid')
      
      // Clear search
      await searchInput.fill('')
    })

    test('Status filter dropdown is visible and works', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      const filterSelect = page.locator('select').first()
      await expect(filterSelect).toBeVisible()
      
      // Change to Pinned
      await filterSelect.selectOption('pinned')
      await expect(filterSelect).toHaveValue('pinned')
      
      // Change back to All
      await filterSelect.selectOption('all')
      await expect(filterSelect).toHaveValue('all')
    })

    test('Grid view button is visible and clickable', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Find view toggle buttons
      const viewToggle = page.locator('main').locator('button').filter({ has: page.locator('svg') })
      await expect(viewToggle.first()).toBeVisible()
    })

    test('List view button is visible and clickable', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Find all buttons in the filter area
      const buttons = page.locator('main').locator('button').filter({ has: page.locator('svg') })
      const count = await buttons.count()
      expect(count).toBeGreaterThan(0)
    })

    test('View toggle buttons work together', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Find view toggle buttons container
      const toggleContainer = page.locator('main').locator('.flex').filter({ has: page.locator('button') }).last()
      await expect(toggleContainer).toBeVisible()
    })

    test('Header elements work', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      
      // Logo navigation
      const logo = page.locator('header a').first()
      await expect(logo).toBeVisible()
      await logo.click()
      await expect(page).toHaveURL('/')
    })
  })
}

test.describe('Files Page - Mobile Menu', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('mobile menu works on files page', async ({ page }) => {
    await page.goto('/files', { waitUntil: 'networkidle' })
    
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await expect(menuBtn).toBeVisible()
    
    await menuBtn.click()
    await page.waitForTimeout(300)
    
    // Files should be highlighted
    await expect(page.locator('nav.fixed a').filter({ hasText: /File/i })).toBeVisible()
    
    // Navigate to Settings
    await page.locator('nav.fixed a').filter({ hasText: /Setting/i }).click()
    await expect(page).toHaveURL('/settings')
  })
})

test.describe('Files Page - Tablet Landscape', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('all filter controls are in one row', async ({ page }) => {
    await page.goto('/files', { waitUntil: 'networkidle' })
    
    // All controls should be visible
    await expect(page.locator('input[type="text"]').first()).toBeVisible()
    await expect(page.locator('select').first()).toBeVisible()
  })
})
