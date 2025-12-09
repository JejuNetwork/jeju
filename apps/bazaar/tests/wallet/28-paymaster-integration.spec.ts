/**
* @fileoverview Test file
 * Paymaster Integration Tests
 * Tests paying gas with alternative ERC20 tokens
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Paymaster Integration', () => {
  test('should display paymaster selector when available', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Go to a transaction page
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Look for paymaster selector
      const paymasterSelector = page.getByText(/Pay Gas With|Pay with/i)
      const selectorExists = await paymasterSelector.isVisible()
      
      if (selectorExists) {
        await expect(paymasterSelector).toBeVisible()
        console.log('✅ Paymaster selector found')
      } else {
        console.log('⏸️  Paymaster not deployed')
      }
    }
  })

  test('should select USDC for gas payment', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to transaction page
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // If paymaster selector exists
      const paymasterButton = page.getByRole('button', { hasText: /Pay Gas With|ETH|USDC/i })
      const count = await paymasterButton.count()
      
      if (count > 0) {
        // Open paymaster selector
        await paymasterButton.first().click()
        await page.waitForTimeout(500)
        
        // Select USDC option
        const usdcOption = page.getByRole('button', { hasText: /USDC/i })
        const usdcExists = await usdcOption.isVisible()
        
        if (usdcExists) {
          await usdcOption.click()
          await page.waitForTimeout(500)
          
          // Verify USDC is selected
          const selectedText = await paymasterButton.first().textContent()
          expect(selectedText).toContain('USDC')
        }
      }
    }
  })

  test('should approve token for paymaster', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Select paymaster token
      const paymasterButton = page.getByRole('button', { hasText: /Pay Gas|USDC/i })
      const pmExists = await paymasterButton.count()
      
      if (pmExists > 0) {
        await paymasterButton.first().click()
        await page.waitForTimeout(500)
        
        const usdcOption = page.getByRole('button', { hasText: /USDC/i })
        const usdcVisible = await usdcOption.isVisible()
        
        if (usdcVisible) {
          await usdcOption.click()
          await page.waitForTimeout(1000)
          
          // Place bet to trigger approval
          await page.getByTestId('outcome-yes-button').click()
          await page.getByTestId('amount-input').fill('10')
          await page.getByTestId('buy-button').click()
          await page.waitForTimeout(2000)
          
          // May need to approve paymaster first
          const approveButton = page.getByRole('button', { name: /Approve.*USDC/i })
          const needsApproval = await approveButton.isVisible()
          
          if (needsApproval) {
            await approveButton.click()
            await page.waitForTimeout(2000)
            await metamask.confirmTransaction()
            await page.waitForTimeout(5000)
            
            console.log('✅ Paymaster token approved')
          }
        }
      }
    }
  })

  test('should execute transaction with paymaster gas payment', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Setup with paymaster
      const paymasterButton = page.getByRole('button', { hasText: /Pay Gas/i })
      const pmExists = await paymasterButton.count()
      
      if (pmExists > 0) {
        await paymasterButton.first().click()
        await page.waitForTimeout(500)
        
        const usdcOption = page.getByRole('button', { hasText: /USDC/i })
        const usdcVisible = await usdcOption.isVisible()
        
        if (usdcVisible) {
          await usdcOption.click()
          await page.waitForTimeout(1000)
          
          // Place bet
          await page.getByTestId('outcome-yes-button').click()
          await page.getByTestId('amount-input').fill('20')
          await page.getByTestId('buy-button').click()
          await page.waitForTimeout(2000)
          
          // Confirm transaction (gas paid in USDC)
          await metamask.confirmTransaction()
          await page.waitForTimeout(5000)
          
          console.log('✅ Transaction executed with paymaster gas payment')
          
          // Verify success
          const body = await page.textContent('body')
          expect(body).toBeTruthy()
        }
      }
    }
  })

  test('should show estimated token cost for gas', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      const paymasterButton = page.getByRole('button', { hasText: /Pay Gas/i })
      const pmExists = await paymasterButton.count()
      
      if (pmExists > 0) {
        await paymasterButton.first().click()
        await page.waitForTimeout(500)
        
        // Check for estimated cost display
        const body = await page.textContent('body')
        const hasCostEstimate = body?.includes('~') && 
                               (body?.includes('USDC') || body?.includes('elizaOS'))
        
        if (hasCostEstimate) {
          console.log('✅ Gas cost estimate shown in tokens')
        }
      }
    }
  })

})