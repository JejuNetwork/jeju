import { expect, type Page } from '@playwright/test'

/**
 * Navigation and Page Helpers for Jeju Network dApp Testing
 *
 * @module @jejunetwork/tests/helpers/navigation
 *
 * Provides utilities for:
 * - Page navigation with wait conditions
 * - Server health checking before navigation
 * - Next.js dev overlay handling
 * - Page load state management
 */

// ============================================================================
// Server Health Checking
// ============================================================================

interface WaitForServerOptions {
  /** Base URL to check (defaults to PLAYWRIGHT_BASE_URL or http://localhost:3000) */
  baseUrl?: string
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Delay between retries in milliseconds */
  retryDelay?: number
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * Waits for the server to be responsive before proceeding.
 *
 * Checks the root URL and accepts any response (except network errors or 5xx).
 * This prevents flakiness when the server is slow to start.
 *
 * @param options - Server wait configuration
 * @throws Error if server is not responsive after all retries (optional)
 */
export async function waitForServerHealthy(
  options: WaitForServerOptions = {},
): Promise<boolean> {
  const {
    baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    maxRetries = 10,
    retryDelay = 3000,
    timeout = 10000,
  } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${baseUrl}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeout),
    }).catch(() => null)

    // Accept any non-5xx response as "server is up"
    if (response && response.status < 500) {
      return true
    }

    // Only log errors occasionally to reduce noise
    if (attempt === 1 || attempt === maxRetries) {
      const status = response?.status ?? 'unreachable'
      console.log(
        `[Navigation] Server check attempt ${attempt}/${maxRetries}: ${status}`,
      )
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay))
    }
  }

  console.warn(
    `[Navigation] Server may not be fully responsive after ${maxRetries} attempts`,
  )
  return false
}

// ============================================================================
// Navigation Utilities
// ============================================================================

interface NavigateOptions {
  /** Text or pattern to wait for after navigation */
  waitForText?: string | RegExp
  /** Timeout for navigation and wait conditions (ms) */
  timeout?: number
  /** Wait until condition for goto */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  /** Check server health before navigating */
  checkServerHealth?: boolean
  /** Number of navigation retry attempts */
  maxRetries?: number
}

/**
 * Navigate to a route with configurable wait conditions
 *
 * @param page - Playwright page instance
 * @param route - Route path to navigate to (can be relative or absolute)
 * @param options - Navigation options
 */
export async function navigateToRoute(
  page: Page,
  route: string,
  options: NavigateOptions = {},
): Promise<void> {
  const {
    waitForText,
    timeout = 15000,
    waitUntil = 'domcontentloaded',
    checkServerHealth = false,
    maxRetries = 3,
  } = options

  if (checkServerHealth) {
    await waitForServerHealthy({
      maxRetries: 3,
      retryDelay: 1000,
    })
  }

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(route, { waitUntil, timeout })

      if (waitForText) {
        await expect(page.getByText(waitForText)).toBeVisible({ timeout })
      }

      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries) {
        console.log(
          `[Navigation] Attempt ${attempt} failed: ${lastError.message}. Retrying...`,
        )
        await page.waitForTimeout(1000)
      }
    }
  }

  throw lastError ?? new Error(`Navigation to ${route} failed`)
}

/**
 * Navigate to a route with server health check
 *
 * Convenience function that combines server health check with navigation.
 * Use this when you need to ensure the server is up before navigating.
 */
export async function navigateTo(
  page: Page,
  route: string,
  options: Omit<NavigateOptions, 'checkServerHealth'> = {},
): Promise<void> {
  await navigateToRoute(page, route, { ...options, checkServerHealth: true })
}

// ============================================================================
// Page State Management
// ============================================================================

/**
 * Hide Next.js dev overlay to prevent it from intercepting pointer events.
 *
 * In development mode, Next.js injects a portal that can block UI interactions.
 * This function hides it so tests can interact with the actual UI.
 *
 * @param page - Playwright page instance
 */
export async function hideNextDevOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const overlay = document.querySelector('nextjs-portal')
    if (overlay instanceof HTMLElement) {
      overlay.style.pointerEvents = 'none'
      overlay.style.display = 'none'
    }
    // Also hide any error overlays
    document.querySelectorAll('[data-nextjs-dev-overlay]').forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.pointerEvents = 'none'
      }
    })
  })
}

