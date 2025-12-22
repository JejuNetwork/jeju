/**
 * Markets Page Tests
 * Tests prediction markets listing, filtering, search, and data verification
 */

import { assertNoPageErrors } from '@jejunetwork/tests/playwright-only'
import { expect, test } from '@playwright/test'

test.describe('Markets Page', () => {
  test('displays markets page without errors', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(500)

    await assertNoPageErrors(page)
    await expect(
      page.getByRole('heading', { name: /Prediction Markets/i }),
    ).toBeVisible()
    await expect(page.getByText(/Trade on real-world outcomes/i)).toBeVisible()
  })

  test('shows market stats', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(500)

    await assertNoPageErrors(page)
    await expect(page.getByText(/Total Volume/i)).toBeVisible()
    await expect(page.getByText(/Active Markets/i)).toBeVisible()
    await expect(page.getByText(/Total Markets/i)).toBeVisible()
  })

  test('has filter buttons', async ({ page }) => {
    await page.goto('/markets')

    await expect(
      page.getByRole('button', { name: /All Markets/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Active$/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /^Resolved$/i }),
    ).toBeVisible()
  })

  test('switches between filters', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(500)

    const activeButton = page.getByRole('button', { name: /^Active$/i })
    await activeButton.click()
    await expect(activeButton).toHaveClass(/bg-purple-600/)

    const allButton = page.getByRole('button', { name: /All Markets/i })
    await allButton.click()
    await expect(allButton).toHaveClass(/bg-purple-600/)
  })

  test('displays markets grid or appropriate state', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(3000)

    const grid = page.getByTestId('markets-grid')
    const loading = page.locator('.animate-spin')
    const errorMessage = page.getByText(/Failed to load markets/i)
    const noMarkets = page.getByText(/No Markets Found/i)

    const gridExists = await grid.isVisible()
    const loadingExists = await loading.isVisible()
    const errorExists = await errorMessage.isVisible()
    const noMarketsExists = await noMarkets.isVisible()

    expect(gridExists || loadingExists || errorExists || noMarketsExists).toBe(
      true,
    )
  })
})

test.describe('Markets Stats Verification', () => {
  test('market stats contain valid numeric values', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    await assertNoPageErrors(page)

    const totalVolumeElement = page
      .locator('div')
      .filter({ hasText: /Total Volume/i })
      .locator('div')
      .filter({ hasText: /ETH/ })
      .first()
    const activeMarketsElement = page
      .locator('div')
      .filter({ hasText: /Active Markets/i })
      .locator('.text-xl')
      .first()
    const totalMarketsElement = page
      .locator('div')
      .filter({ hasText: /Total Markets/i })
      .locator('.text-xl')
      .first()

    const volumeText = await totalVolumeElement.textContent()
    const activeText = await activeMarketsElement.textContent()
    const totalText = await totalMarketsElement.textContent()

    expect(volumeText).toMatch(/[\d,]+\.?\d*\s*ETH/)

    const activeMatch = activeText?.match(/\d+/)
    const totalMatch = totalText?.match(/\d+/)
    expect(activeMatch).toBeTruthy()
    expect(totalMatch).toBeTruthy()

    const activeCount = parseInt(activeMatch?.[0] ?? '0', 10)
    const totalCount = parseInt(totalMatch?.[0] ?? '0', 10)
    expect(activeCount).toBeLessThanOrEqual(totalCount)

    console.log('Markets stats:', {
      volume: volumeText,
      active: activeCount,
      total: totalCount,
    })
  })
})

test.describe('Markets Filtering', () => {
  test('filtering changes displayed markets', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    await assertNoPageErrors(page)

    await page.getByTestId('filter-all').click()
    await page.waitForTimeout(500)

    const allCards = page.getByTestId('market-card')
    const allCount = await allCards.count()

    await page.getByTestId('filter-active').click()
    await page.waitForTimeout(500)

    const activeCards = page.getByTestId('market-card')
    const activeCount = await activeCards.count()

    await page.getByTestId('filter-resolved').click()
    await page.waitForTimeout(500)

    const resolvedCards = page.getByTestId('market-card')
    const resolvedCount = await resolvedCards.count()

    console.log('Filter counts:', {
      all: allCount,
      active: activeCount,
      resolved: resolvedCount,
    })

    expect(allCount).toBeGreaterThanOrEqual(activeCount)
    expect(allCount).toBeGreaterThanOrEqual(resolvedCount)
  })
})

