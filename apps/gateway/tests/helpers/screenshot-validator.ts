/**
 * Screenshot validation helpers for E2E tests
 * Ensures screenshots are not blank/single color
 */

import type { Page } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * Take screenshot and validate it's not blank
 */
export async function takeValidatedScreenshot(
  page: Page,
  name: string,
  options?: {
    fullPage?: boolean
    expectedUrl?: string
    minColors?: number
  },
): Promise<Buffer> {
  const fullPage = options?.fullPage ?? false
  const minColors = options?.minColors ?? 10

  // Verify URL if specified
  if (options?.expectedUrl) {
    const currentUrl = page.url()
    if (!currentUrl.includes(options.expectedUrl)) {
      throw new Error(
        `Screenshot failed: Expected URL to contain '${options.expectedUrl}' but got '${currentUrl}'`,
      )
    }
  }

  // Take screenshot
  const screenshotBuffer = await page.screenshot({
    path: `test-results/screenshots/${name}.png`,
    fullPage,
  })

  // Validate screenshot is not blank/single color
  const isValid = await validateScreenshotHasContent(
    screenshotBuffer,
    minColors,
  )

  if (!isValid) {
    throw new Error(
      `Screenshot validation failed: '${name}' appears to be blank or single color. Page may not have loaded correctly.`,
    )
  }

  console.log(`✅ Screenshot validated: ${name}`)
  return screenshotBuffer
}

/**
 * Validate screenshot has sufficient color variation (not blank)
 */
async function validateScreenshotHasContent(
  imageBuffer: Buffer,
  minColors: number = 10,
): Promise<boolean> {
  const png = PNG.sync.read(imageBuffer)
  const colorSet = new Set<string>()

  for (let y = 0; y < png.height; y += 10) {
    for (let x = 0; x < png.width; x += 10) {
      const idx = (png.width * y + x) << 2
      const r = png.data[idx]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]

      colorSet.add(`${r},${g},${b}`)

      if (colorSet.size >= minColors) {
        return true
      }
    }
  }

  return colorSet.size >= minColors
}

/**
 * Assert page has loaded content (not blank white screen)
 */
export async function assertPageLoaded(
  page: Page,
  expectedText?: string,
): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const bodyText = await page.locator('body').textContent()

  if (!bodyText || bodyText.trim().length === 0) {
    throw new Error('Page appears blank - no text content in body')
  }

  if (expectedText && !bodyText.includes(expectedText)) {
    throw new Error(
      `Page missing expected text: "${expectedText}". Got: "${bodyText.substring(0, 200)}..."`,
    )
  }

  console.log(`✅ Page loaded with ${bodyText.length} characters`)
}

/**
 * Take screenshot with automatic validation
 */
export async function captureAndValidate(
  page: Page,
  testName: string,
  expectedContent?: string,
): Promise<void> {
  // Wait for page to be stable
  await assertPageLoaded(page, expectedContent)

  // Take screenshot
  await takeValidatedScreenshot(page, testName, {
    fullPage: true,
    expectedUrl: page.url(),
    minColors: 20, // Require at least 20 different colors
  })

  console.log(`✅ ${testName}: Screenshot captured and validated`)
}
