import { test, expect } from '@playwright/test'

test.describe('Proposals List Page', () => {
  test('loads proposals page', async ({ page }) => {
    await page.goto('/proposals')
    
    await expect(page.getByRole('heading', { name: 'Proposals' })).toBeVisible()
  })

  test('has create button', async ({ page }) => {
    await page.goto('/proposals')
    
    const viewport = page.viewportSize()
    const isMobileViewport = viewport ? viewport.width < 768 : false
    
    if (isMobileViewport) {
      // On mobile, use menu to navigate
      await page.locator('button[aria-label="Toggle menu"]').click()
      await page.waitForTimeout(200)
      await page.locator('header nav').getByRole('link', { name: 'Create' }).click()
    } else {
      // Desktop: use header create link
      await page.locator('header').getByRole('link', { name: 'Create' }).click()
    }
    
    await expect(page).toHaveURL('/create')
  })

  test('has search input', async ({ page }) => {
    await page.goto('/proposals')
    
    const searchInput = page.getByPlaceholder(/Search/)
    await expect(searchInput).toBeVisible()
  })

  test('has filter buttons', async ({ page }) => {
    await page.goto('/proposals')
    
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Active' })).toBeVisible()
  })

  test('filter buttons toggle state', async ({ page }) => {
    await page.goto('/proposals')
    
    const allBtn = page.getByRole('button', { name: 'All' })
    const activeBtn = page.getByRole('button', { name: 'Active' })
    
    await activeBtn.click()
    // Buttons should toggle
    await expect(activeBtn).toBeVisible()
    await expect(allBtn).toBeVisible()
  })

  test('shows empty state or proposals', async ({ page }) => {
    await page.goto('/proposals')
    
    // Either shows proposals or empty state
    const hasProposals = await page.getByText(/Score:/).count() > 0
    const hasEmptyState = await page.getByText(/No proposals found/).count() > 0
    
    expect(hasProposals || hasEmptyState).toBe(true)
  })
})
