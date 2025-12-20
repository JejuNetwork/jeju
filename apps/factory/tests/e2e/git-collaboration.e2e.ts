/**
 * Git Collaboration E2E Tests
 * Tests issues, pull requests, and repo settings
 */

import { test, expect } from '@playwright/test';

test.describe('Git Collaboration', () => {
  test.describe('Issues', () => {
    test('should display new issue form', async ({ page }) => {
      await page.goto('/git/jeju/factory/issues/new');
      
      await expect(page.getByRole('heading', { name: /new issue/i })).toBeVisible();
      await expect(page.getByPlaceholder(/issue title/i)).toBeVisible();
    });

    test('should have markdown toolbar', async ({ page }) => {
      await page.goto('/git/jeju/factory/issues/new');
      
      // Check for write/preview tabs
      await expect(page.getByRole('button', { name: /write/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /preview/i })).toBeVisible();
    });

    test('should show label selector', async ({ page }) => {
      await page.goto('/git/jeju/factory/issues/new');
      
      await expect(page.getByText(/labels/i).first()).toBeVisible();
    });

    test('should show assignee selector', async ({ page }) => {
      await page.goto('/git/jeju/factory/issues/new');
      
      await expect(page.getByText(/assignees/i).first()).toBeVisible();
    });

    test('should display issue detail page', async ({ page }) => {
      await page.goto('/git/jeju/factory/issues/42');
      
      // Check for issue title
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByText(/#42/)).toBeVisible();
    });

    test('should show comments section', async ({ page }) => {
      await page.goto('/git/jeju/factory/issues/42');
      
      await expect(page.getByPlaceholder(/leave a comment/i)).toBeVisible();
    });

    test('should show issue status badge', async ({ page }) => {
      await page.goto('/git/jeju/factory/issues/42');
      
      // Should have a status badge visible
      await expect(page.locator('.badge').first()).toBeVisible();
    });
  });

  test.describe('Pull Requests', () => {
    test('should display new PR form', async ({ page }) => {
      await page.goto('/git/jeju/factory/pulls/new');
      
      await expect(page.getByRole('heading', { name: /open a pull request/i })).toBeVisible();
    });

    test('should show branch selectors', async ({ page }) => {
      await page.goto('/git/jeju/factory/pulls/new');
      
      await expect(page.getByText(/base:/i)).toBeVisible();
      await expect(page.getByText(/compare:/i)).toBeVisible();
    });

    test('should show diff summary', async ({ page }) => {
      await page.goto('/git/jeju/factory/pulls/new');
      
      // Check for file changes indicator
      await expect(page.getByText(/files changed/i)).toBeVisible();
    });

    test('should display PR detail page', async ({ page }) => {
      await page.goto('/git/jeju/factory/pulls/45');
      
      await expect(page.getByText(/#45/)).toBeVisible();
    });

    test('should show PR tabs', async ({ page }) => {
      await page.goto('/git/jeju/factory/pulls/45');
      
      await expect(page.getByRole('button', { name: /conversation/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /commits/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /files changed/i })).toBeVisible();
    });

    test('should display diff viewer', async ({ page }) => {
      await page.goto('/git/jeju/factory/pulls/45');
      
      // Click files tab
      await page.getByRole('button', { name: /files changed/i }).click();
      
      // Should show file paths
      await expect(page.getByText(/\.ts$/i).first()).toBeVisible();
    });

    test('should show merge button', async ({ page }) => {
      await page.goto('/git/jeju/factory/pulls/45');
      
      await expect(page.getByRole('button', { name: /merge/i })).toBeVisible();
    });
  });

  test.describe('Repository Settings', () => {
    test('should display settings page', async ({ page }) => {
      await page.goto('/git/jeju/factory/settings');
      
      await expect(page.getByRole('heading', { name: /repository settings/i })).toBeVisible();
    });

    test('should have settings tabs', async ({ page }) => {
      await page.goto('/git/jeju/factory/settings');
      
      await expect(page.getByRole('button', { name: /general/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /branches/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /collaborators/i })).toBeVisible();
    });

    test('should show visibility options', async ({ page }) => {
      await page.goto('/git/jeju/factory/settings');
      
      await expect(page.getByText(/public/i).first()).toBeVisible();
      await expect(page.getByText(/private/i).first()).toBeVisible();
    });

    test('should show danger zone', async ({ page }) => {
      await page.goto('/git/jeju/factory/settings');
      
      // Click danger zone tab
      await page.getByRole('button', { name: /danger zone/i }).click();
      
      await expect(page.getByText(/delete repository/i)).toBeVisible();
    });

    test('should show branch protection', async ({ page }) => {
      await page.goto('/git/jeju/factory/settings');
      
      await page.getByRole('button', { name: /branches/i }).click();
      
      await expect(page.getByText(/branch protection/i)).toBeVisible();
    });
  });
});

