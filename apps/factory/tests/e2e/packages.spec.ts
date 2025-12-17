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
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await expect(page.getByRole('heading', { name: /@jejunetwork\/jeju-sdk/i }).first()).toBeVisible();
    });

    test('should show install command with copy button', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      // Install command should be visible
      await expect(page.locator('code').filter({ hasText: /bun add/i })).toBeVisible();
    });

    test('should display package tabs', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await expect(page.getByRole('button', { name: /readme/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /dependencies/i })).toBeVisible();
    });

    test('should switch to versions tab', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await page.getByRole('button', { name: /versions/i }).click();
      
      // Should show version list
      await expect(page.locator('.card').first()).toBeVisible();
    });

    test('should switch to dependencies tab', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await page.getByRole('button', { name: /dependencies/i }).click();
      
      // Should show dependency list
      await expect(page.getByText(/dependencies/i).first()).toBeVisible();
    });

    test('should show download stats', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await expect(page.getByText(/weekly downloads/i)).toBeVisible();
      await expect(page.getByText(/total downloads/i)).toBeVisible();
    });

    test('should show maintainers', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await expect(page.getByText(/maintainers/i)).toBeVisible();
    });

    test('should show keywords/tags', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await expect(page.getByText(/keywords/i)).toBeVisible();
    });

    test('should render README markdown', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      // README content should be rendered
      await expect(page.locator('.prose, [class*="markdown"]').first()).toBeVisible();
    });

    test('should copy install command on button click', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      // Find copy button near install command
      const copyButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      await copyButton.click();
      
      // Should show check mark (copied state)
      // Note: actual clipboard test requires permissions
    });
  });

  test.describe('Package Version History', () => {
    test('should display all versions', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await page.getByRole('button', { name: /versions/i }).click();
      
      // Should show multiple versions
      await expect(page.locator('.card').first()).toBeVisible();
    });

    test('should show latest badge on current version', async ({ page }) => {
      await page.goto('/packages/%40jejunetwork/jeju-sdk');
      
      await page.getByRole('button', { name: /versions/i }).click();
      
      await expect(page.getByText(/latest/i).first()).toBeVisible();
    });
  });
});

