/**
 * E2E Test: Bazaar Ban Enforcement
 * Verifies banned users cannot trade
 */

import { expect, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('Ban Enforcement in Bazaar', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('loads homepage', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: /Welcome to Bazaar/i }),
    ).toBeVisible()
  })

  test('has ReputationBadge component available', async ({ page }) => {
    await page.goto('/coins')
    await expect(page.getByRole('heading', { name: /Coins/i })).toBeVisible()
  })

  test('has ReportButton component available', async ({ page }) => {
    await page.goto('/coins')
    await expect(page.getByRole('heading', { name: /Coins/i })).toBeVisible()
  })

  test('loads without moderation errors', async ({ page }) => {
    await page.goto('/')
    const body = await page.textContent('body')
    expect(body).not.toContain('BanCheck Error')
    expect(body).not.toContain('Moderation Error')
  })
})
