/**
 * Pools and Liquidity Page Tests
 * Tests pools listing and liquidity interface (without wallet)
 */

import { assertNoPageErrors } from '@jejunetwork/tests/playwright-only'
import { expect, type Page, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Pools Page', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays pools page', async ({ page }) => {
    await page.goto('/pools')
    await assertNoPageErrors(page)

    await expect(page.getByRole('heading', { name: /Pools/i })).toBeVisible()
  })

  test('has create pool button', async ({ page }) => {
    await navigateTo(page, '/pools')

    const createPool = page.getByRole('button', { name: /Create Pool/i })
    await expect(createPool).toBeVisible()
  })

  test('create pool button exists', async ({ page }) => {
    await navigateTo(page, '/pools')

    const createPool = page.getByRole('button', { name: /create pool/i })
    const isEnabled = await createPool.isEnabled()

    if (isEnabled) {
      await createPool.click()
      await page.waitForTimeout(500)

      const cancelBtn = page.getByRole('button', { name: /cancel/i })
      if (await cancelBtn.isVisible()) {
        await expect(cancelBtn).toBeEnabled()
        await cancelBtn.click()
      }
    } else {
      await expect(createPool).toBeVisible()
    }
  })
})

test.describe('Liquidity Page', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays liquidity interface', async ({ page }) => {
    await navigateTo(page, '/liquidity')
    await assertNoPageErrors(page)

    await expect(
      page.getByRole('heading', { name: /Liquidity/i }),
    ).toBeVisible()
  })

  test('has V4 and XLP section toggles', async ({ page }) => {
    await navigateTo(page, '/liquidity')

    await expect(
      page.locator('button').filter({ hasText: /V4 Pools/i }),
    ).toBeVisible()
    await expect(
      page.locator('button').filter({ hasText: /Cross-Chain XLP/i }),
    ).toBeVisible()
  })

  test('switches between V4 and XLP sections', async ({ page }) => {
    await navigateTo(page, '/liquidity')

    const xlpToggle = page
      .locator('button')
      .filter({ hasText: /Cross-Chain XLP/i })
    if (await xlpToggle.isVisible()) {
      await xlpToggle.click()
      await page.waitForTimeout(300)

      const body = await page.textContent('body')
      expect(
        body?.includes('XLP') ||
          body?.includes('Cross-chain') ||
          body?.includes('Supported Chains'),
      ).toBe(true)
    }

    const v4Toggle = page.locator('button').filter({ hasText: /V4 Pools/i })
    if (await v4Toggle.isVisible()) {
      await v4Toggle.click()
      await page.waitForTimeout(300)
    }
  })

  test('shows supported chains in XLP section', async ({ page }) => {
    await navigateTo(page, '/liquidity')

    const xlpToggle = page
      .locator('button')
      .filter({ hasText: /Cross-Chain XLP/i })
    if (await xlpToggle.isVisible()) {
      await xlpToggle.click()
      await page.waitForTimeout(300)

      const body = await page.textContent('body')
      const hasChains = [
        'Ethereum',
        'Base',
        'Arbitrum',
        'Optimism',
        'Network',
      ].some((chain) => body?.includes(chain))
      expect(hasChains).toBe(true)
    }
  })

  test('has form elements', async ({ page }) => {
    await navigateTo(page, '/liquidity')

    await expect(page.locator('select').first()).toBeVisible()
    await expect(page.locator('input[type="number"]').first()).toBeVisible()
  })

  test('shows user positions or sign in prompt', async ({ page }) => {
    await navigateTo(page, '/liquidity')
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(
      body?.includes('Position') ||
        body?.includes('No positions') ||
        body?.includes('Sign In') ||
        body?.includes('Use wallet or passkey'),
    ).toBe(true)
  })

  test('has token address inputs', async ({ page }) => {
    await navigateTo(page, '/liquidity')

    const token0Input = page.getByPlaceholder('0x...')
    if (await token0Input.first().isVisible()) {
      await token0Input
        .first()
        .fill('0x0000000000000000000000000000000000000001')
      await assertNoPageErrors(page)
    }
  })

  test('has price range inputs', async ({ page }) => {
    await navigateTo(page, '/liquidity')

    const minPriceInput = page.getByPlaceholder('0.0').first()
    const maxPriceInput = page.getByPlaceholder('0.0').nth(1)

    if (await minPriceInput.isVisible()) {
      await minPriceInput.fill('0.5')
    }
    if (await maxPriceInput.isVisible()) {
      await maxPriceInput.fill('2.0')
    }
    await assertNoPageErrors(page)
  })
})
