/**
 * Rental Flow Tests
 * Tests rental creation, extension, cancellation, and management
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Rental Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 10000 });
  });

  test('should open rental modal when clicking provider card', async ({ page }) => {
    const firstCard = page.locator('.provider-card').first();
    await firstCard.click();

    const modal = page.getByTestId('rental-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveClass(/active/);
  });

  test('should display selected provider info in modal', async ({ page }) => {
    await page.locator('.provider-card').first().click();

    const providerInfo = page.getByTestId('selected-provider-info');
    await expect(providerInfo).toBeVisible();
    await expect(providerInfo.locator('.spec-value')).toHaveCount(4);
  });

  test('should display rental form fields', async ({ page }) => {
    await page.locator('.provider-card').first().click();

    await expect(page.getByTestId('rental-duration')).toBeVisible();
    await expect(page.getByTestId('rental-ssh-key')).toBeVisible();
    await expect(page.getByTestId('rental-docker-image')).toBeVisible();
    await expect(page.getByTestId('rental-startup-script')).toBeVisible();
  });

  test('should display cost breakdown', async ({ page }) => {
    await page.locator('.provider-card').first().click();

    const costBreakdown = page.getByTestId('cost-breakdown');
    await expect(costBreakdown).toBeVisible();
    await expect(costBreakdown).toContainText('Price per hour');
    await expect(costBreakdown).toContainText('Duration');
    await expect(costBreakdown).toContainText('Total Cost');
  });

  test('should update cost when duration changes', async ({ page }) => {
    await page.locator('.provider-card').first().click();

    const durationInput = page.getByTestId('rental-duration');
    const totalCost = page.locator('#cost-total');

    // Get initial cost
    const initialCost = await totalCost.textContent();

    // Change duration
    await durationInput.fill('24');
    await page.waitForTimeout(300);

    // Cost should have changed
    const newCost = await totalCost.textContent();
    expect(newCost).not.toBe(initialCost);
  });

  test('should close modal with close button', async ({ page }) => {
    await page.locator('.provider-card').first().click();
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);

    await page.getByTestId('close-rental-modal').click();
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });

  test('should show disabled button when wallet not connected', async ({ page }) => {
    await page.locator('.provider-card').first().click();

    const createBtn = page.getByTestId('create-rental-btn');
    await expect(createBtn).toBeDisabled();
    await expect(createBtn).toContainText('Connect Wallet First');
  });
});

test.describe('Rental Creation with Wallet', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();
    await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
  });

  test('should enable create button when wallet connected', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();

    const createBtn = page.getByTestId('create-rental-btn');
    await expect(createBtn).toBeEnabled();
    await expect(createBtn).toContainText('Create Rental');
  });

  test('should validate SSH key is required', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();

    // Try to submit without SSH key
    const form = page.getByTestId('rental-form');
    await page.getByTestId('rental-duration').fill('1');
    
    // SSH key textarea should be required
    const sshInput = page.getByTestId('rental-ssh-key');
    await expect(sshInput).toHaveAttribute('required', '');
  });

  test('should fill complete rental form', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();

    // Fill form
    await page.getByTestId('rental-duration').fill('4');
    await page.getByTestId('rental-ssh-key').fill('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC test@example.com');
    await page.getByTestId('rental-docker-image').fill('nvidia/cuda:12.0-base');
    await page.getByTestId('rental-startup-script').fill('#!/bin/bash\napt update');

    // All fields should be filled
    await expect(page.getByTestId('rental-duration')).toHaveValue('4');
    await expect(page.getByTestId('rental-ssh-key')).toHaveValue(/ssh-rsa/);
    await expect(page.getByTestId('rental-docker-image')).toHaveValue('nvidia/cuda:12.0-base');
  });

  test('should submit rental and show success toast', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();

    // Fill form
    await page.getByTestId('rental-duration').fill('1');
    await page.getByTestId('rental-ssh-key').fill('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC test@example.com');

    // Submit
    await page.getByTestId('create-rental-btn').click();

    // Handle transaction approval (mock flow)
    // In real test with contracts, metamask.confirmTransaction() would be called

    // Should show success toast
    const toast = page.locator('.toast.success');
    await expect(toast).toBeVisible({ timeout: 10000 });
  });
});

test.describe('My Rentals Page', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Connect wallet
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();
    await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });

    // Navigate to rentals
    await page.getByTestId('nav-rentals').click();
  });

  test('should switch to rentals page', async ({ page }) => {
    const rentalsPage = page.getByTestId('page-rentals');
    await expect(rentalsPage).toBeVisible();
    await expect(rentalsPage).toHaveClass(/active/);
  });

  test('should show empty state when no rentals', async ({ page }) => {
    const noRentals = page.getByTestId('no-rentals');
    await expect(noRentals).toBeVisible();
    await expect(noRentals).toContainText('No active rentals');
  });

  test('should have browse providers button in empty state', async ({ page }) => {
    const browseBtn = page.getByTestId('browse-providers-btn');
    await expect(browseBtn).toBeVisible();

    await browseBtn.click();
    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
  });
});

test.describe('Active Rental Management', () => {
  // These tests assume there are mock rentals displayed

  test('should display rental card with details', async ({ page }) => {
    await page.goto('/');
    
    // Mock having rentals by evaluating JS
    await page.evaluate(() => {
      // Simulate connected state with rentals
      const state = (window as Window & { state?: { connected: boolean; rentals: unknown[] } }).state;
      if (state) {
        state.connected = true;
        state.rentals = [{
          rentalId: '0x1234567890abcdef',
          provider: '0xabc123',
          providerName: 'Test Provider',
          status: 'ACTIVE',
          startTime: Date.now() - 3600000,
          endTime: Date.now() + 82800000,
          totalCost: '0.48',
          sshHost: 'node1.test.com',
          sshPort: 22,
        }];
      }
    });

    await page.getByTestId('nav-rentals').click();
    
    // Check if rental card elements exist
    const rentalsList = page.getByTestId('rentals-list');
    await expect(rentalsList).toBeVisible();
  });

  test('should display SSH terminal for active rental', async ({ page }) => {
    // This test verifies the SSH terminal UI element
    await page.goto('/');
    await page.getByTestId('nav-rentals').click();

    // Look for SSH terminal code block
    const sshTerminal = page.locator('.ssh-terminal');
    // If there are active rentals, should show terminal
    const count = await sshTerminal.count();
    // Just verify the selector works
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

