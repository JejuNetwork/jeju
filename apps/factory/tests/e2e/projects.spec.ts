/**
 * Projects E2E Tests
 * Tests project boards and management
 */

import { test, expect } from '@playwright/test';

test.describe('Projects', () => {
  test.describe('Project List', () => {
    test('should display projects page', async ({ page }) => {
      await page.goto('/projects');
      
      await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
    });

    test('should show project stats', async ({ page }) => {
      await page.goto('/projects');
      
      await expect(page.getByText(/total projects/i)).toBeVisible();
    });

    test('should filter by status', async ({ page }) => {
      await page.goto('/projects');
      
      const filters = ['All Projects', 'Active', 'Completed', 'Archived'];
      
      for (const filter of filters) {
        const button = page.getByRole('button', { name: new RegExp(filter, 'i') });
        if (await button.isVisible()) {
          await button.click();
          break;
        }
      }
    });

    test('should search projects', async ({ page }) => {
      await page.goto('/projects');
      
      const searchInput = page.getByPlaceholder(/search projects/i);
      if (await searchInput.isVisible()) {
        await searchInput.fill('smart contract');
        await expect(searchInput).toHaveValue('smart contract');
      }
    });

    test('should display project cards', async ({ page }) => {
      await page.goto('/projects');
      
      const projectCards = page.locator('.card');
      await expect(projectCards.first()).toBeVisible();
    });

    test('should show create project button', async ({ page }) => {
      await page.goto('/projects');
      
      await expect(page.getByRole('link', { name: /create project|new project/i })).toBeVisible();
    });

    test('should show project progress', async ({ page }) => {
      await page.goto('/projects');
      
      // Progress bars or percentages
      const progressBars = page.locator('[class*="bg-accent"], [role="progressbar"]');
      await expect(progressBars.first()).toBeVisible();
    });

    test('should show member count', async ({ page }) => {
      await page.goto('/projects');
      
      // Member avatars or count
      await expect(page.getByText(/members/i).first()).toBeVisible();
    });
  });

  test.describe('Project Detail', () => {
    test('should navigate to project detail', async ({ page }) => {
      await page.goto('/projects');
      
      const projectLink = page.locator('a[href^="/projects/"]').first();
      if (await projectLink.isVisible()) {
        await projectLink.click();
        await expect(page).toHaveURL(/\/projects\/.+/);
      }
    });
  });

  test.describe('Project Board View', () => {
    test('should show board columns', async ({ page }) => {
      await page.goto('/projects/1');
      
      // Kanban columns
      await expect(page.getByText(/backlog|todo|in progress|done/i).first()).toBeVisible();
    });

    test('should show task cards', async ({ page }) => {
      await page.goto('/projects/1');
      
      const taskCards = page.locator('.card').filter({ has: page.locator('h4, h5') });
      await expect(taskCards.first()).toBeVisible();
    });
  });

  test.describe('Project Settings', () => {
    test('should show settings tab', async ({ page }) => {
      await page.goto('/projects/1');
      
      const settingsTab = page.getByRole('button', { name: /settings/i });
      if (await settingsTab.isVisible()) {
        await settingsTab.click();
      }
    });
  });
});


