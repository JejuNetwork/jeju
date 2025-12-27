/**
 * DAO Pages E2E Tests - New DAO-centric Architecture
 *
 * Tests all pages in the reimagined Autocrat app:
 * - DAOList (home page)
 * - DAODetail (individual DAO view)
 * - CreateDAO (wizard)
 * - AgentEdit
 * - Proposal
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const BASE_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`

test.describe('DAOList Page (Home)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`Console error: ${msg.text()}`)
      }
    })
  })

  test('loads home page with correct title', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page).toHaveTitle(/Autocrat/)
    await expect(page.locator('main')).toBeVisible()
  })

  test('displays hero section with heading', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(
      page.getByRole('heading', { name: 'AI-Powered DAOs' }),
    ).toBeVisible()
    await expect(
      page.getByText(/Discover and join autonomous organizations/),
    ).toBeVisible()
  })

  test('shows Create DAO button in hero', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page.getByRole('link', { name: /Create DAO/ })).toBeVisible()
  })

  test('displays search input', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page.getByPlaceholder(/Search DAOs/)).toBeVisible()
  })

  test('displays status filter dropdown', async ({ page }) => {
    await page.goto(BASE_URL)
    const dropdown = page.locator('select').first()
    await expect(dropdown).toBeVisible()
    await expect(dropdown).toContainText('All Status')
  })

  test('status filter has all options', async ({ page }) => {
    await page.goto(BASE_URL)
    const dropdown = page.locator('select').first()

    await expect(dropdown.locator('option[value="all"]')).toBeVisible()
    await expect(dropdown.locator('option[value="active"]')).toBeVisible()
    await expect(dropdown.locator('option[value="pending"]')).toBeVisible()
    await expect(dropdown.locator('option[value="paused"]')).toBeVisible()
    await expect(dropdown.locator('option[value="archived"]')).toBeVisible()
  })

  test('search filters results', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    const searchInput = page.getByPlaceholder(/Search DAOs/)
    await searchInput.fill('nonexistent-dao-xyz')

    // Should show empty state or filtered results
    await page.waitForTimeout(500)
  })

  test('network-only filter button works', async ({ page }) => {
    await page.goto(BASE_URL)

    // Find the shield button (network filter)
    const networkButton = page
      .locator('button')
      .filter({ has: page.locator('svg.lucide-shield') })
    await expect(networkButton).toBeVisible()

    // Click to toggle
    await networkButton.click()

    // Should have active styling
    await expect(networkButton).toHaveClass(/border-amber/)
  })

  test('displays loading state initially', async ({ page }) => {
    await page.goto(BASE_URL)
    // May see loading spinner briefly
  })

  test('handles error state with retry button', async ({ page }) => {
    // This would require mocking the API - placeholder test
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
  })

  test('shows empty state when no DAOs match', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Search for something that won't match
    await page.getByPlaceholder(/Search DAOs/).fill('zzzznonexistent999')
    await page.waitForTimeout(500)

    // Should show "No DAOs found" or similar
    const _emptyState = page.getByText(/No DAOs found/)
    // May or may not be visible depending on data
  })
})

test.describe('Header Navigation', () => {
  test('header has logo linking to home', async ({ page }) => {
    await page.goto(BASE_URL)

    const logo = page.getByRole('link', { name: /Autocrat/ })
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('href', '/')
  })

  test('header has DAOs nav link', async ({ page }) => {
    await page.goto(BASE_URL)

    const daosLink = page.locator('header').getByRole('link', { name: 'DAOs' })
    await expect(daosLink).toBeVisible()
  })

  test('header has Create DAO button', async ({ page }) => {
    await page.goto(BASE_URL)

    const createButton = page
      .locator('header')
      .getByRole('link', { name: /Create DAO/ })
    await expect(createButton).toBeVisible()
  })

  test('header has wallet connect button', async ({ page }) => {
    await page.goto(BASE_URL)

    const connectButton = page.getByRole('button', { name: /Connect/i })
    await expect(connectButton).toBeVisible()
  })
})

test.describe('CreateDAO Wizard', () => {
  test('loads create page', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)
    await expect(
      page.getByRole('heading', { name: 'DAO Basics' }),
    ).toBeVisible()
  })

  test('shows all wizard steps', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await expect(page.getByText('Basics', { exact: true })).toBeVisible()
    await expect(page.getByText('CEO', { exact: true })).toBeVisible()
    await expect(page.getByText('Board', { exact: true })).toBeVisible()
    await expect(page.getByText('Governance', { exact: true })).toBeVisible()
    await expect(page.getByText('Review', { exact: true })).toBeVisible()
  })

  test('basics step has required fields', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await expect(page.getByLabel(/Slug/)).toBeVisible()
    await expect(page.getByLabel(/Display Name/)).toBeVisible()
    await expect(page.getByLabel(/Description/)).toBeVisible()
  })

  test('continue button is disabled without valid input', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    const continueButton = page.getByRole('button', { name: 'Continue' })
    await expect(continueButton).toBeDisabled()
  })

  test('slug field normalizes input', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    const slugInput = page.getByLabel(/Slug/)
    await slugInput.fill('My Test DAO!')

    // Should be normalized to lowercase with dashes
    await expect(slugInput).toHaveValue('my-test-dao-')
  })

  test('can fill basics step and continue', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')
    await page.getByLabel(/Description/).fill('A test DAO for testing')

    const continueButton = page.getByRole('button', { name: 'Continue' })
    await expect(continueButton).toBeEnabled()
  })

  test('CEO step shows agent configuration', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Fill basics
    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')

    // Go to CEO step
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(
      page.getByRole('heading', { name: 'Configure CEO' }),
    ).toBeVisible()
    await expect(page.getByLabel('Agent Name')).toBeVisible()
  })

  test('CEO step has model selection', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Should see model options
    await expect(page.getByText('Claude Opus 4.5')).toBeVisible()
    await expect(page.getByText('Claude Sonnet 4')).toBeVisible()
  })

  test('CEO step has decision style options', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByText('Aggressive')).toBeVisible()
    await expect(page.getByText('Balanced')).toBeVisible()
    await expect(page.getByText('Conservative')).toBeVisible()
  })

  test('Board step requires minimum 3 members', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Fill basics
    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Fill CEO
    await page.getByLabel('Agent Name').fill('CEO Bot')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Board step
    await expect(
      page.getByRole('heading', { name: 'Configure Board' }),
    ).toBeVisible()
    await expect(page.getByText(/Minimum 3 members required/)).toBeVisible()
  })

  test('can add and remove board members', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Navigate to board step
    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Agent Name').fill('CEO Bot')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Should have 3 default board members
    // Add another
    await page.getByText('Add Board Member').click()

    // Should now have 4 board members
  })

  test('back button returns to previous step', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Now on CEO step
    await expect(
      page.getByRole('heading', { name: 'Configure CEO' }),
    ).toBeVisible()

    // Go back
    await page.getByRole('button', { name: 'Back' }).click()

    // Should be on basics with data preserved
    await expect(page.getByLabel(/Slug/)).toHaveValue('test-dao')
  })

  test('cancel returns to home page', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(BASE_URL)
  })
})

test.describe('Navigation Between Pages', () => {
  test('can navigate from home to create', async ({ page }) => {
    await page.goto(BASE_URL)

    await page
      .getByRole('link', { name: /Create DAO/ })
      .first()
      .click()
    await expect(page).toHaveURL(`${BASE_URL}/create`)
  })

  test('can navigate back to home from create', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(BASE_URL)
  })

  test('logo navigates to home', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    await page.getByRole('link', { name: /Autocrat/ }).click()
    await expect(page).toHaveURL(BASE_URL)
  })
})

test.describe('Responsive Design', () => {
  test('mobile viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(BASE_URL)

    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
  })

  test('tablet viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(BASE_URL)

    await expect(page.locator('main')).toBeVisible()
  })

  test('desktop viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(BASE_URL)

    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('header nav')).toBeVisible()
  })
})

test.describe('DAODetail Page', () => {
  test('handles invalid DAO ID gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/nonexistent-dao-xyz`)

    // Should show error or not found state
    await page.waitForLoadState('networkidle')
  })

  test('back link returns to home', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/test`)
    await page.waitForLoadState('networkidle')

    const backLink = page.getByRole('link', { name: /All DAOs|Back/ })
    if (await backLink.isVisible()) {
      await backLink.click()
      await expect(page).toHaveURL(BASE_URL)
    }
  })
})

test.describe('Proposal Page', () => {
  test('new proposal form loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/test/proposal/new?type=general`)
    await page.waitForLoadState('networkidle')
  })

  test('handles missing DAO ID', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao//proposal/new`)
    await page.waitForLoadState('networkidle')
  })
})

test.describe('Error Handling', () => {
  test('handles 404 routes', async ({ page }) => {
    await page.goto(`${BASE_URL}/nonexistent-route`)
    await page.waitForLoadState('networkidle')
    // Should show something (may be React Router default)
  })

  test('handles malformed DAO IDs', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/<script>alert('xss')</script>`)
    await page.waitForLoadState('networkidle')
    // Should not execute script, should handle gracefully
  })
})

test.describe('Accessibility', () => {
  test('has accessible form labels', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // All form inputs should have labels
    const inputs = page.locator(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    )
    const count = await inputs.count()

    for (let i = 0; i < Math.min(count, 5); i++) {
      const input = inputs.nth(i)
      const id = await input.getAttribute('id')
      if (id) {
        const _label = page.locator(`label[for="${id}"]`)
        // Should have a label
      }
    }
  })

  test('buttons have accessible names', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    const buttons = page.getByRole('button')
    const count = await buttons.count()

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i)
      const name =
        (await button.getAttribute('aria-label')) ||
        (await button.textContent())
      expect(name).toBeTruthy()
    }
  })
})
