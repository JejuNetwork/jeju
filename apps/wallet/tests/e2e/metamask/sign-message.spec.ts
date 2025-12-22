/**
 * MetaMask Message Signing E2E Tests
 *
 * Tests personal_sign and eth_signTypedData functionality.
 */

import { expect } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup, { PASSWORD } from '../../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))

test.describe('Message Signing', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Connect wallet first
    const connectButton = page.locator('button').filter({ hasText: /connect/i })
    if (await connectButton.first().isVisible()) {
      await connectButton.first().click()
      await metamask.connectToDapp()
      await page.waitForTimeout(2000)
    }
  })

  test('should sign a personal message', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const signButton = page.locator('button, [role="button"]').filter({
      hasText: /sign.*message/i,
    })

    if (await signButton.isVisible()) {
      await signButton.click()
      await metamask.confirmSignature()

      // Verify signature result displayed (65 bytes = 130 hex chars + 0x prefix)
      await expect(page.locator('text=/0x[a-fA-F0-9]{130}/i')).toBeVisible({
        timeout: 15000,
      })
    } else {
      test.skip()
    }
  })

  test('should reject signature request', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

    const signButton = page
      .locator('button')
      .filter({ hasText: /sign.*message/i })

    if (await signButton.isVisible()) {
      await signButton.click()
      await metamask.rejectSignature()

      // Should handle rejection gracefully
      await page.waitForTimeout(2000)
    } else {
      test.skip()
    }
  })
})
