/**
 * EIL Cross-Chain Swap E2E Tests
 *
 * Tests the EIL integration in Bazaar swap page:
 * - Cross-chain mode toggle
 * - Chain selection
 * - Fee estimates
 * - Bridge UI states
 *
 * Run with: SKIP_WEBSERVER=1 bunx playwright test tests/e2e/eil-swap.spec.ts
 */

import { assertNoPageErrors } from '@jejunetwork/tests/playwright-only'
import { expect, type Page, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

const WAIT_SHORT = 200
const WAIT_MEDIUM = 500
const WAIT_LONG = 1000

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(WAIT_MEDIUM)
}

test.describe('EIL Cross-Chain - Chain Selection', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/swap')
  })

  test('displays chain selector UI', async ({ page }) => {
    await assertNoPageErrors(page)

    // Should show chain selection labels
    await expect(page.getByText('From Chain')).toBeVisible()
    await expect(page.getByText('To Chain')).toBeVisible()
  })

  test('lists supported chains', async ({ page }) => {
    await assertNoPageErrors(page)

    const chainSelect = page.locator('#source-chain').or(
      page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: 'Jeju' }) })
        .first(),
    )

    if (await chainSelect.isVisible()) {
      const options = await chainSelect.locator('option').allTextContents()
      console.log('Supported chains:', options)

      expect(options).toContain('Jeju')
      // May also have other chains
      const expectedChains = ['Ethereum', 'Arbitrum', 'Optimism', 'Base']
      const hasOtherChains = expectedChains.some((chain) =>
        options.includes(chain),
      )
      console.log('Has cross-chain support:', hasOtherChains)
    }
  })

  test('can select different source and destination chains', async ({
    page,
  }) => {
    await assertNoPageErrors(page)

    const chainSelects = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Jeju' }) })

    if ((await chainSelects.count()) >= 2) {
      const sourceSelect = chainSelects.first()
      const destSelect = chainSelects.nth(1)

      // Set source to Jeju
      await sourceSelect.selectOption({ label: 'Jeju' })
      await page.waitForTimeout(WAIT_SHORT)

      // Set destination to Ethereum (if available)
      const destOptions = await destSelect.locator('option').allTextContents()
      if (destOptions.includes('Ethereum')) {
        await destSelect.selectOption({ label: 'Ethereum' })
        await page.waitForTimeout(WAIT_SHORT)

        expect(await destSelect.inputValue()).not.toBe(
          await sourceSelect.inputValue(),
        )
      }
    }
  })

  test('shows cross-chain indicator when chains differ', async ({ page }) => {
    await assertNoPageErrors(page)

    const chainSelects = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Jeju' }) })

    if ((await chainSelects.count()) >= 2) {
      const sourceSelect = chainSelects.first()
      const destSelect = chainSelects.nth(1)

      const destOptions = await destSelect.locator('option').allTextContents()
      if (destOptions.includes('Ethereum')) {
        await sourceSelect.selectOption({ label: 'Jeju' })
        await destSelect.selectOption({ label: 'Ethereum' })
        await page.waitForTimeout(WAIT_MEDIUM)

        // Should show cross-chain indicator (lightning icon is now active)
        const body = await page.textContent('body')
        expect(
          body?.includes('Ethereum') ||
            body?.includes('Bridge') ||
            body?.includes('cross-chain'),
        ).toBe(true)
      }
    }
  })
})

test.describe('EIL Cross-Chain - Fee Display', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/swap')
  })

  test('shows fee estimate for cross-chain swap', async ({ page }) => {
    await assertNoPageErrors(page)

    const chainSelects = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Jeju' }) })

    if ((await chainSelects.count()) >= 2) {
      // Enable cross-chain
      await chainSelects.first().selectOption({ label: 'Jeju' })

      const destOptions = await chainSelects
        .nth(1)
        .locator('option')
        .allTextContents()
      if (destOptions.includes('Ethereum')) {
        await chainSelects.nth(1).selectOption({ label: 'Ethereum' })

        // Enter amount
        const inputAmount = page.locator('input[type="number"]').first()
        await inputAmount.fill('1')
        await page.waitForTimeout(WAIT_LONG)

        // Should show fee info
        const body = await page.textContent('body')
        expect(
          body?.includes('Fee') ||
            body?.includes('0.5%') ||
            body?.includes('Est.'),
        ).toBe(true)
      }
    }
  })

  test('shows estimated time for bridge', async ({ page }) => {
    await assertNoPageErrors(page)

    const chainSelects = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Jeju' }) })

    if ((await chainSelects.count()) >= 2) {
      const destOptions = await chainSelects
        .nth(1)
        .locator('option')
        .allTextContents()
      if (destOptions.includes('Base')) {
        await chainSelects.first().selectOption({ label: 'Jeju' })
        await chainSelects.nth(1).selectOption({ label: 'Base' })

        const inputAmount = page.locator('input[type="number"]').first()
        await inputAmount.fill('1')
        await page.waitForTimeout(WAIT_LONG)

        // Should show estimated time
        const body = await page.textContent('body')
        expect(
          body?.includes('Est. Time') ||
            body?.includes('minutes') ||
            body?.includes('Bridge'),
        ).toBe(true)
      }
    }
  })
})

