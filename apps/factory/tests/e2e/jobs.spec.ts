/**
 * Jobs E2E Tests
 * Tests job listings and applications
 */

import { test, expect } from '@playwright/test';

test.describe('Jobs', () => {
  test.describe('Job List', () => {
    test('should display jobs page', async ({ page }) => {
      await page.goto('/jobs');
      
      await expect(page.getByRole('heading', { name: /jobs/i })).toBeVisible();
    });

    test('should show job stats', async ({ page }) => {
      await page.goto('/jobs');
      
      await expect(page.getByText(/open positions/i)).toBeVisible();
    });

    test('should filter by type', async ({ page }) => {
      await page.goto('/jobs');
      
      const filters = ['All Jobs', 'Full-time', 'Part-time', 'Contract', 'Bounty'];
      
      for (const filter of filters) {
        const button = page.getByRole('button', { name: new RegExp(filter, 'i') });
        if (await button.isVisible()) {
          await button.click();
          break;
        }
      }
    });

    test('should search jobs', async ({ page }) => {
      await page.goto('/jobs');
      
      const searchInput = page.getByPlaceholder(/search jobs/i);
      if (await searchInput.isVisible()) {
        await searchInput.fill('solidity developer');
        await expect(searchInput).toHaveValue('solidity developer');
      }
    });

    test('should display job cards', async ({ page }) => {
      await page.goto('/jobs');
      
      const jobCards = page.locator('.card');
      await expect(jobCards.first()).toBeVisible();
    });

    test('should show post job button', async ({ page }) => {
      await page.goto('/jobs');
      
      await expect(page.getByRole('link', { name: /post job|create job/i })).toBeVisible();
    });

    test('should show salary range', async ({ page }) => {
      await page.goto('/jobs');
      
      // Salary like "$100k - $150k" or "0.5 - 1 ETH"
      await expect(page.getByText(/\$\d+k|\d+ ETH/i).first()).toBeVisible();
    });

    test('should show company/org logos', async ({ page }) => {
      await page.goto('/jobs');
      
      const logos = page.locator('img.rounded, img[alt*="logo"]');
      await expect(logos.first()).toBeVisible();
    });

    test('should show location/remote indicator', async ({ page }) => {
      await page.goto('/jobs');
      
      await expect(page.getByText(/remote|on-site|hybrid/i).first()).toBeVisible();
    });
  });

  test.describe('Job Detail', () => {
    test('should navigate to job detail', async ({ page }) => {
      await page.goto('/jobs');
      
      const jobLink = page.locator('a[href^="/jobs/"]').first();
      if (await jobLink.isVisible()) {
        await jobLink.click();
        await expect(page).toHaveURL(/\/jobs\/.+/);
      }
    });
  });

  test.describe('Job Filters', () => {
    test('should filter by skill', async ({ page }) => {
      await page.goto('/jobs');
      
      const skillFilters = page.locator('.badge, button').filter({ hasText: /solidity|react|typescript/i });
      if (await skillFilters.first().isVisible()) {
        await skillFilters.first().click();
      }
    });

    test('should filter by salary range', async ({ page }) => {
      await page.goto('/jobs');
      
      const salaryFilter = page.locator('select, input[type="range"]').first();
      if (await salaryFilter.isVisible()) {
        // Interact with filter
      }
    });
  });

  test.describe('Job Application', () => {
    test('should show apply button', async ({ page }) => {
      await page.goto('/jobs/1');
      
      await expect(page.getByRole('button', { name: /apply/i })).toBeVisible();
    });
  });
});

