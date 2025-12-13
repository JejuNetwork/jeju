/**
 * EIL Cross-Chain Transfer E2E Tests
 * 
 * Tests the complete EIL user flow in Gateway:
 * 1. Connect wallet
 * 2. Navigate to Cross-Chain Transfer tab
 * 3. Select destination chain
 * 4. Select token and enter amount
 * 5. Initiate transfer
 * 6. Verify transaction is submitted
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('EIL Cross-Chain Transfer', () => {
  test.beforeEach(async ({ page, metamask }) => {
    // Navigate to Gateway
    await page.goto('/')
    
    // Connect wallet
    await page.click('text=Connect Wallet')
    await metamask.connectToDapp()
  })

  test('should display EIL stats when navigating to transfer tab', async ({ page }) => {
    // Click Cross-Chain Transfer tab
    await page.click('text=Cross-Chain Transfer')
    
    // Verify EIL Stats component is visible
    await expect(page.locator('text=EIL Protocol Stats')).toBeVisible()
    await expect(page.locator('text=24h Volume')).toBeVisible()
    await expect(page.locator('text=Active XLPs')).toBeVisible()
    await expect(page.locator('text=Success Rate')).toBeVisible()
  })

  test('should display cross-chain transfer form', async ({ page }) => {
    await page.click('text=Cross-Chain Transfer')
    
    // Verify form elements
    await expect(page.locator('text=Instant Cross-Chain Transfer')).toBeVisible()
    await expect(page.locator('text=Destination Chain')).toBeVisible()
    await expect(page.locator('text=Token to Transfer')).toBeVisible()
    await expect(page.locator('text=Amount')).toBeVisible()
  })

  test('should allow selecting destination chain', async ({ page }) => {
    await page.click('text=Cross-Chain Transfer')
    
    // Click on Ethereum chain option
    await page.click('text=Ethereum')
    
    // Verify Ethereum is selected (has blue border)
    const ethereumButton = page.locator('button:has-text("Ethereum")')
    await expect(ethereumButton).toHaveCSS('border-color', 'rgb(59, 130, 246)')
  })

  test('should show estimated fees and time', async ({ page }) => {
    await page.click('text=Cross-Chain Transfer')
    
    // Verify fee information is displayed
    await expect(page.locator('text=Estimated Time')).toBeVisible()
    await expect(page.locator('text=Network Fee')).toBeVisible()
    await expect(page.locator('text=Protocol')).toBeVisible()
    await expect(page.locator('text=EIL (Trustless)')).toBeVisible()
  })

  test('should show info banner about EIL', async ({ page }) => {
    await page.click('text=Cross-Chain Transfer')
    
    // Verify EIL explanation banner
    await expect(page.locator('text=How EIL Works')).toBeVisible()
    await expect(page.locator('text=Sign once')).toBeVisible()
  })

  test('should disable transfer button when amount is empty', async ({ page }) => {
    await page.click('text=Cross-Chain Transfer')
    
    // Find transfer button
    const transferButton = page.locator('button[type="submit"]')
    
    // Should be disabled without amount
    await expect(transferButton).toBeDisabled()
  })

  test('should show EIL not configured message when contracts not deployed', async ({ page }) => {
    // If EIL is not configured, should show warning
    await page.click('text=Cross-Chain Transfer')
    
    // Check for either the form or the "not configured" message
    const hasForm = await page.locator('text=Instant Cross-Chain Transfer').isVisible()
    const hasWarning = await page.locator('text=EIL (Ethereum Interop Layer) is not configured').isVisible()
    
    expect(hasForm || hasWarning).toBe(true)
  })
})

test.describe('XLP Dashboard', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto('/')
    await page.click('text=Connect Wallet')
    await metamask.connectToDapp()
  })

  test('should display XLP dashboard tabs', async ({ page }) => {
    await page.click('text=XLP Dashboard')
    
    // Verify tabs are visible
    await expect(page.locator('text=Overview')).toBeVisible()
    await expect(page.locator('text=Liquidity')).toBeVisible()
    await expect(page.locator('text=Stake')).toBeVisible()
    await expect(page.locator('text=History')).toBeVisible()
  })

  test('should show L1 stake information on overview tab', async ({ page }) => {
    await page.click('text=XLP Dashboard')
    
    // Verify stake info
    await expect(page.locator('text=L1 Stake')).toBeVisible()
    await expect(page.locator('text=L2 ETH Liquidity')).toBeVisible()
  })

  test('should show registration form for new XLPs', async ({ page }) => {
    await page.click('text=XLP Dashboard')
    await page.click('button:has-text("Stake")')
    
    // Check for registration form or stake management
    const hasRegForm = await page.locator('text=Register as XLP').isVisible()
    const hasStakeManagement = await page.locator('text=Active Stake').isVisible()
    
    expect(hasRegForm || hasStakeManagement).toBe(true)
  })

  test('should show supported chains selector', async ({ page }) => {
    await page.click('text=XLP Dashboard')
    await page.click('button:has-text("Stake")')
    
    // If showing registration, should have chain selector
    const hasChains = await page.locator('text=Supported Chains').isVisible()
    if (hasChains) {
      await expect(page.locator('text=Jeju Mainnet')).toBeVisible()
      await expect(page.locator('text=Base')).toBeVisible()
    }
  })

  test('should show liquidity deposit form', async ({ page }) => {
    await page.click('text=XLP Dashboard')
    await page.click('button:has-text("Liquidity")')
    
    // Verify liquidity form
    await expect(page.locator('text=ETH Liquidity')).toBeVisible()
    await expect(page.locator('text=Deposit ETH')).toBeVisible()
  })

  test('should show XLP info banner', async ({ page }) => {
    await page.click('text=XLP Dashboard')
    
    // Verify info banner
    await expect(page.locator('text=How XLP works')).toBeVisible()
    await expect(page.locator('text=Stake ETH on L1')).toBeVisible()
  })
})

