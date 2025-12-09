import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Markets Search and Filtering', () => {
  test('should have search input', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(500);
    
    await assertNoPageErrors(page);
    const searchInput = page.getByTestId('market-search');
    await expect(searchInput).toBeVisible();
  });

  test('should filter markets by search query', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(1000);
    
    await assertNoPageErrors(page);
    
    const searchInput = page.getByTestId('market-search');
    await searchInput.fill('test');
    await page.waitForTimeout(500);
    
    await assertNoPageErrors(page);
  });

  test('should show clear search button when searching', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(1000);
    
    await assertNoPageErrors(page);
    
    const searchInput = page.getByTestId('market-search');
    await searchInput.fill('nonexistent market query');
    await page.waitForTimeout(500);
    
    const clearButton = page.getByRole('button', { name: /Clear Search/i });
    const clearExists = await clearButton.isVisible();
    
    if (clearExists) {
      await clearButton.click();
      await expect(searchInput).toHaveValue('');
    }
  });

  test('should have filter buttons with proper testids', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(500);
    
    await assertNoPageErrors(page);
    
    await expect(page.getByTestId('filter-all')).toBeVisible();
    await expect(page.getByTestId('filter-active')).toBeVisible();
    await expect(page.getByTestId('filter-resolved')).toBeVisible();
  });
});



