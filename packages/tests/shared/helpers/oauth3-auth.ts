/**
 * OAuth3 Authentication Helpers for E2E Tests
 *
 * Provides wallet-based authentication via OAuth3 (Jeju's decentralized auth).
 * Uses MetaMask for wallet signing, which triggers OAuth3 session creation.
 *
 * @module @jejunetwork/tests/helpers/oauth3-auth
 *
 * @example
 * ```typescript
 * import { test } from '@jejunetwork/tests';
 * import { loginWithWallet, isAuthenticated, logout } from '@jejunetwork/tests';
 *
 * test('should login with wallet', async ({ page, metamask }) => {
 *   await page.goto('/');
 *   await loginWithWallet(page, metamask);
 *   expect(await isAuthenticated(page)).toBe(true);
 * });
 * ```
 */

import type { Page } from '@playwright/test'
import type { MetaMask } from '@synthetixio/synpress/playwright'
import { TEST_WALLET_ADDRESS } from '../utils'

/**
 * UI Selectors for authentication elements
 * These can be overridden via options if your app uses different selectors
 */
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
  /** Expected wallet address after login */
  walletAddress?: string
  /** Custom selector for the connect button */
  connectButtonSelector?: string
  /** Custom selector for wallet option in modal */
  walletOptionSelector?: string
  /** Timeout for waiting for elements (ms) */
  timeout?: number
  /** Whether to wait for network idle after login */
  waitForNetworkIdle?: boolean
}

/**
 * Login with wallet via OAuth3
 *
 * This function handles the full authentication flow:
 * 1. Clicks the connect/login button
 * 2. Selects wallet option if a modal appears
 * 3. Connects MetaMask to the dApp (if MetaMask instance provided)
 * 4. Waits for authentication to complete
 *
 * @param page - Playwright page instance
 * @param metaMask - Optional MetaMask instance for handling wallet connection
 * @param options - Login configuration options
 */
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

  console.log(
    `[OAuth3Auth] Initiating wallet login for ${walletAddress.slice(0, 10)}...`,
  )

  // Wait for page to be ready
  if (waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {
      console.log('[OAuth3Auth] Page not fully idle, continuing...')
    })
  }

  // Look for connect wallet button
  const connectButton = page.locator(connectButtonSelector).first()
  const isConnectVisible = await connectButton
    .isVisible({ timeout: 5000 })
    .catch(() => false)

  if (isConnectVisible) {
    console.log('[OAuth3Auth] Found connect button, clicking...')
    await connectButton.click()

    // Wait for OAuth3 wallet connection modal
    await page.waitForTimeout(1000)

    // Look for wallet option in modal
    const walletOption = page.locator(walletOptionSelector).first()
    const isWalletOptionVisible = await walletOption
      .isVisible({ timeout: 3000 })
      .catch(() => false)

    if (isWalletOptionVisible) {
      console.log('[OAuth3Auth] Found wallet option, clicking...')
      await walletOption.click()

      // If MetaMask is provided, handle the connection and signature
      if (metaMask) {
        console.log('[OAuth3Auth] Handling MetaMask connection...')
        await metaMask.connectToDapp()
        console.log('[OAuth3Auth] MetaMask connected to dapp')
      }
    } else if (metaMask) {
      // Modal might skip directly to MetaMask popup
      console.log('[OAuth3Auth] No wallet selector, connecting directly...')
      await metaMask.connectToDapp()
    }
  } else {
    console.log(
      '[OAuth3Auth] No connect button visible, may already be logged in',
    )
  }

  // Wait for auth to complete
  await page.waitForTimeout(2000)

  // Verify login by checking for user indicators
  const isLoggedIn = await isAuthenticated(page, { walletAddress, timeout })

  if (isLoggedIn) {
    console.log('[OAuth3Auth] Login successful, user indicator visible')
  } else {
    console.log('[OAuth3Auth] Login flow completed, user indicator not visible')
  }
}

interface AuthCheckOptions {
  /** Expected wallet address prefix to look for */
  walletAddress?: string
  /** Timeout for checking auth state (ms) */
  timeout?: number
}

/**
 * Check if user is currently authenticated
 *
 * Looks for common indicators of authentication:
 * - User menu element
 * - Truncated wallet address display
 * - Account/profile buttons
 *
 * @param page - Playwright page instance
 * @param options - Auth check options
 * @returns true if user appears to be authenticated
 */
export async function isAuthenticated(
  page: Page,
  options: AuthCheckOptions = {},
): Promise<boolean> {
  const { walletAddress = TEST_WALLET_ADDRESS, timeout = 5000 } = options

  const addressPrefix = walletAddress.slice(0, 6)

  const userIndicator = page
    .locator(AUTH_SELECTORS.userMenu)
    .or(page.locator(`text=${addressPrefix}`))
    .or(page.locator(AUTH_SELECTORS.accountButton))
    .first()

  return userIndicator.isVisible({ timeout }).catch(() => false)
}

