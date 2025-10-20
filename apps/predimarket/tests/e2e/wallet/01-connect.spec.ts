/**
 * Wallet Connection Tests using Synpress
 * 
 * Tests MetaMask wallet connection to Predimarket
 * Using Synpress for reliable wallet testing
 */

// Import necessary Synpress modules and setup
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../wallet-setup/basic.setup'

// Create a test instance with Synpress and MetaMask fixtures
const test = testWithSynpress(metaMaskFixtures(basicSetup))

// Extract expect function from test
const { expect } = test

test.describe('Wallet Connection with Synpress', () => {
  test('should connect wallet to Predimarket', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    // Create a new MetaMask instance
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId
    )

    // Navigate to the homepage
    await page.goto('/')

    // Verify page loaded
    await expect(page.getByText('Predimarket')).toBeVisible()

    // Click the connect button
    const connectButton = page.locator('button:has-text("Connect")').first()
    await connectButton.click()

    // Wait for wallet selection modal
    await page.waitForTimeout(1000)

    // Select MetaMask
    await page.click('text="MetaMask"')

    // Connect MetaMask to the dapp
    await metamask.connectToDapp()

    // Verify the connected account address is shown
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 })
  })

  test('should display connected wallet address', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId
    )

    await page.goto('/')
    const connectButton = page.locator('button:has-text("Connect")').first()
    await connectButton.click()
    await page.waitForTimeout(1000)
    await page.click('text="MetaMask"')
    await metamask.connectToDapp()

    // Verify address displays (should show default Anvil account)
    await expect(page.locator('button:has-text(/0xf39/)')).toBeVisible()
  })

  test('should navigate to market with connected wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId
    )

    // Connect wallet first
    await page.goto('/')
    const connectButton = page.locator('button:has-text("Connect")').first()
    await connectButton.click()
    await page.waitForTimeout(1000)
    await page.click('text="MetaMask"')
    await metamask.connectToDapp()

    // Wait for connection
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()

    // Navigate to first market (if available)
    const marketCard = page.locator('[data-testid="market-card"]').first()
    const hasMarkets = await marketCard.isVisible({ timeout: 5000 }).catch(() => false)
    
    if (hasMarkets) {
      await marketCard.click()
      await expect(page.getByText('Place Bet')).toBeVisible()
    }
  })
});

