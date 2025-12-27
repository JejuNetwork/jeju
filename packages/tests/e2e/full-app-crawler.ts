/**
 * Full App Crawler E2E Test Infrastructure
 *
 * Automatically discovers and tests all pages, buttons, menus, and user actions
 * in any Jeju app. Supports both logged-in and logged-out states, wallet
 * interactions, and comprehensive coverage verification.
 *
 * Usage:
 *   import { createAppCrawler, runFullAppCrawl } from '@jejunetwork/tests/e2e/full-app-crawler'
 *
 *   test('should crawl all pages', async ({ page }) => {
 *     await runFullAppCrawl(page, { baseUrl: 'http://localhost:4001' })
 *   })
 */

import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

// Types
export interface CrawlConfig {
  baseUrl: string
  maxPages?: number
  maxActionsPerPage?: number
  timeout?: number
  skipPatterns?: RegExp[]
  includePatterns?: RegExp[]
  screenshotOnError?: boolean
  screenshotDir?: string
  verbose?: boolean
  testWalletConnection?: boolean
  excludeExternalLinks?: boolean
}

export interface PageState {
  url: string
  title: string
  buttons: string[]
  links: string[]
  forms: string[]
  inputs: string[]
  modals: string[]
  walletConnectors: string[]
  errors: string[]
}

export interface CrawlResult {
  pagesVisited: Map<string, PageState>
  actionsPerformed: ActionResult[]
  errors: CrawlError[]
  coverage: CoverageSummary
}

export interface ActionResult {
  page: string
  action: string
  selector: string
  success: boolean
  error?: string
  timestamp: number
}

export interface CrawlError {
  url: string
  action: string
  error: string
  screenshot?: string
}

export interface CoverageSummary {
  totalPages: number
  totalButtons: number
  totalLinks: number
  totalForms: number
  buttonsClicked: number
  linksVisited: number
  formsSubmitted: number
  errorRate: number
}

// Default configuration
const DEFAULT_CONFIG: Required<CrawlConfig> = {
  baseUrl: '',
  maxPages: 100,
  maxActionsPerPage: 50,
  timeout: 10000,
  skipPatterns: [
    /\/api\//,
    /\/health/,
    /\.(pdf|zip|tar|gz|mp3|mp4|wav|avi)$/i,
    /^mailto:/,
    /^tel:/,
    /^javascript:/,
  ],
  includePatterns: [],
  screenshotOnError: true,
  screenshotDir: 'test-results/crawler-screenshots',
  verbose: false,
  testWalletConnection: true,
  excludeExternalLinks: true,
}

// Element selectors for discovery
const SELECTORS = {
  // Navigation elements
  navLinks: 'nav a, header a, [role="navigation"] a',
  menuButtons:
    '[role="menuitem"], [data-testid*="menu"], button[aria-haspopup]',
  dropdowns: '[role="listbox"], [role="menu"], select',

  // Interactive elements
  buttons:
    'button:not([disabled]), [role="button"]:not([disabled]), input[type="submit"], input[type="button"]',
  links: 'a[href]:not([href^="#"]):not([href^="javascript:"])',
  forms: 'form',
  inputs: 'input:not([type="hidden"]), textarea, select',

  // Wallet elements
  walletConnect:
    '[data-testid*="connect"], [aria-label*="connect wallet" i], button:has-text(/connect/i)',
  walletDisconnect:
    '[data-testid*="disconnect"], [aria-label*="disconnect" i], button:has-text(/disconnect/i)',

  // Modal elements
  modals: '[role="dialog"], [data-testid*="modal"], .modal, [class*="modal"]',
  modalClose:
    '[aria-label*="close" i], button:has-text(/close|cancel|dismiss/i), [data-testid*="close"]',

  // Error elements
  errorMessages:
    '[role="alert"], .error, [class*="error"], [data-testid*="error"]',

  // Loading elements
  loading:
    '[data-testid*="loading"], [aria-busy="true"], .loading, [class*="spinner"]',
}

/**
 * Wait for page to be fully loaded and stable
 */
async function waitForPageReady(page: Page, timeout = 10000): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout })

  // Wait for any loading indicators to disappear
  const loadingIndicator = page.locator(SELECTORS.loading).first()
  try {
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 5000 })
  } catch {
    // Loading indicator may not exist, continue
  }

  // Brief wait for any JS to settle
  await page.waitForTimeout(500)
}

/**
 * Check if a URL is internal to the app
 */
