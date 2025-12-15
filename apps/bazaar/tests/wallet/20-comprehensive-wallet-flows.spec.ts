/**
import type { Page } from "@playwright/test";
 * Comprehensive Wallet Connection & Network Tests
 * Tests ALL wallet connection scenarios with real blockchain
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Comprehensive Wallet Flows', () => {
  test('should connect wallet from homepage', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Verify connect button exists
    const connectButton = page.getByRole('button', { name: /Connect Wallet/i })
    await expect(connectButton).toBeVisible()
    
    // Click connect
    await connectButton.click()
    await page.waitForTimeout(1000)
    
    // Approve connection in MetaMask
    await metamask.connectToDapp()
    
    // Verify address appears in header
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Verify disconnect button appears
    await expect(page.getByRole('button', { name: /Disconnect/i })).toBeVisible()
  })

  test('should disconnect wallet and reconnect', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect first
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Disconnect
    const disconnectButton = page.getByRole('button', { name: /Disconnect/i })
    await disconnectButton.click()
    await page.waitForTimeout(1000)
    
    // Verify address is gone
    await expect(page.getByText(/0xf39F/i)).not.toBeVisible()
    
    // Verify connect button is back
    await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible()
    
    // Reconnect
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('should maintain connection across page navigation', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect wallet
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to tokens
    await page.getByRole('link', { name: /^Tokens$/i }).click()
    await expect(page).toHaveURL('/tokens')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    
    // Navigate to swap
    await page.getByRole('link', { name: /^Swap$/i }).click()
    await expect(page).toHaveURL('/swap')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    
    // Navigate to markets
    await page.getByRole('link', { name: /^Markets$/i }).click()
    await expect(page).toHaveURL('/markets')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    
    // Navigate to portfolio
    await page.getByRole('link', { name: /^Portfolio$/i }).click()
    await expect(page).toHaveURL('/portfolio')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })

  test('should verify network is Network (1337)', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect wallet
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Go to a page that shows network info or requires correct network
    await page.goto('/tokens/create')
    
    // Should NOT show network switch warning
    const networkWarning = page.getByText(/Switch to the network/i)
    const warningVisible = await networkWarning.isVisible()
    
    if (warningVisible) {
      throw new Error('Wrong network! Should be on the network (1337)')
    }
  })

  test('should display wallet balance', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Navigate to portfolio to check balance
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)
    
    // Should show portfolio stats (Total Value, P&L, Active Positions)
    const totalValue = page.getByText(/Total Value/i)
    await expect(totalValue).toBeVisible()
  })
})

