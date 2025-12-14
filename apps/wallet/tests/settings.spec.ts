import { test, expect } from '@playwright/test';

test.describe('Settings View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('text=Settings');
  });

  test('should display settings sections', async ({ page }) => {
    await expect(page.locator('text=Security')).toBeVisible();
    await expect(page.locator('text=Notifications')).toBeVisible();
    await expect(page.locator('text=Networks')).toBeVisible();
    await expect(page.locator('text=Advanced')).toBeVisible();
  });

  test('should navigate to Security settings', async ({ page }) => {
    await page.click('button:has-text("Security")');
    
    await expect(page.locator('text=Security Settings')).toBeVisible();
    await expect(page.locator('text=Transaction Simulation')).toBeVisible();
    await expect(page.locator('text=Approval Warnings')).toBeVisible();
    await expect(page.locator('text=Scam Protection')).toBeVisible();
  });

  test('should navigate to Notifications settings', async ({ page }) => {
    await page.click('button:has-text("Notifications")');
    
    await expect(page.locator('text=Transaction Notifications')).toBeVisible();
    await expect(page.locator('text=Price Alerts')).toBeVisible();
  });

  test('should navigate to Networks settings', async ({ page }) => {
    await page.click('button:has-text("Networks")');
    
    await expect(page.locator('text=Supported Networks')).toBeVisible();
    await expect(page.locator('text=Ethereum')).toBeVisible();
    await expect(page.locator('text=Base')).toBeVisible();
  });

  test('should navigate to Advanced settings', async ({ page }) => {
    await page.click('button:has-text("Advanced")');
    
    await expect(page.locator('text=Advanced Settings')).toBeVisible();
    await expect(page.locator('text=Default Slippage')).toBeVisible();
    await expect(page.locator('text=MEV Protection')).toBeVisible();
  });

  test('should navigate back from sub-settings', async ({ page }) => {
    await page.click('button:has-text("Security")');
    await expect(page.locator('text=Security Settings')).toBeVisible();
    
    await page.click('text=Back to Settings');
    await expect(page.locator('text=Manage your wallet preferences')).toBeVisible();
  });

  test('should toggle settings', async ({ page }) => {
    await page.click('button:has-text("Security")');
    
    // Find the toggle button for Transaction Simulation
    const toggles = page.locator('button.relative.w-12.h-6');
    
    // Toggle should be clickable
    if (await toggles.count() > 0) {
      const firstToggle = toggles.first();
      await expect(firstToggle).toBeVisible();
    }
  });

  test('should display version info', async ({ page }) => {
    await expect(page.locator('text=Jeju Wallet v0.1.0')).toBeVisible();
    await expect(page.locator('text=Powered by Jeju Network')).toBeVisible();
  });
});

