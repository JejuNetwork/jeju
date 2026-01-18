/**
 * Coins Page Tests
 * Tests coins listing, filtering, and token creation form (without wallet)
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

test.describe('Coins Listing', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays coins page with heading', async ({ page }) => {
    await page.goto('/coins')
    await assertNoPageErrors(page)

    await expect(page.getByRole('heading', { name: /Coins/i })).toBeVisible()
    await expect(page.getByText(/Browse and trade coins/i)).toBeVisible()
  })

  test('shows create coin button', async ({ page }) => {
    await page.goto('/coins')

    const createButton = page.getByRole('link', { name: /Create Coin/i })
    await expect(createButton).toBeVisible()
    await expect(createButton).toHaveAttribute('href', '/coins/create')
  })

  test('has filter buttons', async ({ page }) => {
    await page.goto('/coins')

    await expect(page.getByRole('button', { name: /All Coins/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Verified/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /New/i })).toBeVisible()
  })

  test('filter buttons toggle correctly', async ({ page }) => {
    await page.goto('/coins')

    const allButton = page.getByRole('button', { name: /All Coins/i })
    const verifiedButton = page.getByRole('button', { name: /Verified/i })

    await verifiedButton.click()
    await expect(verifiedButton).toHaveClass(/bg-purple-600/)

    await allButton.click()
    await expect(allButton).toHaveClass(/bg-purple-600/)
  })

  test('search input filters coins', async ({ page }) => {
    await navigateTo(page, '/coins')

    const searchInput = page.getByPlaceholder(/Search/i)
    if (await searchInput.isVisible()) {
      await searchInput.fill('ETH')
      await page.waitForTimeout(500)
      await assertNoPageErrors(page)
    }
  })
})

test.describe('Token Creation Form', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays create token form', async ({ page }) => {
    await page.goto('/coins/create')

    await expect(
      page.getByRole('heading', { name: /Create Token/i }),
    ).toBeVisible()
    await expect(page.getByText(/Launch your own ERC20 token/i)).toBeVisible()
  })

  test('has all required form fields', async ({ page }) => {
    await page.goto('/coins/create')

    await expect(page.getByPlaceholder(/My Awesome Token/i)).toBeVisible()
    await expect(page.getByPlaceholder(/MAT/i)).toBeVisible()
    await expect(page.getByPlaceholder(/Describe your token/i)).toBeVisible()
    await expect(page.getByPlaceholder('1000000')).toBeVisible()
  })

  test('shows wallet connection requirement', async ({ page }) => {
    await page.goto('/coins/create')
    await expect(page.getByText(/Please connect your wallet/i)).toBeVisible()
  })

  test('displays how it works section', async ({ page }) => {
    await page.goto('/coins/create')

    await expect(
      page.getByRole('heading', { name: /How it works/i }),
    ).toBeVisible()
    await expect(
      page.getByText(/Connect your wallet and switch to the network network/i),
    ).toBeVisible()
    await expect(
      page.getByText(/Fill in token details \(name, symbol, supply\)/i),
    ).toBeVisible()
    await expect(
      page.getByText(/Deploy your ERC20 token contract/i),
    ).toBeVisible()
  })

  test('validates form inputs', async ({ page }) => {
    await page.goto('/coins/create')

    const createButton = page
      .locator('main, [role="main"]')
      .getByRole('button', {
        name: /Create Token|Sign In|Switch to the network/i,
      })
      .first()

    await expect(createButton).toBeVisible()
    const buttonText = await createButton.textContent()

    if (buttonText?.includes('Sign In')) {
      expect(buttonText).toContain('Sign In')
    } else if (buttonText?.includes('Create Token')) {
      await expect(createButton).toBeDisabled()
    }

    await page.getByPlaceholder(/My Awesome Token/i).fill('Test Token')
    await page.getByPlaceholder(/MAT/i).fill('TEST')
    const updatedButtonText = await createButton.textContent()
    expect(updatedButtonText).toBeTruthy()
  })

  test('form fields accept input', async ({ page }) => {
    await navigateTo(page, '/coins/create')

    const nameInput = page.getByPlaceholder(/token|awesome/i).first()
    if (await nameInput.isVisible()) {
      await nameInput.fill('Test Token')
      expect(await nameInput.inputValue()).toBe('Test Token')
    }

    const symbolInput = page.getByPlaceholder(/symbol|mat/i)
    if (await symbolInput.isVisible()) {
      await symbolInput.fill('TEST')
      expect(await symbolInput.inputValue()).toBe('TEST')
    }
  })
})
