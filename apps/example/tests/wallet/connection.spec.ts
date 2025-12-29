import { basicSetup, test } from '@jejunetwork/tests'
import type { BrowserContext, Page } from '@playwright/test'
import { MetaMask } from '@synthetixio/synpress/playwright'

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

    await expect(page.getByText('Connect your wallet')).toBeVisible()
    await expect(page.locator('#connect')).toBeVisible()
    await expect(page.locator('#connect')).toHaveText('Connect Wallet')
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

    await page.locator('#connect').click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
    await expect(page.locator('#disconnect')).toBeVisible()
    await expect(page.locator('#connect')).not.toBeVisible()
  })

  test('displays wallet address in header after connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    await expect(page.getByText(/0xf39F.*2266/i)).toBeVisible()
  })

  test('shows todo form after wallet connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    await expect(page.locator('#todo-form')).toBeVisible({ timeout: 15000 })
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

    await expect(page.getByRole('tab', { name: /All/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /To Do/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Done/i })).toBeVisible()
  })

  test('disconnects wallet successfully', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    await expect(page.locator('#disconnect')).toBeVisible()
    await page.locator('#disconnect').click()

    await expect(page.locator('#connect')).toBeVisible()
    await expect(page.getByText('Connect your wallet')).toBeVisible()
    await expect(page.getByText(/0xf39F/i)).not.toBeVisible()
  })
})

test.describe('Page Header', () => {
  test('shows app title', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('Jeju Tasks')).toBeVisible()
  })

  test('header persists after wallet connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    await expect(page.getByText('Jeju Tasks')).toBeVisible()
  })
})
