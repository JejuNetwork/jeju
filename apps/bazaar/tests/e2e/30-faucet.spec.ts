import { test, expect } from '@playwright/test'
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/playwright-only'

test.describe('Bazaar Faucet', () => {
  test('should display faucet page with wallet connection prompt', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'faucet',
      steps: [
        {
          name: 'initial',
          action: async () => {
            await page.goto('/faucet')
          },
          waitFor: 1000,
        },
        {
          name: 'wallet-prompt',
          action: async () => {
            // Should show connect wallet message when not connected
            await expect(page.getByText(/JEJU Faucet/i)).toBeVisible()
            await expect(page.getByText(/Connect your wallet/i)).toBeVisible()
          },
        },
      ],
    })
  })

  test('should display faucet info correctly', async ({ page }) => {
    await page.goto('/faucet')

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'faucet',
      step: '01-initial',
    })

    // Check faucet title is visible
    await expect(page.getByText(/JEJU Faucet/i)).toBeVisible()

    // Check amount per claim stat exists
    await expect(page.getByText(/Amount per claim/i)).toBeVisible()
    await expect(page.getByText(/100 JEJU/i)).toBeVisible()

    // Check cooldown stat exists
    await expect(page.getByText(/Cooldown/i)).toBeVisible()
    await expect(page.getByText(/12 hours/i)).toBeVisible()

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'faucet',
      step: '02-info-displayed',
    })
  })

  test('should have faucet link on homepage', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'faucet-navigation',
      steps: [
        {
          name: 'homepage',
          action: async () => {
            await page.goto('/')
          },
          waitFor: 1000,
        },
        {
          name: 'faucet-link-visible',
          action: async () => {
            // Check faucet link exists on homepage
            await expect(page.getByRole('link', { name: /Faucet/i })).toBeVisible()
          },
        },
        {
          name: 'navigate-to-faucet',
          action: async () => {
            await page.getByRole('link', { name: /Faucet/i }).click()
          },
          waitFor: 1000,
        },
        {
          name: 'on-faucet-page',
          action: async () => {
            await expect(page).toHaveURL(/\/faucet/)
            await expect(page.getByText(/JEJU Faucet/i)).toBeVisible()
          },
        },
      ],
    })
  })

  test('should display developer API docs section', async ({ page }) => {
    await page.goto('/faucet')

    // Check API docs section exists
    await expect(page.getByText(/Developer API/i)).toBeVisible()

    // Click to expand API docs
    await page.getByText(/Developer API/i).click()

    // Check API endpoints are shown
    await expect(page.getByText(/\/api\/faucet\/status/i)).toBeVisible()
    await expect(page.getByText(/\/api\/faucet\/claim/i)).toBeVisible()
    await expect(page.getByText(/\/api\/faucet\/info/i)).toBeVisible()

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'faucet',
      step: '03-api-docs-expanded',
    })
  })

  test('should have back to home link', async ({ page }) => {
    await page.goto('/faucet')

    // Check back to home link
    await expect(page.getByRole('link', { name: /Back to Home/i })).toBeVisible()

    // Click and verify navigation
    await page.getByRole('link', { name: /Back to Home/i }).click()
    await expect(page).toHaveURL('/')
  })

  test('faucet API returns info endpoint', async ({ page }) => {
    // Test API directly
    const response = await page.request.get('/api/faucet/info')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.name).toContain('Faucet')
    expect(data.tokenSymbol).toBe('JEJU')
    expect(data.amountPerClaim).toBe('100')
    expect(data.cooldownHours).toBe(12)
    expect(data.chainId).toBeGreaterThan(0)
    expect(data.requirements).toHaveLength(2)
  })

  test('faucet API returns 400 for invalid address on status', async ({ page }) => {
    const response = await page.request.get('/api/faucet/status/invalid-address')
    expect(response.status()).toBe(400)

    const data = await response.json()
    expect(data.error).toBe('Invalid address format')
  })

  test('faucet API returns 400 for invalid claim request', async ({ page }) => {
    const response = await page.request.post('/api/faucet/claim', {
      data: { address: 'not-an-address' },
    })
    expect(response.status()).toBe(400)

    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain('Invalid')
  })

  test('faucet API returns 404 for unknown endpoint', async ({ page }) => {
    const response = await page.request.get('/api/faucet/unknown')
    expect(response.status()).toBe(404)
  })
})
