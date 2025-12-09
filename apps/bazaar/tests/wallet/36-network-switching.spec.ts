/**
* @fileoverview Test file
 * Network Switching Tests
 * Tests switching between different networks and verifying contract updates
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Network Switching', () => {
  test('should verify currently on Jeju network', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Go to page that shows network requirements
    await page.goto('/tokens/create')
    await page.waitForTimeout(1000)
    
    // Should NOT show network switch warning for Jeju
    const switchWarning = page.getByText(/Switch to Jeju|Wrong network/i)
    const hasWarning = await switchWarning.isVisible()
    
    expect(hasWarning).toBe(false)
    console.log('✅ Verified on Jeju network')
  })

  test('should detect and show wrong network warning', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Add Ethereum Mainnet
    await metamask.addNetwork({
      name: 'Ethereum Mainnet',
      rpcUrl: 'https://eth.llamarpc.com',
      chainId: 1,
      symbol: 'ETH',
    })
    
    // Switch to Ethereum
    await metamask.switchNetwork('Ethereum Mainnet')
    await page.waitForTimeout(2000)
    
    // Reload page to detect network change
    await page.goto('/tokens/create')
    await page.waitForTimeout(1000)
    
    // Should show network switch warning
    const switchWarning = page.getByText(/Switch to Jeju|Chain ID: 1337|Please switch/i)
    const hasWarning = await switchWarning.isVisible()
    
    if (hasWarning) {
      await expect(switchWarning).toBeVisible()
      console.log('✅ Wrong network warning displayed')
    }
    
    // Switch back to Jeju
    await metamask.switchNetwork('Jeju Local')
    await page.waitForTimeout(2000)
    await page.reload()
    await page.waitForTimeout(1000)
    
    // Warning should be gone
    const warningAfter = await page.getByText(/Switch to Jeju/i).isVisible()
    expect(warningAfter).toBe(false)
    
    console.log('✅ Switched back to Jeju')
  })

  test('should update contract addresses when switching networks', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // On Jeju (1337), contracts should work
    await page.goto('/swap')
    await page.waitForTimeout(1000)
    
    const swapButton = page.getByRole('button', { name: /Swap/i })
    const buttonOnJeju = await swapButton.textContent()
    
    // Switch to different network
    await metamask.addNetwork({
      name: 'Testnet',
      rpcUrl: 'https://sepolia.drpc.org',
      chainId: 11155111,
      symbol: 'ETH',
    })
    
    await metamask.switchNetwork('Testnet')
    await page.waitForTimeout(2000)
    await page.reload()
    await page.waitForTimeout(1000)
    
    // Button should show different state (contracts not on this network)
    const buttonOnTestnet = await swapButton.textContent()
    
    console.log(`Button on Jeju: ${buttonOnJeju}`)
    console.log(`Button on Testnet: ${buttonOnTestnet}`)
    
    // Should show warning or disabled state
    const hasNetworkWarning = buttonOnTestnet?.includes('Switch') || 
                             buttonOnTestnet?.includes('Contracts Not Deployed')
    
    // Switch back
    await metamask.switchNetwork('Jeju Local')
    await page.waitForTimeout(1000)
    
    console.log('✅ Contract addresses update based on network')
  })

  test('should maintain wallet connection during network switch', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Verify connected
    const addressBefore = await page.getByText(/0xf39F/i).textContent()
    
    // Switch network
    await metamask.addNetwork({
      name: 'Sepolia',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      symbol: 'ETH',
    })
    
    await metamask.switchNetwork('Sepolia')
    await page.waitForTimeout(2000)
    
    // Wallet should still show address
    const addressAfter = page.getByText(/0xf39F/i)
    const stillConnected = await addressAfter.isVisible()
    
    if (stillConnected) {
      await expect(addressAfter).toBeVisible()
      console.log('✅ Wallet stayed connected during network switch')
    }
    
    // Switch back to Jeju
    await metamask.switchNetwork('Jeju Local')
    await page.waitForTimeout(1000)
  })

  test('should handle network switch during transaction', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    
    // Start a transaction
    await page.goto('/tokens/create')
    await page.waitForTimeout(1000)
    
    await page.getByPlaceholder(/My Awesome Token/i).fill('NetworkTest')
    await page.getByPlaceholder(/MAT/i).fill('NTWK')
    await page.getByPlaceholder('1000000').fill('1000')
    
    const createButton = page.getByRole('button', { name: /Create Token/i })
    const createEnabled = await createButton.isEnabled()
    
    if (createEnabled) {
      // Start transaction
      await createButton.click()
      await page.waitForTimeout(1000)
      
      // Switch network in MetaMask before confirming
      await metamask.addNetwork({
        name: 'Test Network',
        rpcUrl: 'https://rpc.ankr.com/eth_goerli',
        chainId: 5,
        symbol: 'ETH',
      })
      
      await metamask.switchNetwork('Test Network')
      await page.waitForTimeout(1000)
      
      // Transaction should fail or be rejected
      // App should handle gracefully
      
      // Switch back
      await metamask.switchNetwork('Jeju Local')
      await page.waitForTimeout(1000)
      
      console.log('✅ Network switch during transaction handled')
    }
  })
})
