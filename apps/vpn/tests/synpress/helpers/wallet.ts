import type { BrowserContext, Page } from '@playwright/test'
import { MetaMask } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../../synpress.config'

export function createMetaMask(
  context: BrowserContext,
  metamaskPage: Page,
  extensionId: string,
): MetaMask {
  return new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId,
  )
}

export async function isWalletConnected(page: Page): Promise<boolean> {
  const connectedIndicator = page.locator('[data-testid="wallet-connected"]')
  const addressButton = page.locator('button:has-text(/0x/)')

  const hasIndicator = await connectedIndicator.isVisible().catch(() => false)
  const hasAddress = await addressButton.isVisible().catch(() => false)

  return hasIndicator || hasAddress
}

export async function waitForPageLoad(
  page: Page,
  timeout = 10000,
): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout })
  await page.waitForSelector('h1', { timeout })
}

export async function navigateToTab(
  page: Page,
  tabIndex: 0 | 1 | 2,
): Promise<void> {
  const tabButton = page.locator('nav button').nth(tabIndex)
  await tabButton.click()
  await page.waitForTimeout(300)
}

export async function getCurrentTab(page: Page): Promise<string> {
  if (
    await page
      .getByText('Tap to Connect')
      .isVisible()
      .catch(() => false)
  ) {
    return 'vpn'
  }
  if (
    await page
      .getByText('Fair Contribution')
      .isVisible()
      .catch(() => false)
  ) {
    return 'contribution'
  }
  if (
    await page
      .getByRole('heading', { name: 'Settings' })
      .isVisible()
      .catch(() => false)
  ) {
    return 'settings'
  }
  return 'unknown'
}

export async function takeScreenshot(
  page: Page,
  name: string,
  fullPage = true,
): Promise<void> {
  await page.screenshot({
    path: `test-results/screenshots/vpn-${name}.png`,
    fullPage,
  })
}
