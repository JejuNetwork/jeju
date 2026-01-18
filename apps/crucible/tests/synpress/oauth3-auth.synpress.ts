/**
 * Crucible OAuth3 Authentication Tests (Synpress)
 */

import { basicSetup } from '@jejunetwork/tests'
import type { Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

async function openWalletLogin(page: Page): Promise<void> {
  await page.getByRole('button', { name: /sign in/i }).first().click()
  const walletOption = page.getByRole('button', { name: /connect wallet/i })
  if (await walletOption.isVisible().catch(() => false)) {
    await walletOption.click()
  }
}

test.describe('Crucible OAuth3 Login', () => {
  test('shows sign in button', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByRole('button', { name: /sign in/i }).first(),
    ).toBeVisible()
  })

  test('connects wallet via OAuth3 modal', async ({
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
    await page.waitForLoadState('networkidle')
    await openWalletLogin(page)

    await metamask.connectToDapp()

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({
      timeout: 15000,
    })
  })
})
