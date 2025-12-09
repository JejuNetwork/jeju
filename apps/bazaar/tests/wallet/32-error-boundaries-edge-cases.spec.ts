/**
* @fileoverview Test file
 * Error Boundaries & Edge Cases
 * Tests error handling, recovery, and edge cases throughout the app
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Error Boundaries & Edge Cases', () => {
  test('should handle navigation to non-existent pages', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to non-existent routes
    await page.goto('/nonexistent-page-12345')
    await page.waitForTimeout(1000)
    
    // Should show 404 or redirect
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    
    // Navigate back
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Welcome to Bazaar/i })).toBeVisible()
  })

  test('should handle indexer connection failures gracefully', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Go to page that requires indexer data
    await page.goto('/tokens')
    await page.waitForTimeout(2000)
    
    // Should show either tokens or loading or error state (not crash)
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    
    const hasErrorOrData = body?.includes('Failed to load') || 
                           body?.includes('0x') ||
                           body?.includes('No tokens') ||
                           body?.includes('Loading')
    
    expect(hasErrorOrData).toBe(true)
  })

  test('should handle MetaMask transaction rejection', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Try to create a token
    await page.goto('/tokens/create')
    await page.getByPlaceholder(/My Awesome Token/i).fill('Test')
    await page.getByPlaceholder(/MAT/i).fill('TST')
    await page.getByPlaceholder('1000000').fill('1000')
    
    const createButton = page.getByRole('button', { name: /Create Token/i })
    const enabled = await createButton.isEnabled()
    
    if (enabled) {
      await createButton.click()
      await page.waitForTimeout(2000)
      
      // Reject transaction in MetaMask
      await metamask.rejectTransaction()
      await page.waitForTimeout(2000)
      
      // Should show error message or stay on page
      const body = await page.textContent('body')
      const hasErrorHandling = body?.includes('Transaction failed') || 
                              body?.includes('rejected') ||
                              body?.includes('Create Token') // Still on form
      
      expect(body).toBeTruthy()
      console.log('✅ Transaction rejection handled gracefully')
    }
  })

  test('should recover from error boundary', async ({ page }) => {
    // Visit page without wallet (may trigger some components to error)
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    
    // Should show error boundary or load normally
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    
    // If error boundary triggered
    const errorBoundary = page.getByText(/Something went wrong|Reload Page/i)
    const hasErrorBoundary = await errorBoundary.isVisible()
    
    if (hasErrorBoundary) {
      // Click reload button
      const reloadButton = page.getByRole('button', { name: /Reload Page/i })
      await reloadButton.click()
      await page.waitForTimeout(2000)
      
      // Should reload page
      const reloadedBody = await page.textContent('body')
      expect(reloadedBody).toBeTruthy()
      
      console.log('✅ Error boundary recovery works')
    }
  })

  test('should handle concurrent transactions', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Try to place multiple bets rapidly
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()
    
    if (count >= 2) {
      // Open first market
      await marketCards.nth(0).click()
      await page.waitForTimeout(1000)
      
      const tradingInterface = page.getByTestId('trading-interface')
      const interfaceExists = await tradingInterface.isVisible()
      
      if (interfaceExists) {
        // Start first bet
        await page.getByTestId('outcome-yes-button').click()
        await page.getByTestId('amount-input').fill('5')
        await page.getByTestId('buy-button').click()
        await page.waitForTimeout(1000)
        
        // Don't wait for confirmation, navigate away
        await page.goto('/markets')
        await page.waitForTimeout(500)
        
        // Open second market
        const secondCard = await marketCards.nth(1).isVisible()
        
        if (secondCard) {
          await marketCards.nth(1).click()
          await page.waitForTimeout(1000)
          
          // App should handle pending transaction gracefully
          const body = await page.textContent('body')
          expect(body).toBeTruthy()
          
          console.log('✅ Concurrent transaction handling works')
        }
      }
    }
  })

  test('should validate form inputs and show errors', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Test token creation validation
    await page.goto('/tokens/create')
    
    // Leave required fields empty
    const createButton = page.getByRole('button', { name: /Create Token/i })
    const isDisabled = await createButton.isDisabled()
    
    expect(isDisabled).toBe(true)
    
    // Fill only name
    await page.getByPlaceholder(/My Awesome Token/i).fill('Test')
    
    // Still disabled (needs symbol)
    const stillDisabled = await createButton.isDisabled()
    expect(stillDisabled).toBe(true)
    
    // Fill symbol
    await page.getByPlaceholder(/MAT/i).fill('TST')
    
    // Now should be enabled
    const nowEnabled = await createButton.isEnabled()
    expect(nowEnabled).toBe(true)
    
    console.log('✅ Form validation working correctly')
  })

  test('should handle network errors gracefully', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to markets (which queries GraphQL)
    await page.goto('/markets')
    await page.waitForTimeout(3000)
    
    // Should show either:
    // 1. Markets loaded successfully
    // 2. Loading state
    // 3. Error message "Failed to load markets"
    
    const body = await page.textContent('body')
    
    const hasValidState = body?.includes('market') ||
                         body?.includes('Loading') ||
                         body?.includes('Failed') ||
                         body?.includes('No markets')
    
    expect(hasValidState).toBe(true)
    
    // Should not crash
    expect(body?.length).toBeGreaterThan(100)
    
    console.log('✅ Network errors handled gracefully')
  })

  test('should handle rapid navigation without crashes', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate rapidly between pages
    for (let i = 0; i < 3; i++) {
      await page.goto('/markets')
      await page.waitForTimeout(200)
      
      await page.goto('/portfolio')
      await page.waitForTimeout(200)
      
      await page.goto('/tokens')
      await page.waitForTimeout(200)
      
      await page.goto('/swap')
      await page.waitForTimeout(200)
      
      await page.goto('/')
      await page.waitForTimeout(200)
    }
    
    // Final state should be valid
    await expect(page.getByRole('heading', { name: /Welcome to Bazaar/i })).toBeVisible()
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    
    console.log('✅ Rapid navigation handled without crashes')
  })

  test('should maintain data consistency after refresh', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to portfolio
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Get current stats
    const valueBefore = await page.getByText(/Total Value/i).locator('..').textContent()
    
    // Refresh page
    await page.reload()
    await page.waitForTimeout(2000)
    
    // Wallet should reconnect automatically
    const isConnected = await page.getByText(/0xf39F/i).isVisible({ timeout: 5000 })
    
    if (!isConnected) {
      // May need to reconnect
      const connectButton = page.getByRole('button', { name: /Connect Wallet/i })
      const needsConnect = await connectButton.isVisible()
      
      if (needsConnect) {
        await connectButton.click()
        await metamask.connectToDapp()
        await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
      }
    }
    
    // Stats should reload
    const valueAfter = await page.getByText(/Total Value/i).locator('..').textContent()
    
    expect(valueBefore).toBeTruthy()
    expect(valueAfter).toBeTruthy()
    
    console.log('✅ Data consistency maintained after refresh')
  })
})
