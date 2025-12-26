/**
 * Distributed Training E2E Tests (Synpress)
 * Tests training page and wizard with wallet integration
 */

// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { testWithSynpress } from '@synthetixio/synpress'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Training Page', () => {
  test('loads training page', async ({ page }) => {
    await page.goto('/training')
    await expect(
      page.locator('h1:has-text("Distributed Training")'),
    ).toBeVisible()
    await expect(page.locator('text=Psyche-powered')).toBeVisible()
  })

  test('shows training stats cards', async ({ page }) => {
    await page.goto('/training')
    await expect(page.locator('text=Active Runs')).toBeVisible()
    await expect(page.locator('text=Available Nodes')).toBeVisible()
    await expect(page.locator('text=Trainable Models')).toBeVisible()
    await expect(page.locator('text=Total Rewards')).toBeVisible()
  })

  test('switches between tabs', async ({ page }) => {
    await page.goto('/training')

    await expect(page.locator('button:has-text("Training Runs")')).toHaveClass(
      /bg-accent/,
    )

    await page.click('button:has-text("Base Models")')
    await expect(page.locator('button:has-text("Base Models")')).toHaveClass(
      /bg-accent/,
    )

    await page.click('button:has-text("Compute Nodes")')
    await expect(page.locator('button:has-text("Compute Nodes")')).toHaveClass(
      /bg-accent/,
    )
  })

  test('shows base models in models tab', async ({ page }) => {
    await page.goto('/training')
    await page.click('button:has-text("Base Models")')
    await expect(page.locator('text=LLaMA 3 8B')).toBeVisible()
    await expect(page.locator('text=Mistral 7B')).toBeVisible()
  })

  test('navigates to create training page', async ({ page }) => {
    await page.goto('/training')
    await page.click('a:has-text("New Training Run")')
    await expect(page).toHaveURL('/training/create')
    await expect(
      page.locator('h1:has-text("Create Training Run")'),
    ).toBeVisible()
  })
})

test.describe('Training Wizard', () => {
  test('shows training run creation wizard', async ({ page }) => {
    await page.goto('/training/create')
    await expect(page.locator('text=Select Model')).toBeVisible()
    await expect(page.locator('text=Dataset')).toBeVisible()
    await expect(page.locator('text=Configuration')).toBeVisible()
    await expect(page.locator('text=Compute Nodes')).toBeVisible()
    await expect(page.locator('text=Review & Launch')).toBeVisible()
  })

  test('selects base model', async ({ page }) => {
    await page.goto('/training/create')
    await page.fill('input[placeholder="Search models..."]', 'mistral')
    await page.click('button:has-text("Mistral 7B")')
    await expect(
      page.locator('button:has-text("Mistral 7B") svg.text-accent-400'),
    ).toBeVisible()
  })

  test('navigates through wizard steps', async ({ page }) => {
    await page.goto('/training/create')

    await page.click('button:has-text("LLaMA 3 8B")')
    await page.click('button:has-text("Continue")')

    await expect(page.locator('text=Select Training Dataset')).toBeVisible()
    await page.click('button:has-text("Jeju Documentation")')
    await page.click('button:has-text("Continue")')

    await expect(page.locator('text=Training Configuration')).toBeVisible()
    await page.click('button:has-text("Continue")')

    await expect(page.locator('text=Select Compute Nodes')).toBeVisible()
    await page.click('button:has-text("Continue")')

    await expect(page.locator('text=Review & Launch')).toBeVisible()
    await expect(
      page.locator('button:has-text("Launch Training")'),
    ).toBeVisible()
  })

  test('updates training configuration', async ({ page }) => {
    await page.goto('/training/create')

    await page.click('button:has-text("LLaMA 3 8B")')
    await page.click('button:has-text("Continue")')
    await page.click('button:has-text("Jeju Documentation")')
    await page.click('button:has-text("Continue")')

    const stepsInput = page.locator('input[type="number"]').first()
    await stepsInput.fill('2000')
    expect(await stepsInput.inputValue()).toBe('2000')

    const batchInput = page.locator('input[type="number"]').nth(1)
    await batchInput.fill('512')
    expect(await batchInput.inputValue()).toBe('512')

    await page.click('button:has-text("Private")')
    await expect(
      page.locator('button:has-text("Private") svg.text-accent-400'),
    ).toBeVisible()
  })

  test('shows stake amount in review', async ({ page }) => {
    await page.goto('/training/create')

    await page.click('button:has-text("LLaMA 3 8B")')
    await page.click('button:has-text("Continue")')
    await page.click('button:has-text("Jeju Documentation")')
    await page.click('button:has-text("Continue")')
    await page.click('button:has-text("Continue")')
    await page.click('button:has-text("Continue")')

    await expect(page.locator('input[value="0.01"]')).toBeVisible()
    await expect(page.locator('text=Stake Amount')).toBeVisible()
  })

  test('goes back in wizard', async ({ page }) => {
    await page.goto('/training/create')

    await page.click('button:has-text("LLaMA 3 8B")')
    await page.click('button:has-text("Continue")')

    await expect(page.locator('text=Select Training Dataset')).toBeVisible()

    await page.click('button:has-text("Back")')
    await expect(page.locator('text=Select Base Model')).toBeVisible()
  })

  test('disables continue button without selection', async ({ page }) => {
    await page.goto('/training/create')
    const continueButton = page.locator('button:has-text("Continue")')
    await expect(continueButton).toBeDisabled()

    await page.click('button:has-text("LLaMA 3 8B")')
    await expect(continueButton).toBeEnabled()
  })

  test('pre-fills model from URL param', async ({ page }) => {
    await page.goto('/training/create?model=meta/llama-3-8b')
    await expect(
      page.locator('button:has-text("LLaMA 3 8B") svg'),
    ).toBeVisible()
  })
})