test.describe('Markets Search', () => {
  test('search filters markets correctly', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    await assertNoPageErrors(page)

    const searchInput = page.getByTestId('market-search')

    const allCards = page.getByTestId('market-card')
    const initialCount = await allCards.count()

    await searchInput.fill('XYZNONEXISTENTQUERYTHATSHOULDRTURNEMPTY123')
    await page.waitForTimeout(500)

    const afterSearchCards = page.getByTestId('market-card')
    const afterSearchCount = await afterSearchCards.count()

    console.log('Search filter:', {
      before: initialCount,
      after: afterSearchCount,
    })

    const emptyState = page.getByText(/No markets match your search/i)
    const emptyVisible = await emptyState.isVisible()

    expect(afterSearchCount === 0 || emptyVisible).toBe(true)
  })
})

test.describe('Market Card Data', () => {
  test('market cards display prices as percentages', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)
    await assertNoPageErrors(page)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      const firstCard = marketCards.first()
      const cardText = await firstCard.textContent()

      const hasPercentages = cardText?.match(/\d+\.?\d*%/)
      expect(hasPercentages).toBeTruthy()

      expect(cardText).toMatch(/YES/i)
      expect(cardText).toMatch(/NO/i)

      const yesMatch = cardText?.match(/YES.*?(\d+\.?\d*)%/i)
      const noMatch = cardText?.match(/NO.*?(\d+\.?\d*)%/i)

      if (yesMatch && noMatch) {
        const yesPercent = parseFloat(yesMatch[1])
        const noPercent = parseFloat(noMatch[1])

        expect(yesPercent).toBeGreaterThanOrEqual(0)
        expect(yesPercent).toBeLessThanOrEqual(100)
        expect(noPercent).toBeGreaterThanOrEqual(0)
        expect(noPercent).toBeLessThanOrEqual(100)

        const sum = yesPercent + noPercent
        expect(sum).toBeGreaterThan(95)
        expect(sum).toBeLessThan(105)
      }
    }
  })

  test('price bars add up to approximately 100%', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        const card = marketCards.nth(i)
        const cardText = await card.textContent()

        const yesMatch = cardText?.match(/YES.*?(\d+\.?\d*)%/i)
        const noMatch = cardText?.match(/NO.*?(\d+\.?\d*)%/i)

        if (yesMatch && noMatch) {
          const yesPercent = parseFloat(yesMatch[1])
          const noPercent = parseFloat(noMatch[1])

          const sum = yesPercent + noPercent
          expect(sum).toBeGreaterThan(98)
          expect(sum).toBeLessThan(102)

          console.log(
            `Market ${i}: YES ${yesPercent}% + NO ${noPercent}% = ${sum}%`,
          )
        }
      }
    }
  })

  test('market volume displays correctly', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    const marketCards = page.getByTestId('market-card')
    const count = await marketCards.count()

    if (count > 0) {
      const firstCard = marketCards.first()
      const cardText = await firstCard.textContent()

      const volumeMatch = cardText?.match(/Volume.*?([\d,]+\.?\d*)\s*ETH/i)

      if (volumeMatch) {
        const volume = parseFloat(volumeMatch[1].replace(/,/g, ''))
        expect(volume).toBeGreaterThanOrEqual(0)
        expect(Number.isNaN(volume)).toBe(false)
        console.log('Market volume:', volume, 'ETH')
      } else {
        expect(cardText).toMatch(/Volume/i)
      }
    }
  })

  test('resolved markets show outcome', async ({ page }) => {
    await page.goto('/markets')
    await page.waitForTimeout(2000)

    await page.getByTestId('filter-resolved').click()
    await page.waitForTimeout(500)

    const resolvedCards = page.getByTestId('market-card')
    const count = await resolvedCards.count()

    if (count > 0) {
      const firstResolved = resolvedCards.first()
      const cardText = await firstResolved.textContent()

      expect(cardText).toMatch(/Resolved/i)

      const hasOutcome = cardText?.match(/Outcome:?\s*(YES|NO)/i)
      if (hasOutcome) {
        console.log('Resolved market outcome:', hasOutcome[1])
        expect(['YES', 'NO']).toContain(hasOutcome[1])
      }
    }
  })
})

test.describe('Portfolio Page', () => {
  test('displays portfolio page', async ({ page }) => {
    await page.goto('/portfolio')

    await expect(
      page.getByRole('heading', { name: /Your Portfolio/i }),
    ).toBeVisible()
  })

  test('shows portfolio stats sections', async ({ page }) => {
    await page.goto('/portfolio')
    await page.waitForTimeout(500)

    const body = await page.textContent('body')
    expect(body).toMatch(/Total Value|Total P&L|Active Positions|Connect/i)
  })
})
