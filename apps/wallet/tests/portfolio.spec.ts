/**
 * Portfolio View E2E Tests
 * Tests the unified multi-chain portfolio view
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { PASSWORD } from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Portfolio View - Not Connected', () => {
  test('should show connect wallet prompt', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to portfolio
    const portfolioButton = page.locator('button:has-text("Portfolio")');
    await portfolioButton.click();
    
    await expect(page.locator('text=Connect Your Wallet')).toBeVisible();
    await expect(page.locator('text=/unified portfolio/i')).toBeVisible();
  });
});

test.describe('Portfolio View - Connected', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
    
    // Navigate to portfolio
    const portfolioButton = page.locator('button:has-text("Portfolio")');
    await portfolioButton.click();
    await page.waitForTimeout(500);
  });

  test('should show unified portfolio header', async ({ page }) => {
    await expect(page.locator('text=Unified Portfolio')).toBeVisible();
    await expect(page.locator('text=All chains')).toBeVisible();
  });

  test('should display wallet address in portfolio', async ({ page }) => {
    const addressDisplay = page.locator('text=/0x[a-fA-F0-9]+\\.\\.\\.[a-fA-F0-9]+/');
    await expect(addressDisplay.first()).toBeVisible();
  });

  test('should show total portfolio value card', async ({ page }) => {
    await expect(page.locator('text=Total Portfolio Value')).toBeVisible();
    // Should show some ETH value
    await expect(page.locator('text=/\\d+\\.\\d+ ETH/i')).toBeVisible();
  });

  test('should have refresh button', async ({ page }) => {
    const refreshButton = page.locator('button:has-text("Refresh")');
    await expect(refreshButton).toBeVisible();
    await expect(refreshButton).toBeEnabled();
  });

  test('should refresh balances when clicking refresh', async ({ page }) => {
    const refreshButton = page.locator('button:has-text("Refresh")');
    await refreshButton.click();
    
    // Refresh icon should spin
    const spinningIcon = page.locator('.animate-spin');
    await expect(spinningIcon.first()).toBeVisible();
  });

  test('should show Token Balances section', async ({ page }) => {
    await expect(page.locator('text=Token Balances')).toBeVisible();
  });

  test('should show feature cards', async ({ page }) => {
    await expect(page.locator('text=Jeju Features')).toBeVisible();
    await expect(page.locator('text=Bridgeless')).toBeVisible();
    await expect(page.locator('text=Multi-Chain')).toBeVisible();
    await expect(page.locator('text=AI Agent')).toBeVisible();
    await expect(page.locator('text=Secure')).toBeVisible();
  });

  test('should show "Aggregated across all chains" text', async ({ page }) => {
    await expect(page.locator('text=/Aggregated across all chains/i')).toBeVisible();
  });
});

test.describe('Portfolio - View Switching', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
  });

  test('should switch from Chat to Portfolio', async ({ page }) => {
    // Start in chat
    await expect(page.locator('textarea')).toBeVisible();
    
    // Switch to portfolio
    await page.locator('button:has-text("Portfolio")').click();
    await page.waitForTimeout(300);
    
    // Should show portfolio content
    await expect(page.locator('text=Unified Portfolio')).toBeVisible();
  });

  test('should switch from Portfolio back to Chat', async ({ page }) => {
    // Go to portfolio first
    await page.locator('button:has-text("Portfolio")').click();
    await page.waitForTimeout(300);
    
    // Switch back to chat
    await page.locator('button:has-text("Chat")').click();
    await page.waitForTimeout(300);
    
    // Should show chat input
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('should maintain wallet connection when switching views', async ({ page }) => {
    // Check connection in chat
    await expect(page.locator('button:has-text("Disconnect")')).toBeVisible();
    
    // Switch to portfolio
    await page.locator('button:has-text("Portfolio")').click();
    await page.waitForTimeout(300);
    
    // Should still be connected
    await expect(page.locator('button:has-text("Disconnect")')).toBeVisible();
    
    // Switch back to chat
    await page.locator('button:has-text("Chat")').click();
    await page.waitForTimeout(300);
    
    // Should still be connected
    await expect(page.locator('button:has-text("Disconnect")')).toBeVisible();
  });
});

test.describe('Portfolio - Sidebar Balance', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
  });

  test('should show total balance in sidebar', async ({ page }) => {
    await expect(page.locator('text=Total Balance')).toBeVisible();
  });

  test('should show token count in sidebar', async ({ page }) => {
    await expect(page.locator('text=/\\d+ tokens? across chains/i')).toBeVisible();
  });

  test('should have refresh button in sidebar balance', async ({ page }) => {
    // Find refresh button near Total Balance
    const balanceSection = page.locator('text=Total Balance').locator('..');
    const refreshButton = balanceSection.locator('button');
    await expect(refreshButton.first()).toBeVisible();
  });
});

