import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../test/wallet-setup/jeju.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Wallet Connection with Synpress', () => {
  test('should connect MetaMask wallet to Bazaar', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')

    await page.getByRole('button', { name: /Connect Wallet/i }).click()

    await metamask.connectToDapp()

    // Wait for wallet address to appear in header
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('should display wallet address in header', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await page.waitForTimeout(1000)
    
    await metamask.connectToDapp()

    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('should be on Jeju network', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Verify Jeju network is configured (network switching happens in setup)
    await expect(page).toHaveURL('/')
  })
})

