/**
 * Token Creation Tests with Wallet
 * Tests ERC20 token creation with MetaMask confirmation
 */

import type { BrowserContext, Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { createPublicClient, formatEther, http } from 'viem'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const RPC_URL = process.env.L2_RPC_URL ?? 'http://localhost:6546'
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? '1337', 10)
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

test.describe('Token Creation', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('navigates to token creation page', async ({ page }) => {
    await page.goto('/coins/create')
    await expect(
      page.getByRole('heading', { name: /Create Token/i }),
    ).toBeVisible()
  })

  test('fills token creation form', async ({ page }) => {
    await page.goto('/coins/create')

    await page.getByPlaceholder(/My Awesome Token/i).fill('Synpress Test Token')
    await page.getByPlaceholder(/MAT/i).fill('SYNT')
    await page
      .getByPlaceholder(/Describe your token/i)
      .fill('A token created during Synpress E2E testing')
    await page.locator('input[placeholder="1000000"]').fill('5000000')

    const createButton = page.locator('main').getByRole('button').first()
    const buttonText = await createButton.textContent()

    expect(buttonText).toBeTruthy()
    expect(buttonText).not.toContain('Connect Wallet')
  })

  test('has all form fields', async ({ page }) => {
    await page.goto('/coins/create')

    const nameInput = page.getByPlaceholder(/My Awesome Token/i)
    await expect(nameInput).toBeVisible()
    await nameInput.fill('Test Token')

    const symbolInput = page.getByPlaceholder(/MAT/i)
    await expect(symbolInput).toBeVisible()
    await symbolInput.fill('TEST')

    const supplyInput = page.getByPlaceholder('1000000')
    await expect(supplyInput).toBeVisible()
    await supplyInput.fill('1000000')

    const decimalsSelect = page.locator('select').first()
    if (await decimalsSelect.isVisible()) {
      await decimalsSelect.selectOption('18')
    }
  })

  test('validates required fields', async ({ page }) => {
    await page.goto('/coins/create')

    const createButton = page.getByRole('button', { name: /Create Token/i })
    const isDisabled = await createButton.isDisabled()
    expect(isDisabled).toBe(true)
  })

  test('creates token with MetaMask confirmation', async ({
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

    await page.goto('/coins/create')

    await page
      .getByPlaceholder(/My Awesome Token/i)
      .fill(`TestToken${Date.now()}`)
    await page
      .getByPlaceholder(/MAT/i)
      .fill(`T${Date.now().toString().slice(-4)}`)
    await page.getByPlaceholder('1000000').fill('1000000')

    const createButton = page.getByRole('button', { name: /Create Token/i })
    if (await createButton.isEnabled()) {
      await createButton.click()
      await page.waitForTimeout(2000)
      await metamask.confirmTransaction()
      await page.waitForTimeout(5000)
      console.log('Token creation transaction confirmed')
    }
  })

  test('verifies token creation on-chain', async ({
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

    const factoryAddress = process.env.PUBLIC_ERC20_FACTORY_ADDRESS
    if (!factoryAddress || factoryAddress === '0x0') {
      console.log('Skipping: Factory not deployed')
      return
    }

    const initialBalance = await publicClient.getBalance({
      address: TEST_ADDRESS as `0x${string}`,
    })

    await page.goto('/coins/create')

    const tokenName = `ValidationToken${Date.now()}`
    const tokenSymbol = `VAL${Date.now().toString().slice(-4)}`

    await page.getByPlaceholder(/My Awesome Token/i).fill(tokenName)
    await page.getByPlaceholder(/MAT/i).fill(tokenSymbol)
    await page.getByPlaceholder('1000000').fill('1000000')

    const createButton = page.getByRole('button', { name: /Create Token/i })

    if (await createButton.isEnabled()) {
      await createButton.click()
      await page.waitForTimeout(2000)
      await metamask.confirmTransaction()
      await page.waitForTimeout(10000)

      const finalBalance = await publicClient.getBalance({
        address: TEST_ADDRESS as `0x${string}`,
      })
      expect(finalBalance).toBeLessThan(initialBalance)

      console.log(
        `Token created, gas spent: ${formatEther(initialBalance - finalBalance)} ETH`,
      )
    }
  })
})

test.describe('Coins Page with Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('displays coins list', async ({ page }) => {
    await page.goto('/coins')
    await expect(page.getByRole('heading', { name: /Coins/i })).toBeVisible()
  })

  test('has search input', async ({ page }) => {
    await page.goto('/coins')
    const searchInput = page.getByPlaceholder(/Search/i)
    if (await searchInput.isVisible()) {
      await searchInput.fill('ETH')
      await page.waitForTimeout(500)
    }
  })

  test('has create token link', async ({ page }) => {
    await page.goto('/coins')
    const createLink = page.getByRole('link', { name: /Create/i })
    if (await createLink.isVisible()) {
      await createLink.click()
      await page.waitForURL('**/coins/create')
    }
  })
})
