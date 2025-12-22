import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Factory App - Basic Tests', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('text=Factory')).toBeVisible();
    await expect(page.locator('text=Developer Hub')).toBeVisible();
  });

  test('should navigate to bounties page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Bounties');
    
    await expect(page).toHaveURL('/bounties');
    await expect(page.locator('h1:has-text("Bounties")')).toBeVisible();
  });

  test('should navigate to feed page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Feed');
    
    await expect(page).toHaveURL('/feed');
    await expect(page.locator('h1:has-text("Factory Feed")')).toBeVisible();
  });

  test('should navigate to models page', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Models');
    
    await expect(page).toHaveURL('/models');
    await expect(page.locator('h1:has-text("Model Hub")')).toBeVisible();
  });

  test('should connect wallet', async ({ page, context, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    
    // Click connect button
    await page.click('button:has-text("Connect Wallet")');
    
    // Connect MetaMask
    await metamask.connectToDapp();
    
    // Verify connection (address should be visible)
    await expect(page.locator('text=0xf39')).toBeVisible({ timeout: 10000 });
  });

  test('should filter bounties by status', async ({ page }) => {
    await page.goto('/bounties');
    
    // Click on "Open" filter
    await page.click('button:has-text("Open")');
    
    // All visible bounties should have "Open" status
    const openBadges = page.locator('.badge-success:has-text("Open")');
    const count = await openBadges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should search bounties', async ({ page }) => {
    await page.goto('/bounties');
    
    // Type in search
    await page.fill('input[placeholder="Search bounties..."]', 'ZK');
    
    // Should show ZK-related bounty
    await expect(page.locator('text=ZK proof')).toBeVisible();
  });

  test('should show model details', async ({ page }) => {
    await page.goto('/models');
    
    // Click on first model
    await page.click('text=llama-3-jeju-ft');
    
    // Should navigate to model page
    await expect(page).toHaveURL(/\/models\/jeju\/llama-3-jeju-ft/);
  });
});

