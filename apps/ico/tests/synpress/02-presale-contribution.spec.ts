/**
 * Presale Contribution Tests
 * Tests the full contribution flow with on-chain verification
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';
import { getBalance, getPresaleStats, getContribution } from '../helpers/contract-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const ICO_URL = process.env.ICO_URL || 'http://localhost:4020';
const PRESALE_ADDRESS = process.env.NEXT_PUBLIC_PRESALE_ADDRESS || '';
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test.describe('Contribution Input', () => {
  test('should calculate token amount from ETH input', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Enter contribution amount
    const input = page.locator('input[type="number"]');
    await input.fill('1');

    // Should show token calculation
    await expect(page.getByText(/You receive/i)).toBeVisible();
    await expect(page.getByText(/JEJU/i)).toBeVisible();
  });

  test('should apply volume bonus for larger contributions', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Enter 5 ETH (should get 3% bonus)
    const input = page.locator('input[type="number"]');
    await input.fill('5');

    // Should show bonus
    await expect(page.getByText(/Bonus/i)).toBeVisible();
    await expect(page.getByText(/3%|5%/i)).toBeVisible();
  });

  test('should validate minimum contribution', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Enter below minimum (0.001 ETH)
    const input = page.locator('input[type="number"]');
    await input.fill('0.001');

    // Should show min contribution info
    await expect(page.getByText(/Min:/i)).toBeVisible();
  });

  test('should quick-fill amounts work', async ({ page }) => {
    await page.goto(ICO_URL);

    // Click 0.1 button
    await page.getByRole('button', { name: '0.1' }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue('0.1');

    // Click 1 button
    await page.getByRole('button', { name: '1' }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue('1');

    // Click 5 button
    await page.getByRole('button', { name: '5' }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue('5');
  });
});

test.describe('On-Chain Contribution', () => {
  test.skip(!PRESALE_ADDRESS, 'Presale contract not deployed');

  test('should contribute ETH and verify on-chain', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Get initial state
    const initialBalance = await getBalance(page, TEST_WALLET);
    const initialStats = await getPresaleStats(page, PRESALE_ADDRESS);

    // Enter contribution
    const input = page.locator('input[type="number"]');
    await input.fill('0.1');
    await page.waitForTimeout(500);

    // Submit contribution
    const contributeButton = page.getByRole('button', { name: /Contribute|Submit/i });
    await contributeButton.click();
    await page.waitForTimeout(2000);

    // Confirm in MetaMask
    await metamask.confirmTransaction();

    // Wait for success
    await page.waitForSelector('text=/success|confirmed/i', { timeout: 60000 });

    // Verify on-chain: balance decreased
    const finalBalance = await getBalance(page, TEST_WALLET);
    expect(finalBalance).toBeLessThan(initialBalance);

    // Verify on-chain: presale stats updated
    const finalStats = await getPresaleStats(page, PRESALE_ADDRESS);
    expect(finalStats.raised).toBeGreaterThan(initialStats.raised);
    expect(finalStats.participants).toBeGreaterThanOrEqual(initialStats.participants);
  });

  test('should update contribution on additional deposits', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Get initial contribution
    const initialContrib = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);

    // Make contribution
    const input = page.locator('input[type="number"]');
    await input.fill('0.1');
    const contributeButton = page.getByRole('button', { name: /Contribute|Submit/i });
    await contributeButton.click();
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    await page.waitForSelector('text=/success|confirmed/i', { timeout: 60000 });

    // Verify contribution increased
    const finalContrib = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);
    expect(finalContrib.ethAmount).toBeGreaterThan(initialContrib.ethAmount);
    expect(finalContrib.tokenAllocation).toBeGreaterThan(initialContrib.tokenAllocation);
  });
});

test.describe('Contribution Limits', () => {
  test.skip(!PRESALE_ADDRESS, 'Presale contract not deployed');

  test('should reject contribution below minimum', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Try very small amount
    const input = page.locator('input[type="number"]');
    await input.fill('0.001');

    const contributeButton = page.getByRole('button', { name: /Contribute|Submit/i });
    
    // Should be disabled or show error
    const isDisabled = await contributeButton.isDisabled();
    const hasError = await page.getByText(/minimum|too low/i).isVisible();
    expect(isDisabled || hasError).toBe(true);
  });

  test('should reject contribution above maximum', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Try above max (50 ETH)
    const input = page.locator('input[type="number"]');
    await input.fill('100');

    const contributeButton = page.getByRole('button', { name: /Contribute|Submit/i });
    
    // Should be disabled or show error
    const isDisabled = await contributeButton.isDisabled();
    const hasError = await page.getByText(/maximum|too high/i).isVisible();
    expect(isDisabled || hasError).toBe(true);
  });
});
