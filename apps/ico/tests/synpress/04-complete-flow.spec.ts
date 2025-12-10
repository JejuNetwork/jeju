/**
 * Complete Presale Flow Tests
 * End-to-end tests covering the full presale lifecycle
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';
import { getPresalePhase, getContribution, getPresaleStats } from '../helpers/contract-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const ICO_URL = process.env.ICO_URL || 'http://localhost:4020';
const PRESALE_ADDRESS = process.env.NEXT_PUBLIC_PRESALE_ADDRESS || '';
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test.describe('Complete User Journey', () => {
  test('should complete full presale flow: connect → contribute → verify', async ({ context, page, metamaskPage, extensionId }) => {
    test.skip(!PRESALE_ADDRESS, 'Presale not deployed');
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // 1. Visit presale page
    await page.goto(ICO_URL);
    await expect(page.getByText('Jeju Token')).toBeVisible();

    // 2. Connect wallet
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // 3. View presale info
    await expect(page.getByText(/Progress/i)).toBeVisible();
    await expect(page.getByText(/Participate/i)).toBeVisible();

    // 4. Check initial on-chain state
    const initialContrib = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);
    const initialStats = await getPresaleStats(page, PRESALE_ADDRESS);

    // 5. Enter contribution
    await page.locator('input[type="number"]').fill('0.5');
    await page.waitForTimeout(500);

    // 6. Verify calculation display
    await expect(page.getByText(/You receive/i)).toBeVisible();
    await expect(page.getByText(/JEJU/i)).toBeVisible();

    // 7. Submit contribution
    const contributeButton = page.getByRole('button', { name: /Contribute|Submit/i });
    await contributeButton.click();
    await page.waitForTimeout(2000);

    // 8. Confirm in MetaMask
    await metamask.confirmTransaction();

    // 9. Wait for confirmation
    await page.waitForSelector('text=/success|confirmed/i', { timeout: 90000 });

    // 10. Verify on-chain
    const finalContrib = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);
    const finalStats = await getPresaleStats(page, PRESALE_ADDRESS);

    expect(finalContrib.ethAmount).toBeGreaterThan(initialContrib.ethAmount);
    expect(finalStats.raised).toBeGreaterThan(initialStats.raised);
  });

  test('should navigate full site and verify all pages', async ({ page }) => {
    // Homepage
    await page.goto(ICO_URL);
    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Tokenomics')).toBeVisible();
    await expect(page.getByText('Timeline')).toBeVisible();

    // Whitepaper
    await page.goto(`${ICO_URL}/whitepaper`);
    await expect(page.getByText('Whitepaper')).toBeVisible();
    await expect(page.getByText('Abstract')).toBeVisible();
    await expect(page.getByText('MiCA')).toBeVisible();

    // TOC navigation
    await page.getByRole('link', { name: /Tokenomics/i }).click();
    await expect(page.locator('#tokenomics')).toBeInViewport();
  });
});

test.describe('Multiple Contributions', () => {
  test.skip(!PRESALE_ADDRESS, 'Presale not deployed');

  test('should accumulate multiple contributions', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    const initialContrib = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);

    // First contribution
    await page.locator('input[type="number"]').fill('0.1');
    await page.getByRole('button', { name: /Contribute/i }).click();
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    await page.waitForSelector('text=/success/i', { timeout: 60000 });

    const afterFirst = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);
    expect(afterFirst.ethAmount - initialContrib.ethAmount).toBe(BigInt(0.1 * 1e18));

    // Second contribution
    await page.locator('input[type="number"]').fill('0.2');
    await page.getByRole('button', { name: /Contribute/i }).click();
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    await page.waitForSelector('text=/success/i', { timeout: 60000 });

    const afterSecond = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);
    expect(afterSecond.ethAmount - initialContrib.ethAmount).toBe(BigInt(0.3 * 1e18));
  });
});

test.describe('Error Handling', () => {
  test('should handle rejected transaction gracefully', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    await page.locator('input[type="number"]').fill('0.1');
    await page.getByRole('button', { name: /Contribute/i }).click();
    await page.waitForTimeout(2000);

    // Reject in MetaMask
    await metamask.rejectTransaction();
    await page.waitForTimeout(2000);

    // Should show error or return to normal state
    const hasError = await page.getByText(/rejected|cancelled|denied/i).isVisible();
    const canRetry = await page.getByRole('button', { name: /Contribute/i }).isEnabled();
    
    expect(hasError || canRetry).toBe(true);
  });

  test('should handle insufficient balance', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Try to contribute more than balance
    await page.locator('input[type="number"]').fill('10000');

    // Should show insufficient balance or disable button
    const contributeButton = page.getByRole('button', { name: /Contribute/i });
    const isDisabled = await contributeButton.isDisabled();
    const hasWarning = await page.getByText(/insufficient|not enough/i).isVisible();

    expect(isDisabled || hasWarning).toBe(true);
  });
});

test.describe('Responsive Behavior', () => {
  test('should work on mobile viewport', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(ICO_URL);

    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Participate')).toBeVisible();

    // Connect should work on mobile
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Input should work
    await page.locator('input[type="number"]').fill('0.1');
    await expect(page.getByText(/You receive/i)).toBeVisible();
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(ICO_URL);

    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Tokenomics')).toBeVisible();
    await expect(page.getByText('Timeline')).toBeVisible();
  });
});
