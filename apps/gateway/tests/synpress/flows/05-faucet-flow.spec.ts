/**
 * @fileoverview Faucet Tab E2E Tests
 * Tests the JEJU faucet functionality for testnet token distribution
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Faucet Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display faucet tab in navigation', async ({ page }) => {
    const faucetTab = page.getByRole('button', { name: /Faucet/i });
    await expect(faucetTab).toBeVisible();
  });

  test('should navigate to faucet tab', async ({ page }) => {
    await page.getByRole('button', { name: /Faucet/i }).click();
    
    // Should show faucet info
    await expect(page.getByText(/JEJU Testnet Faucet/i)).toBeVisible();
    await expect(page.getByText(/Amount per claim/i)).toBeVisible();
    await expect(page.getByText(/Cooldown/i)).toBeVisible();
  });

  test('should display faucet configuration', async ({ page }) => {
    await page.getByRole('button', { name: /Faucet/i }).click();
    
    // Check for amount per claim
    await expect(page.getByText(/100 JEJU/i)).toBeVisible();
    
    // Check for cooldown period
    await expect(page.getByText(/12 hours/i)).toBeVisible();
    
    // Check for network info
    await expect(page.getByText(/Jeju/i)).toBeVisible();
  });

  test('should display registration requirements', async ({ page }) => {
    await page.getByRole('button', { name: /Faucet/i }).click();
    
    // Should show requirements
    await expect(page.getByText(/Requirements/i)).toBeVisible();
    await expect(page.getByText(/ERC-8004/i)).toBeVisible();
  });

  test('should show API access information', async ({ page }) => {
    await page.getByRole('button', { name: /Faucet/i }).click();
    
    // Should display API endpoints
    await expect(page.getByText(/API Access/i)).toBeVisible();
    await expect(page.getByText(/\/api\/faucet/i)).toBeVisible();
    await expect(page.getByText(/faucet-status/i)).toBeVisible();
    await expect(page.getByText(/faucet-claim/i)).toBeVisible();
  });
});

test.describe('Faucet with Connected Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await page.waitForTimeout(1000);
    
    await page.getByRole('button', { name: /Faucet/i }).click();
  });

  test('should display user status section', async ({ page }) => {
    await expect(page.getByText(/Your Status/i)).toBeVisible();
    await expect(page.getByText(/ERC-8004 Registry/i)).toBeVisible();
    await expect(page.getByText(/Cooldown/i)).toBeVisible();
    await expect(page.getByText(/Eligibility/i)).toBeVisible();
  });

  test('should show registration status', async ({ page }) => {
    // Should show either "Registered" or "Not Registered"
    const statusTexts = ['Registered', 'Not Registered'];
    const registryStatus = await page.locator('.flex.items-center.justify-between').filter({ hasText: /ERC-8004 Registry/i }).textContent();
    
    expect(statusTexts.some(s => registryStatus?.includes(s))).toBe(true);
  });

  test('should have claim button', async ({ page }) => {
    const claimButton = page.getByRole('button', { name: /Claim.*JEJU/i });
    await expect(claimButton).toBeVisible();
  });

  test('should have refresh button', async ({ page }) => {
    // Find the refresh button by its icon
    const refreshButton = page.locator('button').filter({ has: page.locator('svg.lucide-refresh-cw') });
    await expect(refreshButton.first()).toBeVisible();
  });

  test('should show registration warning if not registered', async ({ page }) => {
    // If user is not registered, should show warning
    const isNotRegistered = await page.getByText(/Not Registered/).isVisible().catch(() => false);
    
    if (isNotRegistered) {
      await expect(page.getByText(/Registration Required/i)).toBeVisible();
      await expect(page.getByText(/Go to Registry/i)).toBeVisible();
    }
  });
});

test.describe('Faucet Claim Flow', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await page.waitForTimeout(1000);
    
    await page.getByRole('button', { name: /Faucet/i }).click();
  });

  test('should disable claim button when not eligible', async ({ page }) => {
    // Wait for status to load
    await page.waitForTimeout(2000);
    
    const eligible = await page.getByText(/Eligible/).isVisible().catch(() => false);
    const notEligible = await page.getByText(/Not Eligible/).isVisible().catch(() => false);
    
    if (notEligible || !eligible) {
      const claimButton = page.getByRole('button', { name: /Claim.*JEJU/i });
      await expect(claimButton).toBeDisabled();
    }
  });

  test('should show faucet balance', async ({ page }) => {
    await expect(page.getByText(/Faucet Balance/i)).toBeVisible();
    // Should show a balance value
    const balanceSection = page.locator('.stat-card').filter({ hasText: /Faucet Balance/i });
    await expect(balanceSection).toBeVisible();
  });
});

test.describe('Faucet UI Responsiveness', () => {
  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Navigate to faucet
    await page.getByRole('button', { name: /Faucet/i }).click();
    
    // Cards should stack properly
    await expect(page.getByText(/JEJU Testnet Faucet/i)).toBeVisible();
    await expect(page.getByText(/API Access/i)).toBeVisible();
  });

  test('should be responsive on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    
    await page.getByRole('button', { name: /Faucet/i }).click();
    
    // All sections should be visible
    await expect(page.getByText(/JEJU Testnet Faucet/i)).toBeVisible();
    await expect(page.getByText(/Amount per claim/i)).toBeVisible();
  });
});
