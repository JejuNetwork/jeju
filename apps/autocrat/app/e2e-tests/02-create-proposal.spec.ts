import { test, expect } from '@playwright/test'

test.describe('Create Proposal Page', () => {
  test('loads create proposal page', async ({ page }) => {
    await page.goto('/create')
    
    await expect(page.getByRole('heading', { name: 'Create Proposal' })).toBeVisible()
  })

  test('has proposal type selection', async ({ page }) => {
    await page.goto('/create')
    
    // New wizard has button-based type selection
    await expect(page.getByText('Parameter Change')).toBeVisible()
    await expect(page.getByText('Treasury Allocation')).toBeVisible()
    await expect(page.getByText('Code Upgrade')).toBeVisible()
  })

  test('has title input field', async ({ page }) => {
    await page.goto('/create')
    
    const titleInput = page.locator('input[placeholder*="Clear, descriptive title"]')
    await expect(titleInput).toBeVisible()
    
    await titleInput.fill('Test Proposal Title')
    await expect(titleInput).toHaveValue('Test Proposal Title')
  })

  test('has summary textarea', async ({ page }) => {
    await page.goto('/create')
    
    const summaryInput = page.locator('textarea[placeholder*="1-2 sentence summary"]')
    await expect(summaryInput).toBeVisible()
  })

  test('has description textarea', async ({ page }) => {
    await page.goto('/create')
    
    const descInput = page.locator('textarea[placeholder*="Include"]')
    await expect(descInput).toBeVisible()
  })

  test('has AI assistant toggle', async ({ page }) => {
    await page.goto('/create')
    
    await expect(page.getByText('AI Assistant')).toBeVisible()
  })

  test('has continue button', async ({ page }) => {
    await page.goto('/create')
    
    const continueBtn = page.getByRole('button', { name: /Continue/i })
    await expect(continueBtn).toBeVisible()
    // Should be disabled until form is filled
    await expect(continueBtn).toBeDisabled()
  })

  test('back/cancel button returns to home', async ({ page }) => {
    await page.goto('/create')
    
    // Click cancel button (which is Back/Cancel on first step)
    await page.getByRole('button', { name: /Cancel/i }).click()
    
    await expect(page).toHaveURL('/')
  })

  test('shows draft step initially', async ({ page }) => {
    await page.goto('/create')
    
    await expect(page.getByText('Draft Your Proposal')).toBeVisible()
  })

  test('character count shows for title', async ({ page }) => {
    await page.goto('/create')
    
    const titleInput = page.locator('input[placeholder*="Clear, descriptive title"]')
    await titleInput.fill('Test Title Here')
    
    // Should show character count
    await expect(page.getByText(/\/100/)).toBeVisible()
  })

  test('can select proposal type', async ({ page }) => {
    await page.goto('/create')
    
    // Click on Treasury Allocation type
    await page.getByText('Treasury Allocation').click()
    
    // The button should have accent border (selected state)
    const treasuryButton = page.locator('button').filter({ hasText: 'Treasury Allocation' })
    await expect(treasuryButton).toHaveClass(/border-accent/)
  })
})
