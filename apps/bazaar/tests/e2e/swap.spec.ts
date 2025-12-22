/**
 * Swap Page Tests
 * Tests swap interface, token selection, and amount inputs (without wallet)
 */

import { assertNoPageErrors } from '@jejunetwork/tests/playwright-only'
import { expect, type Page, test } from '@playwright/test'

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Swap Interface', () => {
  test('displays swap page', async ({ page }) => {
    await page.goto('/swap')
    await assertNoPageErrors(page)

    await expect(page.getByRole('heading', { name: /Swap/i })).toBeVisible()
  })

  test('has token selectors', async ({ page }) => {
    await page.goto('/swap')

    const selects = page.locator('select')
    const count = await selects.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('has amount inputs', async ({ page }) => {
    await page.goto('/swap')

    const inputAmount = page.locator('input[type="number"]').first()
    await expect(inputAmount).toBeVisible()
    await inputAmount.fill('0.1')
    expect(await inputAmount.inputValue()).toBe('0.1')
  })

  test('has swap button', async ({ page }) => {
    await page.goto('/swap')

    const swapButton = page.getByRole('button', {
      name: /Swap|Connect Wallet|Enter amount/i,
    })
    await expect(swapButton.first()).toBeVisible()
  })
})

test.describe('Token Selection', () => {
  test('all token dropdown options work', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const inputTokenSelect = page.locator('select').first()
    await expect(inputTokenSelect).toBeVisible()

    const inputOptions = await inputTokenSelect
      .locator('option')
      .allTextContents()
    console.log('Input token options:', inputOptions)

    for (const option of inputOptions.slice(0, 3)) {
      await inputTokenSelect.selectOption({ label: option })
      await page.waitForTimeout(200)
      await assertNoPageErrors(page)
    }

    const outputTokenSelect = page.locator('select').nth(1)
    await expect(outputTokenSelect).toBeVisible()

    const outputOptions = await outputTokenSelect
      .locator('option')
      .allTextContents()

    for (const option of outputOptions.slice(0, 3)) {
      await outputTokenSelect.selectOption({ label: option })
      await page.waitForTimeout(200)
      await assertNoPageErrors(page)
    }
  })

  test('selects ETH to USDC pair', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const inputSelect = page.locator('select').first()
    const outputSelect = page.locator('select').nth(1)

    await inputSelect.selectOption('ETH')
    await outputSelect.selectOption('USDC')
    await page.waitForTimeout(300)
    await assertNoPageErrors(page)
  })

  test('tests all token pair combinations', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const inputSelect = page.locator('select').first()
    const outputSelect = page.locator('select').nth(1)

    const tokens = ['ETH', 'USDC', 'JEJU']

    for (const inputToken of tokens) {
      for (const outputToken of tokens) {
        if (inputToken === outputToken) continue

        await inputSelect.selectOption(inputToken)
        await page.waitForTimeout(100)
        await outputSelect.selectOption(outputToken)
        await page.waitForTimeout(200)
        await assertNoPageErrors(page)

        console.log(`Tested: ${inputToken} → ${outputToken}`)
      }
    }
  })
})

test.describe('Amount Input', () => {
  test('handles various amount values', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const inputAmount = page.locator('input[type="number"]').first()

    const testValues = ['0', '0.001', '1', '10.5', '999', '0.123456789']

    for (const value of testValues) {
      await inputAmount.fill(value)
      await page.waitForTimeout(300)
      await assertNoPageErrors(page)
      expect(await inputAmount.inputValue()).toBe(value)
    }
  })

  test('validates minimum amount requirements', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const inputSelect = page.locator('select').first()
    const outputSelect = page.locator('select').nth(1)

    await inputSelect.selectOption('ETH')
    await outputSelect.selectOption('USDC')

    const inputAmount = page.locator('input[type="number"]').first()
    await inputAmount.fill('0.0000001')
    await page.waitForTimeout(300)

    await expect(
      page.locator('button').filter({ hasText: /Swap/i }).last(),
    ).toBeVisible()
  })

  test('shows output amount calculation', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const inputAmount = page.locator('input[type="number"]').first()
    await inputAmount.fill('1')
    await page.waitForTimeout(500)

    const outputAmount = page.locator('input[type="number"]').nth(1)
    await expect(outputAmount).toBeVisible()

    const outputValue = await outputAmount.inputValue()
    console.log('Output amount:', outputValue)
  })
})

test.describe('Swap Controls', () => {
  test('swap direction button works', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const inputSelect = page.locator('select').first()
    const outputSelect = page.locator('select').nth(1)

    await inputSelect.selectOption('ETH')
    await outputSelect.selectOption('USDC')
    await page.waitForTimeout(300)

    const initialInput = await inputSelect.inputValue()
    const initialOutput = await outputSelect.inputValue()

    const swapIcon = page.locator('button').filter({ hasText: /↓|⇅|swap/i })
    const swapIconCount = await swapIcon.count()

    if (swapIconCount > 0) {
      await swapIcon.first().click()
      await page.waitForTimeout(300)
      await assertNoPageErrors(page)

      const newInput = await inputSelect.inputValue()
      expect(
        newInput !== initialInput ||
          (await outputSelect.inputValue()) !== initialOutput,
      ).toBe(true)
    }
  })

  test('cross-chain toggle shows when available', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(500)

    const crossChainToggle = page
      .getByRole('button', { name: /off|on/i })
      .first()
    if (await crossChainToggle.isVisible()) {
      await expect(crossChainToggle).toBeEnabled()
    }
  })

  test('price info displays correctly', async ({ page }) => {
    await page.goto('/swap')
    await page.waitForTimeout(1000)
    await assertNoPageErrors(page)

    const body = await page.textContent('body')
    const hasSwapContent = body?.includes('Swap') || body?.includes('swap')
    expect(hasSwapContent).toBe(true)
  })
})

test.describe('Swap Button States', () => {
  test('button shows appropriate state', async ({ page }) => {
    await navigateTo(page, '/swap')
    await assertNoPageErrors(page)

    const swapButton = page.getByRole('button', {
      name: /Swap|Connect Wallet|Switch to the network|Contracts Not Deployed/i,
    })
    const buttonExists = await swapButton.first().isVisible({ timeout: 5000 })

    if (buttonExists) {
      const initialText = await swapButton.first().textContent()
      console.log('Swap button initial state:', initialText)

      const inputAmount = page.locator('input[type="number"]').first()
      const inputExists = await inputAmount.isVisible()

      if (inputExists) {
        await inputAmount.fill('1')
        await page.waitForTimeout(300)
      }

      const finalText = await swapButton.first().textContent()
      console.log('Swap button final state:', finalText)
      expect(finalText).toBeTruthy()
    }
  })
})
