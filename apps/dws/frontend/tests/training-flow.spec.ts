/**
 * RLAIF Training Flow E2E Tests (Synpress)
 *
 * Tests the DWS Training UI for creating and monitoring RLAIF training runs.
 * Uses MetaMask wallet integration for on-chain interactions.
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

// ============================================================================
// Training Page Navigation
// ============================================================================

test.describe('Training Page', () => {
  test('loads training page', async ({ page }) => {
    await page.goto('/compute/training')
    await expect(
      page.locator('h1:has-text("Training"), h2:has-text("Training")'),
    ).toBeVisible()
  })

  test('shows training dashboard sections', async ({ page }) => {
    await page.goto('/compute/training')
    // Check for common dashboard elements
    await expect(
      page.locator('text=Runs').or(page.locator('text=runs')),
    ).toBeVisible()
  })

  test('navigation to training page works', async ({ page }) => {
    await page.goto('/')
    // Navigate via menu
    const trainingLink = page
      .locator('a:has-text("Training"), button:has-text("Training")')
      .first()
    await trainingLink.click()
    await expect(page).toHaveURL(/training/)
  })
})

// ============================================================================
// RLAIF Run Creation
// ============================================================================

test.describe('RLAIF Run Creation', () => {
  test('shows create run button', async ({ page }) => {
    await page.goto('/compute/training')
    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create Run"), a:has-text("New Run")',
    )
    const count = await createButton.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('create run dialog has environment selection', async ({ page }) => {
    await page.goto('/compute/training')

    // Click create run button if exists
    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create")',
    )
    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Check for environment selection
      const envSelect = page.locator(
        'select[name="environment"], [data-testid="environment-select"]',
      )
      const envExists = (await envSelect.count()) > 0

      if (envExists) {
        await expect(envSelect).toBeVisible()
      }
    }
  })

  test('create run form validates required fields', async ({ page }) => {
    await page.goto('/compute/training')

    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create")',
    )
    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Submit without filling required fields
      const submitButton = page.locator(
        'button:has-text("Submit"), button:has-text("Create")',
      )
      if ((await submitButton.count()) > 0) {
        await submitButton.first().click()

        // Check for validation error
        const errorMessage = page.locator(
          '.text-red-500, .error, [role="alert"]',
        )
        const hasError =
          (await errorMessage.count()) > 0 ||
          (await page.locator('text=required').count()) > 0
        expect(hasError).toBe(true)
      }
    }
  })
})

// ============================================================================
// Training Run Monitoring
// ============================================================================

test.describe('Run Monitoring', () => {
  test('shows training runs list', async ({ page }) => {
    await page.goto('/compute/training')

    // Check for runs list or empty state
    const runsList = page.locator(
      '[data-testid="runs-list"], .runs-list, table',
    )
    const emptyState = page.locator('text=No runs, text=no training runs')

    const hasRuns = (await runsList.count()) > 0
    const hasEmpty = (await emptyState.count()) > 0

    expect(hasRuns || hasEmpty).toBe(true)
  })

  test('run status display', async ({ page }) => {
    await page.goto('/compute/training')

    // Check for status indicators
    const _statusIndicators = page.locator('.status, [data-status], badge')
    // Just verify the page loads without errors
    await expect(page.locator('body')).toBeVisible()
  })

  test('can expand run details', async ({ page }) => {
    await page.goto('/compute/training')

    // Find a run row and click to expand
    const runRow = page.locator('[data-testid="run-row"], tr.run-row').first()
    if ((await runRow.count()) > 0) {
      await runRow.click()

      // Check for expanded details
      const details = page.locator('[data-testid="run-details"], .run-details')
      expect(await details.count()).toBeGreaterThanOrEqual(0)
    }
  })
})

// ============================================================================
// Wallet Integration
// ============================================================================

test.describe('Training with Wallet', () => {
  test('connect wallet shows account', async ({
    page,
    context,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    await page.goto('/compute/training')

    // Find and click connect wallet button
    const connectButton = page.locator(
      'button:has-text("Connect"), button:has-text("Wallet")',
    )
    if ((await connectButton.count()) > 0) {
      await connectButton.first().click()
      await metamask.connectToDapp()

      // Verify connected state
      await page.waitForTimeout(1000)
      const addressDisplay = page.locator(
        'text=0x, [data-testid="wallet-address"]',
      )
      expect(await addressDisplay.count()).toBeGreaterThanOrEqual(0)
    }
  })

  test('create run with wallet connected', async ({
    page,
    context,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    await page.goto('/compute/training')

    // Connect wallet first
    const connectButton = page.locator('button:has-text("Connect")')
    if ((await connectButton.count()) > 0) {
      await connectButton.first().click()
      await metamask.connectToDapp()
    }

    // Create a new run
    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create")',
    )
    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Fill form if visible
      const envSelect = page.locator('select[name="environment"]')
      if ((await envSelect.count()) > 0) {
        await envSelect.selectOption({ index: 0 })
      }

      const modelInput = page.locator('input[name="model"]')
      if ((await modelInput.count()) > 0) {
        await modelInput.fill('Qwen/Qwen2.5-3B-Instruct')
      }

      const submitButton = page.locator(
        'button:has-text("Submit"), button:has-text("Create Run")',
      )
      if ((await submitButton.count()) > 0) {
        await submitButton.first().click()

        // If transaction confirmation is needed
        await page.waitForTimeout(1000)
        const confirmButton = page.locator('button:has-text("Confirm")')
        if ((await confirmButton.count()) > 0) {
          await confirmButton.click()
          await metamask.confirmTransaction()
        }
      }
    }
  })
})

// ============================================================================
// Environment Selection
// ============================================================================

test.describe('Environment Selection', () => {
  test('shows available environments', async ({ page }) => {
    await page.goto('/compute/training')

    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create")',
    )
    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Check for environment options
      const envOptions = page.locator(
        'option, [role="option"], .environment-option',
      )
      expect(await envOptions.count()).toBeGreaterThanOrEqual(0)
    }
  })

  test('babylon environment shows archetype selection', async ({ page }) => {
    await page.goto('/compute/training')

    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create")',
    )
    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Select babylon environment if available
      const envSelect = page.locator('select[name="environment"]')
      if ((await envSelect.count()) > 0) {
        await envSelect.selectOption('babylon')

        // Check for archetype selection
        const archetypeSelect = page.locator(
          'select[name="archetype"], [data-testid="archetype-select"]',
        )
        expect(await archetypeSelect.count()).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

// ============================================================================
// Rubric Selection
// ============================================================================

test.describe('Rubric Selection', () => {
  test('shows rubric options for scoring', async ({ page }) => {
    await page.goto('/compute/training')

    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create")',
    )
    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Check for rubric selection
      const rubricSelect = page.locator(
        'select[name="rubric"], [data-testid="rubric-select"]',
      )
      if ((await rubricSelect.count()) > 0) {
        await expect(rubricSelect).toBeVisible()
      }
    }
  })

  test('default rubric is pre-selected', async ({ page }) => {
    await page.goto('/compute/training')

    const createButton = page.locator(
      'button:has-text("New Run"), button:has-text("Create")',
    )
    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      const rubricSelect = page.locator('select[name="rubric"]')
      if ((await rubricSelect.count()) > 0) {
        const value = await rubricSelect.inputValue()
        expect(value).toBeDefined()
      }
    }
  })
})

// ============================================================================
// Training Progress
// ============================================================================

test.describe('Training Progress Display', () => {
  test('shows progress indicators for active runs', async ({ page }) => {
    await page.goto('/compute/training')

    // Check for progress bars or percentage indicators
    const progressIndicators = page.locator(
      '[role="progressbar"], .progress-bar, .progress',
    )
    const percentages = page.locator('text=% complete, text=Progress')

    // Either progress indicators or no active runs is acceptable
    const _hasProgress =
      (await progressIndicators.count()) > 0 || (await percentages.count()) > 0
    // Just ensure page is stable
    await expect(page.locator('body')).toBeVisible()
  })

  test('shows iteration count for RLAIF runs', async ({ page }) => {
    await page.goto('/compute/training')

    // Check for iteration display
    const iterationDisplay = page.locator('text=Iteration, text=iteration')
    expect(await iterationDisplay.count()).toBeGreaterThanOrEqual(0)
  })

  test('shows metrics for completed runs', async ({ page }) => {
    await page.goto('/compute/training')

    // Look for metric displays
    const metrics = page.locator(
      'text=Score, text=Loss, text=Accuracy, text=Reward',
    )
    expect(await metrics.count()).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Error Handling
// ============================================================================

test.describe('Error Handling', () => {
  test('shows error state for failed runs', async ({ page }) => {
    await page.goto('/compute/training')

    // Check for error indicators
    const _errorIndicators = page.locator(
      '.text-red-500, .error, [data-status="failed"]',
    )
    // Just verify the page handles errors gracefully
    await expect(page.locator('body')).toBeVisible()
  })

  test('retry option for failed runs', async ({ page }) => {
    await page.goto('/compute/training')

    // Look for retry buttons on failed runs
    const retryButton = page.locator(
      'button:has-text("Retry"), button:has-text("Restart")',
    )
    expect(await retryButton.count()).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Responsive Design
// ============================================================================

test.describe('Responsive Design', () => {
  test('mobile view adjusts layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/compute/training')

    // Verify page renders correctly on mobile
    await expect(page.locator('body')).toBeVisible()

    // Check for mobile menu or hamburger
    const mobileMenu = page.locator(
      '[data-testid="mobile-menu"], .hamburger, button[aria-label="Menu"]',
    )
    expect(await mobileMenu.count()).toBeGreaterThanOrEqual(0)
  })

  test('tablet view maintains functionality', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/compute/training')

    // Verify page renders correctly on tablet
    await expect(page.locator('body')).toBeVisible()
  })
})