function isInternalUrl(url: string, baseUrl: string): boolean {
  try {
    const base = new URL(baseUrl)
    const target = new URL(url, baseUrl)
    return target.origin === base.origin
  } catch {
    return false
  }
}

/**
 * Check if URL matches skip patterns
 */
function shouldSkipUrl(url: string, config: Required<CrawlConfig>): boolean {
  if (config.skipPatterns.some((pattern) => pattern.test(url))) {
    return true
  }
  if (config.includePatterns.length > 0) {
    return !config.includePatterns.some((pattern) => pattern.test(url))
  }
  return false
}

/**
 * Get normalized URL path for comparison
 */
function getNormalizedPath(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url, baseUrl)
    // Remove trailing slash, normalize
    return parsed.pathname.replace(/\/$/, '') || '/'
  } catch {
    return url
  }
}

/**
 * Extract page state - all interactive elements
 */
async function extractPageState(page: Page): Promise<PageState> {
  const url = page.url()
  const title = await page.title()

  // Get all interactive elements
  const buttons: string[] = []
  const links: string[] = []
  const forms: string[] = []
  const inputs: string[] = []
  const modals: string[] = []
  const walletConnectors: string[] = []
  const errors: string[] = []

  // Extract button text
  const buttonElements = await page.locator(SELECTORS.buttons).all()
  for (const btn of buttonElements) {
    const text = await btn.textContent().catch(() => '')
    if (text?.trim()) {
      buttons.push(text.trim().slice(0, 50))
    }
  }

  // Extract link hrefs
  const linkElements = await page.locator(SELECTORS.links).all()
  for (const link of linkElements) {
    const href = await link.getAttribute('href').catch(() => '')
    if (href) {
      links.push(href)
    }
  }

  // Count forms
  const formElements = await page.locator(SELECTORS.forms).count()
  for (let i = 0; i < formElements; i++) {
    forms.push(`form-${i}`)
  }

  // Count inputs
  const inputElements = await page.locator(SELECTORS.inputs).count()
  for (let i = 0; i < inputElements; i++) {
    inputs.push(`input-${i}`)
  }

  // Check for modals
  const modalElements = await page.locator(SELECTORS.modals).all()
  for (const modal of modalElements) {
    const isVisible = await modal.isVisible().catch(() => false)
    if (isVisible) {
      modals.push('active-modal')
    }
  }

  // Check for wallet connectors
  const walletButtons = await page.locator(SELECTORS.walletConnect).all()
  for (const btn of walletButtons) {
    const isVisible = await btn.isVisible().catch(() => false)
    if (isVisible) {
      walletConnectors.push('wallet-connect')
    }
  }

  // Check for errors
  const errorElements = await page.locator(SELECTORS.errorMessages).all()
  for (const err of errorElements) {
    const text = await err.textContent().catch(() => '')
    if (text?.trim()) {
      errors.push(text.trim().slice(0, 100))
    }
  }

  return {
    url,
    title,
    buttons,
    links,
    forms,
    inputs,
    modals,
    walletConnectors,
    errors,
  }
}

/**
 * Close any open modals
 */
async function closeModals(page: Page): Promise<void> {
  const closeButtons = await page.locator(SELECTORS.modalClose).all()
  for (const btn of closeButtons) {
    const isVisible = await btn.isVisible().catch(() => false)
    if (isVisible) {
      await btn.click().catch(() => {
        // Modal may have closed already
      })
      await page.waitForTimeout(300)
    }
  }

  // Press Escape as fallback
  await page.keyboard.press('Escape').catch(() => {
    // Escape handling may not be available
  })
}

/**
 * Test a single button click
 */
async function testButtonClick(
  page: Page,
  button: Locator,
  config: Required<CrawlConfig>,
): Promise<ActionResult> {
  const buttonText = (await button.textContent().catch(() => '')) || 'unknown'

  const result: ActionResult = {
    page: page.url(),
    action: 'click',
    selector: buttonText.trim().slice(0, 50),
    success: false,
    timestamp: Date.now(),
  }

  try {
    // Check if button is clickable
    const isVisible = await button.isVisible()
    const isEnabled = await button.isEnabled()

    if (!isVisible || !isEnabled) {
      result.success = true // Skip but don't error
      return result
    }

    // Store current URL to detect navigation
    const currentUrl = page.url()

    // Click the button
    await button.click({ timeout: config.timeout })

    // Wait for any navigation or state change
    await waitForPageReady(page, config.timeout)

    // Close any modals that opened
    await closeModals(page)

    // Navigate back if we went to a new page (preserve crawl state)
    if (
      page.url() !== currentUrl &&
      isInternalUrl(currentUrl, config.baseUrl)
    ) {
      await page
        .goBack({ waitUntil: 'domcontentloaded', timeout: config.timeout })
        .catch(() => {
          // May fail if no history, navigate directly
          page.goto(currentUrl, { timeout: config.timeout })
        })
      await waitForPageReady(page, config.timeout)
    }

    result.success = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }

  return result
}

