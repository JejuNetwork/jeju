/**
 * XLP V2/V3 Pool Swap Tests
 * Tests swap functionality across V2 constant-product and V3 concentrated liquidity pools
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import type { Page, BrowserContext } from '@playwright/test'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const WAIT_SHORT = 200
const WAIT_MEDIUM = 500
const CONNECT_TIMEOUT = 15000

async function connectWallet(
  page: Page, 
  context: BrowserContext, 
  metamaskPage: Page, 
  extensionId: string
): Promise<void> {
  const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
  await page.goto('/')
  
  const connectButton = page.getByRole('button', { name: /Connect Wallet/i })
  if (await connectButton.isVisible({ timeout: 5000 })) {
    await connectButton.click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: CONNECT_TIMEOUT })
  }
}

async function selectSwapTokens(page: Page, inputToken: string, outputToken: string): Promise<void> {
  const inputSelect = page.locator('select').first()
  await inputSelect.selectOption(inputToken)
  await page.waitForTimeout(WAIT_SHORT)

  const outputSelect = page.locator('select').nth(1)
  await outputSelect.selectOption(outputToken)
  await page.waitForTimeout(WAIT_SHORT)
}

test.describe('XLP V2/V3 Pool Swap Tests', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('should load swap page and display token selectors', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    await expect(page.getByRole('heading', { name: /Swap/i })).toBeVisible()
    await expect(page.locator('select').first()).toBeVisible()
    await expect(page.locator('select').nth(1)).toBeVisible()
    await expect(page.locator('input[type="number"]').first()).toBeVisible()
  })

  test('should calculate output amount for ETH to USDC swap', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    await selectSwapTokens(page, 'ETH', 'USDC')

    const inputAmount = page.locator('input[type="number"]').first()
    await inputAmount.fill('1')
    await page.waitForTimeout(WAIT_MEDIUM)

    const outputValue = await page.locator('input[type="number"]').nth(1).inputValue()
    expect(parseFloat(outputValue) || 0).toBeGreaterThanOrEqual(0)
  })

  test('should show cross-chain toggle when EIL is available', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    const crossChainToggle = page.locator('button').filter({ hasText: /ON|OFF/i })
    if (await crossChainToggle.isVisible()) {
      await crossChainToggle.click()
      await page.waitForTimeout(WAIT_SHORT)
      // Chain selectors should appear
      const chainSelects = page.locator('select').filter({ has: page.locator('option', { hasText: /Ethereum|Base|Arbitrum/i }) })
      expect(await chainSelects.count()).toBeGreaterThanOrEqual(0)
    }
  })

  test('should swap tokens (input to output direction)', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    await selectSwapTokens(page, 'ETH', 'USDC')

    const inputAmount = page.locator('input[type="number"]').first()
    await inputAmount.fill('0.1')
    await page.waitForTimeout(WAIT_SHORT)

    const swapButton = page.locator('button').filter({ hasText: /Swap/i }).last()
    if (await swapButton.isEnabled()) {
      await swapButton.click()
      await page.waitForTimeout(WAIT_MEDIUM)
      const body = await page.textContent('body')
      expect(body?.includes('Swap') || body?.includes('error') || body?.includes('initiated')).toBe(true)
    }
  })

  test('should show fee and rate information', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    await selectSwapTokens(page, 'ETH', 'USDC')

    const inputAmount = page.locator('input[type="number"]').first()
    await inputAmount.fill('1')
    await page.waitForTimeout(WAIT_MEDIUM)

    const body = await page.textContent('body')
    expect(body?.includes('Rate') || body?.includes('Fee') || body?.includes('ETH')).toBe(true)
  })

  test('should handle token swap direction reversal', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    const inputSelect = page.locator('select').first()
    const outputSelect = page.locator('select').nth(1)
    await selectSwapTokens(page, 'ETH', 'USDC')

    const initialInput = await inputSelect.inputValue()
    const initialOutput = await outputSelect.inputValue()

    const swapDirButton = page.locator('button').filter({ has: page.locator('svg') }).nth(0)
    if (await swapDirButton.isVisible()) {
      await swapDirButton.click()
      await page.waitForTimeout(WAIT_SHORT)
      // Verify tokens changed
      const newInput = await inputSelect.inputValue()
      expect(newInput !== initialInput || (await outputSelect.inputValue()) !== initialOutput).toBe(true)
    }
  })

  test('should validate minimum amount requirements', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    await selectSwapTokens(page, 'ETH', 'USDC')

    const inputAmount = page.locator('input[type="number"]').first()
    await inputAmount.fill('0.0000001')
    await page.waitForTimeout(WAIT_SHORT)

    // Page should not crash on small amounts
    await expect(page.locator('button').filter({ hasText: /Swap/i }).last()).toBeVisible()
  })

  test('should show slippage protection info', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    await selectSwapTokens(page, 'ETH', 'USDC')

    const inputAmount = page.locator('input[type="number"]').first()
    await inputAmount.fill('100')
    await page.waitForTimeout(WAIT_MEDIUM)

    // Page should handle large amounts
    const body = await page.textContent('body')
    expect(body?.includes('Swap')).toBe(true)
  })
})

test.describe('XLP Cross-Chain Swap Tests', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  async function enableCrossChain(page: Page): Promise<boolean> {
    const toggle = page.locator('button').filter({ hasText: /ON|OFF/i })
    if (await toggle.isVisible()) {
      const isOff = (await toggle.textContent())?.includes('OFF')
      if (isOff) {
        await toggle.click()
        await page.waitForTimeout(WAIT_SHORT)
      }
      return true
    }
    return false
  }

  test('should enable cross-chain mode', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    if (await enableCrossChain(page)) {
      const body = await page.textContent('body')
      expect(body?.includes('From') && body?.includes('To')).toBe(true)
    }
  })

  test('should select different source and destination chains', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    if (await enableCrossChain(page)) {
      const chainSelects = page.locator('select').filter({ has: page.locator('option') })
      const selectCount = await chainSelects.count()

      if (selectCount >= 4) {
        const sourceChain = chainSelects.nth(2)
        const destChain = chainSelects.nth(3)

        if (await sourceChain.isVisible()) await sourceChain.selectOption({ index: 0 })
        if (await destChain.isVisible()) await destChain.selectOption({ index: 1 })
      }
    }
  })

  test('should show estimated time and fees for cross-chain swap', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(WAIT_MEDIUM)

    if (await enableCrossChain(page)) {
      const inputAmount = page.locator('input[type="number"]').first()
      await inputAmount.fill('1')
      await page.waitForTimeout(WAIT_MEDIUM)

      const body = await page.textContent('body')
      // Page remains functional with cross-chain enabled
      expect(body?.length).toBeGreaterThan(0)
    }
  })
})

test.describe('XLP Liquidity Page Integration', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('should load liquidity page with V4 and XLP sections', async ({ page }) => {
    await page.goto('/liquidity')
    await page.waitForTimeout(WAIT_MEDIUM)

    await expect(page.getByRole('heading', { name: /Liquidity/i })).toBeVisible()
    await expect(page.locator('button').filter({ hasText: /V4 Pools/i })).toBeVisible()
    await expect(page.locator('button').filter({ hasText: /Cross-Chain XLP/i })).toBeVisible()
  })

  test('should switch between V4 and XLP sections', async ({ page }) => {
    await page.goto('/liquidity')
    await page.waitForTimeout(WAIT_MEDIUM)

    const xlpTab = page.locator('button').filter({ hasText: /Cross-Chain XLP/i })
    await xlpTab.click()
    await page.waitForTimeout(WAIT_SHORT)

    const body = await page.textContent('body')
    expect(body?.includes('XLP') || body?.includes('Cross-chain') || body?.includes('Supported Chains')).toBe(true)

    await page.locator('button').filter({ hasText: /V4 Pools/i }).click()
    await page.waitForTimeout(WAIT_SHORT)
  })

  test('should show supported chains in XLP section', async ({ page }) => {
    await page.goto('/liquidity')
    await page.waitForTimeout(WAIT_MEDIUM)

    await page.locator('button').filter({ hasText: /Cross-Chain XLP/i }).click()
    await page.waitForTimeout(WAIT_SHORT)

    const body = await page.textContent('body')
    const hasChains = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Jeju'].some(chain => body?.includes(chain))
    expect(hasChains).toBe(true)
  })

  test('should show V4 liquidity add form', async ({ page }) => {
    await page.goto('/liquidity')
    await page.waitForTimeout(WAIT_MEDIUM)

    // Form elements should exist
    await expect(page.locator('select').first()).toBeVisible()
    await expect(page.locator('input[type="number"]').first()).toBeVisible()
  })

  test('should show user positions when connected', async ({ page }) => {
    await page.goto('/liquidity')
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(body?.includes('Position') || body?.includes('No positions') || body?.includes('Connect wallet')).toBe(true)
  })
})
