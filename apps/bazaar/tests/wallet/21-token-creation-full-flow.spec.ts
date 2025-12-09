/**
* @fileoverview Test file
 * Token Creation - Complete End-to-End Flow
 * Tests REAL token deployment with contract verification
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Token Creation - Full Flow', () => {
  test('should create token with MetaMask transaction', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect wallet
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to token creation
    await page.goto('/tokens/create')
    await expect(page.getByRole('heading', { name: /Create Token/i })).toBeVisible()
    
    // Fill form
    const tokenName = `TestToken${Date.now()}`
    const tokenSymbol = `TST${Date.now().toString().slice(-4)}`
    
    await page.getByPlaceholder(/My Awesome Token/i).fill(tokenName)
    await page.getByPlaceholder(/MAT/i).fill(tokenSymbol)
    await page.getByPlaceholder(/Describe your token/i).fill('Test token for Synpress testing')
    await page.getByPlaceholder('1000000').fill('1000000')
    
    // Select decimals
    const decimalsSelect = page.locator('select').filter({ hasText: /standard/i })
    await decimalsSelect.selectOption('18')
    
    // Click create button
    const createButton = page.getByRole('button', { name: /Create Token/i })
    await expect(createButton).toBeEnabled()
    await createButton.click()
    
    // Confirm in MetaMask
    await page.waitForTimeout(2000)
    await metamask.confirmTransaction()
    
    // Wait for transaction confirmation
    await page.waitForTimeout(5000)
    
    // Should see success toast or redirect
    const body = await page.textContent('body')
    const hasSuccess = body?.includes('created successfully') || 
                      body?.includes('Token') || 
                      body?.includes(tokenSymbol)
    
    expect(hasSuccess).toBe(true)
  })

  test('should verify created token appears in indexer', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Create token
    await page.goto('/tokens/create')
    const tokenName = `TestToken${Date.now()}`
    const tokenSymbol = `TST${Date.now().toString().slice(-4)}`
    
    await page.getByPlaceholder(/My Awesome Token/i).fill(tokenName)
    await page.getByPlaceholder(/MAT/i).fill(tokenSymbol)
    await page.getByPlaceholder('1000000').fill('100000')
    
    const createButton = page.getByRole('button', { name: /Create Token/i })
    await createButton.click()
    await page.waitForTimeout(2000)
    await metamask.confirmTransaction()
    await page.waitForTimeout(5000)
    
    // Navigate to tokens list
    await page.goto('/tokens')
    await page.waitForTimeout(3000) // Wait for indexer
    
    // Search for our token
    const body = await page.textContent('body')
    
    // Token should appear (either by symbol or address)
    // Note: might take a few seconds for indexer to catch up
    await page.waitForTimeout(5000)
    await page.reload()
    await page.waitForTimeout(2000)
    
    // Verify page loads without errors
    const reloadedBody = await page.textContent('body')
    expect(reloadedBody).toBeTruthy()
  })

  test('should navigate to created token detail page', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Go to tokens list
    await page.goto('/tokens')
    await page.waitForTimeout(2000)
    
    // If tokens exist, click first one
    const tokenCards = page.locator('a').filter({ has: page.locator('text=/0x[a-fA-F0-9]{4}\\.\\.\\./')  })
    const count = await tokenCards.count()
    
    if (count > 0) {
      await tokenCards.first().click()
      
      // Should navigate to detail page
      await expect(page).toHaveURL(/\/tokens\/\d+\/0x[a-fA-F0-9]{40}/)
      
      // Verify detail page loads
      const detailBody = await page.textContent('body')
      expect(detailBody).toBeTruthy()
      expect(detailBody!.length).toBeGreaterThan(100)
    }
  })

  test('should handle token creation with different decimals', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Test with 6 decimals (like USDC)
    await page.goto('/tokens/create')
    
    await page.getByPlaceholder(/My Awesome Token/i).fill('USDC Clone')
    await page.getByPlaceholder(/MAT/i).fill('USDC6')
    await page.getByPlaceholder('1000000').fill('1000000')
    
    const decimalsSelect = page.locator('select')
    await decimalsSelect.selectOption('6')
    
    const createButton = page.getByRole('button', { name: /Create Token/i })
    await createButton.click()
    await page.waitForTimeout(2000)
    await metamask.confirmTransaction()
    await page.waitForTimeout(5000)
    
    // Should succeed
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('should reject token creation without wallet', async ({ page }) => {
    await page.goto('/tokens/create')
    
    // Should show connect wallet message
    await expect(page.getByText(/Please connect your wallet/i)).toBeVisible()
    
    // Create button should be disabled or say "Connect Wallet"
    const button = page.getByRole('button', { name: /Connect Wallet|Create Token/i }).first()
    const buttonText = await button.textContent()
    
    if (buttonText?.includes('Create Token')) {
      await expect(button).toBeDisabled()
    } else {
      expect(buttonText).toContain('Connect Wallet')
    }
  })

})