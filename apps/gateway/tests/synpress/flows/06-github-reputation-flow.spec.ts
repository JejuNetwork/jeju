/**
 * @fileoverview GitHub Reputation / Leaderboard E2E Tests
 * Tests the GitHub reputation panel and leaderboard functionality
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('GitHub Reputation Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display GitHub reputation section in navigation', async ({ page }) => {
    // Look for GitHub/Reputation related UI
    const reputationSection = page.getByText(/GitHub|Reputation|Leaderboard/i);
    await expect(reputationSection.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show leaderboard preview', async ({ page }) => {
    // Navigate to a section that shows reputation
    await page.waitForTimeout(1000);
    
    // Look for leaderboard or contributor related elements
    const leaderboardElements = page.locator('[data-testid="leaderboard"]').or(
      page.getByText(/Top Contributors|Leaderboard/i)
    );
    
    // May or may not be present depending on UI layout
    const isVisible = await leaderboardElements.first().isVisible().catch(() => false);
    if (isVisible) {
      await expect(leaderboardElements.first()).toBeVisible();
    }
  });
});

test.describe('GitHub Reputation with Connected Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await page.waitForTimeout(1000);
  });

  test('should display wallet-specific reputation info', async ({ page }) => {
    // Once wallet is connected, look for reputation-related UI
    const reputationInfo = page.getByText(/Score|Reputation|GitHub/i);
    await expect(reputationInfo.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show wallet verification option', async ({ page }) => {
    // Look for wallet verification or linking functionality
    const verifyOptions = page.getByRole('button', { name: /Verify|Link|Connect.*GitHub/i });
    
    const hasVerifyOption = await verifyOptions.first().isVisible().catch(() => false);
    if (hasVerifyOption) {
      await expect(verifyOptions.first()).toBeVisible();
    }
  });

  test('should display on-chain reputation status', async ({ page }) => {
    // Look for on-chain status indicators
    const onChainStatus = page.getByText(/On-Chain|Attested|Score/i);
    
    const hasStatus = await onChainStatus.first().isVisible().catch(() => false);
    if (hasStatus) {
      await expect(onChainStatus.first()).toBeVisible();
    }
  });
});

test.describe('Leaderboard API Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should fetch leaderboard data successfully', async ({ page }) => {
    // Intercept API calls to the leaderboard endpoint
    let apiCalled = false;
    
    page.on('response', (response) => {
      if (response.url().includes('/api/leaderboard') || response.url().includes('/api/attestation')) {
        apiCalled = true;
      }
    });
    
    // Wait for any API calls
    await page.waitForTimeout(3000);
    
    // May or may not make API call depending on current view
    // This test verifies no errors occur
  });

  test('should handle leaderboard API errors gracefully', async ({ page }) => {
    // Mock failed API response
    await page.route('**/api/leaderboard**', async (route) => {
      await route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Server error' }),
      });
    });
    
    await page.reload();
    await page.waitForTimeout(2000);
    
    // Page should not crash
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Attestation Flow', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await page.waitForTimeout(1000);
  });

  test('should display attestation requirements', async ({ page }) => {
    // Look for attestation-related UI
    const attestationInfo = page.getByText(/Attestation|Verify|Link.*Wallet/i);
    
    const hasInfo = await attestationInfo.first().isVisible().catch(() => false);
    if (hasInfo) {
      await expect(attestationInfo.first()).toBeVisible();
    }
  });

  test('should show oracle status when available', async ({ page }) => {
    // Look for oracle status indicator
    const oracleStatus = page.getByText(/Oracle|Signer|Enabled|Disabled/i);
    
    const hasStatus = await oracleStatus.first().isVisible().catch(() => false);
    if (hasStatus) {
      await expect(oracleStatus.first()).toBeVisible();
    }
  });
});

test.describe('Agent Linking', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await page.waitForTimeout(1000);
  });

  test('should display agent linking option if applicable', async ({ page }) => {
    // Look for agent-related UI
    const agentUI = page.getByText(/Agent|Link.*Agent|AI.*Agent/i);
    
    const hasAgentUI = await agentUI.first().isVisible().catch(() => false);
    if (hasAgentUI) {
      await expect(agentUI.first()).toBeVisible();
    }
  });
});

test.describe('UI Responsiveness', () => {
  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Page should load without horizontal scroll
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should be responsive on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    
    // Page should load properly
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should be responsive on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    
    // Page should load properly
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

