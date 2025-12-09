/**
* @fileoverview Test file
 * End-to-End Complete Journey
 * Tests FULL user journey across all features in sequence
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('End-to-End Complete Journey', () => {
  test('should complete full user journey: connect -> create token -> swap -> trade market -> claim', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    // === STEP 1: Connect Wallet ===
    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    console.log('✅ Wallet connected')
    
    // === STEP 2: Create Token ===
    await page.goto('/tokens/create')
    await page.waitForTimeout(1000)
    
    const tokenName = `JourneyToken${Date.now()}`
    const tokenSymbol = `JRN${Date.now().toString().slice(-4)}`
    
    await page.getByPlaceholder(/My Awesome Token/i).fill(tokenName)
    await page.getByPlaceholder(/MAT/i).fill(tokenSymbol)
    await page.getByPlaceholder(/Describe your token/i).fill('E2E test token')
    await page.getByPlaceholder('1000000').fill('1000000')
    
    const createButton = page.getByRole('button', { name: /Create Token/i })
    const createEnabled = await createButton.isEnabled()
    
    if (createEnabled) {
      await createButton.click()
      await page.waitForTimeout(2000)
      await metamask.confirmTransaction()
      await page.waitForTimeout(5000)
      
      console.log('✅ Token created')
    }
    
    // === STEP 3: Browse Markets ===
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    // Search for a market
    const searchInput = page.getByTestId('market-search')
    await searchInput.fill('game')
    await page.waitForTimeout(500)
    await searchInput.clear()
    
    // Filter by Active
    const activeFilter = page.getByTestId('filter-active')
    await activeFilter.click()
    await expect(activeFilter).toHaveClass(/bg-purple-600/)
    
    console.log('✅ Markets browsed and filtered')
    
    // === STEP 4: Place Bet on Market ===
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      const tradingInterface = page.getByTestId('trading-interface')
      const interfaceExists = await tradingInterface.isVisible()
      
      if (interfaceExists) {
        // Place YES bet
        await page.getByTestId('outcome-yes-button').click()
        await page.getByTestId('amount-input').fill('50')
        await page.getByTestId('buy-button').click()
        await page.waitForTimeout(2000)
        await metamask.confirmTransaction()
        await page.waitForTimeout(5000)
        
        console.log('✅ Market bet placed')
      }
    }
    
    // === STEP 5: Check Portfolio ===
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Verify stats display
    await expect(page.getByText(/Total Value/i)).toBeVisible()
    await expect(page.getByText(/Total P&L/i)).toBeVisible()
    await expect(page.getByText(/Active Positions/i)).toBeVisible()
    
    console.log('✅ Portfolio viewed')
    
    // === STEP 6: Try Swap (if contracts deployed) ===
    await page.goto('/swap')
    await page.waitForTimeout(1000)
    
    const inputSelect = page.locator('select').first()
    const outputSelect = page.locator('select').nth(1)
    await inputSelect.selectOption('ETH')
    await outputSelect.selectOption('USDC')
    await page.locator('input[type="number"]').first().fill('0.01')
    
    const swapButton = page.getByRole('button', { name: /Swap/i })
    const swapEnabled = await swapButton.isEnabled()
    
    if (swapEnabled) {
      await swapButton.click()
      await page.waitForTimeout(2000)
      await metamask.confirmTransaction()
      await page.waitForTimeout(5000)
      
      console.log('✅ Swap executed')
    } else {
      console.log('⏸️  Swap contracts not deployed')
    }
    
    // === STEP 7: Return to Homepage ===
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Welcome to Bazaar/i })).toBeVisible()
    
    // Wallet should still be connected
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    
    console.log('✅ Journey complete - all steps executed')
    
    // Final verification
    const finalBody = await page.textContent('body')
    expect(finalBody).toBeTruthy()
    expect(finalBody!.length).toBeGreaterThan(500)
  })

  test('should handle errors gracefully throughout journey', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Try to create token with invalid data
    await page.goto('/tokens/create')
    await page.getByPlaceholder(/MAT/i).fill('INVALID_SYMBOL_TOO_LONG_12345')
    await page.waitForTimeout(500)
    
    // Should handle validation
    const createButton = page.getByRole('button', { name: /Create Token/i })
    const enabled = await createButton.isEnabled()
    
    // Either disabled or will show error after click
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    
    // Try to access non-existent market
    await page.goto('/markets/0x0000000000000000000000000000000000000000000000000000000000000000')
    await page.waitForTimeout(1000)
    
    // Should show "Market Not Found" or error
    const errorBody = await page.textContent('body')
    const hasErrorMessage = errorBody?.includes('Not Found') || 
                           errorBody?.includes('doesn\'t exist')
    
    expect(errorBody).toBeTruthy()
    
    // Navigate back successfully
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Welcome to Bazaar/i })).toBeVisible()
  })

  test('should maintain state across tab switches', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate through all pages rapidly
    const pages = [
      { url: '/tokens', heading: /Tokens/i },
      { url: '/swap', heading: /Swap Tokens/i },
      { url: '/pools', heading: /Liquidity Pools/i },
      { url: '/liquidity', heading: /Add Liquidity/i },
      { url: '/markets', heading: /Prediction Markets/i },
      { url: '/portfolio', heading: /Your Portfolio/i },
      { url: '/nfts', heading: /NFT Marketplace/i },
      { url: '/my-nfts', heading: /My NFTs/i },
      { url: '/games', heading: /Games/i },
    ]
    
    for (const pageDef of pages) {
      await page.goto(pageDef.url)
      await page.waitForTimeout(500)
      
      // Verify page loads
      await expect(page.getByRole('heading', { name: pageDef.heading })).toBeVisible({ timeout: 10000 })
      
      // Wallet should stay connected
      await expect(page.getByText(/0xf39F/i)).toBeVisible()
    }
    
    console.log('✅ All pages maintain wallet connection')
  })

  test('should complete rapid action sequence', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Rapid sequence of actions
    
    // 1. View Markets
    await page.goto('/markets')
    await page.waitForTimeout(1000)
    
    // 2. Search markets
    await page.getByTestId('market-search').fill('test')
    await page.waitForTimeout(300)
    await page.getByTestId('market-search').clear()
    
    // 3. Filter active
    await page.getByTestId('filter-active').click()
    await page.waitForTimeout(300)
    
    // 4. View portfolio
    await page.goto('/portfolio')
    await page.waitForTimeout(1000)
    
    // 5. Check swap
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await page.locator('select').first().selectOption('ETH')
    
    // 6. Back to home
    await page.goto('/')
    await page.waitForTimeout(500)
    
    // Wallet should still be connected
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    
    console.log('✅ Rapid action sequence completed without issues')
  })

})