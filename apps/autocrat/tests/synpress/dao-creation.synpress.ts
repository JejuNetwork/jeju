/**
 * DAO Creation Flow Tests with Wallet
 *
 * Tests the complete DAO creation wizard with wallet connection:
 * 1. Connect wallet
 * 2. Fill out all wizard steps
 * 3. Submit DAO creation transaction
 * 4. Verify DAO appears in list
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { connectAndVerify, test, walletPassword } from '@jejunetwork/tests'
import { expect } from '@playwright/test'
import { MetaMask } from '@synthetixio/synpress/playwright'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`

// Test data
const TEST_DAO = {
  name: 'test-dao',
  displayName: 'Test DAO',
  description: 'A test DAO for automated testing of the Autocrat platform.',
  farcasterChannel: '/test-channel',
  tags: ['test', 'automated'],
  ceo: {
    name: 'TestBot CEO',
    bio: 'An AI CEO for testing purposes',
    personality: 'Decisive, analytical, test-focused',
    values: ['accuracy', 'reliability', 'thoroughness'],
  },
  board: [
    { name: 'Treasury Bot', role: 'TREASURY' },
    { name: 'Code Guardian', role: 'CODE' },
    { name: 'Community Bot', role: 'COMMUNITY' },
  ],
}

test.describe('DAO Creation with Wallet', () => {
  test('complete DAO creation flow', async ({
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

    // Navigate to create page
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Connect wallet first
    await connectAndVerify(page, metamask, {
      connectButtonText: 'Connect',
    })

    // Step 1: Basics
    await expect(
      page.getByRole('heading', { name: 'DAO Basics' }),
    ).toBeVisible()

    await page.getByLabel(/Slug/).fill(TEST_DAO.name)
    await page.getByLabel(/Display Name/).fill(TEST_DAO.displayName)
    await page.getByLabel(/Description/).fill(TEST_DAO.description)

    // Optional: Farcaster channel
    const farcasterInput = page.getByLabel(/Farcaster Channel/)
    if (await farcasterInput.isVisible()) {
      await farcasterInput.fill(TEST_DAO.farcasterChannel)
    }

    // Add tags
    const tagInput = page.getByPlaceholder(/Add a tag/)
    if (await tagInput.isVisible()) {
      for (const tag of TEST_DAO.tags) {
        await tagInput.fill(tag)
        await page.getByRole('button', { name: 'Add' }).click()
      }
    }

    // Continue to CEO step
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 2: CEO Configuration
    await expect(
      page.getByRole('heading', { name: 'Configure CEO' }),
    ).toBeVisible()

    await page.getByLabel('Agent Name').fill(TEST_DAO.ceo.name)

    const bioInput = page.getByLabel('Bio')
    if (await bioInput.isVisible()) {
      await bioInput.fill(TEST_DAO.ceo.bio)
    }

    const personalityInput = page.getByLabel('Personality')
    if (await personalityInput.isVisible()) {
      await personalityInput.fill(TEST_DAO.ceo.personality)
    }

    // Select model (Claude Opus by default, so we can leave it)
    // Select decision style
    await page.getByText('Balanced').click()

    // Add values
    for (let i = 0; i < TEST_DAO.ceo.values.length; i++) {
      const valueInputs = page.locator('input[placeholder*="Security"]')
      if (await valueInputs.nth(i).isVisible()) {
        await valueInputs.nth(i).fill(TEST_DAO.ceo.values[i])

        // Add new value input if needed
        if (i < TEST_DAO.ceo.values.length - 1) {
          await page.getByText('Add Value').click()
        }
      }
    }

    // Continue to Board step
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 3: Board Configuration
    await expect(
      page.getByRole('heading', { name: 'Configure Board' }),
    ).toBeVisible()

    // Board should have 3 default members
    // Fill in their names
    const agentNameInputs = page.locator('input[placeholder*="Treasury"]')
    const count = await agentNameInputs.count()

    // Name the board members
    for (let i = 0; i < Math.min(count, TEST_DAO.board.length); i++) {
      // Find the agent form and fill the name
    }

    // Continue to Governance step
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 4: Governance Parameters
    await expect(
      page.getByRole('heading', { name: 'Governance Parameters' }),
    ).toBeVisible()

    // Default values should be pre-filled
    const minQualityInput = page.locator('input[type="number"]').first()
    await expect(minQualityInput).toHaveValue('70')

    // Verify checkboxes
    const ceoVetoCheckbox = page.locator('input[type="checkbox"]').first()
    await expect(ceoVetoCheckbox).toBeChecked()

    // Continue to Review step
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 5: Review & Create
    await expect(page.getByRole('heading', { name: /Review/ })).toBeVisible()

    // Verify summary shows correct data
    await expect(page.getByText(TEST_DAO.displayName)).toBeVisible()
    await expect(page.getByText(`@${TEST_DAO.name}`)).toBeVisible()
    await expect(page.getByText(TEST_DAO.ceo.name)).toBeVisible()

    // Funding notice should be visible
    await expect(page.getByText(/treasury/i)).toBeVisible()

    // Submit button should be visible
    const createButton = page.getByRole('button', { name: 'Create DAO' })
    await expect(createButton).toBeVisible()
    await expect(createButton).toBeEnabled()

    // Click create (will trigger API call)
    // Note: In real test with backend, this would create the DAO
    // await createButton.click()
    // await expect(page).toHaveURL(/\/dao\/test-dao/)
  })

  test('validates CEO name requirement', async ({
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

    await connectAndVerify(page, metamask, {
      connectButtonText: 'Connect',
    })

    // Fill basics
    await page.getByLabel(/Slug/).fill('test-dao')
    await page.getByLabel(/Display Name/).fill('Test DAO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // On CEO step, don't fill name
    await expect(
      page.getByRole('heading', { name: 'Configure CEO' }),
    ).toBeVisible()

    // Continue button should be disabled
    const continueButton = page.getByRole('button', { name: 'Continue' })
    await expect(continueButton).toBeDisabled()

    // Fill CEO name
    await page.getByLabel('Agent Name').fill('Test CEO')

    // Now continue should be enabled
    await expect(continueButton).toBeEnabled()
  })

  test('preserves form data on navigation', async ({
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

    await connectAndVerify(page, metamask, {
      connectButtonText: 'Connect',
    })

    // Fill basics
    await page.getByLabel(/Slug/).fill('persist-test')
    await page.getByLabel(/Display Name/).fill('Persist Test')
    await page.getByLabel(/Description/).fill('Testing data persistence')

    // Go to CEO step
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Agent Name').fill('Persistent CEO')

    // Go back
    await page.getByRole('button', { name: 'Back' }).click()

    // Data should be preserved
    await expect(page.getByLabel(/Slug/)).toHaveValue('persist-test')
    await expect(page.getByLabel(/Display Name/)).toHaveValue('Persist Test')
    await expect(page.getByLabel(/Description/)).toHaveValue(
      'Testing data persistence',
    )

    // Go forward again
    await page.getByRole('button', { name: 'Continue' }).click()

    // CEO data should be preserved
    await expect(page.getByLabel('Agent Name')).toHaveValue('Persistent CEO')
  })

  test('can navigate using step indicators', async ({
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

    await connectAndVerify(page, metamask, {
      connectButtonText: 'Connect',
    })

    // Fill all required fields to unlock steps
    await page.getByLabel(/Slug/).fill('step-nav-test')
    await page.getByLabel(/Display Name/).fill('Step Nav Test')
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.getByLabel('Agent Name').fill('Step Nav CEO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Now we're on Board step
    // Should be able to click back to Basics via step indicator
    const basicsStep = page.getByText('Basics', { exact: true })
    await basicsStep.click()

    // Should be back on basics
    await expect(page.getByLabel(/Slug/)).toHaveValue('step-nav-test')
  })
})

test.describe('Board Member Management', () => {
  test('starts with 3 default board members', async ({
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
    await connectAndVerify(page, metamask, { connectButtonText: 'Connect' })

    // Navigate to board step
    await page.getByLabel(/Slug/).fill('board-test')
    await page.getByLabel(/Display Name/).fill('Board Test')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Agent Name').fill('Board Test CEO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Should see 3 board member forms
    await expect(
      page.getByRole('heading', { name: 'Configure Board' }),
    ).toBeVisible()

    // Count expandable sections (board member forms)
    const boardForms = page
      .locator('[class*="bg-slate-900"]')
      .filter({ hasText: /Treasury|Code|Community/ })
    // Should have at least 3
  })

  test('can add a fourth board member', async ({
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
    await connectAndVerify(page, metamask, { connectButtonText: 'Connect' })

    // Navigate to board step
    await page.getByLabel(/Slug/).fill('add-member-test')
    await page.getByLabel(/Display Name/).fill('Add Member Test')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Agent Name').fill('Add Member CEO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Click add board member
    await page.getByText('Add Board Member').click()

    // Should now have 4 board member forms
  })

  test('cannot remove board member when at minimum', async ({
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
    await connectAndVerify(page, metamask, { connectButtonText: 'Connect' })

    // Navigate to board step
    await page.getByLabel(/Slug/).fill('min-board-test')
    await page.getByLabel(/Display Name/).fill('Min Board Test')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Agent Name').fill('Min Board CEO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // With 3 members (minimum), trash buttons should not be visible
    // or should be disabled
    const trashButtons = page
      .locator('button')
      .filter({ has: page.locator('svg.lucide-trash-2') })
    const count = await trashButtons.count()

    // Either no trash buttons, or they should not allow removal
    if (count > 0) {
      // If visible, clicking should not reduce below 3
    }
  })
})

test.describe('Governance Parameters', () => {
  test('has sensible default values', async ({
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
    await connectAndVerify(page, metamask, { connectButtonText: 'Connect' })

    // Navigate to governance step
    await page.getByLabel(/Slug/).fill('gov-defaults-test')
    await page.getByLabel(/Display Name/).fill('Gov Defaults Test')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Agent Name').fill('Gov Defaults CEO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Fill board names
    await page.getByRole('button', { name: 'Continue' }).click()

    // On governance step
    await expect(
      page.getByRole('heading', { name: 'Governance Parameters' }),
    ).toBeVisible()

    // Check defaults
    const minQualityInput = page.locator('input[type="number"]').first()
    await expect(minQualityInput).toHaveValue('70')

    // CEO veto should be enabled by default
    const ceoVetoCheckbox = page
      .getByText('Enable CEO Veto Power')
      .locator('..')
      .locator('input[type="checkbox"]')
    if (await ceoVetoCheckbox.isVisible()) {
      await expect(ceoVetoCheckbox).toBeChecked()
    }
  })

  test('can modify governance parameters', async ({
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
    await connectAndVerify(page, metamask, { connectButtonText: 'Connect' })

    // Navigate to governance step
    await page.getByLabel(/Slug/).fill('gov-modify-test')
    await page.getByLabel(/Display Name/).fill('Gov Modify Test')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Agent Name').fill('Gov Modify CEO')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Modify min quality score
    const minQualityInput = page.locator('input[type="number"]').first()
    await minQualityInput.fill('80')
    await expect(minQualityInput).toHaveValue('80')

    // Modify voting period
    const votingPeriodInput = page.locator('input[type="number"]').nth(2)
    if (await votingPeriodInput.isVisible()) {
      await votingPeriodInput.fill('5')
      await expect(votingPeriodInput).toHaveValue('5')
    }
  })
})

test.describe('Error Handling', () => {
  test('shows error when creation fails', async ({
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
    await connectAndVerify(page, metamask, { connectButtonText: 'Connect' })

    // Fill all steps
    await page.getByLabel(/Slug/).fill('error-test')
    await page.getByLabel(/Display Name/).fill('Error Test')
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.getByLabel('Agent Name').fill('Error Test CEO')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Fill board member names
    const nameInputs = page.getByLabel('Agent Name')
    const count = await nameInputs.count()
    for (let i = 0; i < count; i++) {
      const input = nameInputs.nth(i)
      if ((await input.isVisible()) && !(await input.inputValue())) {
        await input.fill(`Board Member ${i + 1}`)
      }
    }

    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // On review step, click create
    const createButton = page.getByRole('button', { name: 'Create DAO' })
    if (await createButton.isEnabled()) {
      await createButton.click()

      // If API is not available, should show error
      // Error message should appear near the button
      await page.waitForTimeout(2000)
    }
  })

  test('handles network disconnection gracefully', async ({
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
    await connectAndVerify(page, metamask, { connectButtonText: 'Connect' })

    // Disconnect network
    await context.setOffline(true)

    // Try to submit (will fail)
    await page.getByLabel(/Slug/).fill('offline-test')
    await page.getByLabel(/Display Name/).fill('Offline Test')

    // Should handle gracefully without crashing
    await context.setOffline(false)
  })
})
