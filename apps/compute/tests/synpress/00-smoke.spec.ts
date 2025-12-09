/**
 * Smoke Tests
 * Quick verification that all critical paths work
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Smoke Tests', () => {
  test('page loads without errors', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Jeju Compute/);
    
    // Check no console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.waitForLoadState('networkidle');
    expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('all main UI elements are visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Header
    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('nav-providers')).toBeVisible();
    await expect(page.getByTestId('nav-rentals')).toBeVisible();
    await expect(page.getByTestId('nav-models')).toBeVisible();
    await expect(page.getByTestId('network-badge')).toBeVisible();
    await expect(page.getByTestId('connect-wallet')).toBeVisible();

    // Stats
    await expect(page.getByTestId('stats-bar')).toBeVisible();

    // Filters
    await expect(page.getByTestId('filters-bar')).toBeVisible();

    // Provider grid
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('providers load and display', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    const cards = page.locator('.provider-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('complete wallet connection flow', async ({ context, page, metamaskPage, extensionId }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect
    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();

    // Verify connected
    await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });

    // Disconnect
    await page.getByTestId('disconnect-wallet').click();
    await expect(page.getByTestId('connect-wallet')).toBeVisible();
  });

  test('complete rental modal flow', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    // Open modal
    await page.locator('.provider-card').first().click();
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);

    // Fill form
    await page.getByTestId('rental-duration').fill('2');
    await page.getByTestId('rental-ssh-key').fill('ssh-rsa AAAA test');

    // Close modal
    await page.getByTestId('close-rental-modal').click();
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });

  test('all navigation works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // To rentals
    await page.getByTestId('nav-rentals').click();
    await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);

    // To models
    await page.getByTestId('nav-models').click();
    await expect(page.getByTestId('page-models')).toHaveClass(/active/);

    // Back to providers
    await page.getByTestId('nav-providers').click();
    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
  });

  test('filters work without errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    // Apply filters
    await page.getByTestId('filter-gpu').selectOption('NVIDIA_H100');
    await page.getByTestId('filter-features').selectOption('ssh');
    await page.getByTestId('apply-filters').click();
    await page.waitForTimeout(500);

    // Reset
    await page.getByTestId('reset-filters').click();
    await page.waitForTimeout(500);

    // Grid should still be visible
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('toast notifications work', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Trigger a toast by trying to connect without metamask
    await page.evaluate(() => {
      (window as Window & { ethereum?: unknown }).ethereum = undefined;
    });

    await page.getByTestId('connect-wallet').click();

    // Should show error toast
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Responsive Design', () => {
  test('works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Core elements should still be visible
    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('connect-wallet')).toBeVisible();
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('stats-bar')).toBeVisible();
    await expect(page.getByTestId('filters-bar')).toBeVisible();
  });
});

test.describe('Error Handling', () => {
  test('handles missing ethereum gracefully', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      delete (window as Window & { ethereum?: unknown }).ethereum;
    });

    await page.getByTestId('connect-wallet').click();
    
    // Should show error, not crash
    const toast = page.locator('.toast.error');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });
});

