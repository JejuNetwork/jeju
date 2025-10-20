import { Page } from '@playwright/test';
import path from 'path';

/**
 * Screenshot helper utilities for Jeju E2E tests
 *
 * These helpers ensure consistent screenshot capture across all tests
 * for visual verification and debugging.
 */

export interface ScreenshotOptions {
  /** App name (e.g., 'bazaar', 'gateway') */
  appName: string;
  /** Feature being tested (e.g., 'swap', 'betting') */
  feature: string;
  /** Step number or name (e.g., '01-initial', '02-filled-form') */
  step: string;
  /** Whether to capture full page (default: true) */
  fullPage?: boolean;
  /** Additional screenshot options */
  options?: {
    mask?: string[];
    animations?: 'disabled' | 'allow';
  };
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
  options: ScreenshotOptions
): Promise<string> {
  const {
    appName,
    feature,
    step,
    fullPage = true,
    options: screenshotOpts = {}
  } = options;

  const screenshotPath = getScreenshotPath(appName, feature, step);

  await page.screenshot({
    path: screenshotPath,
    fullPage,
    ...screenshotOpts,
  });

  console.log(`📸 Screenshot saved: ${screenshotPath}`);
  return screenshotPath;
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
    step: string;
    action?: () => Promise<void>;
    fullPage?: boolean;
  }>
): Promise<string[]> {
  const screenshots: string[] = [];

  for (const { step, action, fullPage = true } of steps) {
    // Execute action if provided
    if (action) {
      await action();
      // Wait for any animations/transitions
      await page.waitForTimeout(500);
    }

    // Capture screenshot
    const screenshotPath = await captureScreenshot(page, {
      appName,
      feature,
      step,
      fullPage,
    });

    screenshots.push(screenshotPath);
  }

  return screenshots;
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
    appName: string;
    feature: string;
    steps: Array<{
      name: string;
      action: () => Promise<void>;
      waitFor?: string | number;
    }>;
  }
): Promise<string[]> {
  const { appName, feature, steps } = options;
  const screenshots: string[] = [];
  let stepNumber = 1;

  for (const { name, action, waitFor } of steps) {
    // Execute action
    await action();

    // Wait if specified
    if (waitFor) {
      if (typeof waitFor === 'string') {
        await page.waitForSelector(waitFor);
      } else {
        await page.waitForTimeout(waitFor);
      }
    }

    // Small delay for UI to settle
    await page.waitForTimeout(300);

    // Capture screenshot
    const step = `${String(stepNumber).padStart(2, '0')}-${name}`;
    const screenshotPath = await captureScreenshot(page, {
      appName,
      feature,
      step,
    });

    screenshots.push(screenshotPath);
    stepNumber++;
  }

  console.log(`✅ Captured ${screenshots.length} screenshots for ${feature} flow`);
  return screenshots;
}

/**
 * Capture wallet interaction screenshots
 *
 * Special helper for wallet-based tests that need to capture
 * wallet popup states.
 */
export async function captureWalletFlow(
  page: Page,
  walletPage: Page,
  options: {
    appName: string;
    feature: string;
    beforeApproval: string;
    afterApproval: string;
  }
): Promise<{ app: string[]; wallet: string[] }> {
  const { appName, feature, beforeApproval, afterApproval } = options;

  // Capture app state before approval
  const appBefore = await captureScreenshot(page, {
    appName,
    feature,
    step: beforeApproval,
  });

  // Capture wallet popup (if visible)
  const walletScreenshots: string[] = [];
  try {
    if (await walletPage.isVisible()) {
      const walletShot = await captureScreenshot(walletPage, {
        appName,
        feature,
        step: `${beforeApproval}-wallet`,
      });
      walletScreenshots.push(walletShot);
    }
  } catch (e) {
    console.warn('Could not capture wallet screenshot:', e);
  }

  // Wait for approval to complete
  await page.waitForTimeout(1000);

  // Capture app state after approval
  const appAfter = await captureScreenshot(page, {
    appName,
    feature,
    step: afterApproval,
  });

  return {
    app: [appBefore, appAfter],
    wallet: walletScreenshots,
  };
}

/**
 * Get standardized screenshot path
 */
export function getScreenshotPath(
  appName: string,
  feature: string,
  step: string
): string {
  return path.join(
    'test-results',
    'screenshots',
    appName,
    feature,
    `${step}.png`
  );
}

/**
 * Capture responsive screenshots (multiple viewports)
 *
 * Usage:
 * ```typescript
 * await captureResponsiveScreenshots(page, {
 *   appName: 'bazaar',
 *   feature: 'homepage',
 *   step: 'initial',
 *   viewports: [
 *     { name: 'mobile', width: 375, height: 667 },
 *     { name: 'tablet', width: 768, height: 1024 },
 *     { name: 'desktop', width: 1920, height: 1080 },
 *   ]
 * });
 * ```
 */
export async function captureResponsiveScreenshots(
  page: Page,
  options: {
    appName: string;
    feature: string;
    step: string;
    viewports?: Array<{ name: string; width: number; height: number }>;
  }
): Promise<Record<string, string>> {
  const {
    appName,
    feature,
    step,
    viewports = [
      { name: 'mobile', width: 375, height: 667 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1920, height: 1080 },
    ],
  } = options;

  const screenshots: Record<string, string> = {};

  for (const viewport of viewports) {
    // Set viewport
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    // Wait for layout to stabilize
    await page.waitForTimeout(500);

    // Capture screenshot
    const screenshotPath = await captureScreenshot(page, {
      appName,
      feature,
      step: `${step}-${viewport.name}`,
    });

    screenshots[viewport.name] = screenshotPath;
  }

  return screenshots;
}

/**
 * Helper to ensure test results directory exists
 */
export async function ensureScreenshotDir(
  appName: string,
  feature: string
): Promise<string> {
  const dir = path.join('test-results', 'screenshots', appName, feature);
  // Directory will be created automatically by Playwright
  return dir;
}
