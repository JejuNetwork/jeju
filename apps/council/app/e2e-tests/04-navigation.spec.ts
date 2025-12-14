import { test, expect, Page } from '@playwright/test'

async function navigateViaMenu(page: Page, target: string) {
  const viewport = page.viewportSize()
  const isMobileViewport = viewport ? viewport.width < 768 : false
  
  if (isMobileViewport) {
    // Open mobile menu first
    const menuBtn = page.locator('button[aria-label="Toggle menu"]')
    await menuBtn.click()
    // Wait for menu to open
    await page.waitForTimeout(200)
    // Click the link in the mobile nav
    await page.locator('header nav').getByRole('link', { name: target }).click()
  } else {
    await page.locator('header').getByRole('link', { name: target }).click()
  }
}

test.describe('Navigation', () => {
  test('navigate from dashboard to proposals', async ({ page }) => {
    await page.goto('/')
    
    await navigateViaMenu(page, 'Proposals')
    await expect(page).toHaveURL('/proposals')
    await expect(page.getByRole('heading', { name: 'Proposals' })).toBeVisible()
  })

  test('navigate from dashboard to create', async ({ page }) => {
    await page.goto('/')
    
    await navigateViaMenu(page, 'Create')
    await expect(page).toHaveURL('/create')
    await expect(page.getByRole('heading', { name: 'Create Proposal' })).toBeVisible()
  })

  test('navigate from proposals to create via header', async ({ page }) => {
    await page.goto('/proposals')
    
    await navigateViaMenu(page, 'Create')
    await expect(page).toHaveURL('/create')
  })

  test('navigate from create back to dashboard', async ({ page }) => {
    await page.goto('/create')
    
    await navigateViaMenu(page, 'Dashboard')
    await expect(page).toHaveURL('/')
  })

  test('logo returns to dashboard', async ({ page }) => {
    await page.goto('/proposals')
    
    await page.locator('header a').first().click()
    await expect(page).toHaveURL('/')
  })
})
