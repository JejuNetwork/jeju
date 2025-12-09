import { test, expect } from '@playwright/test'

const viewports = [
  { name: 'mobile-portrait', width: 375, height: 812 },
  { name: 'mobile-landscape', width: 812, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 720 },
]

const pages = ['/', '/upload', '/files', '/settings']

for (const viewport of viewports) {
  for (const pagePath of pages) {
    test.describe(`Theme Toggle - ${viewport.name} on ${pagePath}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } })

      test('theme toggle is visible', async ({ page }) => {
        await page.goto(pagePath, { waitUntil: 'networkidle' })
        
        const themeBtn = page.locator('button[aria-label*="mode"]')
        await expect(themeBtn).toBeVisible()
      })

      test('theme toggle switches theme', async ({ page }) => {
        await page.goto(pagePath, { waitUntil: 'networkidle' })
        
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

      test('theme toggle icon changes', async ({ page }) => {
        await page.goto(pagePath, { waitUntil: 'networkidle' })
        
        const themeBtn = page.locator('button[aria-label*="mode"]')
        
        const initialLabel = await themeBtn.getAttribute('aria-label')
        
        await themeBtn.click()
        await page.waitForTimeout(300)
        
        const newLabel = await themeBtn.getAttribute('aria-label')
        
        expect(newLabel).not.toBe(initialLabel)
      })

      test('theme persists on reload', async ({ page }) => {
        await page.goto(pagePath, { waitUntil: 'networkidle' })
        
        const themeBtn = page.locator('button[aria-label*="mode"]')
        
        // Set specific theme
        const isDark = await page.evaluate(() => 
          document.documentElement.classList.contains('dark')
        )
        
        if (!isDark) {
          await themeBtn.click()
          await page.waitForTimeout(300)
        }
        
        // Reload
        await page.reload({ waitUntil: 'networkidle' })
        await page.waitForTimeout(500)
        
        // Should still be dark
        const afterReload = await page.evaluate(() => 
          document.documentElement.classList.contains('dark')
        )
        
        expect(afterReload).toBe(true)
      })
    })
  }
}
