/**
 * UI Screenshot Test - Captures every screen
 * This test runs WITHOUT needing deployed contracts
 * Just verifies UI renders and captures screenshots
 */

import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow as _captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4002';

test.describe('Gateway UI Screenshots - No Wallet Required', () => {
  test('capture all screens without wallet connection', async ({ page }) => {
    // Screenshot 1: Homepage (disconnected state)
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ 
      path: 'test-results/screenshots/00-01-homepage-disconnected.png', 
      fullPage: true 
    });
    console.log('📸 Screenshot 1: Homepage (disconnected)');
    
    // Verify page loaded (not blank)
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain('Gateway Portal');
    console.log(`✅ Page loaded with ${bodyText?.length} characters`);
    
    // Screenshot 2: Connect button visible
    await page.screenshot({ 
      path: 'test-results/screenshots/00-02-connect-prompt.png',
      fullPage: true
    });
    console.log('📸 Screenshot 2: Connect wallet prompt');
    
    // Verify connect button exists
    const connectButton = page.locator('button:has-text("Connect")');
    await expect(connectButton).toBeVisible();
  });
});

test.describe('Gateway Full UI Tour (No Transactions)', () => {
  test.skip('navigate entire UI and capture all screens', async ({ page }) => {
    // This test documents all screens but skips execution until contracts deployed
    // Un-skip when ready to capture everything
    
    await page.goto(GATEWAY_URL);
    
    const screens = [
      { name: 'Homepage', selector: 'body' },
      { name: 'Connect Modal', action: () => page.click('button:has-text("Connect")') },
      // Add more as needed
    ];
    
    let screenshotNum = 1;
    for (const screen of screens) {
      if (screen.action) await screen.action();
      await page.waitForTimeout(1000);
      await page.screenshot({ 
        path: `test-results/screenshots/ui-tour-${screenshotNum}-${screen.name.toLowerCase().replace(/\s+/g, '-')}.png`,
        fullPage: true
      });
      console.log(`📸 Screenshot ${screenshotNum}: ${screen.name}`);
      screenshotNum++;
    }
  });
});
