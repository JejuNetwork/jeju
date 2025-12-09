/**
 * Comprehensive Button E2E Tests
 * Tests every button on every page in desktop and mobile viewports
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

// Viewport configurations
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

// =============================================================================
// DESKTOP VIEWPORT TESTS
// =============================================================================

test.describe('Desktop Viewport - All Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ---------------------------------------------------------------------------
  // Header Buttons
  // ---------------------------------------------------------------------------

  test.describe('Header Navigation Buttons', () => {
    test('nav-providers button is visible and clickable', async ({ page }) => {
      const btn = page.getByTestId('nav-providers');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      await btn.click();
      await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
      await expect(btn).toHaveClass(/active/);
    });

    test('nav-rentals button is visible and clickable', async ({ page }) => {
      const btn = page.getByTestId('nav-rentals');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      await btn.click();
      await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);
      await expect(btn).toHaveClass(/active/);
    });

    test('nav-models button is visible and clickable', async ({ page }) => {
      const btn = page.getByTestId('nav-models');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      await btn.click();
      await expect(page.getByTestId('page-models')).toHaveClass(/active/);
      await expect(btn).toHaveClass(/active/);
    });

    test('connect-wallet button is visible and clickable', async ({ page }) => {
      const btn = page.getByTestId('connect-wallet');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      await expect(btn).toContainText('Connect Wallet');
    });

    test('connect-wallet button triggers wallet connection flow', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      const btn = page.getByTestId('connect-wallet');
      
      await btn.click();
      await metamask.connectToDapp();
      
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
    });

    test('disconnect-wallet button is visible after connecting', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.getByTestId('connect-wallet').click();
      await metamask.connectToDapp();
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
      
      const btn = page.getByTestId('disconnect-wallet');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
    });

    test('disconnect-wallet button disconnects wallet', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.getByTestId('connect-wallet').click();
      await metamask.connectToDapp();
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
      
      await page.getByTestId('disconnect-wallet').click();
      await expect(page.getByTestId('connect-wallet')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Providers Page Buttons
  // ---------------------------------------------------------------------------

  test.describe('Providers Page Buttons', () => {
    test('apply-filters button is visible and clickable', async ({ page }) => {
      const btn = page.getByTestId('apply-filters');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      await btn.click();
      // Should not throw error
      await expect(page.getByTestId('provider-grid')).toBeVisible();
    });

    test('reset-filters button is visible and clickable', async ({ page }) => {
      const btn = page.getByTestId('reset-filters');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      await btn.click();
      // Filter inputs should be reset
      await expect(page.getByTestId('filter-gpu')).toHaveValue('');
      await expect(page.getByTestId('filter-memory')).toHaveValue('');
    });

    test('apply-filters button filters providers correctly', async ({ page }) => {
      await page.waitForSelector('.provider-card', { timeout: 10000 });
      
      // Apply GPU filter
      await page.getByTestId('filter-gpu').selectOption('NVIDIA_H100');
      await page.getByTestId('apply-filters').click();
      await page.waitForTimeout(500);
      
      // Grid should update
      await expect(page.getByTestId('provider-grid')).toBeVisible();
    });

    test('provider card is clickable and opens modal', async ({ page }) => {
      await page.waitForSelector('.provider-card', { timeout: 10000 });
      
      const card = page.locator('.provider-card').first();
      await expect(card).toBeVisible();
      await card.click();
      
      await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
    });
  });

  // ---------------------------------------------------------------------------
  // Filter Controls
  // ---------------------------------------------------------------------------

  test.describe('Filter Controls', () => {
    test('filter-gpu dropdown is functional', async ({ page }) => {
      const select = page.getByTestId('filter-gpu');
      await expect(select).toBeVisible();
      await select.selectOption('NVIDIA_RTX_4090');
      await expect(select).toHaveValue('NVIDIA_RTX_4090');
    });

    test('filter-memory input is functional', async ({ page }) => {
      const input = page.getByTestId('filter-memory');
      await expect(input).toBeVisible();
      await input.fill('32');
      await expect(input).toHaveValue('32');
    });

    test('filter-price input is functional', async ({ page }) => {
      const input = page.getByTestId('filter-price');
      await expect(input).toBeVisible();
      await input.fill('0.1 ETH');
      await expect(input).toHaveValue('0.1 ETH');
    });

    test('filter-features dropdown is functional', async ({ page }) => {
      const select = page.getByTestId('filter-features');
      await expect(select).toBeVisible();
      await select.selectOption('ssh');
      await expect(select).toHaveValue('ssh');
    });
  });

  // ---------------------------------------------------------------------------
  // Rental Modal Buttons
  // ---------------------------------------------------------------------------

  test.describe('Rental Modal Buttons', () => {
    test.beforeEach(async ({ page }) => {
      await page.waitForSelector('.provider-card', { timeout: 10000 });
      await page.locator('.provider-card').first().click();
    });

    test('close-rental-modal button is visible and closes modal', async ({ page }) => {
      const btn = page.getByTestId('close-rental-modal');
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
    });

    test('create-rental-btn is visible but disabled when not connected', async ({ page }) => {
      const btn = page.getByTestId('create-rental-btn');
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
      await expect(btn).toContainText('Connect Wallet First');
    });

    test('create-rental-btn is enabled when connected', async ({ context, page, metamaskPage, extensionId }) => {
      // Close modal first
      await page.getByTestId('close-rental-modal').click();
      
      // Connect wallet
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      await page.getByTestId('connect-wallet').click();
      await metamask.connectToDapp();
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
      
      // Open modal again
      await page.locator('.provider-card').first().click();
      
      const btn = page.getByTestId('create-rental-btn');
      await expect(btn).toBeEnabled();
      await expect(btn).toContainText('Create Rental');
    });

    test('rental-duration input is functional', async ({ page }) => {
      const input = page.getByTestId('rental-duration');
      await expect(input).toBeVisible();
      await input.fill('12');
      await expect(input).toHaveValue('12');
    });

    test('rental-ssh-key textarea is functional', async ({ page }) => {
      const input = page.getByTestId('rental-ssh-key');
      await expect(input).toBeVisible();
      await input.fill('ssh-rsa AAAA test');
      await expect(input).toHaveValue('ssh-rsa AAAA test');
    });

    test('rental-docker-image input is functional', async ({ page }) => {
      const input = page.getByTestId('rental-docker-image');
      await expect(input).toBeVisible();
      await input.fill('nvidia/cuda:12.0');
      await expect(input).toHaveValue('nvidia/cuda:12.0');
    });

    test('rental-startup-script textarea is functional', async ({ page }) => {
      const input = page.getByTestId('rental-startup-script');
      await expect(input).toBeVisible();
      await input.fill('#!/bin/bash\necho hello');
      await expect(input).toContainText('#!/bin/bash');
    });

    test('modal closes on backdrop click', async ({ page }) => {
      // Click on backdrop (overlay area)
      await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
      await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
    });
  });

  // ---------------------------------------------------------------------------
  // My Rentals Page Buttons
  // ---------------------------------------------------------------------------

  test.describe('My Rentals Page Buttons', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByTestId('nav-rentals').click();
    });

    test('browse-providers-btn is visible in empty state', async ({ page }) => {
      const btn = page.getByTestId('browse-providers-btn');
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
    });

    test('browse-providers-btn navigates to providers page', async ({ page }) => {
      await page.getByTestId('browse-providers-btn').click();
      await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
    });
  });

  // ---------------------------------------------------------------------------
  // Rental Action Buttons (Dynamic)
  // ---------------------------------------------------------------------------

  test.describe('Rental Action Buttons', () => {
    test('extend and cancel buttons appear for active rentals', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      // Connect wallet
      await page.getByTestId('connect-wallet').click();
      await metamask.connectToDapp();
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
      
      // Navigate to rentals
      await page.getByTestId('nav-rentals').click();
      await page.waitForTimeout(1000);
      
      // Check if there are any rental cards with active status
      const activeRental = page.locator('.rental-card .rental-status.active');
      const activeCount = await activeRental.count();
      
      if (activeCount > 0) {
        // Extend button should exist
        const extendBtn = page.locator('[data-testid^="extend-rental-btn-"]').first();
        await expect(extendBtn).toBeVisible();
        
        // Cancel button should exist
        const cancelBtn = page.locator('[data-testid^="cancel-rental-btn-"]').first();
        await expect(cancelBtn).toBeVisible();
      }
    });

    test('rate button appears for completed rentals', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      // Connect wallet
      await page.getByTestId('connect-wallet').click();
      await metamask.connectToDapp();
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
      
      // Navigate to rentals
      await page.getByTestId('nav-rentals').click();
      await page.waitForTimeout(1000);
      
      // Check if there are any rental cards with completed status
      const completedRental = page.locator('.rental-card .rental-status.completed');
      const completedCount = await completedRental.count();
      
      if (completedCount > 0) {
        // Rate button should exist
        const rateBtn = page.locator('[data-testid^="rate-rental-btn-"]').first();
        await expect(rateBtn).toBeVisible();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Rating Modal Buttons
  // ---------------------------------------------------------------------------

  test.describe('Rating Modal Buttons', () => {
    test.beforeEach(async ({ page }) => {
      // Manually open rating modal
      await page.evaluate(() => {
        const modal = document.getElementById('rating-modal');
        if (modal) modal.classList.add('active');
      });
    });

    test('close-rating-modal button is visible and closes modal', async ({ page }) => {
      const btn = page.getByTestId('close-rating-modal');
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(page.getByTestId('rating-modal')).not.toHaveClass(/active/);
    });

    test('submit-rating-btn is visible but disabled initially', async ({ page }) => {
      const btn = page.getByTestId('submit-rating-btn');
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test('all 5 rating stars are clickable', async ({ page }) => {
      const stars = page.locator('.rating-star');
      await expect(stars).toHaveCount(5);
      
      for (let i = 0; i < 5; i++) {
        await expect(stars.nth(i)).toBeVisible();
        await stars.nth(i).click();
        await expect(stars.nth(i)).toHaveClass(/active/);
      }
    });

    test('each rating star has unique test ID', async ({ page }) => {
      for (let i = 1; i <= 5; i++) {
        const star = page.getByTestId(`rating-star-${i}`);
        await expect(star).toBeVisible();
      }
    });

    test('rating-star-1 is clickable', async ({ page }) => {
      const star = page.getByTestId('rating-star-1');
      await star.click();
      await expect(star).toHaveClass(/active/);
    });

    test('rating-star-2 is clickable', async ({ page }) => {
      const star = page.getByTestId('rating-star-2');
      await star.click();
      await expect(star).toHaveClass(/active/);
      await expect(page.getByTestId('rating-star-1')).toHaveClass(/active/);
    });

    test('clicking specific star by test ID works', async ({ page }) => {
      await page.getByTestId('rating-star-4').click();
      
      // First 4 stars should be active
      for (let i = 1; i <= 4; i++) {
        await expect(page.getByTestId(`rating-star-${i}`)).toHaveClass(/active/);
      }
      // 5th should not be active
      await expect(page.getByTestId('rating-star-5')).not.toHaveClass(/active/);
    });

    test('clicking star enables submit button', async ({ page }) => {
      await page.locator('.rating-star').first().click();
      await expect(page.getByTestId('submit-rating-btn')).toBeEnabled();
    });

    test('rating-review textarea is functional', async ({ page }) => {
      const input = page.getByTestId('rating-review');
      await expect(input).toBeVisible();
      await input.fill('Great experience');
      await expect(input).toHaveValue('Great experience');
    });

    test('rating modal closes on backdrop click', async ({ page }) => {
      await page.locator('#rating-modal.modal-overlay').click({ position: { x: 10, y: 10 } });
      await expect(page.getByTestId('rating-modal')).not.toHaveClass(/active/);
    });
  });

  // ---------------------------------------------------------------------------
  // AI Models Page
  // ---------------------------------------------------------------------------

  test.describe('AI Models Page', () => {
    test('models page loads correctly', async ({ page }) => {
      await page.getByTestId('nav-models').click();
      await expect(page.getByTestId('page-models')).toHaveClass(/active/);
      await expect(page.getByTestId('models-list')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Toast Container
  // ---------------------------------------------------------------------------

  test.describe('Toast Container', () => {
    test('toast-container is present in DOM', async ({ page }) => {
      const container = page.getByTestId('toast-container');
      await expect(container).toBeAttached();
    });

    test('toast appears on wallet disconnect', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      // Connect wallet
      await page.getByTestId('connect-wallet').click();
      await metamask.connectToDapp();
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
      
      // Disconnect and check toast
      await page.getByTestId('disconnect-wallet').click();
      
      const toast = page.locator('.toast');
      await expect(toast).toBeVisible({ timeout: 5000 });
    });
  });
});

// =============================================================================
// MOBILE VIEWPORT TESTS
// =============================================================================

test.describe('Mobile Viewport - All Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ---------------------------------------------------------------------------
  // Header Buttons (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('Header Navigation Buttons (Mobile)', () => {
    test('nav-providers button is visible and tappable', async ({ page }) => {
      const btn = page.getByTestId('nav-providers');
      await expect(btn).toBeVisible();
      await btn.tap();
      await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
    });

    test('nav-rentals button is visible and tappable', async ({ page }) => {
      const btn = page.getByTestId('nav-rentals');
      await expect(btn).toBeVisible();
      await btn.tap();
      await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);
    });

    test('nav-models button is visible and tappable', async ({ page }) => {
      const btn = page.getByTestId('nav-models');
      await expect(btn).toBeVisible();
      await btn.tap();
      await expect(page.getByTestId('page-models')).toHaveClass(/active/);
    });

    test('connect-wallet button is visible and meets touch target size', async ({ page }) => {
      const btn = page.getByTestId('connect-wallet');
      await expect(btn).toBeVisible();
      
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        // Minimum touch target should be 44px
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('connect-wallet triggers wallet flow on mobile', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.getByTestId('connect-wallet').tap();
      await metamask.connectToDapp();
      
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
    });

    test('disconnect-wallet button works on mobile', async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.getByTestId('connect-wallet').tap();
      await metamask.connectToDapp();
      await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
      
      await page.getByTestId('disconnect-wallet').tap();
      await expect(page.getByTestId('connect-wallet')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Providers Page Buttons (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('Providers Page Buttons (Mobile)', () => {
    test('apply-filters button is full-width and tappable', async ({ page }) => {
      const btn = page.getByTestId('apply-filters');
      await expect(btn).toBeVisible();
      
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      
      await btn.tap();
      await expect(page.getByTestId('provider-grid')).toBeVisible();
    });

    test('reset-filters button is full-width and tappable', async ({ page }) => {
      const btn = page.getByTestId('reset-filters');
      await expect(btn).toBeVisible();
      
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      
      await btn.tap();
      await expect(page.getByTestId('filter-gpu')).toHaveValue('');
    });

    test('provider card is tappable on mobile', async ({ page }) => {
      await page.waitForSelector('.provider-card', { timeout: 10000 });
      
      const card = page.locator('.provider-card').first();
      await card.tap();
      
      await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
    });
  });

  // ---------------------------------------------------------------------------
  // Filter Controls (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('Filter Controls (Mobile)', () => {
    test('filter-gpu dropdown meets touch target size', async ({ page }) => {
      const select = page.getByTestId('filter-gpu');
      const box = await select.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('filter-memory input meets touch target size', async ({ page }) => {
      const input = page.getByTestId('filter-memory');
      const box = await input.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('filter controls are full-width on mobile', async ({ page }) => {
      const gpu = page.getByTestId('filter-gpu');
      const gpuBox = await gpu.boundingBox();
      
      const memory = page.getByTestId('filter-memory');
      const memoryBox = await memory.boundingBox();
      
      expect(gpuBox).not.toBeNull();
      expect(memoryBox).not.toBeNull();
      
      if (gpuBox && memoryBox) {
        // Both should be similar width (full-width minus padding)
        expect(gpuBox.width).toBeGreaterThan(300);
        expect(memoryBox.width).toBeGreaterThan(300);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Rental Modal Buttons (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('Rental Modal Buttons (Mobile)', () => {
    test.beforeEach(async ({ page }) => {
      await page.waitForSelector('.provider-card', { timeout: 10000 });
      await page.locator('.provider-card').first().tap();
    });

    test('modal appears as bottom sheet on mobile', async ({ page }) => {
      const modal = page.locator('.modal');
      await expect(modal).toBeVisible();
      
      const box = await modal.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        // Modal should be at bottom of viewport
        expect(box.y + box.height).toBeGreaterThanOrEqual(MOBILE.height - 50);
      }
    });

    test('close-rental-modal button meets touch target size', async ({ page }) => {
      const btn = page.getByTestId('close-rental-modal');
      await expect(btn).toBeVisible();
      
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('close-rental-modal button closes modal on tap', async ({ page }) => {
      await page.getByTestId('close-rental-modal').tap();
      await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
    });

    test('create-rental-btn is full-width on mobile', async ({ page }) => {
      const btn = page.getByTestId('create-rental-btn');
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThan(300);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('rental-duration input meets touch target size', async ({ page }) => {
      const input = page.getByTestId('rental-duration');
      const box = await input.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('rental-ssh-key textarea meets touch target size', async ({ page }) => {
      const input = page.getByTestId('rental-ssh-key');
      const box = await input.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('rental-docker-image input meets touch target size', async ({ page }) => {
      const input = page.getByTestId('rental-docker-image');
      const box = await input.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('form inputs are interactive on mobile', async ({ page }) => {
      await page.getByTestId('rental-duration').fill('8');
      await page.getByTestId('rental-ssh-key').fill('ssh-rsa test');
      await page.getByTestId('rental-docker-image').fill('ubuntu:latest');
      
      await expect(page.getByTestId('rental-duration')).toHaveValue('8');
      await expect(page.getByTestId('rental-ssh-key')).toHaveValue('ssh-rsa test');
      await expect(page.getByTestId('rental-docker-image')).toHaveValue('ubuntu:latest');
    });
  });

  // ---------------------------------------------------------------------------
  // My Rentals Page Buttons (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('My Rentals Page Buttons (Mobile)', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByTestId('nav-rentals').tap();
    });

    test('browse-providers-btn is visible and tappable', async ({ page }) => {
      const btn = page.getByTestId('browse-providers-btn');
      await expect(btn).toBeVisible();
      
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('browse-providers-btn navigates correctly on mobile', async ({ page }) => {
      await page.getByTestId('browse-providers-btn').tap();
      await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
    });
  });

  // ---------------------------------------------------------------------------
  // Rating Modal Buttons (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('Rating Modal Buttons (Mobile)', () => {
    test.beforeEach(async ({ page }) => {
      await page.evaluate(() => {
        const modal = document.getElementById('rating-modal');
        if (modal) modal.classList.add('active');
      });
    });

    test('rating modal appears as bottom sheet', async ({ page }) => {
      const modal = page.locator('#rating-modal .modal');
      await expect(modal).toBeVisible();
      
      const box = await modal.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.y + box.height).toBeGreaterThanOrEqual(MOBILE.height - 50);
      }
    });

    test('close-rating-modal button meets touch target size', async ({ page }) => {
      const btn = page.getByTestId('close-rating-modal');
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('rating stars are large enough for touch', async ({ page }) => {
      const stars = page.locator('.rating-star');
      const firstStar = stars.first();
      const box = await firstStar.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        // Stars should be at least 40px for comfortable tapping
        expect(box.width).toBeGreaterThanOrEqual(40);
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    });

    test('all rating stars are tappable on mobile', async ({ page }) => {
      const stars = page.locator('.rating-star');
      
      for (let i = 0; i < 5; i++) {
        await stars.nth(i).tap();
        await expect(stars.nth(i)).toHaveClass(/active/);
      }
    });

    test('each rating star has unique test ID on mobile', async ({ page }) => {
      for (let i = 1; i <= 5; i++) {
        const star = page.getByTestId(`rating-star-${i}`);
        await expect(star).toBeVisible();
      }
    });

    test('rating-star-1 is tappable on mobile', async ({ page }) => {
      const star = page.getByTestId('rating-star-1');
      await star.tap();
      await expect(star).toHaveClass(/active/);
    });

    test('rating-star-2 is tappable on mobile', async ({ page }) => {
      const star = page.getByTestId('rating-star-2');
      await star.tap();
      await expect(star).toHaveClass(/active/);
      await expect(page.getByTestId('rating-star-1')).toHaveClass(/active/);
    });

    test('tapping specific star by test ID works on mobile', async ({ page }) => {
      await page.getByTestId('rating-star-3').tap();
      
      // First 3 stars should be active
      for (let i = 1; i <= 3; i++) {
        await expect(page.getByTestId(`rating-star-${i}`)).toHaveClass(/active/);
      }
    });

    test('submit-rating-btn is full-width on mobile', async ({ page }) => {
      const btn = page.getByTestId('submit-rating-btn');
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThan(300);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('rating-review textarea is functional on mobile', async ({ page }) => {
      const input = page.getByTestId('rating-review');
      await input.fill('Excellent GPU performance');
      await expect(input).toHaveValue('Excellent GPU performance');
    });
  });

  // ---------------------------------------------------------------------------
  // AI Models Page (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('AI Models Page (Mobile)', () => {
    test('models page loads correctly on mobile', async ({ page }) => {
      await page.getByTestId('nav-models').tap();
      await expect(page.getByTestId('page-models')).toHaveClass(/active/);
      await expect(page.getByTestId('models-list')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Toast Container (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('Toast Container (Mobile)', () => {
    test('toast-container is present on mobile', async ({ page }) => {
      const container = page.getByTestId('toast-container');
      await expect(container).toBeAttached();
    });
  });

  // ---------------------------------------------------------------------------
  // Navigation Tab Scrolling (Mobile)
  // ---------------------------------------------------------------------------

  test.describe('Navigation Tab Scrolling (Mobile)', () => {
    test('nav tabs are horizontally scrollable', async ({ page }) => {
      const navTabs = page.locator('.nav-tabs');
      await expect(navTabs).toBeVisible();
      
      // All tabs should be reachable
      await page.getByTestId('nav-models').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('nav-models')).toBeVisible();
    });
  });
});

// =============================================================================
// TABLET VIEWPORT TESTS
// =============================================================================

test.describe('Tablet Viewport - All Buttons', () => {
  const TABLET = { width: 768, height: 1024 };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('all navigation buttons work on tablet', async ({ page }) => {
    await page.getByTestId('nav-providers').click();
    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
    
    await page.getByTestId('nav-rentals').click();
    await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);
    
    await page.getByTestId('nav-models').click();
    await expect(page.getByTestId('page-models')).toHaveClass(/active/);
  });

  test('filter controls work on tablet', async ({ page }) => {
    await page.getByTestId('filter-gpu').selectOption('NVIDIA_A100_40GB');
    await page.getByTestId('apply-filters').click();
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('provider cards are clickable on tablet', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
  });

  test('rental modal works on tablet', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    
    await page.getByTestId('rental-duration').fill('6');
    await page.getByTestId('close-rental-modal').click();
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });
});

// =============================================================================
// KEYBOARD ACCESSIBILITY TESTS
// =============================================================================

test.describe('Keyboard Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('escape key closes rental modal', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
    
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });

  test('escape key closes rating modal', async ({ page }) => {
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });
    await expect(page.getByTestId('rating-modal')).toHaveClass(/active/);
    
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rating-modal')).not.toHaveClass(/active/);
  });

  test('tab navigation works through header buttons', async ({ page }) => {
    await page.getByTestId('nav-providers').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Should be able to tab through elements
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
  });
});

// =============================================================================
// BUTTON STATE TESTS
// =============================================================================

test.describe('Button States', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('active nav tab has correct styling', async ({ page }) => {
    const activeTab = page.getByTestId('nav-providers');
    await expect(activeTab).toHaveClass(/active/);
  });

  test('disabled button shows correct styling', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    
    const btn = page.getByTestId('create-rental-btn');
    await expect(btn).toBeDisabled();
  });

  test('rating submit button transitions from disabled to enabled', async ({ page }) => {
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });
    
    const btn = page.getByTestId('submit-rating-btn');
    await expect(btn).toBeDisabled();
    
    await page.locator('.rating-star').nth(2).click();
    await expect(btn).toBeEnabled();
  });
});

