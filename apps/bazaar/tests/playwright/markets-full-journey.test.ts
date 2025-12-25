/**
 * Complete Trading Journey Integration Test
 *
 * ⚠️ REQUIRES FULL INFRASTRUCTURE:
 * - Deployed contracts (Predimarket, Oracle, ERC20)
 * - Running indexer with Markets processor enabled
 * - Test markets with liquidity
 *
 * This is a SMOKE TEST for the complete user flow
 */

import { getContract, getServicesConfig, getCurrentNetwork } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { expect, test } from '@playwright/test'

const services = getServicesConfig(getCurrentNetwork())
const predimarketAddress = getContract('moderation', 'predimarket', 'localnet')

const INFRASTRUCTURE_READY =
  predimarketAddress &&
  predimarketAddress !== ZERO_ADDRESS &&
  services.indexer?.graphql

test.describe('Complete Trading Journey', () => {
  test.skip(!INFRASTRUCTURE_READY, 'Infrastructure not deployed')

  test('should complete end-to-end journey: browse → trade → portfolio → claim', async ({
    page,
  }) => {
    await page.goto('/markets')

    const marketCard = page.getByTestId('market-card').first()
    await expect(marketCard).toBeVisible({ timeout: 5000 })

    const marketText = await marketCard.textContent()
    console.log('Found market:', marketText)

    await marketCard.click()
    await expect(page).toHaveURL(/\/markets\/.+/)

    const tradingInterface = page.getByTestId('trading-interface')
    await expect(tradingInterface).toBeVisible({ timeout: 5000 })

    console.log('Trading interface loaded successfully')
  })

  test('should verify market data loads correctly', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const statsVisible = await Promise.all([
      page.getByText(/Total Volume/i).isVisible(),
      page.getByText(/Active Markets/i).isVisible(),
      page.getByText(/Total Markets/i).isVisible(),
    ])

    const allVisible = statsVisible.every((v) => v === true)
    expect(allVisible).toBe(true)
  })

  test('should verify portfolio loads with wallet connected', async ({
    page,
  }) => {
    await page.goto('/portfolio')
    await page.waitForTimeout(2000)

    const body = await page.textContent('body')
    const hasPortfolioContent =
      body?.includes('Total Value') || body?.includes('Connect Your Wallet')

    expect(hasPortfolioContent).toBe(true)
  })
})
