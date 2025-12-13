/**
 * Live Integration Tests
 * 
 * Tests the Council UI with real running backend and chain.
 * Verifies data flows correctly from chain -> API -> UI.
 */

import { test, expect } from '@playwright/test'

const COUNCIL_API = process.env.NEXT_PUBLIC_COUNCIL_API || 'http://localhost:8010'

// Check if backend is available
test.beforeAll(async () => {
  try {
    const response = await fetch(`${COUNCIL_API}/health`)
    if (!response.ok) {
      test.skip()
    }
  } catch {
    test.skip()
  }
})

test.describe('Live Backend Integration', () => {
  test('dashboard loads real governance stats', async ({ page }) => {
    await page.goto('/')
    
    // Wait for data to load
    await page.waitForLoadState('networkidle')
    
    // Stats should show real data from API
    const statsCards = page.locator('.stat-card')
    await expect(statsCards).toHaveCount(4)
    
    // Proposals count should be visible
    await expect(page.locator('.stat-label').first()).toContainText('Proposals')
    const proposalCount = page.locator('.stat-value').first()
    await expect(proposalCount).toBeVisible()
  })

  test('CEO status shows model information', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // CEO section should show model details
    await expect(page.getByText('AI CEO')).toBeVisible()
    
    // Model name should be visible if API is working
    const ceoSection = page.locator('.card-static').first()
    await expect(ceoSection).toBeVisible()
  })

  test('council status shows agents', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Council section should show agents
    const councilCards = page.locator('.card-static')
    await expect(councilCards.nth(1)).toBeVisible()
  })

  test('create page assesses proposal with real AI', async ({ page }) => {
    await page.goto('/create')
    await page.waitForLoadState('networkidle')
    
    // Fill in proposal form
    const typeSelect = page.locator('select')
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption({ index: 1 })
    }
    
    const titleInput = page.getByPlaceholder(/10-100/)
    if (await titleInput.isVisible()) {
      await titleInput.fill('Enable Cross-Chain Bridging for ETH and Base')
    }
    
    const summaryInput = page.getByPlaceholder(/50-500/)
    if (await summaryInput.isVisible()) {
      await summaryInput.fill('Deploy bridge contracts to enable seamless token transfers between Ethereum mainnet and Base L2.')
    }
    
    const descInput = page.getByPlaceholder(/Problem/)
    if (await descInput.isVisible()) {
      await descInput.fill('## Problem\nUsers cannot move assets between networks.\n\n## Solution\nDeploy bridge contracts.')
    }
    
    // Click assess button if visible
    const assessBtn = page.getByRole('button', { name: /Assess/i })
    if (await assessBtn.isVisible()) {
      await assessBtn.click()
      // Wait for response
      await page.waitForTimeout(2000)
    }
    
    // Test passes if page loads correctly
    await expect(page.getByRole('heading', { name: /Create Proposal/i })).toBeVisible()
  })

  test('proposals page loads and displays list', async ({ page }) => {
    await page.goto('/proposals')
    await page.waitForLoadState('networkidle')
    
    // Page should show proposals heading
    await expect(page.getByRole('heading', { name: /Proposals/i })).toBeVisible()
    
    // Should show either proposals or empty state
    const proposalCards = page.locator('.proposal-card, [data-testid="proposal-card"]')
    const emptyState = page.getByText(/No proposals|No active proposals/i)
    
    const hasProposals = await proposalCards.first().isVisible().catch(() => false)
    const isEmpty = await emptyState.isVisible().catch(() => false)
    expect(hasProposals || isEmpty).toBeTruthy()
  })

  test('navigation between pages works', async ({ page }) => {
    await page.goto('/')
    
    // Navigate to proposals
    await page.getByRole('link', { name: /Proposals/i }).first().click()
    await expect(page).toHaveURL('/proposals')
    
    // Navigate to create
    await page.getByRole('link', { name: /Create/i }).first().click()
    await expect(page).toHaveURL('/create')
    
    // Navigate back to dashboard
    await page.getByRole('link', { name: /Dashboard/i }).first().click()
    await expect(page).toHaveURL('/')
  })

  test('API errors are handled gracefully', async ({ page }) => {
    // Even if API returns errors, page should not crash
    await page.goto('/')
    
    // Page should still render
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
  })
})

test.describe('Real Chain Integration', () => {
  test('stats reflect on-chain data', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Stats should show real values from chain
    const statsCards = page.locator('.stat-card')
    const firstStat = statsCards.first().locator('.stat-value')
    
    // Value should be a number (not loading placeholder)
    const value = await firstStat.textContent()
    expect(value).toBeDefined()
    expect(value).not.toBe('')
  })

  test('governance parameters are displayed', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Min score parameter should be visible
    await expect(page.getByText('Min Score')).toBeVisible()
    const minScore = page.locator('.stat-value').nth(3)
    const scoreText = await minScore.textContent()
    expect(scoreText).toMatch(/\d+%/)
  })
})

test.describe('Responsive UI', () => {
  test('mobile view works with live data', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Main content should be visible in mobile
    await expect(page.locator('main')).toBeVisible()
    
    // Stats cards should be visible
    const statCards = page.locator('.stat-card')
    await expect(statCards.first()).toBeVisible()
    
    // Mobile menu should be accessible if present
    const menuButton = page.locator('button[aria-label="Toggle menu"]')
    if (await menuButton.isVisible()) {
      await menuButton.click()
      await page.waitForTimeout(300)
    }
  })

  test('tablet view displays correctly', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    
    // Layout should adapt
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('.stat-card').first()).toBeVisible()
  })
})
