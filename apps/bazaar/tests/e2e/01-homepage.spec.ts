import { test, expect } from '@playwright/test'
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/playwright-only'

test.describe('Bazaar Homepage', () => {
  test('should display homepage with all features', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'homepage',
      steps: [
        {
          name: 'initial',
          action: async () => {
            await page.goto('/')
          },
          waitFor: 1000,
        },
        {
          name: 'features-visible',
          action: async () => {
            // Check title
            await expect(page.getByRole('heading', { name: /^Bazaar$/i })).toBeVisible()

            // Check feature links on homepage cards
            await expect(page.getByRole('link', { name: /Coins/i }).first()).toBeVisible()
            await expect(page.getByRole('link', { name: /Swap/i }).first()).toBeVisible()
            await expect(page.getByRole('link', { name: /Pools/i }).first()).toBeVisible()
            await expect(page.getByRole('link', { name: /Predict/i }).first()).toBeVisible()
            await expect(page.getByRole('link', { name: /NFTs/i }).first()).toBeVisible()
          },
        },
      ],
    })
  })

  test('should navigate to tokens page', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'navigation',
      steps: [
        {
          name: 'homepage',
          action: async () => {
            await page.goto('/')
          },
        },
        {
          name: 'click-tokens',
          action: async () => {
            // Click on Tokens card
            await page.getByRole('link', { name: /Coins/i }).first().click()
          },
          waitFor: 1000,
        },
        {
          name: 'tokens-page',
          action: async () => {
            // Should be on tokens page
            await expect(page).toHaveURL(/\/coins/)
            await expect(page.getByRole('heading', { name: /Coins/i }).first()).toBeVisible()
          },
        },
      ],
    })
  })

  test('should display navigation menu', async ({ page }) => {
    await page.goto('/')

    // Capture initial state
    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'navigation-menu',
      step: '01-initial',
    })

    // Check navigation items
    await expect(page.getByRole('link', { name: /^Home$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Coins$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Swap$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Pools$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Predict$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^NFTs$/i })).toBeVisible()

    // Capture final state with all nav items visible
    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'navigation-menu',
      step: '02-all-items-visible',
    })
  })
})
