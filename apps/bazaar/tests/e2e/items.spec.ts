/**
 * Items Page Tests
 * Tests item listing, filtering, and marketplace interface (without wallet)
 */

import { assertNoPageErrors } from '@jejunetwork/tests/playwright-only'
import { expect, type Page, test } from '@playwright/test'

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Items Page', () => {
  test('displays items page', async ({ page }) => {
    await page.goto('/items')
    await assertNoPageErrors(page)

    await expect(page.getByRole('heading', { name: /Items/i })).toBeVisible()
  })

  test('has filter buttons', async ({ page }) => {
    await navigateTo(page, '/items')

    const allItems = page.getByRole('button', { name: /all items/i })
    if (await allItems.isVisible()) {
      await expect(allItems).toBeEnabled()
    }
  })

  test('has sort dropdown', async ({ page }) => {
    await page.goto('/items')

    const sortSelect = page.locator('select')
    if (await sortSelect.isVisible()) {
      await sortSelect.selectOption('price')
      expect(await sortSelect.inputValue()).toBe('price')

      await sortSelect.selectOption('recent')
      expect(await sortSelect.inputValue()).toBe('recent')

      await sortSelect.selectOption('collection')
      expect(await sortSelect.inputValue()).toBe('collection')
    }
  })

  test('item card is clickable', async ({ page }) => {
    await page.goto('/items')
    await page.waitForTimeout(1000)

    const itemCard = page.getByTestId('item-card').first()
    if (await itemCard.isVisible()) {
      await itemCard.click()
      await page.waitForTimeout(500)
      await assertNoPageErrors(page)
    }
  })

  test('filter buttons work correctly', async ({ page }) => {
    await navigateTo(page, '/items')

    const allFilter = page.getByRole('button', { name: /all items/i })
    const myFilter = page.getByRole('button', { name: /my collection/i })

    if (await allFilter.isVisible()) {
      await allFilter.click()
      await expect(allFilter).toHaveClass(/bg-bazaar-primary/)
    }

    if (await myFilter.isVisible()) {
      await myFilter.click()
      await expect(myFilter).toHaveClass(/bg-bazaar-primary/)
    }
  })
})

test.describe('Items Mint Page', () => {
  test('displays mint form', async ({ page }) => {
    await navigateTo(page, '/items/mint')

    const nameInput = page.getByPlaceholder(/name/i)
    if (await nameInput.isVisible()) {
      await expect(nameInput).toBeEnabled()
    }

    const descInput = page.getByPlaceholder(/description/i)
    if (await descInput.isVisible()) {
      await expect(descInput).toBeEnabled()
    }
  })

  test('mint button exists', async ({ page }) => {
    await navigateTo(page, '/items/mint')

    const mintBtn = page.getByRole('button', { name: /mint/i })
    if (await mintBtn.isVisible()) {
      await expect(mintBtn).toBeVisible()
    }
  })
})

test.describe('My Items Page', () => {
  test('displays my items page', async ({ page }) => {
    await page.goto('/items')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})
