import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';

test.describe('Documentation Site', () => {
  test('should load homepage', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'documentation',
      feature: 'homepage',
      steps: [
        {
          name: 'initial',
          action: async () => {
            await page.goto('/');
          },
          waitFor: 1000,
        },
        {
          name: 'content-loaded',
          action: async () => {
            // Check for VitePress content
            await expect(page.locator('.VPContent, .content, main')).toBeVisible();
          },
        },
      ],
    });
  });

  test('should navigate to different sections', async ({ page }) => {
    await page.goto('/');

    await captureScreenshot(page, {
      appName: 'documentation',
      feature: 'navigation',
      step: '01-homepage',
    });

    // Check sidebar navigation exists
    const sidebar = page.locator('.VPSidebar, .sidebar, nav');
    await expect(sidebar).toBeVisible();

    await captureScreenshot(page, {
      appName: 'documentation',
      feature: 'navigation',
      step: '02-sidebar-visible',
    });
  });

  test('should display navigation menu', async ({ page }) => {
    await page.goto('/');

    // Wait for page load
    await page.waitForTimeout(1000);

    await captureScreenshot(page, {
      appName: 'documentation',
      feature: 'menu',
      step: '01-menu-loaded',
    });

    // VitePress should have navigation
    const hasNav = await page.locator('nav, .nav, .VPNav').count();
    expect(hasNav).toBeGreaterThan(0);
  });

  test('should be mobile responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await captureScreenshot(page, {
      appName: 'documentation',
      feature: 'responsive',
      step: '01-mobile',
    });

    // Content should still be visible
    await expect(page.locator('.VPContent, .content, main')).toBeVisible();

    // Test tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    await captureScreenshot(page, {
      appName: 'documentation',
      feature: 'responsive',
      step: '02-tablet',
    });

    // Desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    await captureScreenshot(page, {
      appName: 'documentation',
      feature: 'responsive',
      step: '03-desktop',
    });
  });
});
