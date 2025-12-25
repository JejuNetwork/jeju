/**
 * Bug Bounty Page Flow Tests
 *
 * Tests the bug bounty program page:
 * - Tab navigation (Overview, Submissions, Leaderboard)
 * - Reward tiers display
 * - Scope information
 * - Submit vulnerability flow
 */

import { expect, test } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3010'
const BUG_BOUNTY_URL = `${BASE_URL}/bug-bounty`

test.describe('Bug Bounty Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUG_BOUNTY_URL)
    await page.waitForLoadState('networkidle')
  })

  test('displays hero section correctly', async ({ page }) => {
    // Hero heading
    await expect(
      page.getByRole('heading', { name: 'Security Bug Bounty' }),
    ).toBeVisible()

    // Hero description
    await expect(page.getByText(/Help secure Jeju Network/)).toBeVisible()

    // Main CTA buttons
    await expect(
      page.getByRole('link', { name: /Report Vulnerability/ }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /View Scope/ })).toBeVisible()
  })

  test('displays stats cards', async ({ page }) => {
    await page.waitForTimeout(500)
    // Check for stat card labels
    await expect(page.getByText('Bounty Pool').first()).toBeVisible()
    await expect(page.getByText('Total Paid').first()).toBeVisible()
    await expect(page.getByText('Active Reports').first()).toBeVisible()
    await expect(page.getByText('Guardians').first()).toBeVisible()
  })
})

test.describe('Bug Bounty Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUG_BOUNTY_URL)
    await page.waitForLoadState('networkidle')
  })

  test('overview tab shows reward tiers', async ({ page }) => {
    // Default to overview tab
    await expect(page.getByText('Reward Tiers')).toBeVisible()

    // All severity levels
    await expect(page.getByText('Low').first()).toBeVisible()
    await expect(page.getByText('Medium').first()).toBeVisible()
    await expect(page.getByText('High').first()).toBeVisible()
    await expect(page.getByText('Critical').first()).toBeVisible()

    // Reward ranges
    await expect(page.getByText('$500 - $2,500')).toBeVisible()
    await expect(page.getByText('$25,000 - $50,000')).toBeVisible()
  })

  test('overview tab shows scope information', async ({ page }) => {
    // Scroll to scope section
    await page.evaluate(() => {
      const scope = document.getElementById('scope')
      if (scope) scope.scrollIntoView()
    })
    await page.waitForTimeout(300)

    // In Scope section
    await expect(page.getByText('In Scope').first()).toBeVisible()

    // Vulnerability types
    await expect(page.getByText('Funds at Risk').first()).toBeVisible()
    await expect(page.getByText('Wallet Drain').first()).toBeVisible()

    // Out of scope
    await expect(page.getByText('Out of Scope').first()).toBeVisible()
  })

  test('overview tab shows submission process', async ({ page }) => {
    await expect(page.getByText('Submission Process')).toBeVisible()

    // Process steps
    await expect(page.getByText('Submit').first()).toBeVisible()
    await expect(page.getByText('Validation')).toBeVisible()
    await expect(page.getByText('Review')).toBeVisible()
    await expect(page.getByText('Payout')).toBeVisible()
  })

  test('overview tab shows rules and guidelines', async ({ page }) => {
    await expect(page.getByText('Rules & Guidelines')).toBeVisible()

    // DO section
    await expect(
      page.getByText('Provide detailed reproduction steps'),
    ).toBeVisible()
    await expect(
      page.getByText('Include working proof of concept'),
    ).toBeVisible()

    // DO NOT section
    await expect(page.getByText('Access user data or funds')).toBeVisible()
    await expect(page.getByText('Execute exploits on mainnet')).toBeVisible()
  })

  test('can switch to submissions tab', async ({ page }) => {
    await page.getByRole('button', { name: 'submissions' }).click()

    // Should show submissions section
    await expect(page.getByText('Recent Submissions')).toBeVisible()

    // New Report button
    await expect(page.getByRole('link', { name: 'New Report' })).toBeVisible()
  })

  test('can switch to leaderboard tab', async ({ page }) => {
    await page.getByRole('button', { name: 'leaderboard' }).click()

    // Should show leaderboard section
    await expect(page.getByText('Top Researchers')).toBeVisible()

    // Coming soon message (placeholder)
    await expect(page.getByText('Leaderboard coming soon...')).toBeVisible()
  })

  test('tabs maintain state on click', async ({ page }) => {
    // Start on overview
    await expect(page.getByRole('button', { name: 'overview' })).toHaveClass(
      /text-red-400/,
    )

    // Switch to submissions
    await page.getByRole('button', { name: 'submissions' }).click()
    await expect(page.getByRole('button', { name: 'submissions' })).toHaveClass(
      /text-red-400/,
    )

    // Switch back to overview
    await page.getByRole('button', { name: 'overview' }).click()
    await expect(page.getByRole('button', { name: 'overview' })).toHaveClass(
      /text-red-400/,
    )
  })
})

test.describe('Bug Bounty Navigation', () => {
  test('report vulnerability links to create page', async ({ page }) => {
    await page.goto(BUG_BOUNTY_URL)

    await page.getByRole('link', { name: /Report Vulnerability/ }).click()

    // Should navigate to create with bug-bounty type
    await expect(page).toHaveURL(/\/create.*type=bug-bounty/)
  })

  test('new report button links to create page', async ({ page }) => {
    await page.goto(BUG_BOUNTY_URL)

    // Switch to submissions tab
    await page.getByRole('button', { name: 'submissions' }).click()

    await page.getByRole('link', { name: 'New Report' }).click()

    // Should navigate to create with bug-bounty type
    await expect(page).toHaveURL(/\/create.*type=bug-bounty/)
  })

  test('view scope anchor link works', async ({ page }) => {
    await page.goto(BUG_BOUNTY_URL)

    await page.getByRole('link', { name: /View Scope/ }).click()
    await page.waitForTimeout(500)

    // URL should have #scope anchor
    await expect(page).toHaveURL(`${BUG_BOUNTY_URL}#scope`)

    // Scope section should be visible
    await expect(page.getByText('In Scope').first()).toBeVisible()
  })
})

test.describe('Bug Bounty Responsive', () => {
  test('mobile layout works correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(BUG_BOUNTY_URL)

    // Hero should be visible
    await expect(
      page.getByRole('heading', { name: 'Security Bug Bounty' }),
    ).toBeVisible()

    // Stats should stack
    await expect(page.getByText('Bounty Pool')).toBeVisible()

    // Tabs should be visible
    await expect(page.getByRole('button', { name: 'overview' })).toBeVisible()
  })

  test('tablet layout shows full content', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(BUG_BOUNTY_URL)
    await page.waitForLoadState('networkidle')

    // All sections visible
    await expect(page.getByText('Reward Tiers').first()).toBeVisible()

    // Scroll to see more content
    await page.evaluate(() => window.scrollBy(0, 500))
    await page.waitForTimeout(300)

    // Process section should be visible after scroll
    await expect(page.getByText('Submission Process').first()).toBeVisible()
  })
})