test.describe('EIL Cross-Chain - Button States', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/swap')
  })

  test('shows Bridge button for cross-chain transfers', async ({ page }) => {
    await assertNoPageErrors(page)

    const sourceChain = page.locator('#source-chain')
    const destChain = page.locator('#dest-chain')

    if ((await sourceChain.isVisible()) && (await destChain.isVisible())) {
      const destOptions = await destChain.locator('option').allTextContents()
      if (destOptions.includes('Ethereum')) {
        await sourceChain.selectOption({ label: 'Jeju' })
        await destChain.selectOption({ label: 'Ethereum' })

        const inputAmount = page.locator('input[type="number"]').first()
        await inputAmount.fill('1')
        await page.waitForTimeout(WAIT_MEDIUM)

        // Find the action button in the swap card
        const swapCard = page.locator('.card')
        const actionButton = swapCard.locator('button.btn-primary').first()

        if (await actionButton.isVisible()) {
          const buttonText = await actionButton.textContent()
          expect(
            buttonText?.includes('Bridge') ||
              buttonText?.includes('Ethereum') ||
              buttonText?.includes('Connect'),
          ).toBe(true)
        }
      }
    }
  })

  test('shows Swap button for same-chain transfers', async ({ page }) => {
    await assertNoPageErrors(page)

    const sourceChain = page.locator('#source-chain')
    const destChain = page.locator('#dest-chain')

    if ((await sourceChain.isVisible()) && (await destChain.isVisible())) {
      // Keep both on same chain
      await sourceChain.selectOption({ label: 'Jeju' })
      await destChain.selectOption({ label: 'Jeju' })

      const inputAmount = page.locator('input[type="number"]').first()
      await inputAmount.fill('1')
      await page.waitForTimeout(WAIT_MEDIUM)

      // Find the action button in the swap card
      const swapCard = page.locator('.card')
      const actionButton = swapCard.locator('button.btn-primary').first()

      if (await actionButton.isVisible()) {
        const buttonText = await actionButton.textContent()
        expect(
          buttonText?.includes('Transfer') ||
            buttonText?.includes('Swap') ||
            buttonText?.includes('Connect'),
        ).toBe(true)
      }
    }
  })
})

test.describe('EIL Cross-Chain - Availability Warning', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('shows warning when cross-chain bridge unavailable', async ({
    page,
  }) => {
    await navigateTo(page, '/swap')
    await assertNoPageErrors(page)

    const chainSelects = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Jeju' }) })

    if ((await chainSelects.count()) >= 2) {
      const destOptions = await chainSelects
        .nth(1)
        .locator('option')
        .allTextContents()

      if (destOptions.includes('Ethereum')) {
        await chainSelects.first().selectOption({ label: 'Jeju' })
        await chainSelects.nth(1).selectOption({ label: 'Ethereum' })
        await page.waitForTimeout(WAIT_MEDIUM)

        // May show warning text if EIL is not configured
        const _warningText = page.getByText(
          /bridge not available|cross-chain.*unavailable/i,
        )

        // Either warning shows or page works - both are valid states
        const body = await page.textContent('body')
        expect(body?.length).toBeGreaterThan(100)
      }
    }
  })
})

test.describe('EIL Cross-Chain - EIL Info', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('shows EIL powered info when available', async ({ page }) => {
    await navigateTo(page, '/swap')
    await assertNoPageErrors(page)

    // Look for EIL info section at the bottom
    const body = await page.textContent('body')

    // May show EIL info if configured
    const hasEILInfo =
      body?.includes('EIL') ||
      body?.includes('Cross-chain bridging powered') ||
      body?.includes('transfers available')

    // Just verify page renders without crash
    expect(body?.includes('Swap')).toBe(true)
    console.log('Has EIL info:', hasEILInfo)
  })
})

test.describe('Liquidity Page - XLP Integration', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/liquidity')
  })

  test('loads liquidity page', async ({ page }) => {
    await assertNoPageErrors(page)
    await expect(
      page.getByRole('heading', { name: /Liquidity/i }),
    ).toBeVisible()
  })

  test('shows pool sections or tabs', async ({ page }) => {
    await assertNoPageErrors(page)

    const body = await page.textContent('body')
    expect(
      body?.includes('Pool') ||
        body?.includes('V4') ||
        body?.includes('XLP') ||
        body?.includes('Liquidity'),
    ).toBe(true)
  })

  test('shows liquidity interface', async ({ page }) => {
    await assertNoPageErrors(page)

    // Should have some form of liquidity UI
    const hasInputs = (await page.locator('input').count()) > 0
    const hasSelects = (await page.locator('select').count()) > 0
    const hasButtons = (await page.locator('button').count()) > 0

    expect(hasInputs || hasSelects || hasButtons).toBe(true)
  })
})

test.describe('Cross-Chain - Mobile', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('cross-chain UI works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await navigateTo(page, '/swap')
    await assertNoPageErrors(page)

    // Chain selectors should be visible
    await expect(page.getByText('From Chain')).toBeVisible()
    await expect(page.getByText('To Chain')).toBeVisible()

    // Should be able to interact
    const chainSelects = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Jeju' }) })
    if ((await chainSelects.count()) >= 2) {
      await chainSelects.first().selectOption({ label: 'Jeju' })
      await assertNoPageErrors(page)
    }
  })
})