/**
 * Wait for authentication to complete after wallet connection
 *
 * Polls for auth state until timeout or success.
 *
 * @param page - Playwright page instance
 * @param options - Wait options
 * @returns true if authentication completed, false if timed out
 */
export async function waitForAuth(
  page: Page,
  options: AuthCheckOptions & { pollInterval?: number } = {},
): Promise<boolean> {
  const { timeout = 10000, pollInterval = 500, ...authOptions } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await isAuthenticated(page, { ...authOptions, timeout: pollInterval })) {
      return true
    }
    await page.waitForTimeout(pollInterval)
  }

  return false
}

interface LogoutOptions {
  /** Custom selector for user menu */
  userMenuSelector?: string
  /** Custom selector for logout button */
  logoutButtonSelector?: string
  /** Timeout for waiting for elements (ms) */
  timeout?: number
}

/**
 * Logout from the current session
 *
 * Clicks the user menu and then the logout button.
 *
 * @param page - Playwright page instance
 * @param options - Logout configuration options
 */
export async function logout(
  page: Page,
  options: LogoutOptions = {},
): Promise<void> {
  const {
    userMenuSelector = AUTH_SELECTORS.userMenu,
    logoutButtonSelector = AUTH_SELECTORS.logoutButton,
    timeout = 5000,
  } = options

  console.log('[OAuth3Auth] Initiating logout...')

  // Look for user menu
  const userMenu = page
    .locator(userMenuSelector)
    .or(page.locator(AUTH_SELECTORS.accountButton))
    .first()

  // Use a portion of the timeout for menu visibility check
  const menuTimeout = Math.floor(timeout * 0.6)
  const isUserMenuVisible = await userMenu
    .isVisible({ timeout: menuTimeout })
    .catch(() => false)

  if (isUserMenuVisible) {
    await userMenu.click()
    await page.waitForTimeout(500)

    const logoutButton = page.locator(logoutButtonSelector).first()
    // Use remaining timeout for logout button visibility
    const buttonTimeout = Math.floor(timeout * 0.4)
    const isLogoutVisible = await logoutButton
      .isVisible({ timeout: buttonTimeout })
      .catch(() => false)

    if (isLogoutVisible) {
      await logoutButton.click()
      console.log('[OAuth3Auth] Logout button clicked')
    } else {
      console.log('[OAuth3Auth] Logout button not found in menu')
    }
  } else {
    console.log('[OAuth3Auth] User menu not visible, may already be logged out')
  }

  await page.waitForTimeout(1000)
  console.log('[OAuth3Auth] Logout completed')
}

/**
 * Ensure user is logged out before test
 *
 * Useful in beforeEach hooks to ensure clean state.
 *
 * @param page - Playwright page instance
 */
export async function ensureLoggedOut(page: Page): Promise<void> {
  if (await isAuthenticated(page, { timeout: 2000 })) {
    await logout(page)
  }
}

/**
 * Ensure user is logged in before test
 *
 * If not already authenticated, performs login flow.
 *
 * @param page - Playwright page instance
 * @param metaMask - MetaMask instance for wallet connection
 * @param options - Login options
 */
export async function ensureLoggedIn(
  page: Page,
  metaMask?: MetaMask,
  options: LoginOptions = {},
): Promise<void> {
  if (!(await isAuthenticated(page, { timeout: 2000 }))) {
    await loginWithWallet(page, metaMask, options)
  }
}

/**
 * Get the displayed wallet address from the page
 *
 * Searches for wallet address patterns in common locations.
 *
 * @param page - Playwright page instance
 * @returns The wallet address if found, null otherwise
 */
export async function getDisplayedWalletAddress(
  page: Page,
): Promise<string | null> {
  // Look for full or truncated wallet address
  const addressPattern = /0x[a-fA-F0-9]{4,}/

  const addressSelectors = [
    '[data-testid="wallet-address"]',
    'button:has-text(/0x[a-fA-F0-9]{4,}/)',
    'span:has-text(/0x[a-fA-F0-9]{4,}/)',
    'div:has-text(/0x[a-fA-F0-9]{4,}/)',
    AUTH_SELECTORS.userMenu,
  ]

  for (const selector of addressSelectors) {
    const element = page.locator(selector).first()
    const isVisible = await element.isVisible({ timeout: 2000 }).catch(() => false)

    if (isVisible) {
      const text = await element.textContent({ timeout: 2000 }).catch(() => null)
      if (text) {
        const match = text.match(addressPattern)
        if (match) {
          return match[0]
        }
      }
    }
  }

  return null
}
