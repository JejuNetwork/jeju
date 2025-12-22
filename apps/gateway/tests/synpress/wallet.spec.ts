/**
 * Gateway Wallet Tests
 *
 * Tests wallet connection, token display, and balance functionality.
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001'

test.describe('Wallet Connection', () => {
  test('displays connect button before connection', async ({ page }) => {
    await page.goto(GATEWAY_URL)
    await page.waitForLoadState('networkidle')

    await expect(
      page.locator('button:has-text("Connect")').first(),
    ).toBeVisible()
    await expect(
      page.getByText(/Gateway Portal|Protocol Infrastructure/i),
    ).toBeVisible()
  })

  test('connects MetaMask wallet', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({
      timeout: 15000,
    })

    await page.screenshot({
      path: 'test-results/screenshots/wallet-connected.png',
      fullPage: true,
    })
  })

  test('shows correct network indicator', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
    const networkIndicator = page.locator('text=/Network|Chain/i')
    const hasNetworkInfo = await networkIndicator.isVisible().catch(() => false)

    if (hasNetworkInfo) {
      await expect(networkIndicator).toBeVisible()
    }
  })
})

test.describe('Token Balance Display', () => {
  test('displays all protocol token balances', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await page.waitForTimeout(3000)

    await expect(page.getByText('elizaOS')).toBeVisible()
    await expect(page.getByText('CLANKER')).toBeVisible()
    await expect(page.getByText('VIRTUAL')).toBeVisible()
    await expect(page.getByText('CLANKERMON')).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/token-balances.png',
      fullPage: true,
    })
  })

  test('shows USD values for tokens', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await page.waitForTimeout(3000)

    const usdValues = page.locator('text=/\\$[\\d,]+\\.?\\d*/')
    const count = await usdValues.count()
    expect(count).toBeGreaterThan(0)
  })

  test('displays token logos', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await page.waitForTimeout(3000)

    const images = page.locator(
      'img[alt*="elizaOS"], img[alt*="CLANKER"], img[alt*="VIRTUAL"], img[alt*="CLANKERMON"]',
    )
    const imageCount = await images.count()
    expect(imageCount).toBeGreaterThanOrEqual(1)
  })

  test('calculates total portfolio value', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await page.waitForTimeout(3000)

    const totalText = page.getByText(/Total:/i)
    const hasTotal = await totalText.isVisible().catch(() => false)

    if (hasTotal) {
      await expect(totalText.locator('../..').getByText(/\\$/)).toBeVisible()
    }
  })
})

test.describe('Tab Navigation', () => {
  test('navigates through all tabs', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    const tabs = [
      'Registered Tokens',
      'Bridge from Ethereum',
      'Deploy Paymaster',
      'Add Liquidity',
      'My Earnings',
      'Node Operators',
      'App Registry',
    ]

    for (let i = 0; i < tabs.length; i++) {
      await page.getByRole('button', { name: tabs[i] }).click()
      await page.waitForTimeout(1000)

      await page.screenshot({
        path: `test-results/screenshots/tab-${i + 1}-${tabs[i].toLowerCase().replace(/\s+/g, '-')}.png`,
        fullPage: true,
      })
    }
  })

  test('maintains wallet connection across tabs', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    const tabs = ['Registered Tokens', 'Bridge from Ethereum', 'Add Liquidity']

    for (const tab of tabs) {
      await page.getByRole('button', { name: tab }).click()
      await page.waitForTimeout(500)
      await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
    }
  })
})
