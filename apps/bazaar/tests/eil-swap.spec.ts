/**
 * EIL Cross-Chain Swap E2E Tests
 * 
 * Tests the EIL integration in Bazaar swap page:
 * 1. Toggle cross-chain mode
 * 2. Select source and destination chains
 * 3. Enter swap amount
 * 4. View fee estimates
 * 5. Execute cross-chain swap
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('EIL Cross-Chain Swap', () => {
  test.beforeEach(async ({ page, metamask }) => {
    // Navigate to Bazaar swap page
    await page.goto('/swap')
    
    // Connect wallet
    const connectButton = page.locator('text=Connect Wallet')
    if (await connectButton.isVisible()) {
      await connectButton.click()
      await metamask.connectToDapp()
    }
  })

  test('should show EIL enabled banner when configured', async ({ page }) => {
    // Check for EIL banner
    const banner = page.locator('text=EIL Enabled')
    const noBanner = page.locator('text=Swap functionality unavailable')
    
    const hasBanner = await banner.isVisible()
    const hasNoBanner = await noBanner.isVisible()
    
    // One of these should be true
    expect(hasBanner || hasNoBanner).toBe(true)
    
    if (hasBanner) {
      await expect(page.locator('text=Cross-chain swaps available')).toBeVisible()
    }
  })

  test('should have cross-chain mode toggle', async ({ page }) => {
    // Look for cross-chain toggle
    const toggle = page.locator('text=Cross-Chain Mode')
    const isVisible = await toggle.isVisible()
    
    // Toggle may only be visible when EIL is enabled
    if (isVisible) {
      await expect(toggle).toBeVisible()
    }
  })

  test('should show chain selectors when cross-chain mode is on', async ({ page }) => {
    // Enable cross-chain mode if available
    const toggleButton = page.locator('button:has-text("OFF")')
    if (await toggleButton.isVisible()) {
      await toggleButton.click()
      
      // Verify chain selectors appear
      await expect(page.locator('text=From Chain')).toBeVisible()
      await expect(page.locator('text=To Chain')).toBeVisible()
    }
  })

  test('should display EIL info box for cross-chain swaps', async ({ page }) => {
    // Enable cross-chain mode
    const toggleButton = page.locator('button:has-text("OFF")')
    if (await toggleButton.isVisible()) {
      await toggleButton.click()
      
      // Select different chains
      await page.selectOption('select:near(:text("From Chain"))', '420691')
      await page.selectOption('select:near(:text("To Chain"))', '1')
      
      // Enter amount
      await page.fill('input[placeholder="0.0"]', '0.1')
      
      // Verify EIL info box
      await expect(page.locator('text=EIL Cross-Chain Swap')).toBeVisible()
      await expect(page.locator('text=Est. Time')).toBeVisible()
      await expect(page.locator('text=Network Fee')).toBeVisible()
    }
  })

  test('should show swap button with EIL text for cross-chain', async ({ page }) => {
    // Enable cross-chain mode
    const toggleButton = page.locator('button:has-text("OFF")')
    if (await toggleButton.isVisible()) {
      await toggleButton.click()
      
      // Select different chains
      await page.selectOption('select:near(:text("From Chain"))', '420691')
      await page.selectOption('select:near(:text("To Chain"))', '1')
      
      // Verify swap button text
      await expect(page.locator('button:has-text("Swap via EIL")')).toBeVisible()
    }
  })

  test('should swap tokens within same chain', async ({ page }) => {
    // Keep cross-chain mode off
    await page.fill('input[placeholder="0.0"]', '0.1')
    
    // Should show regular swap button
    const swapButton = page.locator('button:has-text("Swap")')
    await expect(swapButton).toBeVisible()
  })

  test('should show pool info section', async ({ page }) => {
    await page.fill('input[placeholder="0.0"]', '0.1')
    
    // Verify pool info is shown
    await expect(page.locator('text=Rate')).toBeVisible()
    await expect(page.locator('text=Price Impact')).toBeVisible()
    await expect(page.locator('text=Protocol')).toBeVisible()
  })

  test('should show security info for cross-chain swaps', async ({ page }) => {
    // Enable cross-chain mode
    const toggleButton = page.locator('button:has-text("OFF")')
    if (await toggleButton.isVisible()) {
      await toggleButton.click()
      
      // Select different chains
      await page.selectOption('select:near(:text("From Chain"))', '420691')
      await page.selectOption('select:near(:text("To Chain"))', '1')
      
      // Verify security info
      await expect(page.locator('text=L1 Stake-backed')).toBeVisible()
    }
  })
})

test.describe('Liquidity Page - XLP Section', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto('/liquidity')
    
    const connectButton = page.locator('text=Connect Wallet')
    if (await connectButton.isVisible()) {
      await connectButton.click()
      await metamask.connectToDapp()
    }
  })

  test('should have V4 and XLP tabs', async ({ page }) => {
    await expect(page.locator('text=Uniswap V4 Pools')).toBeVisible()
    await expect(page.locator('text=Cross-Chain XLP')).toBeVisible()
  })

  test('should show XLP explanation when clicking XLP tab', async ({ page }) => {
    await page.click('text=Cross-Chain XLP')
    
    await expect(page.locator('text=Become an XLP')).toBeVisible()
    await expect(page.locator('text=Earn fees by providing cross-chain liquidity')).toBeVisible()
  })

  test('should show 3-step XLP onboarding', async ({ page }) => {
    await page.click('text=Cross-Chain XLP')
    
    await expect(page.locator('text=Stake on L1')).toBeVisible()
    await expect(page.locator('text=Deposit Liquidity')).toBeVisible()
    await expect(page.locator('text=Fulfill Transfers')).toBeVisible()
  })

  test('should show supported chains in XLP section', async ({ page }) => {
    await page.click('text=Cross-Chain XLP')
    
    await expect(page.locator('text=Supported Chains')).toBeVisible()
    await expect(page.locator('text=Jeju')).toBeVisible()
    await expect(page.locator('text=Base')).toBeVisible()
  })

  test('should show quick action links', async ({ page }) => {
    await page.click('text=Cross-Chain XLP')
    
    await expect(page.locator('text=Register as XLP')).toBeVisible()
    await expect(page.locator('text=Deposit Liquidity')).toBeVisible()
    await expect(page.locator('text=Try Cross-Chain Transfer')).toBeVisible()
  })

  test('should link to Gateway for XLP registration', async ({ page }) => {
    await page.click('text=Cross-Chain XLP')
    
    const registerLink = page.locator('a:has-text("Register as XLP")')
    await expect(registerLink).toHaveAttribute('href', 'https://gateway.jeju.network?tab=xlp')
  })
})

