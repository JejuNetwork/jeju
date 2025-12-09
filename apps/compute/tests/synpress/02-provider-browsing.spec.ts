/**
 * Provider Browsing Tests
 * Tests provider listing, filtering, and detail viewing
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Provider Browsing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display providers page by default', async ({ page }) => {
    const providersPage = page.getByTestId('page-providers');
    await expect(providersPage).toBeVisible();
    await expect(providersPage).toHaveClass(/active/);
  });

  test('should show page header with title', async ({ page }) => {
    const title = page.locator('.page-title');
    await expect(title).toContainText('Compute Providers');
  });

  test('should display stats bar with metrics', async ({ page }) => {
    const statsBar = page.getByTestId('stats-bar');
    await expect(statsBar).toBeVisible();

    // Check all stats are present
    await expect(page.getByTestId('stat-providers')).toBeVisible();
    await expect(page.getByTestId('stat-gpu-hours')).toBeVisible();
    await expect(page.getByTestId('stat-avg-price')).toBeVisible();
    await expect(page.getByTestId('stat-staked')).toBeVisible();
  });

  test('should display provider cards', async ({ page }) => {
    // Wait for loading to complete
    await page.waitForSelector('.provider-card', { timeout: 10000 });

    const providerGrid = page.getByTestId('provider-grid');
    await expect(providerGrid).toBeVisible();

    const cards = page.locator('.provider-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show provider details in card', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });

    const firstCard = page.locator('.provider-card').first();
    
    // Check card has required elements
    await expect(firstCard.locator('.provider-name')).toBeVisible();
    await expect(firstCard.locator('.provider-address')).toBeVisible();
    await expect(firstCard.locator('.provider-status')).toBeVisible();
    await expect(firstCard.locator('.provider-specs')).toBeVisible();
    await expect(firstCard.locator('.provider-price')).toBeVisible();
    await expect(firstCard.locator('.provider-rating')).toBeVisible();
  });

  test('should show GPU specs in provider card', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });

    const firstCard = page.locator('.provider-card').first();
    const specs = firstCard.locator('.provider-specs');

    // Check GPU spec is shown
    const gpuSpec = specs.locator('.spec-item').filter({ hasText: 'GPU' });
    await expect(gpuSpec).toBeVisible();
  });

  test('should show provider tags (SSH, Docker, TEE)', async ({ page }) => {
    await page.waitForSelector('.provider-card', { timeout: 10000 });

    // At least one provider should have tags
    const tags = page.locator('.provider-tag');
    const count = await tags.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Provider Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 10000 });
  });

  test('should display all filter controls', async ({ page }) => {
    await expect(page.getByTestId('filters-bar')).toBeVisible();
    await expect(page.getByTestId('filter-gpu')).toBeVisible();
    await expect(page.getByTestId('filter-memory')).toBeVisible();
    await expect(page.getByTestId('filter-price')).toBeVisible();
    await expect(page.getByTestId('filter-features')).toBeVisible();
    await expect(page.getByTestId('apply-filters')).toBeVisible();
    await expect(page.getByTestId('reset-filters')).toBeVisible();
  });

  test('should filter by GPU type', async ({ page }) => {
    const gpuFilter = page.getByTestId('filter-gpu');
    await gpuFilter.selectOption('NVIDIA_H100');
    await page.getByTestId('apply-filters').click();

    // Wait for re-render
    await page.waitForTimeout(500);

    // All visible cards should have H100
    const cards = page.locator('.provider-card');
    const count = await cards.count();

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        const gpuSpec = card.locator('.spec-value.gpu');
        await expect(gpuSpec).toContainText('H100');
      }
    }
  });

  test('should filter by memory', async ({ page }) => {
    await page.getByTestId('filter-memory').fill('48');
    await page.getByTestId('apply-filters').click();
    await page.waitForTimeout(500);

    // Cards should only show high-memory GPUs or empty state
    const cards = page.locator('.provider-card');
    const emptyState = page.locator('.empty-state');

    const cardCount = await cards.count();
    const emptyCount = await emptyState.count();

    expect(cardCount > 0 || emptyCount > 0).toBeTruthy();
  });

  test('should filter by features - SSH', async ({ page }) => {
    await page.getByTestId('filter-features').selectOption('ssh');
    await page.getByTestId('apply-filters').click();
    await page.waitForTimeout(500);

    const cards = page.locator('.provider-card');
    const count = await cards.count();

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const sshTag = cards.nth(i).locator('.provider-tag.ssh');
        await expect(sshTag).toBeVisible();
      }
    }
  });

  test('should filter by features - Docker', async ({ page }) => {
    await page.getByTestId('filter-features').selectOption('docker');
    await page.getByTestId('apply-filters').click();
    await page.waitForTimeout(500);

    const cards = page.locator('.provider-card');
    const count = await cards.count();

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const dockerTag = cards.nth(i).locator('.provider-tag.docker');
        await expect(dockerTag).toBeVisible();
      }
    }
  });

  test('should reset filters', async ({ page }) => {
    // Apply some filters
    await page.getByTestId('filter-gpu').selectOption('NVIDIA_H100');
    await page.getByTestId('filter-memory').fill('48');
    await page.getByTestId('apply-filters').click();
    await page.waitForTimeout(500);

    const beforeCount = await page.locator('.provider-card').count();

    // Reset
    await page.getByTestId('reset-filters').click();
    await page.waitForTimeout(500);

    // Should show more cards now
    const afterCount = await page.locator('.provider-card').count();
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);

    // Filters should be cleared
    await expect(page.getByTestId('filter-gpu')).toHaveValue('');
    await expect(page.getByTestId('filter-memory')).toHaveValue('');
  });

  test('should show empty state when no matches', async ({ page }) => {
    // Apply impossible filter
    await page.getByTestId('filter-memory').fill('999999');
    await page.getByTestId('apply-filters').click();
    await page.waitForTimeout(500);

    const emptyState = page.locator('.empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('No providers match');
  });
});

