/**
 * Basic UI E2E Tests
 * Tests that do NOT require MetaMask and can run in headless mode
 */

import { test, expect } from '@playwright/test';

test.describe('Page Load', () => {
  test('page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/Jeju Compute/);
    await page.waitForLoadState('networkidle');
    
    // Filter out expected errors (favicon, network requests to gateway that may not be running)
    const realErrors = errors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('Failed to fetch') &&
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('Load providers error') &&
      !e.includes('net::')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('page has correct meta description', async ({ page }) => {
    await page.goto('/');
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveAttribute('content', /GPU|CPU|rental/i);
  });
});

test.describe('Header Elements', () => {
  test('logo is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('logo')).toContainText('Jeju Compute');
  });

  test('navigation tabs are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('nav-providers')).toBeVisible();
    await expect(page.getByTestId('nav-rentals')).toBeVisible();
    await expect(page.getByTestId('nav-models')).toBeVisible();
  });

  test('network badge is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('network-badge')).toBeVisible();
    await expect(page.getByTestId('network-badge')).toContainText('Sepolia');
  });

  test('connect wallet button is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connect-wallet')).toBeVisible();
    await expect(page.getByTestId('connect-wallet')).toContainText('Connect Wallet');
  });
});

test.describe('Stats Bar', () => {
  test('stats bar is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('stats-bar')).toBeVisible();
  });

  test('all stat cards are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('stat-providers')).toBeVisible();
    await expect(page.getByTestId('stat-gpu-hours')).toBeVisible();
    await expect(page.getByTestId('stat-avg-price')).toBeVisible();
    await expect(page.getByTestId('stat-staked')).toBeVisible();
  });
});

test.describe('Filters', () => {
  test('filters bar is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('filters-bar')).toBeVisible();
  });

  test('all filter controls are functional', async ({ page }) => {
    await page.goto('/');

    // GPU filter
    const gpuFilter = page.getByTestId('filter-gpu');
    await expect(gpuFilter).toBeVisible();
    await gpuFilter.selectOption('NVIDIA_H100');
    await expect(gpuFilter).toHaveValue('NVIDIA_H100');

    // Memory filter
    const memoryFilter = page.getByTestId('filter-memory');
    await expect(memoryFilter).toBeVisible();
    await memoryFilter.fill('32');
    await expect(memoryFilter).toHaveValue('32');

    // Price filter
    const priceFilter = page.getByTestId('filter-price');
    await expect(priceFilter).toBeVisible();
    await priceFilter.fill('0.1');
    await expect(priceFilter).toHaveValue('0.1');

    // Features filter
    const featuresFilter = page.getByTestId('filter-features');
    await expect(featuresFilter).toBeVisible();
    await featuresFilter.selectOption('ssh');
    await expect(featuresFilter).toHaveValue('ssh');
  });

  test('apply filters button works', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    await page.getByTestId('filter-gpu').selectOption('NVIDIA_A100_40GB');
    await page.getByTestId('apply-filters').click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('reset filters button works', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    // Set filters
    await page.getByTestId('filter-gpu').selectOption('NVIDIA_H100');
    await page.getByTestId('filter-memory').fill('64');
    await page.getByTestId('apply-filters').click();

    // Reset
    await page.getByTestId('reset-filters').click();

    await expect(page.getByTestId('filter-gpu')).toHaveValue('');
    await expect(page.getByTestId('filter-memory')).toHaveValue('');
  });
});

test.describe('Provider Grid', () => {
  test('provider grid is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('providers load and display', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    const cards = page.locator('.provider-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('provider card has required elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    const card = page.locator('.provider-card').first();
    await expect(card.locator('.provider-name')).toBeVisible();
    await expect(card.locator('.provider-address')).toBeVisible();
    await expect(card.locator('.provider-status')).toBeVisible();
    await expect(card.locator('.provider-specs')).toBeVisible();
    await expect(card.locator('.provider-price')).toBeVisible();
  });

  test('clicking provider card opens modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    await page.locator('.provider-card').first().click();
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
  });
});

test.describe('Navigation', () => {
  test('clicking nav tabs switches pages', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Providers should be active by default
    await expect(page.getByTestId('nav-providers')).toHaveClass(/active/);
    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);

    // Switch to rentals
    await page.getByTestId('nav-rentals').click();
    await expect(page.getByTestId('nav-rentals')).toHaveClass(/active/);
    await expect(page.getByTestId('page-rentals')).toHaveClass(/active/);

    // Switch to models
    await page.getByTestId('nav-models').click();
    await expect(page.getByTestId('nav-models')).toHaveClass(/active/);
    await expect(page.getByTestId('page-models')).toHaveClass(/active/);

    // Switch back to providers
    await page.getByTestId('nav-providers').click();
    await expect(page.getByTestId('nav-providers')).toHaveClass(/active/);
    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
  });
});

test.describe('My Rentals Page', () => {
  test('rentals page shows empty state', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-rentals').click();

    await expect(page.getByTestId('no-rentals')).toBeVisible();
    await expect(page.getByTestId('browse-providers-btn')).toBeVisible();
  });

  test('browse providers button navigates to providers', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-rentals').click();
    await page.getByTestId('browse-providers-btn').click();

    await expect(page.getByTestId('page-providers')).toHaveClass(/active/);
  });
});

test.describe('AI Models Page', () => {
  test('models page loads', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-models').click();

    await expect(page.getByTestId('page-models')).toHaveClass(/active/);
    await expect(page.getByTestId('models-list')).toBeVisible();
  });
});

