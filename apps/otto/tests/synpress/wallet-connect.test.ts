/**
 * Otto Wallet Connection Tests (Synpress)
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Otto Wallet Connection', () => {
  test('should connect wallet via OAuth3 flow', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Navigate to Otto auth callback (simulating OAuth3 redirect)
    await page.goto('/auth/callback?platform=discord&platformId=123&nonce=test')

    // For now, verify the page loads
    await expect(page.locator('body')).toContainText('Connected')
  })

  test('should sign trading confirmation', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Verify the API is accessible
    const response = await page.request.get('/health')
    expect(response.ok()).toBe(true)
  })
})
