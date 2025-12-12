import { test, expect } from '@playwright/test'

test.describe('Create Proposal Page', () => {
  test('loads create proposal page', async ({ page }) => {
    await page.goto('/create')
    
    await expect(page.getByRole('heading', { name: 'Create Proposal' })).toBeVisible()
  })

  test('has proposal type selector', async ({ page }) => {
    await page.goto('/create')
    
    const typeSelect = page.locator('select')
    await expect(typeSelect).toBeVisible()
    
    const options = await typeSelect.locator('option').count()
    expect(options).toBeGreaterThan(0)
  })

  test('has title input field', async ({ page }) => {
    await page.goto('/create')
    
    const titleInput = page.getByPlaceholder(/10-100/)
    await expect(titleInput).toBeVisible()
    
    await titleInput.fill('Test Proposal Title')
    await expect(titleInput).toHaveValue('Test Proposal Title')
  })

  test('has summary textarea', async ({ page }) => {
    await page.goto('/create')
    
    const summaryInput = page.getByPlaceholder(/50-500/)
    await expect(summaryInput).toBeVisible()
  })

  test('has description textarea', async ({ page }) => {
    await page.goto('/create')
    
    const descInput = page.getByPlaceholder(/Problem/)
    await expect(descInput).toBeVisible()
  })

  test('has assess button', async ({ page }) => {
    await page.goto('/create')
    
    await expect(page.getByRole('button', { name: /Assess/i })).toBeVisible()
  })

  test('has submit button (disabled initially)', async ({ page }) => {
    await page.goto('/create')
    
    const submitBtn = page.getByRole('button', { name: /Submit/i })
    await expect(submitBtn).toBeVisible()
    await expect(submitBtn).toBeDisabled()
  })

  test('back link returns to home', async ({ page }) => {
    await page.goto('/create')
    
    // Click back arrow link in header area
    await page.locator('a[href="/"]').first().click()
    
    await expect(page).toHaveURL('/')
  })

  test('assessment sidebar shows initial state', async ({ page }) => {
    await page.goto('/create')
    
    await expect(page.getByText('Click Assess for feedback')).toBeVisible()
  })
})
