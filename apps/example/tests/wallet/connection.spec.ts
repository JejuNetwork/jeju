import type { BrowserContext, Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

async function connectWallet(
  page: Page,
  context: BrowserContext,
  metamaskPage: Page,
  extensionId: string,
): Promise<MetaMask> {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId,
  )

  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  const connectBtn = page.locator('#connect')
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
  }

  return metamask
}

test.describe('Wallet Connection', () => {
  test('shows connect wallet screen initially', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Should show "Connect Your Wallet" heading
    await expect(page.getByText('Connect Your Wallet')).toBeVisible()

    // Should show connect button
    await expect(page.locator('#connect')).toBeVisible()
    await expect(page.locator('#connect')).toHaveText('Connect Wallet')

    // Should not show main todo form yet
    await expect(page.locator('#todo-form')).not.toBeVisible()
  })

  test('connects MetaMask wallet successfully', async ({
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

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Click connect button
    await page.locator('#connect').click()
    await page.waitForTimeout(1000)

    // Approve connection in MetaMask
    await metamask.connectToDapp()

    // Should show truncated address
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    // Should show disconnect button
    await expect(page.locator('#disconnect')).toBeVisible()

    // Connect screen should be gone
    await expect(page.locator('#connect')).not.toBeVisible()
  })

  test('displays wallet address in header after connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    // Address should be truncated like 0xf39F...2266
    await expect(page.getByText(/0xf39F.*2266/i)).toBeVisible()
  })

  test('shows todo form after wallet connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    // Todo form should now be visible
    await expect(page.locator('#todo-form')).toBeVisible({ timeout: 15000 })

    // Input and buttons should be visible
    await expect(page.locator('#todo-input')).toBeVisible()
    await expect(page.locator('#priority-select')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('shows filter buttons after wallet connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    // Filter buttons should be visible
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pending' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible()
  })

  test('disconnects wallet successfully', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    // Verify connected state
    await expect(page.locator('#disconnect')).toBeVisible()

    // Click disconnect
    await page.locator('#disconnect').click()

    // Should return to connect screen
    await expect(page.locator('#connect')).toBeVisible()
    await expect(page.getByText('Connect Your Wallet')).toBeVisible()

    // Address should no longer be visible
    await expect(page.getByText(/0xf39F/i)).not.toBeVisible()
  })
})

test.describe('Page Header', () => {
  test('shows app title and subtitle', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('Example')).toBeVisible()
    await expect(page.getByText(/Powered by Jeju Network/i)).toBeVisible()
  })

  test('header persists after wallet connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    await expect(page.getByText('Example')).toBeVisible()
    await expect(page.getByText(/Powered by Jeju Network/i)).toBeVisible()
  })
})
