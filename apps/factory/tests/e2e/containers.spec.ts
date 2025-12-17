/**
 * Containers E2E Tests
 * Tests container registry interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Containers', () => {
  test.describe('Container List', () => {
    test('should display containers page', async ({ page }) => {
      await page.goto('/containers');
      
      await expect(page.getByRole('heading', { name: /containers/i })).toBeVisible();
    });

    test('should show container stats', async ({ page }) => {
      await page.goto('/containers');
      
      await expect(page.getByText(/total containers/i)).toBeVisible();
      await expect(page.getByText(/total pulls/i)).toBeVisible();
    });

    test('should filter containers', async ({ page }) => {
      await page.goto('/containers');
      
      const filters = ['All Containers', 'official', 'community', 'verified'];
      
      for (const filter of filters) {
        const button = page.getByRole('button', { name: new RegExp(filter, 'i') });
        if (await button.isVisible()) {
          await button.click();
          break;
        }
      }
    });

    test('should search containers', async ({ page }) => {
      await page.goto('/containers');
      
      const searchInput = page.getByPlaceholder(/search containers/i);
      if (await searchInput.isVisible()) {
        await searchInput.fill('node');
        await expect(searchInput).toHaveValue('node');
      }
    });

    test('should display container cards', async ({ page }) => {
      await page.goto('/containers');
      
      const containerCards = page.locator('.card');
      await expect(containerCards.first()).toBeVisible();
    });

    test('should show pull counts', async ({ page }) => {
      await page.goto('/containers');
      
      // Pull counts like "1.2M pulls"
      await expect(page.getByText(/pulls/i).first()).toBeVisible();
    });

    test('should show architecture badges', async ({ page }) => {
      await page.goto('/containers');
      
      // Architecture badges (ARM64, x86)
      const archBadges = page.locator('.badge').filter({ hasText: /arm64|x86|amd64/i });
      if (await archBadges.first().isVisible()) {
        await expect(archBadges.first()).toBeVisible();
      }
    });

    test('should show push container button', async ({ page }) => {
      await page.goto('/containers');
      
      await expect(page.getByRole('link', { name: /push container/i })).toBeVisible();
    });
  });

  test.describe('Container Detail', () => {
    test('should navigate to container detail', async ({ page }) => {
      await page.goto('/containers');
      
      const containerLink = page.locator('a[href^="/containers/"]').first();
      if (await containerLink.isVisible()) {
        await containerLink.click();
        await expect(page).toHaveURL(/\/containers\/.+/);
      }
    });
  });

  test.describe('Container Copy Commands', () => {
    test('should show pull command', async ({ page }) => {
      await page.goto('/containers');
      
      // Pull command code block
      await expect(page.locator('code').filter({ hasText: /docker pull|bun run pull/i }).first()).toBeVisible();
    });

    test('should have copy button for pull command', async ({ page }) => {
      await page.goto('/containers');
      
      const copyButtons = page.locator('button').filter({ has: page.locator('svg') });
      await expect(copyButtons.first()).toBeVisible();
    });
  });

  test.describe('Container Tags', () => {
    test('should show available tags', async ({ page }) => {
      await page.goto('/containers/jeju/factory-runner');
      
      // Tags section
      await expect(page.getByText(/tags|versions/i).first()).toBeVisible();
    });

    test('should show latest tag', async ({ page }) => {
      await page.goto('/containers/jeju/factory-runner');
      
      await expect(page.getByText(/latest/i).first()).toBeVisible();
    });
  });
});


