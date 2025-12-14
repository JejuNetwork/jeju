import { test, expect } from '@playwright/test'

test.describe('Theme Toggle', () => {
  test('theme toggle button exists', async ({ page }) => {
    await page.goto('/')
    
    // Find theme toggle button (has Sun or Moon icon)
    const themeBtn = page.locator('button[aria-label="Toggle theme"]')
    await expect(themeBtn).toBeVisible()
  })

  test('clicking theme toggle changes theme', async ({ page }) => {
    await page.goto('/')
    
    const html = page.locator('html')
    const themeBtn = page.locator('button[aria-label="Toggle theme"]')
    
    // Get initial state
    const initialDark = await html.evaluate((el) => el.classList.contains('dark'))
    
    // Click toggle
    await themeBtn.click()
    
    // Check state changed
    const afterClickDark = await html.evaluate((el) => el.classList.contains('dark'))
    expect(afterClickDark).toBe(!initialDark)
    
    // Click again to restore
    await themeBtn.click()
    const restoredDark = await html.evaluate((el) => el.classList.contains('dark'))
    expect(restoredDark).toBe(initialDark)
  })
})
