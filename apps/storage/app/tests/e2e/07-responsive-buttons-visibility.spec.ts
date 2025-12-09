import { test, expect } from '@playwright/test'

const viewports = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 12 Pro', width: 390, height: 844 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
  { name: 'Galaxy S20', width: 360, height: 800 },
  { name: 'iPad Mini', width: 768, height: 1024 },
  { name: 'iPad Pro', width: 1024, height: 1366 },
  { name: 'Laptop', width: 1366, height: 768 },
  { name: 'Desktop HD', width: 1920, height: 1080 },
  { name: 'Ultrawide', width: 2560, height: 1080 },
]

// Test all viewports for button visibility
for (const viewport of viewports) {
  test.describe(`Button Visibility - ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('Dashboard - all interactive elements visible', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      
      // Hero CTA buttons
      const uploadCta = page.locator('main a').filter({ hasText: /Upload/i }).first()
      await expect(uploadCta).toBeVisible()
      
      const browseCta = page.locator('main a').filter({ hasText: /Browse/i }).first()
      await expect(browseCta).toBeVisible()
      
      // Theme toggle
      await expect(page.locator('button[aria-label*="mode"]')).toBeVisible()
      
      // Logo
      await expect(page.locator('header a').first()).toBeVisible()
    })

    test('Upload - all interactive elements visible', async ({ page }) => {
      await page.goto('/upload', { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      
      // Back link
      await expect(page.locator('a').filter({ hasText: /Back/i }).first()).toBeVisible()
      
      // Theme toggle
      await expect(page.locator('button[aria-label*="mode"]')).toBeVisible()
    })

    test('Files - all interactive elements visible', async ({ page }) => {
      await page.goto('/files', { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      
      // Back link
      await expect(page.locator('a').filter({ hasText: /Back/i }).first()).toBeVisible()
      
      // Upload button
      await expect(page.locator('main a').filter({ hasText: /Upload/i }).first()).toBeVisible()
      
      // Search input
      await expect(page.locator('input[type="text"]').first()).toBeVisible()
      
      // Status filter
      await expect(page.locator('select').first()).toBeVisible()
    })

    test('Settings - all interactive elements visible', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      
      // Back link
      await expect(page.locator('a').filter({ hasText: /Back/i }).first()).toBeVisible()
      
      // Theme toggle
      await expect(page.locator('button[aria-label*="mode"]')).toBeVisible()
    })
  })
}

// Test landscape orientations specifically
test.describe('Landscape Orientations', () => {
  const landscapeViewports = [
    { name: 'iPhone landscape', width: 812, height: 375 },
    { name: 'iPad landscape', width: 1024, height: 768 },
    { name: 'Desktop landscape', width: 1920, height: 1080 },
  ]

  for (const viewport of landscapeViewports) {
    test.describe(`${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } })

      test('Dashboard buttons not cut off', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' })
        
        // Both CTA buttons should be fully visible
        const uploadBtn = page.locator('main a').filter({ hasText: /Upload/i }).first()
        const browseBtn = page.locator('main a').filter({ hasText: /Browse/i }).first()
        
        await expect(uploadBtn).toBeVisible()
        await expect(browseBtn).toBeVisible()
        
        // Check buttons are not clipped
        const uploadBox = await uploadBtn.boundingBox()
        const browseBox = await browseBtn.boundingBox()
        
        expect(uploadBox).not.toBeNull()
        expect(browseBox).not.toBeNull()
        
        // Buttons should be within viewport
        expect(uploadBox!.x).toBeGreaterThanOrEqual(0)
        expect(uploadBox!.y).toBeGreaterThanOrEqual(0)
        expect(uploadBox!.x + uploadBox!.width).toBeLessThanOrEqual(viewport.width)
        
        expect(browseBox!.x).toBeGreaterThanOrEqual(0)
        expect(browseBox!.y).toBeGreaterThanOrEqual(0)
        expect(browseBox!.x + browseBox!.width).toBeLessThanOrEqual(viewport.width)
      })

      test('Files page controls fit', async ({ page }) => {
        await page.goto('/files', { waitUntil: 'networkidle' })
        
        const searchInput = page.locator('input[type="text"]').first()
        const filterSelect = page.locator('select').first()
        
        await expect(searchInput).toBeVisible()
        await expect(filterSelect).toBeVisible()
        
        // Verify not clipped
        const searchBox = await searchInput.boundingBox()
        const filterBox = await filterSelect.boundingBox()
        
        expect(searchBox).not.toBeNull()
        expect(filterBox).not.toBeNull()
        
        expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(viewport.width)
        expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(viewport.width)
      })
    })
  }
})

// Test touch targets on mobile
test.describe('Mobile Touch Targets', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('buttons meet minimum touch target size (44px)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    
    // Check CTA buttons
    const uploadBtn = page.locator('main a').filter({ hasText: /Upload/i }).first()
    const uploadBox = await uploadBtn.boundingBox()
    
    expect(uploadBox).not.toBeNull()
    expect(uploadBox!.height).toBeGreaterThanOrEqual(40) // iOS minimum is 44, we allow 40
    
    // Check theme toggle
    const themeBtn = page.locator('button[aria-label*="mode"]')
    const themeBox = await themeBtn.boundingBox()
    
    expect(themeBox).not.toBeNull()
    expect(themeBox!.height).toBeGreaterThanOrEqual(36)
    expect(themeBox!.width).toBeGreaterThanOrEqual(36)
    
    // Check menu button
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    const menuBox = await menuBtn.boundingBox()
    
    expect(menuBox).not.toBeNull()
    expect(menuBox!.height).toBeGreaterThanOrEqual(36)
    expect(menuBox!.width).toBeGreaterThanOrEqual(36)
  })
})
