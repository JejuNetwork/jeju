import basicSetup from '@jejunetwork/tests/wallet-setup'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Network Node with Wallet', () => {
  test('should connect wallet to app', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Navigate to the node app
    await page.goto('http://localhost:1420')
    await page.waitForSelector('text=Dashboard')

    // Navigate to wallet page
    await page.click('text=Wallet')
    await page.waitForSelector('text=Connect External Wallet')

    // Click connect external wallet
    await page.click('text=Connect External Wallet')

    // Connect MetaMask
    await metamask.connectToDapp()

    // Verify wallet is connected
    await expect(page.locator('text=0xf39F')).toBeVisible()
  })

  test('should start a service after connecting wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    await page.goto('http://localhost:1420')
    await page.waitForSelector('text=Dashboard')

    // First connect wallet
    await page.click('text=Wallet')
    await page.click('text=Connect External Wallet')
    await metamask.connectToDapp()

    // Navigate to services
    await page.click('text=Services')
    await page.waitForSelector('text=Cron Executor')

    // Start the cron service (no stake required)
    const cronCard = page.locator('text=Cron Executor').locator('..')
    await cronCard.locator('button:has-text("Start")').click()

    // Should show running status
    await expect(cronCard.locator('.status-healthy')).toBeVisible()
  })

  test('should approve and stake for a service', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    await page.goto('http://localhost:1420')
    await page.waitForSelector('text=Dashboard')

    // Connect wallet
    await page.click('text=Wallet')
    await page.click('text=Connect External Wallet')
    await metamask.connectToDapp()

    // Navigate to staking
    await page.click('text=Staking')
    await page.waitForSelector('text=Stakes by Service')

    // Click stake on proxy service
    const proxyRow = page.locator('text=Proxy Node').locator('..')
    await proxyRow.locator('button:has-text("Stake")').click()

    // Enter stake amount
    await page.fill('input[type="number"]', '0.1')
    await page.click('button:has-text("Stake")')

    // Approve the transaction in MetaMask
    await metamask.confirmTransaction()

    // Verify stake was successful
    await expect(page.locator('text=0.1 ETH')).toBeVisible()
  })

  test('should start a trading bot with acknowledgement', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    await page.goto('http://localhost:1420')
    await page.waitForSelector('text=Dashboard')

    // Connect wallet
    await page.click('text=Wallet')
    await page.click('text=Connect External Wallet')
    await metamask.connectToDapp()

    // Navigate to bots
    await page.click('text=Trading Bots')
    await page.waitForSelector('text=DEX Arbitrage Bot')

    // Start DEX arb bot
    const dexArbCard = page.locator('text=DEX Arbitrage Bot').locator('..')
    await dexArbCard.locator('button:has-text("Start")').click()

    // Configure capital
    await page.fill('input[type="number"]', '0.1')
    await page.click('button:has-text("Start Bot")')

    // Should show running status
    await expect(dexArbCard.locator('.status-healthy')).toBeVisible()
  })

  test('should claim rewards', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    await page.goto('http://localhost:1420')
    await page.waitForSelector('text=Dashboard')

    // Connect wallet
    await page.click('text=Wallet')
    await page.click('text=Connect External Wallet')
    await metamask.connectToDapp()

    // Navigate to staking
    await page.click('text=Staking')
    await page.waitForSelector('text=Pending Rewards')

    // If there are pending rewards, claim them
    const claimAllButton = page.locator('button:has-text("Claim All")')
    if (await claimAllButton.isVisible()) {
      await claimAllButton.click()
      await metamask.confirmTransaction()

      // Verify claim was processed
      await expect(page.locator('text=claimed')).toBeVisible()
    }
  })
})