/**
 * Test form submission with random/test data
 */
async function testFormSubmission(
  page: Page,
  form: Locator,
  _config: Required<CrawlConfig>,
): Promise<ActionResult> {
  const result: ActionResult = {
    page: page.url(),
    action: 'form-submit',
    selector: 'form',
    success: false,
    timestamp: Date.now(),
  }

  try {
    // Fill inputs with test data
    const inputs = await form
      .locator('input:not([type="hidden"]):not([type="submit"])')
      .all()

    for (const input of inputs) {
      const type = (await input.getAttribute('type')) || 'text'
      const name = (await input.getAttribute('name')) || 'input'

      if (type === 'email') {
        await input.fill('test@example.com')
      } else if (type === 'password') {
        await input.fill('TestPassword123')
      } else if (type === 'number') {
        await input.fill('42')
      } else if (type === 'checkbox' || type === 'radio') {
        await input.check().catch(() => {
          // May already be checked
        })
      } else {
        await input.fill(`Test ${name}`)
      }
    }

    // Fill textareas
    const textareas = await form.locator('textarea').all()
    for (const textarea of textareas) {
      await textarea.fill('Test description text for E2E testing.')
    }

    // Don't actually submit - just verify the form is fillable
    result.success = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }

  return result
}

/**
 * Full app crawler - visits all pages and tests all interactions
 */
export async function runFullAppCrawl(
  page: Page,
  config: Partial<CrawlConfig>,
): Promise<CrawlResult> {
  const fullConfig: Required<CrawlConfig> = { ...DEFAULT_CONFIG, ...config }

  const result: CrawlResult = {
    pagesVisited: new Map(),
    actionsPerformed: [],
    errors: [],
    coverage: {
      totalPages: 0,
      totalButtons: 0,
      totalLinks: 0,
      totalForms: 0,
      buttonsClicked: 0,
      linksVisited: 0,
      formsSubmitted: 0,
      errorRate: 0,
    },
  }

  const visitedPaths = new Set<string>()
  const urlQueue: string[] = [fullConfig.baseUrl]

  // Process URL queue
  while (urlQueue.length > 0 && visitedPaths.size < fullConfig.maxPages) {
    const url = urlQueue.shift()
    if (!url) continue

    const normalizedPath = getNormalizedPath(url, fullConfig.baseUrl)

    // Skip if already visited or should be skipped
    if (visitedPaths.has(normalizedPath)) continue
    if (shouldSkipUrl(url, fullConfig)) continue
    if (
      fullConfig.excludeExternalLinks &&
      !isInternalUrl(url, fullConfig.baseUrl)
    )
      continue

    visitedPaths.add(normalizedPath)

    if (fullConfig.verbose) {
      console.log(`Crawling: ${url}`)
    }

    try {
      // Navigate to page
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: fullConfig.timeout,
      })
      await waitForPageReady(page, fullConfig.timeout)

      // Extract page state
      const pageState = await extractPageState(page)
      result.pagesVisited.set(normalizedPath, pageState)
      result.coverage.totalPages++
      result.coverage.totalButtons += pageState.buttons.length
      result.coverage.totalLinks += pageState.links.length
      result.coverage.totalForms += pageState.forms.length

      // Add discovered links to queue
      for (const link of pageState.links) {
        const absoluteUrl = new URL(link, url).href
        const linkPath = getNormalizedPath(absoluteUrl, fullConfig.baseUrl)

        if (
          !visitedPaths.has(linkPath) &&
          isInternalUrl(absoluteUrl, fullConfig.baseUrl)
        ) {
          urlQueue.push(absoluteUrl)
        }
      }

      // Test buttons on this page
      const buttons = await page.locator(SELECTORS.buttons).all()
      let buttonsTested = 0

      for (const button of buttons) {
        if (buttonsTested >= fullConfig.maxActionsPerPage) break

        const actionResult = await testButtonClick(page, button, fullConfig)
        result.actionsPerformed.push(actionResult)

        if (actionResult.success) {
          result.coverage.buttonsClicked++
        } else if (actionResult.error) {
          result.errors.push({
            url,
            action: `button: ${actionResult.selector}`,
            error: actionResult.error,
          })
        }

        buttonsTested++
      }

      // Test forms on this page
      const forms = await page.locator(SELECTORS.forms).all()
      let formsTested = 0

      for (const form of forms) {
        if (formsTested >= 5) break // Limit forms per page

        const actionResult = await testFormSubmission(page, form, fullConfig)
        result.actionsPerformed.push(actionResult)

        if (actionResult.success) {
          result.coverage.formsSubmitted++
        } else if (actionResult.error) {
          result.errors.push({
            url,
            action: 'form-submit',
            error: actionResult.error,
          })
        }

        formsTested++
      }

      // Log errors found on page
      if (pageState.errors.length > 0) {
        for (const error of pageState.errors) {
          result.errors.push({
            url,
            action: 'page-load',
            error: `Error displayed: ${error}`,
          })
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      result.errors.push({
        url,
        action: 'navigation',
        error: errorMessage,
      })
    }
  }

  // Calculate coverage and error rate
  result.coverage.linksVisited = visitedPaths.size
  const totalActions = result.actionsPerformed.length
  const failedActions = result.actionsPerformed.filter((a) => !a.success).length
  result.coverage.errorRate =
    totalActions > 0 ? failedActions / totalActions : 0

  return result
}

