/**
 * Bazaar OAuth3 Authentication Tests (Synpress)
 */

import { CORE_PORTS } from '@jejunetwork/config'
import type { Page } from '@playwright/test'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const BAZAAR_URL = `http://localhost:${CORE_PORTS.BAZAAR.get()}`

async function openWalletLogin(page: Page): Promise<void> {
  await page.getByRole('button', { name: /sign in/i }).first().click()
  const walletOption = page.getByRole('button', { name: /connect wallet/i })
  if (await walletOption.isVisible().catch(() => false)) {
    await walletOption.click()
  }
}

test.describe('Bazaar OAuth3 Login', () => {
  test('shows sign in button', async ({ page }) => {
    await page.goto(BAZAAR_URL)
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

    await page.goto(BAZAAR_URL)
    await page.waitForLoadState('networkidle')
    await openWalletLogin(page)

    await metamask.connectToDapp()

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({
      timeout: 15000,
    })
  })
})
