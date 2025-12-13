import { test, expect } from '@playwright/test'

test.describe('Council Dashboard', () => {
  test('loads dashboard page', async ({ page }) => {
    await page.goto('/')
    
    // Page should load with main content
    await expect(page.locator('main')).toBeVisible()
  })

  test('displays stats cards', async ({ page }) => {
    await page.goto('/')
    
    // Check stat labels are visible
    await expect(page.locator('.stat-label').first()).toBeVisible()
  })

  test('shows CEO status section', async ({ page }) => {
    await page.goto('/')
    
    await expect(page.getByText('AI CEO')).toBeVisible()
  })

  test('shows Council status section', async ({ page }) => {
    await page.goto('/')
    
    // Wait for page to fully load
    await page.waitForLoadState('networkidle')
    
    // Should show council card
    await expect(page.locator('.card-static').nth(1)).toBeVisible()
  })

  test('header navigation works', async ({ page }) => {
    await page.goto('/')
    
    const viewport = page.viewportSize()
    const isMobileViewport = viewport ? viewport.width < 768 : false
    
    if (isMobileViewport) {
      // Mobile: just check menu button exists
      await expect(page.locator('button[aria-label="Toggle menu"]')).toBeVisible()
    } else {
      // Desktop: check nav links
      const header = page.locator('header')
      await expect(header.getByRole('link', { name: 'Dashboard' })).toBeVisible()
      await expect(header.getByRole('link', { name: 'Proposals' })).toBeVisible()
      await expect(header.getByRole('link', { name: 'Create' })).toBeVisible()
    }
  })

  test('view all link exists', async ({ page }) => {
    await page.goto('/')
    
    await expect(page.getByText('View all →')).toBeVisible()
  })
})
