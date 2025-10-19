/**
 * @fileoverview Wallet connection E2E tests
 * @module gateway/tests/e2e/wallet-connection
 */

import { test, expect, setupMetaMask, importTestAccount, connectWallet } from '../fixtures/wallet';

test.describe('Wallet Connection Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMetaMask();
    await importTestAccount();
    await page.goto('/');
  });

  test('should display connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.getByText('Connect Your Wallet')).toBeVisible();
    await expect(page.getByText(/Bridge tokens from Base/i)).toBeVisible();
  });

  test('should successfully connect wallet', async ({ page }) => {
    await connectWallet(page);
    
    // Verify connected state
    await expect(page.getByText('Connect Your Wallet')).not.toBeVisible();
    await expect(page.getByText(/Token Balances/i)).toBeVisible();
  });

  test('should display token balances after connecting', async ({ page }) => {
    await connectWallet(page);
    
    // Check for all protocol tokens
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
  });

  test('should show all navigation tabs when connected', async ({ page }) => {
    await connectWallet(page);
    
    await expect(page.getByRole('button', { name: /Registered Tokens/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bridge from Base/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Deploy Paymaster/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add Liquidity/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /My Earnings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Node Operators/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /App Registry/i })).toBeVisible();
  });

  test('should display correct network info in header', async ({ page }) => {
    await connectWallet(page);
    
    // Check if wallet address is displayed (RainbowKit shows truncated address)
    const addressButton = page.locator('button:has-text("0xf39F")');
    await expect(addressButton).toBeVisible();
  });
});

