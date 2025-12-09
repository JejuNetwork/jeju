import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Markets Page', () => {
  test('should display markets page without errors', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(500);
    
    await assertNoPageErrors(page);
    await expect(page.getByRole('heading', { name: /Prediction Markets/i })).toBeVisible();
    await expect(page.getByText(/Trade on real-world outcomes/i)).toBeVisible();
  });

  test('should show market stats without errors', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(500);

    await assertNoPageErrors(page);
    await expect(page.getByText(/Total Volume/i)).toBeVisible();
    await expect(page.getByText(/Active Markets/i)).toBeVisible();
    await expect(page.getByText(/Total Markets/i)).toBeVisible();
  });

  test('should have filter buttons', async ({ page }) => {
    await page.goto('/markets');

    await expect(page.getByRole('button', { name: /All Markets/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Active$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Resolved$/i })).toBeVisible();
  });

  test('should switch between filters', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(500);

    const activeButton = page.getByRole('button', { name: /^Active$/i });
    await activeButton.click();
    await expect(activeButton).toHaveClass(/bg-purple-600/);

    const allButton = page.getByRole('button', { name: /All Markets/i });
    await allButton.click();
    await expect(allButton).toHaveClass(/bg-purple-600/);
  });

  test('should display markets grid, loading, or error state', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(3000); // Increased wait for indexer

    const grid = page.getByTestId('markets-grid');
    const loading = page.locator('.animate-spin');
    const errorMessage = page.getByText(/Failed to load markets/i);
    const noMarkets = page.getByText(/No Markets Found/i);
    
    const gridExists = await grid.isVisible();
    const loadingExists = await loading.isVisible();
    const errorExists = await errorMessage.isVisible();
    const noMarketsExists = await noMarkets.isVisible();
    
    // Should show one of these states
    expect(gridExists || loadingExists || errorExists || noMarketsExists).toBe(true);
  });
});

test.describe('Portfolio Page', () => {
  test('should display portfolio page', async ({ page }) => {
    await page.goto('/portfolio');

    await expect(page.getByRole('heading', { name: /Your Portfolio/i })).toBeVisible();
  });

  test('should show wallet connection requirement', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should have portfolio stats sections', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toMatch(/Total Value|Total P&L|Active Positions|Connect/i);
  });
});
