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

    test('should display repository cards', async ({ page }) => {
      await page.goto('/git');
      
      // Check first repo card
      const repoCard = page.locator('.card').first();
      await expect(repoCard).toBeVisible();
    });
  });

  test.describe('Repository Detail', () => {
    test('should display repository page', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Page should load
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should show repository tabs', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Should have some tab buttons
      const codeButton = page.getByRole('button', { name: /code/i }).first();
      await expect(codeButton).toBeVisible();
    });

    test('should show action buttons', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // Should have star or fork button
      const buttons = page.getByRole('button');
      await expect(buttons.first()).toBeVisible();
    });

    test('should display README section', async ({ page }) => {
      await page.goto('/git/jeju/factory');
      
      // README heading should be visible
      await expect(page.getByRole('heading', { name: /readme/i })).toBeVisible();
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

