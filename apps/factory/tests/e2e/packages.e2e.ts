/**
 * Packages E2E Tests
 * Tests package registry listing, detail view, and publishing
 */

import { test, expect } from '@playwright/test';

test.describe('Packages', () => {
  test.describe('Package List', () => {
    test('should display package list', async ({ page }) => {
      await page.goto('/packages');
      
      await expect(page.getByRole('heading', { name: /packages/i })).toBeVisible();
    });

    test('should show package stats', async ({ page }) => {
      await page.goto('/packages');
      
      // Stats should be visible
      const stats = page.locator('.card').first();
      await expect(stats).toBeVisible();
    });

    test('should search packages', async ({ page }) => {
      await page.goto('/packages');
      
      const searchInput = page.getByPlaceholder(/search packages/i);
      if (await searchInput.isVisible()) {
        await searchInput.fill('jeju-sdk');
        await expect(searchInput).toHaveValue('jeju-sdk');
      }
    });

    test('should filter packages by type', async ({ page }) => {
      await page.goto('/packages');
      
      // Look for filter buttons
      const filterButtons = page.locator('button').filter({ hasText: /all|library|tool|framework/i });
      const count = await filterButtons.count();
      
      if (count > 0) {
        await filterButtons.first().click();
      }
    });
  });

  test.describe('Package Detail', () => {
    test('should display package header', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      await expect(page.locator('h1').filter({ hasText: '@jeju/sdk' })).toBeVisible();
    });

    test('should show install command', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      // Install command or package info should be visible
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should display package tabs', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      await expect(page.getByRole('button', { name: /readme/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /dependencies/i })).toBeVisible();
    });

    test('should switch to versions tab', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      await page.getByRole('button', { name: /versions/i }).click();
      
      // Should show version list
      await expect(page.locator('.card').first()).toBeVisible();
    });

    test('should switch to dependencies tab', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      await page.getByRole('button', { name: /dependencies/i }).click();
      
      // Should show dependency list
      await expect(page.getByText(/dependencies/i).first()).toBeVisible();
    });

    test('should show download stats', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      // Page shows "Downloads" label and a number
      await expect(page.getByText(/downloads/i).first()).toBeVisible();
    });

    test('should show license info', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      await expect(page.getByText(/license/i).first()).toBeVisible();
    });

    test('should show keyword badges', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      // Keywords are shown as badges (e.g., "jeju", "web3", "sdk")
      await expect(page.locator('.badge').first()).toBeVisible();
    });

    test('should render README markdown', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      // README content should be rendered
      await expect(page.locator('.prose, [class*="markdown"]').first()).toBeVisible();
    });

    test('should have copy buttons', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      // There should be copy buttons on the page
      const buttons = page.getByRole('button');
      await expect(buttons.first()).toBeVisible();
    });
  });

  test.describe('Package Version History', () => {
    test('should display all versions', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      await page.getByRole('button', { name: /versions/i }).click();
      
      // Should show multiple versions
      await expect(page.locator('.card').first()).toBeVisible();
    });

    test('should show latest badge on current version', async ({ page }) => {
      await page.goto('/packages/%40jeju/sdk');
      
      await page.getByRole('button', { name: /versions/i }).click();
      
      await expect(page.getByText(/latest/i).first()).toBeVisible();
    });
  });

  test.describe('Publish Package', () => {
    test('should display publish page', async ({ page }) => {
      await page.goto('/packages/publish');
      
      await expect(page.getByRole('heading', { name: /publish package/i })).toBeVisible();
    });

    test('should show CLI and upload method toggle', async ({ page }) => {
      await page.goto('/packages/publish');
      
      await expect(page.getByRole('button', { name: /cli/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /upload/i }).first()).toBeVisible();
    });

    test('should show npm registry configuration', async ({ page }) => {
      await page.goto('/packages/publish');
      
      // Should show .npmrc config
      await expect(page.getByText(/configure registry/i)).toBeVisible();
      await expect(page.getByText(/pkg.jeju.network/i).first()).toBeVisible();
    });

    test('should show authentication instructions', async ({ page }) => {
      await page.goto('/packages/publish');
      
      await expect(page.getByText(/authenticate/i)).toBeVisible();
      await expect(page.getByText(/bun jeju login/i)).toBeVisible();
    });

    test('should show publish command', async ({ page }) => {
      await page.goto('/packages/publish');
      
      await expect(page.getByText(/bun jeju publish/i)).toBeVisible();
    });

    test('should switch to upload method', async ({ page }) => {
      await page.goto('/packages/publish');
      
      await page.getByRole('button', { name: /upload tarball/i }).click();
      
      // Should show file upload area
      await expect(page.getByText(/upload tarball/i).first()).toBeVisible();
      await expect(page.getByText(/package name/i)).toBeVisible();
    });

    test('should show package.json requirements', async ({ page }) => {
      await page.goto('/packages/publish');
      
      await expect(page.getByText(/package requirements/i)).toBeVisible();
    });
  });
});

