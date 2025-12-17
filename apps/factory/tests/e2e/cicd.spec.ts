/**
 * CI/CD E2E Tests
 * Tests workflow runs, logs, and deployments
 */

import { test, expect } from '@playwright/test';

test.describe('CI/CD', () => {
  test.describe('CI/CD Dashboard', () => {
    test('should display CI/CD page', async ({ page }) => {
      await page.goto('/ci');
      
      await expect(page.getByRole('heading', { name: /ci\/cd/i })).toBeVisible();
    });

    test('should show pipeline stats', async ({ page }) => {
      await page.goto('/ci');
      
      await expect(page.getByText(/total runs/i)).toBeVisible();
      await expect(page.getByText(/running/i).first()).toBeVisible();
    });

    test('should filter by status', async ({ page }) => {
      await page.goto('/ci');
      
      const filters = ['All Runs', 'in progress', 'queued', 'completed', 'failed'];
      
      for (const filter of filters) {
        const button = page.getByRole('button', { name: new RegExp(filter, 'i') });
        if (await button.isVisible()) {
          await button.click();
          await expect(button).toHaveClass(/bg-accent/);
          break;
        }
      }
    });

    test('should display workflow run list', async ({ page }) => {
      await page.goto('/ci');
      
      // Should show workflow runs
      const runCards = page.locator('.card, a[href^="/ci/runs/"]');
      await expect(runCards.first()).toBeVisible();
    });

    test('should show run status indicators', async ({ page }) => {
      await page.goto('/ci');
      
      // Status icons should be visible
      const statusIcons = page.locator('svg[class*="text-green"], svg[class*="text-blue"], svg[class*="text-red"]');
      await expect(statusIcons.first()).toBeVisible();
    });

    test('should show trigger workflow button', async ({ page }) => {
      await page.goto('/ci');
      
      await expect(page.getByRole('link', { name: /trigger workflow/i })).toBeVisible();
    });

    test('should show refresh button', async ({ page }) => {
      await page.goto('/ci');
      
      await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible();
    });

    test('should show job progress indicators', async ({ page }) => {
      await page.goto('/ci');
      
      // Job progress boxes
      const jobIndicators = page.locator('[class*="rounded"]').filter({ has: page.locator('svg') });
      await expect(jobIndicators.first()).toBeVisible();
    });
  });

  test.describe('Workflow Run Detail', () => {
    test('should navigate to run detail', async ({ page }) => {
      await page.goto('/ci');
      
      const runLink = page.locator('a[href^="/ci/runs/"]').first();
      if (await runLink.isVisible()) {
        await runLink.click();
        await expect(page).toHaveURL(/\/ci\/runs\/.+/);
      }
    });
  });

  test.describe('Recent Deployments', () => {
    test('should show deployment section', async ({ page }) => {
      await page.goto('/ci');
      
      await expect(page.getByText(/recent deployments/i)).toBeVisible();
    });

    test('should display deployment cards', async ({ page }) => {
      await page.goto('/ci');
      
      // Deployment cards
      await expect(page.getByText(/production|staging|preview/i).first()).toBeVisible();
    });

    test('should show deployment status', async ({ page }) => {
      await page.goto('/ci');
      
      // Should show success or in_progress indicators
      const deployCards = page.locator('.card').filter({ hasText: /production|staging|preview/i });
      await expect(deployCards.first()).toBeVisible();
    });

    test('should show version tags', async ({ page }) => {
      await page.goto('/ci');
      
      // Version numbers like v1.2.0
      await expect(page.getByText(/v\d+\.\d+\.\d+/i).first()).toBeVisible();
    });
  });
});


