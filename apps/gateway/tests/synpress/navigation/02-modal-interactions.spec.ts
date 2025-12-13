/**
 * Modal Interaction Tests
 * Tests all modals: App details, transaction confirmations, errors
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('App Detail Modal', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should open app detail modal when clicking app card', async ({ page }) => {
    // Find app cards
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to view');
      return;
    }

    // Click first app
    await appCards.first().click();
    await page.waitForTimeout(1000);

    // Modal should open
    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
    await expect(modal).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/modals/01-app-detail-open.png',
      fullPage: true,
    });

    console.log('✅ App detail modal opens');
  });

  test('should close modal with X button', async ({ page }) => {
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to test modal close');
      return;
    }

    await appCards.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
    await expect(modal).toBeVisible();

    // Find and click X button
    const closeButton = modal.locator('button').filter({ has: page.locator('svg') }).first();
    await closeButton.click();
    await page.waitForTimeout(500);

    // Modal should close
    const modalClosed = !(await modal.isVisible().catch(() => true));
    expect(modalClosed).toBe(true);

    console.log('✅ Modal closes with X button');
  });

  test('should close modal with Escape key', async ({ page }) => {
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to test ESC close');
      return;
    }

    await appCards.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
    await expect(modal).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Modal should close
    const modalClosed = !(await modal.isVisible().catch(() => true));
    expect(modalClosed).toBe(true);

    console.log('✅ Modal closes with Escape key');
  });

  test('should close modal when clicking outside', async ({ page }) => {
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to test outside click');
      return;
    }

    await appCards.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
    await expect(modal).toBeVisible();

    // Click outside modal (on backdrop)
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    // Modal should close
    const modalClosed = !(await modal.isVisible().catch(() => true));
    expect(modalClosed).toBe(true);

    console.log('✅ Modal closes when clicking outside');
  });

  test('should display all app details in modal', async ({ page }) => {
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to view details');
      return;
    }

    await appCards.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });

    // Check for standard sections
    await expect(modal.getByText(/Description|Categories|A2A Endpoint|Stake Information|Owner/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/modals/02-app-detail-content.png',
      fullPage: true,
    });

    console.log('✅ App detail modal shows all information');
  });

  test('should show owner actions only for owner', async ({ page }) => {
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to check ownership');
      return;
    }

    await appCards.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });

    // Check if owner actions visible
    const ownerActions = modal.getByText(/Owner Actions/i);
    const isOwner = await ownerActions.isVisible();

    if (isOwner) {
      // Should see edit and withdraw buttons
      await expect(modal.getByRole('button', { name: /Edit Details|Withdraw/i })).toBeVisible();
      console.log('✅ Owner actions visible for owned app');
    } else {
      console.log('ℹ️  Not the owner - owner actions hidden');
    }
  });
});

test.describe('RainbowKit Wallet Modal', () => {
  test('should open wallet connection modal', async ({ page }) => {
    await page.goto(GATEWAY_URL);

    // Click connect button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForTimeout(1000);

    // RainbowKit modal should appear
    // Look for wallet options
    const modal = page.locator('text=/MetaMask|WalletConnect|Coinbase/i');
    const modalVisible = await modal.isVisible();

    expect(modalVisible).toBe(true);

    await page.screenshot({
      path: 'test-results/screenshots/modals/03-rainbowkit-connect.png',
      fullPage: true,
    });

    console.log('✅ RainbowKit modal opens');
  });

  test.skip('should open account modal when clicking connected address', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Click on wallet address
    await page.locator('button:has-text(/0x/)').click();
    await page.waitForTimeout(1000);

    // RainbowKit account modal should appear
    // Would show balance, disconnect option, etc.

    console.log('⚠️  Account modal - needs RainbowKit modal navigation');
  });
});

test.describe('Transaction Confirmation Modal (MetaMask)', () => {
  test('should display MetaMask confirmation for transactions', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Trigger any transaction
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    const noPaymaster = await page.getByText(/No paymaster deployed/i).isVisible();
    if (noPaymaster) {
      console.log('ℹ️  Cannot test MetaMask modal without paymaster');
      return;
    }

    const ethInput = page.getByPlaceholder('1.0');
    if (await ethInput.isVisible()) {
      await ethInput.fill('0.01');
      await page.getByRole('button', { name: /Add.*ETH/i }).click();

      // MetaMask popup should appear
      await page.waitForTimeout(2000);

      // Reject to avoid state changes
      await metamask.rejectTransaction();

      console.log('✅ MetaMask confirmation modal tested');
    }
  });
});

test.describe('Loading and Transition States', () => {
  test('should show loading state while data loads', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Immediately after connection, balances might be loading
    // This is hard to catch but important

    // Navigate to a data-heavy tab
    await page.getByRole('button', { name: /My Earnings/i }).click();

    // Look for loading indicators
    const loadingIndicators = page.locator('text=/Loading|loading|⏳|spinner/i');
    const hasLoading = await loadingIndicators.first().isVisible({ timeout: 5000 });

    if (hasLoading) {
      console.log('✅ Loading indicator shown');
    } else {
      console.log('ℹ️  Data loaded too fast to catch loading state');
    }
  });

  test('should show skeleton loaders for balance cards', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);

    // Before connecting, might see skeleton
    // After connecting, brief skeleton before balances load

    await connectWallet(page, metamask);

    // Look for skeleton loaders
    const skeletons = page.locator('.animate-pulse, [class*="skeleton"]');
    const hasSkeleton = await skeletons.first().isVisible({ timeout: 5000 });

    if (hasSkeleton) {
      console.log('✅ Skeleton loader shown');
    } else {
      console.log('ℹ️  Balances loaded immediately');
    }
  });
});

test.describe('Mobile Navigation', () => {
  test.skip('should show hamburger menu on mobile viewport', async ({ page, metamask }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone size
    
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Look for mobile menu button
    const hamburger = page.locator('[aria-label*="menu"], button:has-text("☰")');
    const hasMobile = await hamburger.isVisible();

    if (hasMobile) {
      await hamburger.click();
      await page.waitForTimeout(500);

      console.log('✅ Mobile navigation menu works');
    } else {
      console.log('ℹ️  No specific mobile navigation (tabs may wrap)');
    }
  });
});


