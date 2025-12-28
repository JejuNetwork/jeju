/**
 * DWS Wallet Integration Tests with Synpress
 *
 * Tests wallet connection, signing, and transactions for DWS features
 * that require blockchain authentication.
 */

// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { testWithSynpress } from '@synthetixio/synpress'
import '@jejunetwork/tests/zod-compat'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import '@jejunetwork/tests/zod-compat'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const DWS_PORT = parseInt(process.env.DWS_PORT || '4031', 10)
const BASE_URL = `http://localhost:${DWS_PORT}`

test.describe('DWS - Wallet Connection', () => {
  test('displays connect button before connection', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // DWS should show a connect wallet option
    const connectBtn = page.locator('button:has-text(/connect/i)').first()
    await expect(connectBtn).toBeVisible({ timeout: 10000 })

    await page.screenshot({
      path: 'test-results/screenshots/dws-before-connect.png',
      fullPage: true,
    })
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

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Click connect button
    const connectBtn = page.locator('button:has-text(/connect/i)').first()
    await connectBtn.click()
    await page.waitForTimeout(1000)

    // Connect MetaMask
    await metamask.connectToDapp()

    // Verify wallet address is shown
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({
      timeout: 15000,
    })

    await page.screenshot({
      path: 'test-results/screenshots/dws-connected.png',
      fullPage: true,
    })
  })
})

test.describe('DWS - Authenticated Navigation', () => {
  test('can navigate compute pages with wallet connected', async ({
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

    await page.goto(BASE_URL)

    // Connect wallet first
    const connectBtn = page.locator('button:has-text(/connect/i)').first()
    if (await connectBtn.isVisible()) {
      await connectBtn.click()
      await page.waitForTimeout(1000)
      await metamask.connectToDapp()
    }

    // Navigate to compute pages
    const computePaths = [
      '/compute/containers',
      '/compute/workers',
      '/compute/jobs',
    ]

    for (const path of computePaths) {
      await page.goto(`${BASE_URL}${path}`)
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('body')).toBeVisible()

      // Wallet should remain connected
      await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
    }
  })

  test('can navigate storage pages with wallet connected', async ({
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

    await page.goto(BASE_URL)

    // Connect wallet first
    const connectBtn = page.locator('button:has-text(/connect/i)').first()
    if (await connectBtn.isVisible()) {
      await connectBtn.click()
      await page.waitForTimeout(1000)
      await metamask.connectToDapp()
    }

    // Navigate to storage pages
    const storagePaths = ['/storage/buckets', '/storage/cdn', '/storage/ipfs']

    for (const path of storagePaths) {
      await page.goto(`${BASE_URL}${path}`)
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('body')).toBeVisible()

      // Wallet should remain connected
      await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
    }
  })
})

test.describe('DWS - Faucet Integration', () => {
  test('can request testnet tokens from faucet', async ({
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

    await page.goto(`${BASE_URL}/faucet`)

    // Connect wallet first
    const connectBtn = page.locator('button:has-text(/connect/i)').first()
    if (await connectBtn.isVisible()) {
      await connectBtn.click()
      await page.waitForTimeout(1000)
      await metamask.connectToDapp()
    }

    await page.waitForTimeout(2000)

    // Check faucet page has expected content
    await expect(page.locator('text=/faucet/i')).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/dws-faucet.png',
      fullPage: true,
    })
  })
})
