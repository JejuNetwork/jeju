/** OAuth3 wallet authentication helpers */

import type { Page } from '@playwright/test'
import type { MetaMask } from '@synthetixio/synpress/playwright'
import { TEST_WALLET_ADDRESS } from '../utils'

const AUTH_SELECTORS = {
  connectButton:
    'button:has-text("Log in"), button:has-text("Login"), button:has-text("Connect Wallet"), button:has-text("Connect"), button:has-text("Sign in")',
  walletOption:
    'button:has-text("Wallet"), button:has-text("MetaMask"), button:has-text("Ethereum")',
  userMenu: '[data-testid="user-menu"]',
  accountButton:
    'button:has-text("Account"), button:has-text("Profile"), button:has-text("Settings")',
  logoutButton:
    'button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Disconnect")',
} as const

interface LoginOptions {
  walletAddress?: string
  connectButtonSelector?: string
  walletOptionSelector?: string
  timeout?: number
  waitForNetworkIdle?: boolean
}

export async function loginWithWallet(
  page: Page,
  metaMask?: MetaMask,
  options: LoginOptions = {},
): Promise<void> {
  const {
    walletAddress = TEST_WALLET_ADDRESS,
    connectButtonSelector = AUTH_SELECTORS.connectButton,
    walletOptionSelector = AUTH_SELECTORS.walletOption,
    timeout = 10000,
    waitForNetworkIdle = true,
  } = options

  if (waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {})
  }

  const connectButton = page.locator(connectButtonSelector).first()
  if (await connectButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await connectButton.click()
    await page.waitForTimeout(1000)

    const walletOption = page.locator(walletOptionSelector).first()
    if (await walletOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await walletOption.click()
      if (metaMask) await metaMask.connectToDapp()
    } else if (metaMask) {
      await metaMask.connectToDapp()
    }
  }

  await page.waitForTimeout(2000)

  if (!(await isAuthenticated(page, { walletAddress, timeout }))) {
    throw new Error(`Login failed for ${walletAddress.slice(0, 10)}...`)
  }
}

interface AuthCheckOptions {
  walletAddress?: string
  timeout?: number
}

export async function isAuthenticated(
  page: Page,
  options: AuthCheckOptions = {},
): Promise<boolean> {
  const { walletAddress = TEST_WALLET_ADDRESS, timeout = 5000 } = options
  const addressPrefix = walletAddress.slice(0, 6)

  return page
    .locator(AUTH_SELECTORS.userMenu)
    .or(page.locator(`text=${addressPrefix}`))
    .or(page.locator(AUTH_SELECTORS.accountButton))
    .first()
    .isVisible({ timeout })
    .catch(() => false)
}

export async function waitForAuth(
  page: Page,
  options: AuthCheckOptions & { pollInterval?: number } = {},
): Promise<boolean> {
  const { timeout = 10000, pollInterval = 500, ...authOptions } = options
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    if (await isAuthenticated(page, { ...authOptions, timeout: pollInterval })) {
      return true
    }
    await page.waitForTimeout(pollInterval)
  }
  return false
}

interface LogoutOptions {
  userMenuSelector?: string
  logoutButtonSelector?: string
  timeout?: number
}

export async function logout(page: Page, options: LogoutOptions = {}): Promise<void> {
  const {
    userMenuSelector = AUTH_SELECTORS.userMenu,
    logoutButtonSelector = AUTH_SELECTORS.logoutButton,
    timeout = 5000,
  } = options

  const userMenu = page
    .locator(userMenuSelector)
    .or(page.locator(AUTH_SELECTORS.accountButton))
    .first()

  if (await userMenu.isVisible({ timeout }).catch(() => false)) {
    await userMenu.click()
    await page.waitForTimeout(500)

    const logoutButton = page.locator(logoutButtonSelector).first()
    if (await logoutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await logoutButton.click()
    }
  }
  await page.waitForTimeout(1000)
}

export async function ensureLoggedOut(page: Page): Promise<void> {
  if (await isAuthenticated(page, { timeout: 2000 })) {
    await logout(page)
  }
}

export async function ensureLoggedIn(
  page: Page,
  metaMask?: MetaMask,
  options: LoginOptions = {},
): Promise<void> {
  if (!(await isAuthenticated(page, { timeout: 2000 }))) {
    await loginWithWallet(page, metaMask, options)
  }
}

export async function getDisplayedWalletAddress(page: Page): Promise<string | null> {
  const selectors = [
    '[data-testid="wallet-address"]',
    AUTH_SELECTORS.userMenu,
    'button:has-text(/0x/)',
    'span:has-text(/0x/)',
  ]

  for (const selector of selectors) {
    const element = page.locator(selector).first()
    if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
      const text = await element.textContent().catch(() => null)
      const match = text?.match(/0x[a-fA-F0-9]{4,}/)
      if (match) return match[0]
    }
  }
  return null
}
