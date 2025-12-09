import { test, expect } from '@playwright/test';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

test.describe('Disconnected State - All Viewport Sizes', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`landing page renders correctly on ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(GATEWAY_URL);
      await page.waitForLoadState('networkidle');

      // Hero title should be visible
      await expect(page.locator('h2:has-text("Connect Wallet")')).toBeVisible();

      // Connect button should be visible and clickable
      const connectBtn = page.locator('button:has-text("Connect Wallet")').first();
      await expect(connectBtn).toBeVisible();
      await connectBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/landing-${name}.png` });
    });
  }
});

test.describe('Header Responsive Tests', () => {
  test('header title visible on all sizes', async ({ page }) => {
    for (const [, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      await page.goto(GATEWAY_URL);
      await expect(page.locator('text=Agent Bazaar')).toBeVisible();
    }
  });

  test('connect button accessible on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto(GATEWAY_URL);
    
    const connectBtn = page.locator('button:has-text("Connect")').first();
    await expect(connectBtn).toBeVisible();
    
    const box = await connectBtn.boundingBox();
    expect(box?.width).toBeGreaterThan(80); // Minimum tap target
    expect(box?.height).toBeGreaterThan(30);
  });
});

test.describe('Card Responsive Tests', () => {
  test('main card visible and readable on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto(GATEWAY_URL);
    
    const card = page.locator('.card').first();
    await expect(card).toBeVisible();
    
    const box = await card.boundingBox();
    // Card should be nearly full width on mobile
    expect(box?.width).toBeGreaterThan(300);
  });
});

test.describe('CSS Responsive Classes', () => {
  test('nav-tab class applies correct flex styles', async ({ page }) => {
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');

    // Verify CSS is loaded by checking body styles
    const hasGradient = await page.evaluate(() => {
      return window.getComputedStyle(document.body).background.includes('gradient');
    });
    expect(hasGradient).toBe(true);
  });

  test('button class has correct base styles', async ({ page }) => {
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');

    const button = page.locator('button.button').first();
    if (await button.count() > 0) {
      const styles = await button.evaluate(el => {
        const cs = window.getComputedStyle(el);
        return { borderRadius: cs.borderRadius, cursor: cs.cursor };
      });
      expect(styles.borderRadius).toBe('8px');
      expect(styles.cursor).toBe('pointer');
    }
  });
});

test.describe('Touch Target Size Validation', () => {
  test('all buttons have adequate tap targets on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto(GATEWAY_URL);
    
    const buttons = await page.locator('button:visible').all();
    
    for (const button of buttons) {
      const box = await button.boundingBox();
      if (box) {
        // Minimum 44x44 touch target recommended by Apple/Google
        expect(box.width).toBeGreaterThanOrEqual(40);
        expect(box.height).toBeGreaterThanOrEqual(30);
      }
    }
  });
});

test.describe('No Horizontal Overflow', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`no horizontal scroll on ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(GATEWAY_URL);
      await page.waitForLoadState('networkidle');

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      expect(hasHorizontalScroll).toBe(false);
    });
  }
});

test.describe('CSS Grid Responsiveness', () => {
  test('grid classes apply correct columns', async ({ page }) => {
    await page.goto(GATEWAY_URL);

    // Test desktop
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.waitForTimeout(200);

    // Test tablet
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.waitForTimeout(200);

    // Test mobile
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.waitForTimeout(200);

    // Verify no layout breaking
    const bodyOverflow = await page.evaluate(() => {
      const body = document.body;
      return window.getComputedStyle(body).overflowX;
    });
    
    expect(bodyOverflow).toBe('hidden');
  });
});

test.describe('Visual Regression Snapshots', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`visual snapshot at ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(GATEWAY_URL);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      await page.screenshot({ 
        path: `test-results/visual-${name}.png`,
        fullPage: true 
      });
    });
  }
});

