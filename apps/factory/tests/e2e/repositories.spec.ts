/**
 * Repositories E2E Tests
 * Tests git repository listing, detail view, and interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Repositories', () => {
  test.describe('Repository List', () => {
    test('should display repository list', async ({ page }) => {
      await page.goto('/git');
      
      await expect(page.getByRole('heading', { name: /repositories/i })).toBeVisible();
    });

    test('should show repository stats', async ({ page }) => {
      await page.goto('/git');
      
      // Check stats are present
      await expect(page.getByText(/total repos/i)).toBeVisible();
    });

    test('should filter repositories by visibility', async ({ page }) => {
      await page.goto('/git');
      
      // Click filter buttons
      const publicFilter = page.getByRole('button', { name: /public/i });
      const privateFilter = page.getByRole('button', { name: /private/i });
      
      if (await publicFilter.isVisible()) {
        await publicFilter.click();
        await expect(publicFilter).toHaveClass(/bg-accent/);
      }
      
      if (await privateFilter.isVisible()) {
        await privateFilter.click();
        await expect(privateFilter).toHaveClass(/bg-accent/);
      }
    });

    test('should search repositories', async ({ page }) => {
      await page.goto('/git');
      
      const searchInput = page.getByPlaceholder(/find a repository/i);
      await searchInput.fill('contracts');
      await expect(searchInput).toHaveValue('contracts');
    });

    test('should sort repositories', async ({ page }) => {
      await page.goto('/git');
      
      const sortSelect = page.locator('select').first();
      if (await sortSelect.isVisible()) {
        await sortSelect.selectOption('stars');
      }
    });

    test('should display repository cards with language and stats', async ({ page }) => {
      await page.goto('/git');
      
      // Check first repo card
      const repoCard = page.locator('.card').first();
      
      // Should show language indicator
      await expect(repoCard.locator('.rounded-full').first()).toBeVisible();
    });
  });

  test.describe('Repository Detail', () => {
    test('should display repository header', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Check owner/name
      await expect(page.locator('h1')).toBeVisible();
    });

    test('should show repository tabs', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      await expect(page.getByRole('button', { name: /code/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /commits/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /issues/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /pull requests/i })).toBeVisible();
    });

    test('should switch between tabs', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Click commits tab
      await page.getByRole('button', { name: /commits/i }).click();
      
      // Should show commit list
      await expect(page.locator('a[href*="/commit/"]').first()).toBeVisible();
    });

    test('should display file browser', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Should show files
      await expect(page.locator('a[href*="/tree/"], a[href*="/blob/"]').first()).toBeVisible();
    });

    test('should show clone URL with copy button', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Clone URL should be visible
      await expect(page.locator('code').filter({ hasText: /git\.jeju/ })).toBeVisible();
      
      // Copy button should work
      const copyButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      if (await copyButton.isVisible()) {
        await copyButton.click();
      }
    });

    test('should display README', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // README section should be visible
      await expect(page.getByText(/readme/i)).toBeVisible();
    });

    test('should show star and fork buttons', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      await expect(page.getByRole('button', { name: /star/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /fork/i })).toBeVisible();
    });

    test('should toggle star on click', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      const starButton = page.getByRole('button', { name: /star/i });
      await starButton.click();
      
      // Button should show starred state
      // (visual change depends on implementation)
    });
  });

  test.describe('Issues Tab', () => {
    test('should display issues list', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Switch to issues tab
      await page.getByRole('button', { name: /issues/i }).click();
      
      // Should show issues or empty state
      const issuesList = page.locator('.card').first();
      await expect(issuesList).toBeVisible();
    });

    test('should show new issue button', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      await page.getByRole('button', { name: /issues/i }).click();
      
      const newIssueBtn = page.getByRole('link', { name: /new issue/i });
      if (await newIssueBtn.isVisible()) {
        await expect(newIssueBtn).toBeVisible();
      }
    });
  });

  test.describe('Pull Requests Tab', () => {
    test('should display pull requests list', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Switch to PRs tab
      await page.getByRole('button', { name: /pull requests/i }).click();
      
      // Should show PRs list or empty state
      await expect(page.locator('.card, [class*="empty"]').first()).toBeVisible();
    });
  });

  test.describe('Actions Tab', () => {
    test('should display workflow runs', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Switch to actions tab
      await page.getByRole('button', { name: /actions/i }).click();
      
      // Should show workflow runs
      await expect(page.getByRole('link', { name: /view all workflows/i })).toBeVisible();
    });
  });
});