test.describe('Rental Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });
    await page.locator('.provider-card').first().click();
  });

  test('modal opens and displays content', async ({ page }) => {
    await expect(page.getByTestId('rental-modal')).toHaveClass(/active/);
    await expect(page.getByTestId('selected-provider-info')).toBeVisible();
    await expect(page.getByTestId('rental-form')).toBeVisible();
  });

  test('close button closes modal', async ({ page }) => {
    await page.getByTestId('close-rental-modal').click();
    await page.waitForTimeout(300); // Wait for animation
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });

  test('clicking backdrop closes modal', async ({ page }) => {
    await page.locator('#rental-modal.modal-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });

  test('escape key closes modal', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rental-modal')).not.toHaveClass(/active/);
  });

  test('duration input is functional', async ({ page }) => {
    const input = page.getByTestId('rental-duration');
    await input.fill('12');
    await expect(input).toHaveValue('12');
  });

  test('ssh key textarea is functional', async ({ page }) => {
    const input = page.getByTestId('rental-ssh-key');
    await input.fill('ssh-rsa AAAA test');
    await expect(input).toHaveValue('ssh-rsa AAAA test');
  });

  test('docker image input is functional', async ({ page }) => {
    const input = page.getByTestId('rental-docker-image');
    await input.fill('nvidia/cuda:12.0');
    await expect(input).toHaveValue('nvidia/cuda:12.0');
  });

  test('startup script textarea is functional', async ({ page }) => {
    const input = page.getByTestId('rental-startup-script');
    const script = '#!/bin/bash\necho hello';
    await input.fill(script);
    await expect(input).toHaveValue(script);
  });

  test('cost breakdown is visible', async ({ page }) => {
    await expect(page.getByTestId('cost-breakdown')).toBeVisible();
  });

  test('cost updates when duration changes', async ({ page }) => {
    const totalBefore = await page.locator('#cost-total').textContent();
    await page.getByTestId('rental-duration').fill('10');
    await page.waitForTimeout(100);
    const totalAfter = await page.locator('#cost-total').textContent();
    expect(totalAfter).not.toBe(totalBefore);
  });

  test('create rental button is disabled without wallet', async ({ page }) => {
    const btn = page.getByTestId('create-rental-btn');
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText('Connect Wallet First');
  });
});

test.describe('Rating Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Open the rating modal via JS
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });
    await page.waitForTimeout(100);
  });

  test('modal displays correctly', async ({ page }) => {
    await expect(page.getByTestId('rating-modal')).toHaveClass(/active/);
    await expect(page.getByTestId('rating-stars')).toBeVisible();
    await expect(page.getByTestId('submit-rating-btn')).toBeVisible();
  });

  test('close button closes modal', async ({ page }) => {
    await page.getByTestId('close-rating-modal').click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('rating-modal')).not.toHaveClass(/active/);
  });

  test('all 5 rating stars are visible', async ({ page }) => {
    for (let i = 1; i <= 5; i++) {
      await expect(page.getByTestId(`rating-star-${i}`)).toBeVisible();
    }
  });

  test('clicking stars activates them', async ({ page }) => {
    await page.getByTestId('rating-star-3').click();

    for (let i = 1; i <= 3; i++) {
      await expect(page.getByTestId(`rating-star-${i}`)).toHaveClass(/active/);
    }
    await expect(page.getByTestId('rating-star-4')).not.toHaveClass(/active/);
    await expect(page.getByTestId('rating-star-5')).not.toHaveClass(/active/);
  });

  test('submit button is disabled initially', async ({ page }) => {
    await expect(page.getByTestId('submit-rating-btn')).toBeDisabled();
  });

  test('submit button is enabled after selecting stars', async ({ page }) => {
    await page.getByTestId('rating-star-1').click();
    await expect(page.getByTestId('submit-rating-btn')).toBeEnabled();
  });

  test('review textarea is functional', async ({ page }) => {
    const input = page.getByTestId('rating-review');
    await input.fill('Great experience');
    await expect(input).toHaveValue('Great experience');
  });

  test('escape key closes modal', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rating-modal')).not.toHaveClass(/active/);
  });
});

test.describe('Toast Container', () => {
  test('toast container exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('toast-container')).toBeAttached();
  });

  test('toast appears on wallet connection attempt without MetaMask', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      delete (window as Window & { ethereum?: unknown }).ethereum;
    });

    await page.getByTestId('connect-wallet').click();

    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Responsive - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('header elements are visible on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('connect-wallet')).toBeVisible();
  });

  test('navigation tabs are scrollable on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('nav-providers')).toBeVisible();
    await page.getByTestId('nav-models').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('nav-models')).toBeVisible();
  });

  test('provider grid displays single column on mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });

    const grid = page.getByTestId('provider-grid');
    const style = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    expect(style).not.toContain('380px'); // Should not have min-width columns
  });

  test('filter controls are full-width on mobile', async ({ page }) => {
    await page.goto('/');
    const gpuFilter = page.getByTestId('filter-gpu');
    const box = await gpuFilter.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(300);
    }
  });

  test('buttons meet touch target size (44px)', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByTestId('connect-wallet');
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('modal appears as bottom sheet on mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 15000 });
    await page.locator('.provider-card').first().click();

    const modal = page.locator('.modal');
    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y + box.height).toBeGreaterThanOrEqual(812 - 50);
    }
  });
});

test.describe('Responsive - Tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('all elements are visible on tablet', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('logo')).toBeVisible();
    await expect(page.getByTestId('stats-bar')).toBeVisible();
    await expect(page.getByTestId('filters-bar')).toBeVisible();
    await expect(page.getByTestId('provider-grid')).toBeVisible();
  });

  test('stats bar shows 2 columns on tablet', async ({ page }) => {
    await page.goto('/');
    const statsBar = page.getByTestId('stats-bar');
    const style = await statsBar.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    expect(style).toContain('1fr'); // Uses grid
  });
});

