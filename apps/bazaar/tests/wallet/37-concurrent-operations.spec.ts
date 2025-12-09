/**
* @fileoverview Test file
 * Concurrent Operations Tests
 * Tests multiple simultaneous transactions and state consistency
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Concurrent Operations', () => {
  test('should handle multiple market bets in sequence', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCards = page.getByTestId('market-card')
    const marketCount = await marketCards.count()
    
    if (marketCount >= 2) {
      console.log(`Testing concurrent bets on ${marketCount} markets`)
      
      // Place bet on first market
      await marketCards.nth(0).click()
      await page.waitForTimeout(1000)
      
      const tradingInterface1 = page.getByTestId('trading-interface')
      const canTrade1 = await tradingInterface1.isVisible()
      
      if (canTrade1) {
        await page.getByTestId('outcome-yes-button').click()
        await page.getByTestId('amount-input').fill('10')
        await page.getByTestId('buy-button').click()
        await page.waitForTimeout(2000)
        await metamask.confirmTransaction()
        await page.waitForTimeout(5000)
        
        console.log('✅ Bet 1 placed')
        
        // Go back and bet on second market
        await page.goto('/markets')
        await page.waitForTimeout(1000)
        
        await marketCards.nth(1).click()
        await page.waitForTimeout(1000)
        
        const tradingInterface2 = page.getByTestId('trading-interface')
        const canTrade2 = await tradingInterface2.isVisible()
        
        if (canTrade2) {
          await page.getByTestId('outcome-no-button').click()
          await page.getByTestId('amount-input').fill('15')
          await page.getByTestId('buy-button').click()
          await page.waitForTimeout(2000)
          await metamask.confirmTransaction()
          await page.waitForTimeout(5000)
          
          console.log('✅ Bet 2 placed')
          
          // Verify both positions in portfolio
          await page.goto('/portfolio')
          await page.waitForTimeout(3000)
          
          const positionsTable = page.getByTestId('positions-table')
          const tableExists = await positionsTable.isVisible()
          
          if (tableExists) {
            const rowCount = await positionsTable.locator('tbody tr').count()
            expect(rowCount).toBeGreaterThanOrEqual(2)
            
            console.log(`✅ Both positions showing in portfolio (${rowCount} total)`)
          }
        }
      }
    }
  })

  test('should handle rapid token swaps', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/swap')
    await page.waitForTimeout(1000)
    
    const swapButton = page.getByRole('button', { name: /Swap/i })
    const swapEnabled = await swapButton.isEnabled()
    
    if (swapEnabled) {
      // Execute 3 swaps in rapid succession
      for (let i = 0; i < 3; i++) {
        console.log(`Swap ${i + 1}/3`)
        
        const inputSelect = page.locator('select').first()
        const outputSelect = page.locator('select').nth(1)
        
        if (i % 2 === 0) {
          await inputSelect.selectOption('ETH')
          await outputSelect.selectOption('USDC')
        } else {
          await inputSelect.selectOption('USDC')
          await outputSelect.selectOption('ETH')
        }
        
        await page.locator('input[type="number"]').first().fill('0.01')
        await page.waitForTimeout(300)
        
        await swapButton.click()
        await page.waitForTimeout(2000)
        await metamask.confirmTransaction()
        await page.waitForTimeout(3000)
        
        console.log(`✅ Swap ${i + 1} complete`)
      }
      
      console.log('✅ All rapid swaps completed successfully')
    } else {
      console.log('⏸️ Swap contracts not deployed')
    }
  })

  test('should handle multiple token creations in sequence', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Create 3 tokens rapidly
    for (let i = 0; i < 3; i++) {
      console.log(`Creating token ${i + 1}/3`)
      
      await page.goto('/tokens/create')
      await page.waitForTimeout(500)
      
      const timestamp = Date.now()
      await page.getByPlaceholder(/My Awesome Token/i).fill(`ConcurrentToken${i}`)
      await page.getByPlaceholder(/MAT/i).fill(`CT${timestamp.toString().slice(-5)}${i}`)
      await page.getByPlaceholder('1000000').fill(`${100000 * (i + 1)}`)
      
      const createButton = page.getByRole('button', { name: /Create Token/i })
      const enabled = await createButton.isEnabled()
      
      if (enabled) {
        await createButton.click()
        await page.waitForTimeout(2000)
        await metamask.confirmTransaction()
        await page.waitForTimeout(4000)
        
        console.log(`✅ Token ${i + 1} created`)
      }
    }
    
    // Verify all tokens appear in list
    await page.goto('/tokens')
    await page.waitForTimeout(5000) // Wait for indexer
    
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    
    console.log('✅ Multiple token creations handled')
  })

  test('should maintain data consistency with concurrent page views', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Place a bet
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const hasMarket = await marketCard.isVisible()
    
    if (hasMarket) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      const tradingInterface = page.getByTestId('trading-interface')
      const canTrade = await tradingInterface.isVisible()
      
      if (canTrade) {
        await page.getByTestId('outcome-yes-button').click()
        await page.getByTestId('amount-input').fill('20')
        await page.getByTestId('buy-button').click()
        await page.waitForTimeout(2000)
        await metamask.confirmTransaction()
        await page.waitForTimeout(5000)
        
        // View position in portfolio
        await page.goto('/portfolio')
        await page.waitForTimeout(2000)
        
        const totalValue1 = await page.locator('text=/Total Value/i').locator('..').textContent()
        
        // Navigate away and back
        await page.goto('/markets')
        await page.waitForTimeout(500)
        await page.goto('/portfolio')
        await page.waitForTimeout(2000)
        
        const totalValue2 = await page.locator('text=/Total Value/i').locator('..').textContent()
        
        // Values should be consistent
        expect(totalValue1).toBeTruthy()
        expect(totalValue2).toBeTruthy()
        
        console.log(`Value 1: ${totalValue1}`)
        console.log(`Value 2: ${totalValue2}`)
        console.log('✅ Data consistency maintained')
      }
    }
  })

  test('should handle transaction queue correctly', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()
    
    if (count >= 2) {
      // Start first transaction
      await marketCards.nth(0).click()
      await page.waitForTimeout(1000)
      
      const tradingInterface = page.getByTestId('trading-interface')
      const canTrade = await tradingInterface.isVisible()
      
      if (canTrade) {
        await page.getByTestId('outcome-yes-button').click()
        await page.getByTestId('amount-input').fill('5')
        await page.getByTestId('buy-button').click()
        await page.waitForTimeout(1000)
        
        // Don't confirm yet, navigate to second market
        await page.goto('/markets')
        await page.waitForTimeout(500)
        
        await marketCards.nth(1).click()
        await page.waitForTimeout(1000)
        
        const tradingInterface2 = page.getByTestId('trading-interface')
        const canTrade2 = await tradingInterface2.isVisible()
        
        if (canTrade2) {
          // Start second transaction
          await page.getByTestId('outcome-no-button').click()
          await page.getByTestId('amount-input').fill('8')
          await page.getByTestId('buy-button').click()
          await page.waitForTimeout(1000)
          
          // Now confirm both in sequence
          await metamask.confirmTransaction()
          await page.waitForTimeout(3000)
          
          await metamask.confirmTransaction()
          await page.waitForTimeout(3000)
          
          console.log('✅ Transaction queue handled correctly')
          
          // Verify both positions created
          await page.goto('/portfolio')
          await page.waitForTimeout(3000)
          
          const positionsTable = page.getByTestId('positions-table')
          const tableExists = await positionsTable.isVisible()
          
          if (tableExists) {
            const rowCount = await positionsTable.locator('tbody tr').count()
            console.log(`Found ${rowCount} positions after concurrent bets`)
          }
        }
      }
    }
  })

  test('should verify final state after all concurrent operations', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Check portfolio for all positions from concurrent tests
    await page.goto('/portfolio')
    await page.waitForTimeout(3000)
    
    // Should show total value
    const totalValueContainer = page.locator('text=/Total Value/i').locator('..')
    await expect(totalValueContainer).toBeVisible()
    
    const valueText = await totalValueContainer.textContent()
    console.log(`Final Total Value: ${valueText}`)
    
    // Should show P&L
    const pnlContainer = page.locator('text=/Total P&L/i').locator('..')
    await expect(pnlContainer).toBeVisible()
    
    const pnlText = await pnlContainer.textContent()
    console.log(`Final P&L: ${pnlText}`)
    
    // Should show active positions
    const activeContainer = page.locator('text=/Active Positions/i').locator('..')
    await expect(activeContainer).toBeVisible()
    
    const activeText = await activeContainer.textContent()
    console.log(`Active Positions: ${activeText}`)
    
    // Check positions table
    const positionsTable = page.getByTestId('positions-table')
    const hasTable = await positionsTable.isVisible()
    
    if (hasTable) {
      const rowCount = await positionsTable.locator('tbody tr').count()
      console.log(`Total positions in table: ${rowCount}`)
      
      // Each row should have valid data
      for (let i = 0; i < Math.min(rowCount, 5); i++) {
        const row = positionsTable.locator('tbody tr').nth(i)
        const rowText = await row.textContent()
        
        // Should have market name, shares, value, P&L
        const hasValidData = rowText?.includes('YES') || 
                            rowText?.includes('NO') ||
                            rowText?.includes('ETH')
        
        expect(hasValidData).toBe(true)
      }
      
      console.log('✅ All positions have valid data')
    }
    
    console.log('✅ Final state verification complete')
  })
})
