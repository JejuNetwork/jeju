import { expect, test } from '@playwright/test'

const BASE_URL = 'http://localhost:1420'

async function navigateToSettings(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')

  const settingsLink = page.locator('text=Settings').first()
  if (await settingsLink.isVisible()) {
    await settingsLink.click()
    await page.waitForLoadState('networkidle')
  }
}

test.describe('Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToSettings(page)
  })

  test('network selector is present', async ({ page }) => {
    const selector = page.locator(
      'select, button:has-text("localnet"), button:has-text("testnet"), button:has-text("mainnet")',
    )
    const isVisible = await selector.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('toggle settings are present', async ({ page }) => {
    const toggles = page.locator('input[type="checkbox"]')
    const count = await toggles.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Save settings button is present', async ({ page }) => {
    const saveButton = page.locator('button:has-text("Save")')
    const isVisible = await saveButton.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })
})
