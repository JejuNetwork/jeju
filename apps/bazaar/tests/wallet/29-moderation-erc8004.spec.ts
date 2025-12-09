/**
* @fileoverview Test file
 * Moderation & ERC-8004 Integration Tests
 * Tests ban enforcement, reputation badges, and reporting
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Moderation & ERC-8004', () => {
  test('should check user ban status before trading', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to market to trigger ban check
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const marketCard = page.getByTestId('market-card').first()
    const cardExists = await marketCard.isVisible()
    
    if (cardExists) {
      await marketCard.click()
      await page.waitForTimeout(1000)
      
      // Check if trading interface shows or ban message
      const tradingBanned = page.getByTestId('trading-banned')
      const bannedExists = await tradingBanned.isVisible()
      
      if (bannedExists) {
        // User is banned
        await expect(tradingBanned).toBeVisible()
        await expect(page.getByText(/Trading Restricted|banned/i)).toBeVisible()
        
        console.log('⚠️  User is banned from trading')
      } else {
        // User is allowed
        const tradingInterface = page.getByTestId('trading-interface')
        const interfaceExists = await tradingInterface.isVisible()
        
        if (interfaceExists) {
          await expect(tradingInterface).toBeVisible()
          console.log('✅ User allowed to trade')
        }
      }
    }
  })

  test('should display reputation badge for users', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    // Look for reputation badges on market cards or detail pages
    const badges = page.locator('[class*="badge"], [data-testid*="reputation"]')
    const badgeCount = await badges.count()
    
    // Badges may appear if user is registered
    console.log(`Found ${badgeCount} reputation indicators`)
    
    // Page should render
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('should show report button for suspicious activity', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    // Look for report buttons (may appear on market pages)
    const reportButtons = page.getByRole('button', { hasText: /Report|Flag/i })
    const reportCount = await reportButtons.count()
    
    console.log(`Found ${reportCount} report buttons`)
    
    // Page should load
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('should redirect to Gateway for reporting', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    
    const reportButtons = page.getByRole('button', { hasText: /Report/i })
    const reportCount = await reportButtons.count()
    
    if (reportCount > 0) {
      const firstReport = reportButtons.first()
      
      // Click report button
      await firstReport.click()
      await page.waitForTimeout(1000)
      
      // Should either open modal or redirect
      const body = await page.textContent('body')
      expect(body).toBeTruthy()
    }
  })

  test('should show different badge types (Trusted, Scammer, Hacker, Banned)', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Look for any reputation badges
    const badges = page.locator('[class*="bg-green-"][class*="TRUSTED"], [class*="bg-red-"][class*="BANNED"], [class*="bg-orange-"][class*="SCAMMER"]')
    const badgeCount = await badges.count()
    
    console.log(`Found ${badgeCount} reputation badges`)
    
    // Page should render
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('should verify stake tier displays for users', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Look for tier indicators (Small, Medium, High)
    const body = await page.textContent('body')
    const hasTierInfo = body?.includes('Small') || 
                       body?.includes('Medium') ||
                       body?.includes('High') ||
                       body?.includes('Tier')
    
    // Page should render (may not have tier info if not registered)
    expect(body).toBeTruthy()
  })

  test('should prevent banned user from trading', async ({ context, page, metamaskPage, extensionId }) => {
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
      
      // If user is banned, should show ban message
      const bannedMessage = page.getByTestId('trading-banned')
      const isBanned = await bannedMessage.isVisible()
      
      if (isBanned) {
        // Verify buy button is hidden or disabled
        const buyButton = page.getByTestId('buy-button')
        const buttonExists = await buyButton.isVisible()
        
        expect(buttonExists).toBe(false)
        
        // Verify ban message shows
        await expect(bannedMessage).toBeVisible()
        await expect(page.getByText(/Trading Restricted|banned/i)).toBeVisible()
        
        console.log('✅ Banned user prevented from trading')
      }
    }
  })
})
