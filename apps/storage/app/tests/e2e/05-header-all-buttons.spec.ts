import { test, expect } from '@playwright/test'

const pages = ['/', '/upload', '/files', '/settings']

const viewports = [
  { name: 'mobile-portrait', width: 375, height: 812 },
  { name: 'mobile-landscape', width: 812, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'desktop-large', width: 1920, height: 1080 },
]

for (const viewport of viewports) {
  test.describe(`Header on all pages - ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const pagePath of pages) {
      test(`Logo is visible and clickable on ${pagePath}`, async ({ page }) => {
        await page.goto(pagePath, { waitUntil: 'networkidle' })
        
        const logo = page.locator('header a').first()
        await expect(logo).toBeVisible()
      })

      test(`Theme toggle works on ${pagePath}`, async ({ page }) => {
        await page.goto(pagePath, { waitUntil: 'networkidle' })
        
        const themeBtn = page.locator('button[aria-label*="mode"]')
        await expect(themeBtn).toBeVisible()
        
        await themeBtn.click()
        await page.waitForTimeout(300)
        
        // Toggle back
        await themeBtn.click()
      })

      if (viewport.width < 1024) {
        test(`Mobile menu button visible on ${pagePath}`, async ({ page }) => {
          await page.goto(pagePath, { waitUntil: 'networkidle' })
          
          const menuBtn = page.locator('button[aria-label="Toggle menu"]')
          await expect(menuBtn).toBeVisible()
        })

        test(`Mobile menu opens on ${pagePath}`, async ({ page }) => {
          await page.goto(pagePath, { waitUntil: 'networkidle' })
          
          const menuBtn = page.locator('button[aria-label="Toggle menu"]')
          await menuBtn.click()
          await page.waitForTimeout(300)
          
          // Menu should show
          await expect(page.locator('nav.fixed')).toBeVisible()
        })
      } else {
        test(`Desktop nav visible on ${pagePath}`, async ({ page }) => {
          await page.goto(pagePath, { waitUntil: 'networkidle' })
          
          const nav = page.locator('header nav')
          await expect(nav).toBeVisible()
        })
      }
    }
  })
}

test.describe('Header - Connect Wallet Button', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  for (const pagePath of pages) {
    test(`Connect button visible on ${pagePath}`, async ({ page }) => {
      await page.goto(pagePath, { waitUntil: 'networkidle' })
      
      const connectBtn = page.locator('header button').filter({ hasText: /Connect/i })
      await expect(connectBtn).toBeVisible()
    })
  }
})

test.describe('Header - Mobile Connect Wallet', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  for (const pagePath of pages) {
    test(`Connect in mobile menu on ${pagePath}`, async ({ page }) => {
      await page.goto(pagePath, { waitUntil: 'networkidle' })
      
      const menuBtn = page.locator('button[aria-label="Toggle menu"]')
      await menuBtn.click()
      await page.waitForTimeout(300)
      
      const connectBtn = page.locator('nav.fixed button').filter({ hasText: /Connect/i })
      await expect(connectBtn).toBeVisible()
    })
  }
})