interface WaitForPageLoadOptions {
  /** Timeout for page load (ms) */
  timeout?: number
  /** Hide Next.js dev overlay after load */
  hideDevOverlay?: boolean
  /** Wait for interactive elements to be present */
  waitForInteractive?: boolean
  /** Selector to wait for to confirm page is interactive */
  interactiveSelector?: string
}

/**
 * Waits for page to be fully loaded and hydrated.
 *
 * @param page - Playwright page instance
 * @param options - Wait options
 */
export async function waitForPageLoad(
  page: Page,
  options: WaitForPageLoadOptions = {},
): Promise<void> {
  const {
    timeout = 20000,
    hideDevOverlay = true,
    waitForInteractive = true,
    interactiveSelector = 'button',
  } = options

  try {
    await page.waitForLoadState('domcontentloaded', { timeout })
  } catch {
    // Timeout is acceptable - page may still be functional
  }

  // Hide Next.js dev overlay to prevent test interference
  if (hideDevOverlay) {
    await hideNextDevOverlay(page)
  }

  // Wait for page to have interactive elements
  if (waitForInteractive) {
    let hasInteractiveElements = false

    for (let i = 0; i < 20; i++) {
      const elementCount = await page
        .locator(interactiveSelector)
        .count()
        .catch(() => 0)

      if (elementCount > 0) {
        hasInteractiveElements = true
        break
      }
      await page.waitForTimeout(500)
    }

    if (!hasInteractiveElements) {
      // Try reloading the page once
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      // Hide overlay again after reload
      if (hideDevOverlay) {
        await hideNextDevOverlay(page)
      }
    }
  }
}

/**
 * Waits a short period between tests to let the server recover.
 *
 * Helps prevent flakiness from server overload.
 *
 * @param page - Playwright page instance
 * @param delay - Delay in milliseconds (default: 500)
 */
export async function cooldownBetweenTests(
  page: Page,
  delay = 500,
): Promise<void> {
  await page.waitForTimeout(delay)
}

// ============================================================================
// App-Specific Navigation Shortcuts
// ============================================================================

/**
 * Navigate to a market page
 *
 * @param page - Playwright page instance
 * @param marketId - Optional specific market ID, otherwise selects first available
 */
export async function navigateToMarket(
  page: Page,
  marketId?: string,
): Promise<void> {
  if (marketId) {
    await page.goto(`/market/${marketId}`)
  } else {
    await page.goto('/')
    await page.waitForSelector('[data-testid="market-card"]', {
      timeout: 15000,
    })
    await page.locator('[data-testid="market-card"]').first().click()
  }
  await expect(page.locator('text=/Place Bet|Buy|Trade/i')).toBeVisible()
}

/**
 * Navigate to portfolio/positions page
 */
export async function navigateToPortfolio(page: Page): Promise<void> {
  await navigateToRoute(page, '/portfolio', {
    waitForText: /Portfolio|Your Positions/i,
  })
}

/**
 * Navigate to swap page
 */
export async function navigateToSwap(page: Page): Promise<void> {
  await navigateToRoute(page, '/swap', { waitForText: /Swap/i })
}

/**
 * Navigate to liquidity page
 */
export async function navigateToLiquidity(page: Page): Promise<void> {
  await navigateToRoute(page, '/liquidity', {
    waitForText: /Liquidity|Add Liquidity/i,
  })
}

// ============================================================================
// URL and Routing Utilities
// ============================================================================

/**
 * Get the current route path (without base URL)
 */
export function getCurrentRoute(page: Page): string {
  const url = new URL(page.url())
  return url.pathname + url.search + url.hash
}

/**
 * Check if page is at a specific route
 */
export function isAtRoute(page: Page, route: string): boolean {
  const currentRoute = getCurrentRoute(page)
  const normalizedExpected = route.replace(/\/$/, '')
  const normalizedCurrent = currentRoute.replace(/\/$/, '')
  return normalizedCurrent === normalizedExpected
}

/**
 * Wait for navigation to a specific route
 */
export async function waitForRoute(
  page: Page,
  route: string,
  options: { timeout?: number } = {},
): Promise<void> {
  const { timeout = 10000 } = options
  const normalizedRoute = route.replace(/\/$/, '')

  await page.waitForURL((url) => {
    const pathname = new URL(url).pathname.replace(/\/$/, '')
    return pathname === normalizedRoute || pathname.startsWith(normalizedRoute)
  }, { timeout })
}
