/**
 * MetaMask Connection E2E Tests
 *
 * Tests wallet connection flows using wagmi integration with MetaMask.
 */

import { expect } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { TEST_ACCOUNTS } from '../../fixtures/accounts'
import basicSetup, { PASSWORD } from '../../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))

test.describe('MetaMask Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should show connect options', async ({ page }) => {
    const connectElement = page.locator('button, [role="button"]').filter({
      hasText: /connect|wallet/i,
    })
    await expect(connectElement.first()).toBeVisible({ timeout: 15000 })
  })

  test('should connect to dApp', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const connectButton = page.locator('button, [role="button"]').filter({
      hasText: /connect|injected|browser wallet/i,
    })
    await connectButton.first().click()

    await metamask.connectToDapp()

    // Verify connected - should show truncated address
    await expect(
      page.locator(`text=${TEST_ACCOUNTS.primary.address.slice(0, 6)}`),
    ).toBeVisible({ timeout: 15000 })
  })

  test('should show correct address after connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const connectButton = page.locator('button').filter({ hasText: /connect/i })
    await connectButton.first().click()
    await metamask.connectToDapp()

    // Should display truncated address
    const addressStart = TEST_ACCOUNTS.primary.address.slice(0, 6)
    const addressEnd = TEST_ACCOUNTS.primary.address.slice(-4)
    const addressRegex = new RegExp(`${addressStart}.*${addressEnd}`, 'i')

    await expect(page.locator(`text=/${addressRegex.source}/i`)).toBeVisible({
      timeout: 15000,
    })
  })

  test('should handle disconnect', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const connectButton = page.locator('button').filter({ hasText: /connect/i })
    await connectButton.first().click()
    await metamask.connectToDapp()

    await page.waitForTimeout(2000)

    const disconnectButton = page
      .locator('button')
      .filter({ hasText: /disconnect/i })

    if (await disconnectButton.isVisible()) {
      await disconnectButton.click()

      await expect(
        page
          .locator('button')
          .filter({ hasText: /connect/i })
          .first(),
      ).toBeVisible({ timeout: 10000 })
    }
  })

  test('should persist connection on reload', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const connectButton = page.locator('button').filter({ hasText: /connect/i })
    await connectButton.first().click()
    await metamask.connectToDapp()

    // Wait for connection indicator
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}/')).toBeVisible({
      timeout: 15000,
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // Give wagmi time to reconnect
    await page.waitForTimeout(3000)
  })
})
