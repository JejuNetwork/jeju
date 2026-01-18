/**
 * Proposal Flow Tests - Full Proposal Creation Wizard
 *
 * Tests the complete proposal creation flow:
 * 1. Draft step - fill out proposal details
 * 2. Quality step - AI assessment
 * 3. Duplicates step - check for similar proposals
 * 4. Submit step - final review and submission
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { connectAndVerify, test, walletPassword } from '@jejunetwork/tests'
import { expect } from '@playwright/test'
import { MetaMask } from '@synthetixio/synpress/playwright'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`

// Sample proposal data
const GOOD_PROPOSAL = {
  type: 'Grant',
  title: 'Community Developer Grants Program Proposal',
  summary:
    'Establish a comprehensive grants program to fund open-source development projects that benefit the Jeju Network ecosystem and expand our developer community.',
  description: `## Problem Statement
The Jeju Network currently lacks a structured grants program to incentivize and fund open-source development. This limits ecosystem growth and developer participation.

## Proposed Solution
We propose establishing a Community Developer Grants Program with the following structure:

### Funding Tiers
- Micro Grants: $1,000 - $5,000 for small utilities and tools
- Standard Grants: $5,000 - $25,000 for medium projects
- Major Grants: $25,000 - $100,000 for significant infrastructure

### Evaluation Process
1. Initial application review by grants committee
2. Technical assessment by core developers
3. Community feedback period (7 days)
4. Final approval by governance

## Implementation Timeline
- Month 1: Committee formation and guidelines
- Month 2: Application portal development
- Month 3: First cohort selection
- Month 4-12: Ongoing grant distribution and monitoring

## Budget Breakdown
- Grant Pool: 500,000 USDC
- Operations: 50,000 USDC (committee compensation, tooling)
- Marketing: 25,000 USDC (developer outreach)
- Total: 575,000 USDC

## Expected Impact
- 50+ funded projects in year one
- 200+ new developers onboarded
- 10+ major infrastructure improvements
- Increased TVL through ecosystem growth

## Risk Assessment
- Funding misuse: Mitigated through milestone-based payouts
- Low quality submissions: Mitigated through technical review
- Committee bias: Mitigated through rotating members and public votes

## Success Metrics
- Number of successful project completions
- Developer retention rate
- Community engagement metrics
- TVL correlation analysis`,
}

const MINIMAL_PROPOSAL = {
  title: 'Test',
  summary: 'Short',
  description: 'Not enough detail',
}

test.describe('Proposal Draft Step', () => {
  test('shows validation for incomplete proposal', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Continue button should be disabled without content
    const continueButton = page.getByRole('button', { name: 'Continue' })
    await expect(continueButton).toBeDisabled()

    // Add minimal content
    await page.getByLabel('Title').fill(MINIMAL_PROPOSAL.title)
    await page.getByLabel('Summary').fill(MINIMAL_PROPOSAL.summary)
    await page.getByLabel('Full Description').fill(MINIMAL_PROPOSAL.description)

    // Still should be disabled (below minimums)
    await expect(continueButton).toBeDisabled()
  })

  test('can select proposal type', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Click different proposal types
    await page.getByText('Treasury Allocation').click()
    await expect(
      page.getByText('Treasury Allocation').locator('..'),
    ).toHaveClass(/border-accent/)

    await page.getByText('Grant').click()
    await expect(page.getByText('Grant').locator('..')).toHaveClass(
      /border-accent/,
    )

    await page.getByText('Code Upgrade').click()
    await expect(page.getByText('Code Upgrade').locator('..')).toHaveClass(
      /border-accent/,
    )
  })

  test('character counters update correctly', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Type in title
    await page.getByLabel('Title').fill('Test Title')
    await expect(page.getByText('10/100')).toBeVisible()

    // Type in summary
    const summary = 'A'.repeat(100)
    await page.getByLabel('Summary').fill(summary)
    await expect(page.getByText('100/500')).toBeVisible()
  })

  test('AI Assistant toggle works', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Click AI Assistant button
    await page.getByText('AI Assistant').click()

    // Generator section should appear
    await expect(page.getByPlaceholder('I want to propose...')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Generate Draft/ }),
    ).toBeVisible()
  })

  test('enables continue when proposal meets requirements', async ({
    page,
  }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Select proposal type
    await page.getByText('Grant').click()

    // Fill complete proposal
    await page.getByLabel('Title').fill(GOOD_PROPOSAL.title)
    await page.getByLabel('Summary').fill(GOOD_PROPOSAL.summary)
    await page.getByLabel('Full Description').fill(GOOD_PROPOSAL.description)

    // Continue should now be enabled
    const continueButton = page.getByRole('button', { name: 'Continue' })
    await expect(continueButton).toBeEnabled()
  })
})

test.describe('Proposal Quality Step', () => {
  test('can run quality assessment', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Fill proposal
    await page.getByText('Grant').click()
    await page.getByLabel('Title').fill(GOOD_PROPOSAL.title)
    await page.getByLabel('Summary').fill(GOOD_PROPOSAL.summary)
    await page.getByLabel('Full Description').fill(GOOD_PROPOSAL.description)

    // Proceed to quality step
    await page.getByRole('button', { name: 'Continue' }).click()

    // Should see quality assessment UI
    await expect(page.getByText('Quality Assessment')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Run Assessment/ }),
    ).toBeVisible()

    // Run assessment
    await page.getByRole('button', { name: /Run Assessment/ }).click()

    // Should show loading state
    await expect(page.getByText(/Assessing/)).toBeVisible()

    // Wait for assessment to complete (with timeout for API call)
    await page.waitForSelector('[class*="text-5xl"]', { timeout: 30000 })

    // Score should be visible
    const scoreElement = page.locator('[class*="text-5xl"]')
    await expect(scoreElement).toBeVisible()
  })

  test('back button returns to draft', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)

    // Fill and proceed
    await page.getByText('Grant').click()
    await page.getByLabel('Title').fill(GOOD_PROPOSAL.title)
    await page.getByLabel('Summary').fill(GOOD_PROPOSAL.summary)
    await page.getByLabel('Full Description').fill(GOOD_PROPOSAL.description)
    await page.getByRole('button', { name: 'Continue' }).click()

    // Should be on quality step
    await expect(page.getByText('Quality Assessment')).toBeVisible()

    // Go back
    await page.getByRole('button', { name: 'Back' }).click()

    // Should be on draft step with data preserved
    await expect(page.getByLabel('Title')).toHaveValue(GOOD_PROPOSAL.title)
    await expect(page.getByLabel('Summary')).toHaveValue(GOOD_PROPOSAL.summary)
  })
})

test.describe('Full Proposal Flow with Wallet', () => {
  test('complete proposal wizard flow', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      walletPassword,
      extensionId,
    )

    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Connect wallet first
    await connectAndVerify(page, metamask, {
      connectButtonText: 'Sign In',
      walletOptionText: 'Connect Wallet',
    })

    // Step 1: Draft
    await page.getByText('Grant').click()
    await page.getByLabel('Title').fill(GOOD_PROPOSAL.title)
    await page.getByLabel('Summary').fill(GOOD_PROPOSAL.summary)
    await page.getByLabel('Full Description').fill(GOOD_PROPOSAL.description)

    // Proceed to quality
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Quality Assessment')).toBeVisible()

    // Step 2: Quality Assessment
    await page.getByRole('button', { name: /Run Assessment/ }).click()

    // Wait for assessment
    await page.waitForSelector('[class*="text-5xl"]', { timeout: 30000 })

    // Check if we can proceed (score >= 90)
    const scoreText = await page.locator('[class*="text-5xl"]').textContent()
    const score = parseInt(scoreText?.replace('%', '') || '0', 10)

    if (score >= 90) {
      // Step 3: Duplicates check (automatic if score is high enough)
      await expect(page.getByText('Duplicate Check')).toBeVisible({
        timeout: 5000,
      })

      // Wait for duplicate check
      await page.waitForTimeout(2000)

      // Step 4: Submit
      if (await page.getByRole('button', { name: 'Continue' }).isEnabled()) {
        await page.getByRole('button', { name: 'Continue' }).click()

        // Should see review step
        await expect(page.getByText('Review & Submit')).toBeVisible()

        // Verify proposal summary
        await expect(page.getByText(GOOD_PROPOSAL.title)).toBeVisible()

        // Submit button should be visible
        await expect(
          page.getByRole('button', { name: 'Submit Proposal' }),
        ).toBeVisible()
      }
    }
  })
})

test.describe('Proposal Cancel Flow', () => {
  test('cancel returns to dashboard', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Fill some content
    await page.getByLabel('Title').fill('Partial proposal')

    // Click cancel
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Should return to dashboard
    await expect(page).toHaveURL(AUTOCRAT_URL)
  })
})
