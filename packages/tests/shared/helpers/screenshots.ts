import path from 'node:path'
import type { Page } from '@playwright/test'

/**
 * Screenshot helper utilities for network E2E tests
 *
 * These helpers ensure consistent screenshot capture across all tests
 * for visual verification and debugging.
 */

export interface ScreenshotOptions {
  /** App name (e.g., 'bazaar', 'gateway') */
  appName: string
  /** Feature being tested (e.g., 'swap', 'betting') */
  feature: string
  /** Step number or name (e.g., '01-initial', '02-filled-form') */
  step: string
  /** Whether to capture full page (default: true) */
  fullPage?: boolean
  /** Additional screenshot options */
  options?: {
    animations?: 'disabled' | 'allow'
  }
}

/**
 * Capture screenshot with standardized naming
 *
 * Usage:
 * ```typescript
 * await captureScreenshot(page, {
 *   appName: 'bazaar',
 *   feature: 'swap',
 *   step: '01-initial-state'
 * });
 * ```
 */
export async function captureScreenshot(
  page: Page,
  options: ScreenshotOptions,
): Promise<string> {
  const {
    appName,
    feature,
    step,
    fullPage = true,
    options: screenshotOpts = {},
  } = options

  const screenshotPath = getScreenshotPath(appName, feature, step)

  await page.screenshot({
    path: screenshotPath,
    fullPage,
    ...screenshotOpts,
  })

  console.log(`📸 Screenshot saved: ${screenshotPath}`)
  return screenshotPath
}

/**
 * Capture multiple screenshots in sequence
 *
 * Usage:
 * ```typescript
 * await captureScreenshots(page, 'bazaar', 'swap', [
 *   { step: '01-initial', action: async () => {} },
 *   { step: '02-filled', action: async () => {
 *     await page.fill('#amount', '100');
 *   }},
 *   { step: '03-confirmed', action: async () => {
 *     await page.click('[data-testid="confirm"]');
 *   }},
 * ]);
 * ```
 */
export async function captureScreenshots(
  page: Page,
  appName: string,
  feature: string,
  steps: Array<{
    step: string
    action?: () => Promise<void>
    fullPage?: boolean
  }>,
): Promise<string[]> {
  const screenshots: string[] = []

  for (const { step, action, fullPage = true } of steps) {
    // Execute action if provided
    if (action) {
      await action()
      // Wait for any animations/transitions
      await page.waitForTimeout(500)
    }

    // Capture screenshot
    const screenshotPath = await captureScreenshot(page, {
      appName,
      feature,
      step,
      fullPage,
    })

    screenshots.push(screenshotPath)
  }

  return screenshots
}

/**
 * Capture screenshot of user flow
 *
 * This is a convenience wrapper that captures initial state,
 * executes actions, and captures final state.
 *
 * Usage:
 * ```typescript
 * await captureUserFlow(page, {
 *   appName: 'bazaar',
 *   feature: 'swap',
 *   steps: [
 *     { name: 'initial', action: () => page.goto('/swap') },
 *     { name: 'filled', action: () => page.fill('#amount', '100') },
 *     { name: 'success', action: () => page.click('#swap-button') },
 *   ]
 * });
 * ```
 */
export async function captureUserFlow(
  page: Page,
  options: {
    appName: string
    feature: string
    steps: Array<{
      name: string
      action: () => Promise<void>
      waitFor?: string | number
    }>
  },
): Promise<string[]> {
  const { appName, feature, steps } = options
  const screenshots: string[] = []
  let stepNumber = 1

  for (const { name, action, waitFor } of steps) {
    // Execute action
    await action()

    // Wait if specified
    if (waitFor) {
      if (typeof waitFor === 'string') {
        await page.waitForSelector(waitFor)
      } else {
        await page.waitForTimeout(waitFor)
      }
    }

    // Small delay for UI to settle
    await page.waitForTimeout(300)

    // Capture screenshot
    const step = `${String(stepNumber).padStart(2, '0')}-${name}`
    const screenshotPath = await captureScreenshot(page, {
      appName,
      feature,
      step,
    })

    screenshots.push(screenshotPath)
    stepNumber++
  }

  console.log(
    `✅ Captured ${screenshots.length} screenshots for ${feature} flow`,
  )
  return screenshots
}

/**
 * Get standardized screenshot path
 */
export function getScreenshotPath(
  appName: string,
  feature: string,
  step: string,
): string {
  return path.join(
    'test-results',
    'screenshots',
    appName,
    feature,
    `${step}.png`,
  )
}
