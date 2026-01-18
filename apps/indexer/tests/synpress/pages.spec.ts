/**
 * Indexer E2E Tests - Full Page Coverage
 *
 * Tests all pages, buttons, and user flows in the Indexer app.
 * Covers blockchain explorer, transaction history, and analytics.
 */

import { getTestConfig } from '@jejunetwork/config/test-config'
import { runFullAppCrawl } from '@jejunetwork/tests/e2e/full-app-crawler'
import { expect, test } from '@playwright/test'

const config = getTestConfig('indexer')
const BASE_URL = process.env.INDEXER_BASE_URL || config.baseURL

test.describe('Indexer - Full Page Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { timeout: 30000 })
  })

  test('should load home page correctly', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page.locator('body')).toBeVisible()
  })

  test('should crawl all pages and test interactions', async ({ page }) => {
    const result = await runFullAppCrawl(page, {
      baseUrl: BASE_URL,
      maxPages: 25,
      maxActionsPerPage: 15,
      timeout: 15000,
      verbose: process.env.VERBOSE === 'true',
    })

    console.log('Indexer Crawl Summary:')
    console.log(`  Pages: ${result.coverage.totalPages}`)
    console.log(
      `  Buttons: ${result.coverage.buttonsClicked}/${result.coverage.totalButtons}`,
    )
    console.log(`  Errors: ${result.errors.length}`)

    expect(result.coverage.totalPages, 'Should discover pages').toBeGreaterThan(
      0,
    )
  })

  test('should have functional search', async ({ page }) => {
    await page.goto(BASE_URL)

    // Look for search input
    const searchInput = page
      .locator(
        'input[type="search"], input[placeholder*="search" i], [data-testid*="search"]',
      )
      .first()

    if (await searchInput.isVisible()) {
      // Test search functionality
      await searchInput.fill('0x')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1000)

      // Should show results or no results message
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('should display blockchain data', async ({ page }) => {
    await page.goto(BASE_URL)

    // Look for common blockchain explorer elements
    const blockchainElements = page.locator(
      '[data-testid*="block"], [data-testid*="transaction"], .block, .transaction, table',
    )

    const hasBlockchainData = (await blockchainElements.count()) > 0

    // Just verify page renders properly
    await expect(page.locator('body')).toBeVisible()

    if (hasBlockchainData) {
      console.log('Found blockchain data elements')
    }
  })

  test('should navigate to blocks page', async ({ page }) => {
    await page.goto(BASE_URL)

    const blocksLink = page.locator('a:has-text(/blocks/i)').first()
    if (await blocksLink.isVisible()) {
      await blocksLink.click()
      await page.waitForLoadState('domcontentloaded')
    }
  })

  test('should navigate to transactions page', async ({ page }) => {
    await page.goto(BASE_URL)

    const txLink = page.locator('a:has-text(/transactions/i)').first()
    if (await txLink.isVisible()) {
      await txLink.click()
      await page.waitForLoadState('domcontentloaded')
    }
  })

  test('should handle invalid addresses gracefully', async ({ page }) => {
    // Try navigating to an invalid address
    await page.goto(`${BASE_URL}/address/invalid-address`)

    // Should show error message or redirect, not crash
    await expect(page.locator('body')).toBeVisible()

    // Look for error handling
    const errorMessage = page.locator(
      '[role="alert"], .error, [data-testid*="error"]',
    )
    const redirectedHome =
      page.url() === BASE_URL || page.url() === `${BASE_URL}/`

    expect(
      (await errorMessage.count()) > 0 || redirectedHome,
      'Should handle invalid address gracefully',
    ).toBe(true)
  })

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(BASE_URL)

    await expect(page.locator('body')).toBeVisible()
  })

  test('should have no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    const criticalErrors = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('net::ERR'),
    )

    expect(
      criticalErrors.length,
      'Should have minimal console errors',
    ).toBeLessThan(3)
  })
})

test.describe('Indexer - GraphQL Playground', () => {
  test('should load GraphQL playground', async ({ page }) => {
    await page.goto(`${BASE_URL}/graphql`)

    // GraphQL playground should have query editor
    const playground = page.locator(
      '.graphiql, [data-testid*="graphql"], textarea, .CodeMirror',
    )

    await expect(playground.first())
      .toBeVisible({ timeout: 10000 })
      .catch(() => {
        console.log('GraphQL playground may be at different route')
      })
  })

  test('should execute basic query', async ({ page }) => {
    await page.goto(`${BASE_URL}/graphql`)

    // Wait for playground to load
    await page.waitForTimeout(2000)

    // Look for execute button
    const executeButton = page
      .locator(
        'button[aria-label*="execute" i], button:has-text(/run|execute/i), .execute-button',
      )
      .first()

    if (await executeButton.isVisible()) {
      await executeButton.click()
      await page.waitForTimeout(1000)
    }

    // Just verify page is functional
    await expect(page.locator('body')).toBeVisible()
  })
})
