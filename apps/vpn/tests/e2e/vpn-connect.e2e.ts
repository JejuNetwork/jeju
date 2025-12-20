import { test, expect } from '@playwright/test';

test.describe('VPN App E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to load
    await page.waitForSelector('h1');
  });

  test('should display VPN app with disconnected state', async ({ page }) => {
    // Check header
    await expect(page.locator('h1')).toContainText('Jeju VPN');
    
    // Check status badge shows Disconnected
    await expect(page.getByText('Disconnected')).toBeVisible();
  });

  test('should display available nodes', async ({ page }) => {
    // Wait for nodes to load
    await page.waitForTimeout(500);
    
    // Should show node count in quick stats
    await expect(page.getByText('Nodes')).toBeVisible();
  });

  test('should connect to VPN', async ({ page }) => {
    // Find and click connect button (the large power button)
    const connectBtn = page.locator('button.w-32.h-32');
    await connectBtn.click();
    
    // Wait for connection (mock takes ~1.5s)
    await page.waitForTimeout(2500);
    
    // Status should change to Connected
    await expect(page.getByText('Protected')).toBeVisible();
    
    // Connection stats should appear
    await expect(page.getByText('Download')).toBeVisible();
    await expect(page.getByText('Upload')).toBeVisible();
  });

  test('should disconnect from VPN', async ({ page }) => {
    // First connect
    const connectBtn = page.locator('button.w-32.h-32');
    await connectBtn.click();
    await page.waitForTimeout(2500);
    
    // Should see Protected
    await expect(page.getByText('Protected')).toBeVisible();
    
    // Now disconnect (click again)
    await connectBtn.click();
    await page.waitForTimeout(1000);
    
    // Should be disconnected - look for "Tap to Connect" text
    await expect(page.getByText('Tap to Connect')).toBeVisible();
  });

  test('should switch to contribution tab', async ({ page }) => {
    // Click Contribute tab in bottom nav
    await page.locator('nav button').nth(1).click();
    
    // Should see contribution panel
    await expect(page.getByText('Fair Contribution')).toBeVisible();
  });

  test('should switch to settings tab', async ({ page }) => {
    // Click Settings tab in bottom nav
    await page.locator('nav button').nth(2).click();
    
    // Should see settings
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Kill Switch')).toBeVisible();
  });

  test('should show connection stats when connected', async ({ page }) => {
    // Connect first
    const connectBtn = page.locator('button.w-32.h-32');
    await connectBtn.click();
    await page.waitForTimeout(2500);
    
    // Check stats are visible
    await expect(page.getByText('Download')).toBeVisible();
    await expect(page.getByText('Duration')).toBeVisible();
    await expect(page.getByText('Latency')).toBeVisible();
    
    // Check connection card exists
    await expect(page.getByText('Connection')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
  });
});

test.describe('VPN Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1');
    // Go to settings tab
    await page.locator('nav button').nth(2).click();
    await page.waitForTimeout(200);
  });

  test('should show protocol options', async ({ page }) => {
    await expect(page.getByText('WireGuard')).toBeVisible();
    await expect(page.getByText('Recommended')).toBeVisible();
  });

  test('should show DNS options', async ({ page }) => {
    await expect(page.getByText('Cloudflare')).toBeVisible();
    await expect(page.getByText('1.1.1.1')).toBeVisible();
  });

  test('should show about section', async ({ page }) => {
    await expect(page.getByText('Version')).toBeVisible();
    await expect(page.getByText('0.1.0')).toBeVisible();
  });
});

test.describe('VPN Contribution Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1');
    // Go to contribution tab
    await page.locator('nav button').nth(1).click();
    await page.waitForTimeout(200);
  });

  test('should show adaptive bandwidth status', async ({ page }) => {
    await expect(page.getByText('Adaptive Bandwidth')).toBeVisible();
  });

  test('should show contribution quota', async ({ page }) => {
    await expect(page.getByText('Contribution Quota')).toBeVisible();
  });

  test('should show edge CDN cache status', async ({ page }) => {
    await expect(page.getByText('Edge CDN Cache')).toBeVisible();
  });

  test('should show contribution settings', async ({ page }) => {
    await expect(page.getByText('Auto Contribution')).toBeVisible();
    await expect(page.getByText('Earning Mode')).toBeVisible();
  });

  test('should show how fair sharing works', async ({ page }) => {
    await expect(page.getByText('How Fair Sharing Works')).toBeVisible();
  });
});
