/**
 * Navigation Tests
 * Tests all navigation flows, tab switching, and page transitions
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display all navigation tabs', async ({ page }) => {
    await expect(page.getByTestId('nav-providers')).toBeVisible();
    await expect(page.getByTestId('nav-rentals')).toBeVisible();
    await expect(page.getByTestId('nav-models')).toBeVisible();
  });

  test('should have providers tab active by default', async ({ page }) => {
    const providersTab = page.getByTestId('nav-providers');
    await expect(providersTab).toHaveClass(/active/);
  });

  test('should switch to rentals tab', async ({ page }) => {
    await page.getByTestId('nav-rentals').click();

    await expect(page.getByTestId('nav-rentals')).toHaveClass(/active/);
    await expect(page.getByTestId('nav-providers')).not.toHaveClass(/active/);
    await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);
    await expect(page.getByTestId('page-providers')).not.toHaveClass(/active/);
  });

  test('should switch to models tab', async ({ page }) => {
    await page.getByTestId('nav-models').click();

    await expect(page.getByTestId('nav-models')).toHaveClass(/active/);
    await expect(page.getByTestId('page-models')).toHaveClass(/active/);
  });

  test('should switch back to providers tab', async ({ page }) => {
    // Go to rentals first
    await page.getByTestId('nav-rentals').click();
    await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);

    // Back to providers
    await page.getByTestId('nav-providers').click();
    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
  });

  test('should maintain tab state after modal close', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });

    // Open modal
    await page.locator('.provider-card').first().click();
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);

    // Close modal
    await page.getByTestId('close-rental-modal').click();

    // Should still be on providers page
    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
  });
});

test.describe('Logo and Branding', () => {
  test('should display logo', async ({ page }) => {
    await page.goto('/');
    const logo = page.getByTestId('logo');
    await expect(logo).toBeVisible();
    await expect(logo).toContainText('Jeju Compute');
  });

  test('should have correct page title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Jeju Compute Marketplace/);
  });
});

test.describe('Page Content', () => {
  test('providers page has correct header', async ({ page }) => {
    await page.goto('/');
    const title = page.locator('.page-title');
    await expect(title).toContainText('Compute Providers');
  });

  test('rentals page has correct header', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-rentals').click();
    const title = page.locator('.page-title');
    await expect(title).toContainText('My Rentals');
  });

  test('models page has correct header', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-models').click();
    const title = page.locator('.page-title');
    await expect(title).toContainText('AI Models');
  });
});

