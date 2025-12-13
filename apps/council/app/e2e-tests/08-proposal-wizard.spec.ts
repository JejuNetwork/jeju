import { test, expect } from '@playwright/test'

test.describe('Proposal Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/create')
    await page.waitForLoadState('networkidle')
  })

  test('loads create proposal page with wizard', async ({ page }) => {
    // Header should be visible
    await expect(page.getByText('Create Proposal')).toBeVisible()
    
    // Wizard steps should be visible
    await expect(page.locator('.card-static').first()).toBeVisible()
  })

  test('displays proposal type selection', async ({ page }) => {
    // Proposal types should be selectable
    await expect(page.getByText('Parameter Change')).toBeVisible()
    await expect(page.getByText('Treasury Allocation')).toBeVisible()
    await expect(page.getByText('Code Upgrade')).toBeVisible()
  })

  test('can select different proposal types', async ({ page }) => {
    // Click on Treasury Allocation
    await page.getByText('Treasury Allocation').click()
    
    // It should be selected (has accent border)
    const treasuryButton = page.locator('button').filter({ hasText: 'Treasury Allocation' })
    await expect(treasuryButton).toHaveClass(/border-accent/)
  })

  test('title field has character limit', async ({ page }) => {
    const titleInput = page.locator('input[placeholder*="Clear, descriptive title"]')
    await expect(titleInput).toBeVisible()
    
    // Type title
    await titleInput.fill('Test Proposal Title')
    await expect(page.getByText('19/100')).toBeVisible()
  })

  test('summary field has character limit', async ({ page }) => {
    const summaryTextarea = page.locator('textarea[placeholder*="1-2 sentence summary"]')
    await expect(summaryTextarea).toBeVisible()
    
    // Type summary
    await summaryTextarea.fill('This is a test summary that describes what the proposal does.')
    await expect(page.getByText('/500')).toBeVisible()
  })

  test('description field shows character count', async ({ page }) => {
    const descriptionTextarea = page.locator('textarea[placeholder*="Include"]')
    await expect(descriptionTextarea).toBeVisible()
    
    // Type description
    await descriptionTextarea.fill('This is a detailed description of the proposal. It includes motivation, solution, implementation plan, timeline, and risk assessment.')
    
    // Should show character count
    await expect(page.getByText(/characters/)).toBeVisible()
  })

  test('AI assistant toggle works', async ({ page }) => {
    // Click on AI Assistant
    await page.getByText('AI Assistant').click()
    
    // Generator section should appear
    await expect(page.getByPlaceholder('I want to propose...')).toBeVisible()
  })

  test('cannot proceed without required fields', async ({ page }) => {
    // Continue button should be disabled
    const continueButton = page.locator('button').filter({ hasText: 'Continue' })
    await expect(continueButton).toBeDisabled()
  })

  test('can proceed with valid draft', async ({ page }) => {
    // Fill in required fields
    await page.locator('input[placeholder*="Clear, descriptive title"]').fill('Increase Staking Rewards by 5%')
    await page.locator('textarea[placeholder*="1-2 sentence summary"]').fill('This proposal aims to increase the staking rewards from 10% to 15% APY to attract more validators and improve network security.')
    await page.locator('textarea[placeholder*="Include"]').fill(`
## Problem
The current staking rewards of 10% APY are not competitive with other networks, leading to low validator participation.

## Solution
Increase staking rewards to 15% APY.

## Implementation
1. Update the RewardsDistributor contract
2. Deploy new parameters
3. Announce changes to community

## Timeline
- Week 1: Code review
- Week 2: Testing
- Week 3: Deployment

## Budget
No additional budget required - funded from existing token inflation.

## Risk Assessment
- Low risk: Simple parameter change
- Mitigation: Gradual rollout over 30 days
    `)
    
    // Continue button should now be enabled
    const continueButton = page.locator('button').filter({ hasText: 'Continue' })
    await expect(continueButton).not.toBeDisabled()
  })

  test('back button returns to previous step', async ({ page }) => {
    // Fill fields and go to next step
    await page.locator('input[placeholder*="Clear, descriptive title"]').fill('Test Proposal')
    await page.locator('textarea[placeholder*="1-2 sentence summary"]').fill('This is a test summary that is at least fifty characters long.')
    await page.locator('textarea[placeholder*="Include"]').fill('A'.repeat(250))
    
    await page.locator('button').filter({ hasText: 'Continue' }).click()
    
    // Should be on quality step
    await expect(page.getByText('Quality Assessment')).toBeVisible()
    
    // Click back
    await page.locator('button').filter({ hasText: 'Back' }).click()
    
    // Should be back on draft step
    await expect(page.getByText('Draft Your Proposal')).toBeVisible()
  })

  test('cancel button redirects to home', async ({ page }) => {
    // Click cancel (which is Back on first step)
    await page.locator('button').filter({ hasText: 'Cancel' }).click()
    
    // Should redirect to home
    await expect(page).toHaveURL('/')
  })
})

test.describe('Proposal Wizard - Quality Step', () => {
  test('can navigate to quality step', async ({ page }) => {
    await page.goto('/create')
    await page.waitForLoadState('networkidle')
    
    // Fill draft
    await page.locator('input[placeholder*="Clear, descriptive title"]').fill('Increase Staking Rewards')
    await page.locator('textarea[placeholder*="1-2 sentence summary"]').fill('This proposal aims to increase staking rewards to improve network security.')
    await page.locator('textarea[placeholder*="Include"]').fill(`
## Problem Statement
Current staking rewards are not competitive.

## Proposed Solution
Increase rewards by 5%.

## Implementation Plan
Deploy updated contract parameters.

## Budget
No additional budget.

## Risk Assessment
Low risk - simple parameter change.
    `)
    
    // Wait for Continue button to be enabled and click
    const continueBtn = page.locator('button').filter({ hasText: 'Continue' })
    await expect(continueBtn).toBeEnabled({ timeout: 5000 })
    await continueBtn.click()
    
    // Wait for quality step
    await page.waitForSelector('text=Quality Assessment', { timeout: 10000 })
    await expect(page.getByText('Quality Assessment')).toBeVisible()
    // Use button role specifically to avoid matching the text in paragraph
    await expect(page.getByRole('button', { name: 'Run Assessment' })).toBeVisible()
  })
})
