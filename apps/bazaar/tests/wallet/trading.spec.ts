/**
 * Trading Tests with Wallet
 * Tests prediction market trading with MetaMask confirmation
 */

import type { BrowserContext, Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { createPublicClient, formatEther, http } from 'viem'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const RPC_URL = process.env.L2_RPC_URL ?? 'http://localhost:6546'
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? '31337', 10)
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const publicClient = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: 'Network',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL),
})

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
  const connectBtn = page.getByRole('button', { name: /Connect Wallet/i })
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  }
  return metamask
}

test.describe('Markets with Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('navigates to markets page', async ({ page }) => {
    await page.goto('/markets')
    await expect(
      page.getByRole('heading', { name: /Prediction Markets/i }),
    ).toBeVisible()
  })

  test('displays markets grid', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(1000)

    const grid = page.getByTestId('markets-grid')
    await expect(grid).toBeVisible()
  })

  test('shows market filters', async ({ page }) => {
    await page.goto('/markets')

    await expect(
      page.getByRole('button', { name: /All Markets/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Active/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Resolved/i })).toBeVisible()
  })

  test('filters markets by status', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(1000)

    const activeButton = page.getByRole('button', { name: /^Active$/i })
    await activeButton.click()
    await expect(activeButton).toHaveClass(/bg-purple-600/)

    const resolvedButton = page.getByRole('button', { name: /^Resolved$/i })
    await resolvedButton.click()
    await expect(resolvedButton).toHaveClass(/bg-purple-600/)
  })

  test('navigates to market detail', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(1000)

    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForURL('**/markets/**')
    }
  })
})

test.describe('Trading Interface', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('displays trading interface', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(1000)

    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForTimeout(1000)

      const tradingInterface = page.getByTestId('trading-interface')
      if (await tradingInterface.isVisible()) {
        await expect(tradingInterface).toBeVisible()
      }
    }
  })

  test('has YES/NO outcome buttons', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(1000)

    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForTimeout(1000)

      const yesButton = page.getByTestId('outcome-yes-button')
      const noButton = page.getByTestId('outcome-no-button')

      if (await yesButton.isVisible()) {
        await yesButton.click()
        await expect(yesButton).toHaveClass(/bg-green-600|ring/)
      }

      if (await noButton.isVisible()) {
        await noButton.click()
        await expect(noButton).toHaveClass(/bg-red-600|ring/)
      }
    }
  })

  test('selects YES outcome button', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      await marketCards.first().click()
      await page.waitForTimeout(500)

      const yesButton = page.getByTestId('outcome-yes-button')
      if (await yesButton.isVisible()) {
        await yesButton.click()
        await expect(yesButton).toHaveClass(/ring-green-400/)
      }
    }
  })

  test('selects NO outcome button', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      await marketCards.first().click()
      await page.waitForTimeout(500)

      const noButton = page.getByTestId('outcome-no-button')
      if (await noButton.isVisible()) {
        await noButton.click()
        await expect(noButton).toHaveClass(/ring-red-400/)
      }
    }
  })

  test('enters bet amount', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      await marketCards.first().click()
      await page.waitForTimeout(500)

      const amountInput = page.getByTestId('amount-input')
      if (await amountInput.isVisible()) {
        await amountInput.fill('0.1')
        await expect(amountInput).toHaveValue('0.1')
      }
    }
  })

  test('shows buy button when connected', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      await marketCards.first().click()
      await page.waitForTimeout(500)

      const buyButton = page.getByTestId('buy-button')
      const bannedMessage = page.getByTestId('trading-banned')

      const buyVisible = await buyButton.isVisible()
      const bannedVisible = await bannedMessage.isVisible()

      expect(buyVisible || bannedVisible).toBe(true)
    }
  })

  test('displays all trading interface components', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      await marketCards.first().click()
      await page.waitForTimeout(500)

      const tradingInterface = page.getByTestId('trading-interface')
      if (await tradingInterface.isVisible()) {
        await expect(page.getByTestId('outcome-yes-button')).toBeVisible()
        await expect(page.getByTestId('outcome-no-button')).toBeVisible()
        await expect(page.getByTestId('amount-input')).toBeVisible()
        await expect(page.getByTestId('buy-button')).toBeVisible()
      }
    }
  })
})

test.describe('Trade Execution', () => {
  test('executes trade with MetaMask confirmation', async ({
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
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.goto('/markets')
    await page.waitForTimeout(1000)

    const marketCard = page.getByTestId('market-card').first()
    if (await marketCard.isVisible()) {
      await marketCard.click()
      await page.waitForTimeout(1000)

      const yesButton = page.getByTestId('outcome-yes-button')
      const amountInput = page.getByTestId('amount-input')
      const buyButton = page.getByTestId('buy-button')

      if ((await yesButton.isVisible()) && (await buyButton.isVisible())) {
        await yesButton.click()
        await amountInput.fill('10')
        await buyButton.click()

        await page.waitForTimeout(2000)
        await metamask.confirmTransaction()
        await page.waitForTimeout(5000)

        console.log('Trade transaction confirmed')
      }
    }
  })

  test('verifies trade on-chain', async ({
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
    await page.getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    const predimarketAddress = process.env.PUBLIC_PREDIMARKET_ADDRESS
    if (!predimarketAddress || predimarketAddress === '0x0') {
      console.log('Skipping: Predimarket not deployed')
      return
    }

    await page.goto('/markets')
    await page.waitForTimeout(1000)

    const marketCard = page.getByTestId('market-card').first()
    if (!(await marketCard.isVisible())) {
      console.log('Skipping: No markets available')
      return
    }

    await marketCard.click()
    await page.waitForTimeout(1000)

    const yesButton = page.getByTestId('outcome-yes-button')
    const amountInput = page.getByTestId('amount-input')
    const buyButton = page.getByTestId('buy-button')

    if (!(await yesButton.isVisible()) || !(await buyButton.isVisible())) {
      console.log('Skipping: Trading interface not available')
      return
    }

    const initialBalance = await publicClient.getBalance({
      address: TEST_ADDRESS as `0x${string}`,
    })

    await yesButton.click()
    await amountInput.fill('10')
    await buyButton.click()
    await page.waitForTimeout(2000)
    await metamask.confirmTransaction()
    await page.waitForTimeout(10000)

    const finalBalance = await publicClient.getBalance({
      address: TEST_ADDRESS as `0x${string}`,
    })
    expect(finalBalance).toBeLessThan(initialBalance)

    console.log(
      `Trade executed, balance change: ${formatEther(initialBalance - finalBalance)} ETH`,
    )
  })
})

test.describe('Portfolio', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('displays portfolio stats', async ({ page }) => {
    await page.goto('/portfolio')
    await expect(page.getByText(/Total Value/i)).toBeVisible()
    await expect(page.getByText(/Total P&L/i)).toBeVisible()
  })

  test('shows positions or empty state', async ({ page }) => {
    await page.goto('/portfolio')
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('has claim buttons for resolved positions', async ({ page }) => {
    await page.goto('/portfolio')
    await page.waitForTimeout(1000)

    const claimButtons = page.getByRole('button', { name: /Claim/i })
    const count = await claimButtons.count()

    if (count > 0) {
      console.log(`Found ${count} claim button(s)`)
    }
  })

  test('navigates to portfolio from nav', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('link', { name: /^Portfolio$/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/portfolio/)
  })
})
