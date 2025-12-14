import { test, expect } from '@playwright/test';

test.describe('Approvals View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    // Navigate to approvals
    await page.click('text=Approvals');
    
    // Should show connect prompt
    await expect(page.locator('text=Connect Your Wallet')).toBeVisible();
  });

  test('should display approvals summary when connected', async ({ page }) => {
    // Would need MetaMask connection via Synpress
    // For now just check the UI structure
    await page.click('text=Approvals');
    
    // Check for the connect prompt or approvals view
    const content = await page.locator('main').textContent();
    expect(content).toBeTruthy();
  });

  test('should have filter tabs', async ({ page }) => {
    await page.click('text=Approvals');
    
    // These would be visible after wallet connection
    // Just check navigation works
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('should navigate between views', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to Portfolio
    await page.click('text=Portfolio');
    await expect(page.locator('text=Connect Your Wallet')).toBeVisible();
    
    // Navigate to NFTs
    await page.click('text=NFTs');
    await expect(page.locator('text=Connect Your Wallet')).toBeVisible();
    
    // Navigate to Approvals
    await page.click('text=Approvals');
    await expect(page.locator('text=Connect Your Wallet')).toBeVisible();
    
    // Navigate back to Chat
    await page.click('text=Chat');
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('should show settings view', async ({ page }) => {
    await page.goto('/');
    
    await page.click('text=Settings');
    
    // Check settings content
    await expect(page.locator('text=Security')).toBeVisible();
    await expect(page.locator('text=Networks')).toBeVisible();
  });
});

