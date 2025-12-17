/**
 * Navigation E2E Tests
 * Tests all navigation routes and menu interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.describe('Desktop Navigation', () => {
    test('should display all main navigation sections', async ({ page }) => {
      await page.goto('/');
      
      // Main nav should be visible
      const nav = page.locator('nav').first();
      await expect(nav).toBeVisible();
      
      // Check all main sections exist
      await expect(nav.getByText('Work')).toBeVisible();
      await expect(nav.getByText('Code')).toBeVisible();
      await expect(nav.getByText('AI')).toBeVisible();
      await expect(nav.getByText('Collaboration')).toBeVisible();
    });

    test('should expand and collapse nav sections', async ({ page }) => {
      await page.goto('/');
      
      // Click Work section to toggle
      await page.getByRole('button', { name: /work/i }).click();
      
      // Check children are visible/hidden
      const bountiesLink = page.getByRole('link', { name: /bounties/i });
      await expect(bountiesLink).toBeVisible();
    });

    test('should navigate to all main pages', async ({ page }) => {
      const routes = [
        { path: '/', title: /factory/i },
        { path: '/bounties', title: /bounties/i },
        { path: '/jobs', title: /jobs/i },
        { path: '/projects', title: /projects/i },
        { path: '/git', title: /repositories/i },
        { path: '/packages', title: /packages/i },
        { path: '/containers', title: /containers/i },
        { path: '/ci', title: /ci/i },
        { path: '/models', title: /model/i },
        { path: '/feed', title: /feed/i },
        { path: '/agents', title: /agent/i },
      ];

      for (const route of routes) {
        await page.goto(route.path);
        await expect(page.getByRole('heading', { name: route.title }).first()).toBeVisible();
      }
    });

    test('should show search input with keyboard shortcut hint', async ({ page }) => {
      await page.goto('/');
      
      const searchInput = page.getByPlaceholder(/search/i);
      await expect(searchInput).toBeVisible();
      
      // Check keyboard shortcut hint
      await expect(page.getByText('⌘K')).toBeVisible();
    });
  });

  test.describe('Mobile Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
    });

    test('should show mobile header with menu button', async ({ page }) => {
      await page.goto('/');
      
      // Mobile header should be visible
      await expect(page.locator('header.lg\\:hidden')).toBeVisible();
      
      // Menu button should be visible
      await expect(page.getByLabel(/toggle menu/i)).toBeVisible();
    });

    test('should open and close mobile menu', async ({ page }) => {
      await page.goto('/');
      
      // Open menu
      await page.getByLabel(/toggle menu/i).click();
      
      // Menu panel should be visible
      await expect(page.locator('nav').filter({ hasText: 'Main' })).toBeVisible();
      
      // Close menu by clicking backdrop
      await page.locator('.bg-black\\/60').click();
      
      // Menu should be hidden
      await expect(page.locator('nav').filter({ hasText: 'Main' })).not.toBeVisible();
    });

    test('should navigate via mobile menu', async ({ page }) => {
      await page.goto('/');
      
      // Open menu
      await page.getByLabel(/toggle menu/i).click();
      
      // Click on Bounties
      await page.getByRole('link', { name: /bounties/i }).click();
      
      // Should navigate and close menu
      await expect(page).toHaveURL('/bounties');
    });
  });
});