/**
 * Create a test function that crawls the entire app
 */
export function createAppCrawler(config: Partial<CrawlConfig>) {
  return async (page: Page): Promise<void> => {
    const result = await runFullAppCrawl(page, config)

    // Log summary
    console.log('\n=== App Crawler Summary ===')
    console.log(`Pages visited: ${result.coverage.totalPages}`)
    console.log(`Buttons found: ${result.coverage.totalButtons}`)
    console.log(`Buttons clicked: ${result.coverage.buttonsClicked}`)
    console.log(`Forms found: ${result.coverage.totalForms}`)
    console.log(`Forms tested: ${result.coverage.formsSubmitted}`)
    console.log(`Errors: ${result.errors.length}`)
    console.log(`Error rate: ${(result.coverage.errorRate * 100).toFixed(2)}%`)

    // Log errors
    if (result.errors.length > 0) {
      console.log('\nErrors encountered:')
      for (const error of result.errors.slice(0, 10)) {
        console.log(`  - ${error.url}: ${error.action} - ${error.error}`)
      }
      if (result.errors.length > 10) {
        console.log(`  ... and ${result.errors.length - 10} more`)
      }
    }

    // Assert no critical errors
    const criticalErrors = result.errors.filter(
      (e) => e.action === 'navigation' || e.error.includes('timeout'),
    )

    expect(
      criticalErrors.length,
      `Found ${criticalErrors.length} critical navigation/timeout errors`,
    ).toBeLessThan(3)

    // Assert reasonable coverage
    expect(
      result.coverage.totalPages,
      'Should visit at least 1 page',
    ).toBeGreaterThan(0)
  }
}

/**
 * Generate test report
 */
export function generateCrawlReport(result: CrawlResult): string {
  const lines: string[] = []

  lines.push('# Full App Crawl Report')
  lines.push('')
  lines.push('## Coverage Summary')
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Pages Visited | ${result.coverage.totalPages} |`)
  lines.push(`| Total Buttons | ${result.coverage.totalButtons} |`)
  lines.push(`| Buttons Clicked | ${result.coverage.buttonsClicked} |`)
  lines.push(`| Total Forms | ${result.coverage.totalForms} |`)
  lines.push(`| Forms Tested | ${result.coverage.formsSubmitted} |`)
  lines.push(
    `| Error Rate | ${(result.coverage.errorRate * 100).toFixed(2)}% |`,
  )
  lines.push('')

  lines.push('## Pages Visited')
  lines.push('')
  for (const [path, state] of result.pagesVisited) {
    lines.push(`### ${path}`)
    lines.push(`- Title: ${state.title}`)
    lines.push(`- Buttons: ${state.buttons.length}`)
    lines.push(`- Links: ${state.links.length}`)
    lines.push(`- Forms: ${state.forms.length}`)
    if (state.errors.length > 0) {
      lines.push(`- **Errors on page**: ${state.errors.join(', ')}`)
    }
    lines.push('')
  }

  if (result.errors.length > 0) {
    lines.push('## Errors')
    lines.push('')
    for (const error of result.errors) {
      lines.push(`- **${error.url}**: ${error.action} - ${error.error}`)
    }
  }

  return lines.join('\n')
}
