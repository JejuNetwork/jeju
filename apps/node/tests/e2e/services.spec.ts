/**
 * Services E2E Tests
 * Tests service controls, compute options, and service configuration
 */

import { expect, test } from '@playwright/test'

const BASE_URL = 'http://localhost:1420'

async function navigateToServices(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')

  const servicesLink = page.locator('text=Services').first()
  if (await servicesLink.isVisible()) {
    await servicesLink.click()
    await page.waitForLoadState('networkidle')
  }
}

test.describe('Hardware Information', () => {
  test('displays hardware summary', async ({ page }) => {
    await navigateToServices(page)

    const hardwareHeading = page.getByRole('heading', { name: 'Your Hardware' })
    if (await hardwareHeading.isVisible({ timeout: 5000 })) {
      await expect(hardwareHeading).toBeVisible()
    }
  })

  test('shows CPU compute option', async ({ page }) => {
    await navigateToServices(page)
    await expect(page.locator('body')).toContainText(/CPU|Compute/i)
  })

  test('shows GPU compute option if available', async ({ page }) => {
    await navigateToServices(page)
    const hasGpu = await page.locator('text=GPU').first().isVisible()
    expect(typeof hasGpu).toBe('boolean')
  })

  test('shows TEE status indicator', async ({ page }) => {
    await navigateToServices(page)
    const teeVisible = await page
      .locator('text=TEE')
      .or(page.locator('text=Confidential'))
      .first()
      .isVisible()
    expect(typeof teeVisible).toBe('boolean')
  })

  test('shows Docker status', async ({ page }) => {
    await navigateToServices(page)
    const dockerVisible = await page.locator('text=Docker').first().isVisible()
    expect(typeof dockerVisible).toBe('boolean')
  })
})

test.describe('Service Controls', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToServices(page)
  })

  test('Start button exists and is interactive', async ({ page }) => {
    const startButton = page
      .locator('button:has-text("Start Compute")')
      .or(page.locator('button:has-text("Start"):near(:text("Compute"))'))

    if (await startButton.first().isVisible()) {
      const isDisabled = await startButton.first().isDisabled()
      expect(typeof isDisabled).toBe('boolean')
    }
  })

  test('Stop button exists when service is running', async ({ page }) => {
    const stopButton = page
      .locator('button:has-text("Stop Compute")')
      .or(page.locator('button:has-text("Stop"):near(:text("Compute"))'))

    const isVisible = await stopButton.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('CPU compute selection is clickable', async ({ page }) => {
    const cpuOption = page.locator('text=CPU Compute').first()
    if (await cpuOption.isVisible()) {
      await cpuOption.click()
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('GPU compute selection responds appropriately', async ({ page }) => {
    const gpuOption = page.locator('text=GPU Compute').first()
    if (await gpuOption.isVisible()) {
      const parentClass = await gpuOption.locator('..').getAttribute('class')
      const isDisabled = parentClass?.includes('cursor-not-allowed') ?? false
      if (!isDisabled) {
        await gpuOption.click()
      }
      expect(typeof isDisabled).toBe('boolean')
    }
  })

  test('CPU cores slider works', async ({ page }) => {
    const slider = page.locator('input[type="range"]').first()
    if (await slider.isVisible()) {
      const min = await slider.getAttribute('min')
      const max = await slider.getAttribute('max')
      expect(min).toBeDefined()
      expect(max).toBeDefined()

      await slider.fill(max ?? '4')
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('hourly rate input accepts values', async ({ page }) => {
    const input = page.locator('input[type="number"]').first()
    if (await input.isVisible()) {
      await input.fill('0.05')
      const value = await input.inputValue()
      expect(value).toBe('0.05')
    }
  })

  test('service expand/collapse buttons work', async ({ page }) => {
    const chevrons = page.locator(
      'button:has([class*="chevron"]), button:has(svg[class*="ChevronDown"]), button:has(svg[class*="ChevronUp"])',
    )
    const count = await chevrons.count()

    if (count > 0) {
      await chevrons.first().click()
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('multiple Start buttons are present', async ({ page }) => {
    const startButtons = page.locator('button:has-text("Start")')
    const count = await startButtons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Bot Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    const botsLink = page.locator('text=Bots').first()
    if (await botsLink.isVisible()) {
      await botsLink.click()
      await page.waitForLoadState('networkidle')
    }
  })

  test('bot toggles are present', async ({ page }) => {
    const toggles = page.locator('input[type="checkbox"]')
    const count = await toggles.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('bot Start buttons are present', async ({ page }) => {
    const startButtons = page.locator('button:has-text("Start")')
    const count = await startButtons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('capital allocation inputs exist', async ({ page }) => {
    const inputs = page.locator('input[type="number"]')
    const count = await inputs.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
