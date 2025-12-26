/** Navigation helpers for Playwright tests */

import { expect, type Page } from '@playwright/test'

interface WaitForServerOptions {
  baseUrl?: string
  maxRetries?: number
  retryDelay?: number
  timeout?: number
}

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

    if (response && response.status < 500) return true
    if (attempt < maxRetries)
      await new Promise((r) => setTimeout(r, retryDelay))
  }
  return false
}

interface NavigateOptions {
  waitForText?: string | RegExp
  timeout?: number
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  checkServerHealth?: boolean
  maxRetries?: number
}

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
    await waitForServerHealthy({ maxRetries: 3, retryDelay: 1000 })
  }

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(route, { waitUntil, timeout })
      if (waitForText) {
        await expect(page.getByText(waitForText)).toBeVisible({ timeout })
      }
      return
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < maxRetries) await page.waitForTimeout(1000)
    }
  }
  throw lastError ?? new Error(`Navigation to ${route} failed`)
}

export async function navigateTo(
  page: Page,
  route: string,
  options: Omit<NavigateOptions, 'checkServerHealth'> = {},
): Promise<void> {
  await navigateToRoute(page, route, { ...options, checkServerHealth: true })
}

/** Hide Next.js dev overlay (blocks pointer events in dev mode) */
export async function hideNextDevOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const portal = document.querySelector('nextjs-portal')
    if (portal instanceof HTMLElement) portal.style.display = 'none'
    document.querySelectorAll('[data-nextjs-dev-overlay]').forEach((el) => {
      if (el instanceof HTMLElement) el.style.pointerEvents = 'none'
    })
  })
}

interface WaitForPageLoadOptions {
  timeout?: number
  hideDevOverlay?: boolean
  waitForInteractive?: boolean
  interactiveSelector?: string
}

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

  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
  if (hideDevOverlay) await hideNextDevOverlay(page)

  if (waitForInteractive) {
    const deadline = Date.now() + timeout
    let found = false
    while (Date.now() < deadline && !found) {
      found =
        (await page
          .locator(interactiveSelector)
          .count()
          .catch(() => 0)) > 0
      if (!found) await page.waitForTimeout(500)
    }
    if (!found) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      if (hideDevOverlay) await hideNextDevOverlay(page)
    }
  }
}

export async function cooldownBetweenTests(
  page: Page,
  delay = 500,
): Promise<void> {
  await page.waitForTimeout(delay)
}

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

export async function navigateToPortfolio(page: Page): Promise<void> {
  await navigateToRoute(page, '/portfolio', {
    waitForText: /Portfolio|Your Positions/i,
  })
}

export async function navigateToSwap(page: Page): Promise<void> {
  await navigateToRoute(page, '/swap', { waitForText: /Swap/i })
}

export async function navigateToLiquidity(page: Page): Promise<void> {
  await navigateToRoute(page, '/liquidity', {
    waitForText: /Liquidity|Add Liquidity/i,
  })
}

export function getCurrentRoute(page: Page): string {
  const url = new URL(page.url())
  return url.pathname + url.search + url.hash
}

export function isAtRoute(page: Page, route: string): boolean {
  const current = getCurrentRoute(page).replace(/\/$/, '')
  const expected = route.replace(/\/$/, '')
  return current === expected
}

export async function waitForRoute(
  page: Page,
  route: string,
  options: { timeout?: number } = {},
): Promise<void> {
  const normalized = route.replace(/\/$/, '')
  await page.waitForURL(
    (url) => new URL(url).pathname.replace(/\/$/, '').startsWith(normalized),
    { timeout: options.timeout ?? 10000 },
  )
}
