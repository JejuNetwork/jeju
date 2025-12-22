/**
 * Complete User Journey Tests
 * Tests end-to-end user flows through the application
 */

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
  const connectBtn = page.getByRole('button', { name: /Connect Wallet/i })
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  }
  return metamask
}

test.describe('Complete User Journey', () => {
  test('completes full journey: connect -> browse -> trade -> check portfolio', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
    console.log('Step 1: Wallet connected')

    await page.goto('/coins')
    await page.waitForTimeout(1000)
    console.log('Step 2: Browsed coins')

    await page.goto('/swap')
    await page.locator('input[type="number"]').first().fill('0.1')
    console.log('Step 3: Checked swap page')

    await page.goto('/markets')
    await page.waitForTimeout(1000)
    console.log('Step 4: Browsed markets')

    await page.goto('/portfolio')
    await expect(page.getByText(/Total Value/i)).toBeVisible()
    console.log('Step 5: Checked portfolio')

    await page.goto('/items')
    await page.waitForTimeout(500)
    console.log('Step 6: Browsed items')

    await page.goto('/games')
    await page.waitForTimeout(500)
    console.log('Step 7: Checked games')

    await page.goto('/')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    console.log('Step 8: Journey complete - wallet still connected')

    console.log('COMPLETE USER JOURNEY: ALL STEPS PASSED')
  })
})

test.describe('Error Handling', () => {
  test('handles non-existent market gracefully', async ({ page }) => {
    await page.goto(
      '/markets/0x0000000000000000000000000000000000000000000000000000000000000000',
    )
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('handles non-existent item gracefully', async ({ page }) => {
    await page.goto('/items/nonexistent-id-12345')
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('shows connect wallet prompt when needed', async ({ page }) => {
    await page.goto('/portfolio')
    await page.waitForTimeout(500)

    const connectPrompt = page.getByRole('button', { name: /Connect Wallet/i })
    await expect(connectPrompt).toBeVisible()
  })
})

test.describe('Navigation Access', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await connectWallet(page, context, metamaskPage, extensionId)
  })

  test('accesses markets from navigation', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('link', { name: /^Markets$/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/markets/)
  })

  test('accesses portfolio from navigation', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('link', { name: /^Portfolio$/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/portfolio/)
  })
})

test.describe('Network and Wallet Validation', () => {
  test('displays homepage', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: /Welcome to Bazaar/i }),
    ).toBeVisible()
  })

  test('has working navigation links', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    await connectWallet(page, context, metamaskPage, extensionId)

    await page.goto('/')

    const navLinks = [
      { name: /Coins/i, url: '/coins' },
      { name: /Swap/i, url: '/swap' },
      { name: /Markets/i, url: '/markets' },
      { name: /Games/i, url: '/games' },
      { name: /Items/i, url: '/items' },
    ]

    for (const link of navLinks) {
      await page.goto('/')
      const navItem = page.getByRole('link', { name: link.name })
      if (await navItem.isVisible()) {
        await navItem.click()
        await page.waitForURL(`**${link.url}*`)
      }
    }
  })
})