test.describe('Training with Wallet', () => {
  test('starts training with wallet connected', async ({
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

    await page.goto('/training/create')

    await page.click('button:has-text("Connect Wallet")')
    await metamask.connectToDapp()

    await page.click('button:has-text("LLaMA 3 8B")')
    await page.click('button:has-text("Continue")')
    await page.click('button:has-text("Jeju Documentation")')
    await page.click('button:has-text("Continue")')
    await page.click('button:has-text("Continue")')
    await page.click('button:has-text("Continue")')

    await page.click('button:has-text("Launch Training")')
    await metamask.confirmTransaction()

    await expect(page).toHaveURL('/training', { timeout: 30000 })
  })
})

test.describe('Compute Nodes', () => {
  test('shows node performance metrics', async ({ page }) => {
    await page.goto('/training')
    await page.click('button:has-text("Compute Nodes")')

    await expect(page.locator('text=GPU Tier')).toBeVisible()
    await expect(page.locator('text=Score')).toBeVisible()
    await expect(page.locator('text=Latency')).toBeVisible()
    await expect(page.locator('text=Bandwidth')).toBeVisible()
    await expect(page.locator('text=Status')).toBeVisible()
  })

  test('shows fine-tune button on models', async ({ page }) => {
    await page.goto('/training')
    await page.click('button:has-text("Base Models")')

    const finetuneButtons = page.locator('a:has-text("Fine-tune")')
    expect(await finetuneButtons.count()).toBeGreaterThan(0)
  })
})

test.describe('Training Progress', () => {
  test('shows training run progress', async ({ page }) => {
    await page.goto('/training')
    const progressBars = page.locator('.bg-gradient-to-r.from-green-500')
    const count = await progressBars.count()
    if (count > 0) {
      await expect(progressBars.first()).toBeVisible()
    }
  })

  test('refreshes training data', async ({ page }) => {
    await page.goto('/training')
    await page.click('button:has-text("Refresh")')
    await expect(page.locator('text=Active Runs')).toBeVisible({
      timeout: 5000,
    })
  })
})
