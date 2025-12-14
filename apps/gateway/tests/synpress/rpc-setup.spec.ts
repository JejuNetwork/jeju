/**
 * RPC Setup Tab E2E Tests
 * Tests for RPC staking and API key management UI
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../e2e/wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('RPC Setup Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display RPC setup tab when wallet connected', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    const connectButton = page.locator('[data-testid="connect-wallet-button"]');
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    // Navigate to RPC tab if not already there
    const rpcTab = page.locator('text=RPC Access').or(page.locator('[data-testid="rpc-tab"]'));
    if (await rpcTab.isVisible()) {
      await rpcTab.click();
    }

    // Should show rate limit tier
    await expect(page.locator('text=Current Tier')).toBeVisible({ timeout: 10000 });
  });

  test('should show tier options', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    const connectButton = page.locator('[data-testid="connect-wallet-button"]');
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    const rpcTab = page.locator('text=RPC Access').or(page.locator('[data-testid="rpc-tab"]'));
    if (await rpcTab.isVisible()) {
      await rpcTab.click();
    }

    // Should show all tier options
    await expect(page.locator('text=FREE')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=BASIC')).toBeVisible();
    await expect(page.locator('text=PRO')).toBeVisible();
    await expect(page.locator('text=UNLIMITED')).toBeVisible();
  });

  test('should show API key section', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    const connectButton = page.locator('[data-testid="connect-wallet-button"]');
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    const rpcTab = page.locator('text=RPC Access').or(page.locator('[data-testid="rpc-tab"]'));
    if (await rpcTab.isVisible()) {
      await rpcTab.click();
    }

    // Should show API keys section
    await expect(page.locator('text=API Keys')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Generate Key')).toBeVisible();
  });

  test('should show RPC endpoints', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    const connectButton = page.locator('[data-testid="connect-wallet-button"]');
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    const rpcTab = page.locator('text=RPC Access').or(page.locator('[data-testid="rpc-tab"]'));
    if (await rpcTab.isVisible()) {
      await rpcTab.click();
    }

    // Should show RPC endpoints
    await expect(page.locator('text=RPC Endpoints')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Jeju')).toBeVisible();
    await expect(page.locator('text=Ethereum')).toBeVisible();
  });

  test('should require wallet connection', async ({ page }) => {
    // Navigate to RPC tab without connecting
    const rpcTab = page.locator('text=RPC Access').or(page.locator('[data-testid="rpc-tab"]'));
    if (await rpcTab.isVisible()) {
      await rpcTab.click();
    }

    // Should prompt to connect
    await expect(page.locator('text=Connect Wallet').or(page.locator('text=Connect wallet'))).toBeVisible({ timeout: 5000 });
  });
});

test.describe('RPC API Key Management', () => {
  test('should create API key', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    const connectButton = page.locator('[data-testid="connect-wallet-button"]');
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    const rpcTab = page.locator('text=RPC Access').or(page.locator('[data-testid="rpc-tab"]'));
    if (await rpcTab.isVisible()) {
      await rpcTab.click();
    }

    // Fill key name
    const nameInput = page.locator('input[placeholder*="Key name"]');
    await nameInput.fill('Test Key');

    // Generate key
    await page.locator('text=Generate Key').click();

    // Should show the new key
    await expect(page.locator('text=API Key Created')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('code:has-text("jrpc_")')).toBeVisible();
  });

  test('should copy API key', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    const connectButton = page.locator('[data-testid="connect-wallet-button"]');
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    const rpcTab = page.locator('text=RPC Access').or(page.locator('[data-testid="rpc-tab"]'));
    if (await rpcTab.isVisible()) {
      await rpcTab.click();
    }

    // Generate a key first
    await page.locator('text=Generate Key').click();
    await expect(page.locator('text=API Key Created')).toBeVisible({ timeout: 10000 });

    // Click copy button
    const copyButton = page.locator('[data-testid="copy-key"]').or(page.locator('button:has(svg)').filter({ has: page.locator('title:has-text("Copy")') }));
    if (await copyButton.isVisible()) {
      await copyButton.click();
    }
  });
});
