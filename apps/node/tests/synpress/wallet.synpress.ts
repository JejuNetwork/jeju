/**
 * Wallet Integration Tests
 * Tests wallet connection and on-chain interactions with MetaMask
 */

import basicSetup from '@jejunetwork/tests/wallet-setup'
import type { BrowserContext, Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const BASE_URL = 'http://localhost:1420'

interface WalletTestContext {
  context: BrowserContext
  page: Page
  metamaskPage: Page
  extensionId: string
}

function createMetaMask(ctx: WalletTestContext): MetaMask {
  return new MetaMask(
    ctx.context,
    ctx.metamaskPage,
    basicSetup.walletPassword,
    ctx.extensionId,
  )
}

async function connectWallet(page: Page, metamask: MetaMask): Promise<void> {
  await page.goto(BASE_URL)
  await page.waitForSelector('text=Dashboard')
  await page.click('text=Wallet')
  await page.waitForSelector('text=Connect External Wallet')
  await page.click('text=Connect External Wallet')
  await metamask.connectToDapp()
}

test.describe('Wallet Connection', () => {
  test('connects wallet to app', async (ctx: WalletTestContext) => {
    const metamask = createMetaMask(ctx)
    await connectWallet(ctx.page, metamask)
    await expect(ctx.page.locator('text=0xf39F')).toBeVisible()
  })
})

test.describe('Service Operations', () => {
  test('starts a service after connecting wallet', async (ctx: WalletTestContext) => {
    const metamask = createMetaMask(ctx)
    await connectWallet(ctx.page, metamask)

    await ctx.page.click('text=Services')
    await ctx.page.waitForSelector('text=Cron Executor')

    const cronCard = ctx.page.locator('text=Cron Executor').locator('..')
    await cronCard.locator('button:has-text("Start")').click()

    await expect(cronCard.locator('.status-healthy')).toBeVisible()
  })
})

test.describe('Staking Operations', () => {
  test('approves and stakes for a service', async (ctx: WalletTestContext) => {
    const metamask = createMetaMask(ctx)
    await connectWallet(ctx.page, metamask)

    await ctx.page.click('text=Staking')
    await ctx.page.waitForSelector('text=Stakes by Service')

    const proxyRow = ctx.page.locator('text=Proxy Node').locator('..')
    await proxyRow.locator('button:has-text("Stake")').click()

    await ctx.page.fill('input[type="number"]', '0.1')
    await ctx.page.click('button:has-text("Stake")')

    await metamask.confirmTransaction()

    await expect(ctx.page.locator('text=0.1 ETH')).toBeVisible()
  })

  test('claims rewards', async (ctx: WalletTestContext) => {
    const metamask = createMetaMask(ctx)
    await connectWallet(ctx.page, metamask)

    await ctx.page.click('text=Staking')
    await ctx.page.waitForSelector('text=Pending Rewards')

    const claimAllButton = ctx.page.locator('button:has-text("Claim All")')
    if (await claimAllButton.isVisible()) {
      await claimAllButton.click()
      await metamask.confirmTransaction()
      await expect(ctx.page.locator('text=claimed')).toBeVisible()
    }
  })
})

test.describe('Bot Operations', () => {
  test('starts a trading bot with acknowledgement', async (ctx: WalletTestContext) => {
    const metamask = createMetaMask(ctx)
    await connectWallet(ctx.page, metamask)

    await ctx.page.click('text=Trading Bots')
    await ctx.page.waitForSelector('text=DEX Arbitrage Bot')

    const dexArbCard = ctx.page.locator('text=DEX Arbitrage Bot').locator('..')
    await dexArbCard.locator('button:has-text("Start")').click()

    await ctx.page.fill('input[type="number"]', '0.1')
    await ctx.page.click('button:has-text("Start Bot")')

    await expect(dexArbCard.locator('.status-healthy')).toBeVisible()
  })
})
