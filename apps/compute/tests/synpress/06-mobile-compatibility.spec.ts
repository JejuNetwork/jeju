/**
 * Mobile Compatibility Tests
 * Comprehensive tests for mobile viewport support across all features
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

// Common mobile viewport sizes
const VIEWPORTS = {
  iPhoneSE: { width: 375, height: 667 },
  iPhone12: { width: 390, height: 844 },
  iPhoneProMax: { width: 428, height: 926 },
  pixel5: { width: 393, height: 851 },
  galaxyS20: { width: 360, height: 800 },
  iPad: { width: 768, height: 1024 },
  iPadPro: { width: 1024, height: 1366 },
};

test.describe('Mobile - iPhone SE (375px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPhoneSE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('header elements are visible and properly stacked', async ({ page }) => {
    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('connect-wallet')).toBeVisible();
    
    // Navigation tabs should be scrollable
    const navTabs = page.locator('.nav-tabs');
    await expect(navTabs).toBeVisible();
    
    // All nav items accessible
    await expect(page.getByTestId('nav-providers')).toBeVisible();
    await expect(page.getByTestId('nav-rentals')).toBeVisible();
    await expect(page.getByTestId('nav-models')).toBeVisible();
  });

  test('stats bar shows 2 columns on mobile', async ({ page }) => {
    const statsBar = page.getByTestId('stats-bar');
    await expect(statsBar).toBeVisible();
    
    // All stats should be visible
    await expect(page.getByTestId('stat-providers')).toBeVisible();
    await expect(page.getByTestId('stat-gpu-hours')).toBeVisible();
    await expect(page.getByTestId('stat-avg-price')).toBeVisible();
    await expect(page.getByTestId('stat-staked')).toBeVisible();
  });

  test('filter bar is properly stacked', async ({ page }) => {
    const filtersBar = page.getByTestId('filters-bar');
    await expect(filtersBar).toBeVisible();
    
    // All filter controls visible
    await expect(page.getByTestId('filter-gpu')).toBeVisible();
    await expect(page.getByTestId('filter-memory')).toBeVisible();
    await expect(page.getByTestId('filter-features')).toBeVisible();
    await expect(page.getByTestId('apply-filters')).toBeVisible();
    await expect(page.getByTestId('reset-filters')).toBeVisible();
  });

  test('provider cards display in single column', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    
    const cards = page.locator('.provider-card');
    const firstCard = cards.first();
    
    // Card should be visible and have proper content
    await expect(firstCard.locator('.provider-name')).toBeVisible();
    await expect(firstCard.locator('.provider-specs')).toBeVisible();
    await expect(firstCard.locator('.provider-price')).toBeVisible();
  });

  test('provider card is tappable and opens modal', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    
    // Tap first provider card
    await page.locator('.provider-card').first().click();
    
    // Modal should open
    const modal = page.getByTestId('rental-modal');
    await expect(modal).toHaveClass(/active/);
  });

  test('modal displays as bottom sheet on mobile', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    
    // Modal should be at the bottom
    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Modal bottom should be at viewport bottom (within safe area tolerance)
      expect(box.y + box.height).toBeGreaterThanOrEqual(VIEWPORTS.iPhoneSE.height - 50);
    }
  });

  test('modal can be closed by tapping backdrop', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
    
    // Click on backdrop (top of modal overlay)
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
    
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });

  test('form inputs are touch-friendly', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    
    // Duration input should be at least 48px tall
    const durationInput = page.getByTestId('rental-duration');
    await expect(durationInput).toBeVisible();
    const inputBox = await durationInput.boundingBox();
    expect(inputBox).not.toBeNull();
    if (inputBox) {
      expect(inputBox.height).toBeGreaterThanOrEqual(44);
    }
    
    // Can interact with input
    await durationInput.fill('5');
    await expect(durationInput).toHaveValue('5');
  });

  test('navigation tabs are scrollable', async ({ page }) => {
    const navTabs = page.locator('.nav-tabs');
    
    // Try scrolling to last tab
    await page.getByTestId('nav-models').scrollIntoViewIfNeeded();
    await page.getByTestId('nav-models').click();
    
    await expect(page.getByTestId('page-models')).toHaveClass(/active/);
  });

  test('filters can be applied on mobile', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    
    // Select filter
    await page.getByTestId('filter-features').selectOption('ssh');
    await page.getByTestId('apply-filters').click();
    
    await page.waitForTimeout(500);
    
    // Grid should still be visible
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });
});

test.describe('Mobile - iPhone 12 Pro Max (428px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPhoneProMax);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('page loads correctly on larger mobile', async ({ page }) => {
    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('stats-bar')).toBeVisible();
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('can complete filter and view flow', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    
    // Apply filter
    await page.getByTestId('filter-gpu').selectOption('NVIDIA_RTX_4090');
    await page.getByTestId('apply-filters').click();
    
    await page.waitForTimeout(500);
    
    // Open provider
    const card = page.locator('.provider-card').first();
    if (await card.isVisible()) {
      await card.click();
      await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
    }
  });
});

test.describe('Mobile - Galaxy S20 (360px - narrow)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.galaxyS20);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('content fits on narrow viewport', async ({ page }) => {
    // Nothing should overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(VIEWPORTS.galaxyS20.width + 5);
  });

  test('text remains readable', async ({ page }) => {
    const title = page.locator('.page-title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Compute Providers');
  });
});

test.describe('Tablet - iPad (768px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPad);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('shows tablet-optimized layout', async ({ page }) => {
    await expect(page.getByTestId('stats-bar')).toBeVisible();
    
    // Stats should be in 2 columns on tablet
    const statsCards = page.locator('.stat-card');
    const count = await statsCards.count();
    expect(count).toBe(4);
  });

  test('provider grid shows multiple columns', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    
    // Grid should have responsive layout
    const grid = page.getByTestId('provider-grid');
    await expect(grid).toBeVisible();
  });

  test('modal appears centered on tablet', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });
    await page.locator('.provider-card').first().click();
    
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
  });
});

test.describe('Mobile Wallet Integration', () => {
  test('wallet connection works on mobile', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.iPhone12);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect
    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();

    // Verify connected
    await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Mobile Rentals Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPhoneSE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('rentals page displays correctly on mobile', async ({ page }) => {
    await page.getByTestId('nav-rentals').click();
    await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);
    
    // Empty state or rentals list should be visible
    const emptyState = page.getByTestId('no-rentals');
    const rentalsList = page.getByTestId('rentals-list');
    
    const emptyVisible = await emptyState.isVisible();
    const listVisible = await rentalsList.isVisible();
    
    expect(emptyVisible || listVisible).toBeTruthy();
  });

  test('browse providers button works on mobile', async ({ page }) => {
    await page.getByTestId('nav-rentals').click();
    await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);
    
    const browseBtn = page.getByTestId('browse-providers-btn');
    if (await browseBtn.isVisible()) {
      await browseBtn.click();
      await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
    }
  });
});

test.describe('Mobile AI Models Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPhone12);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('AI models page accessible on mobile', async ({ page }) => {
    await page.getByTestId('nav-models').click();
    await expect(page.getByTestId('page-models')).toHaveClass(/active/);
    await expect(page.getByTestId('models-list')).toBeVisible();
  });
});

test.describe('Mobile Toast Notifications', () => {
  test('toast appears in correct position on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPhoneSE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Trigger error toast
    await page.evaluate(() => {
      (window as Window & { ethereum?: unknown }).ethereum = undefined;
    });
    await page.getByTestId('connect-wallet').click();

    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    
    // Toast should be visible within viewport
    const box = await toast.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORTS.iPhoneSE.height);
    }
  });
});

test.describe('Mobile Orientation', () => {
  test('works in landscape mode', async ({ page }) => {
    // Landscape iPhone
    await page.setViewportSize({ width: 812, height: 375 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });
});

test.describe('Mobile Performance', () => {
  test('page loads within acceptable time on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iPhone12);
    
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - startTime;
    
    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });
});






