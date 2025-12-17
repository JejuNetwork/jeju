/**
 * Navigation E2E Tests
 * Tests all navigation routes and menu interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.describe('Desktop Navigation', () => {
    test('should display main navigation', async ({ page }) => {
      await page.goto('/');
      
      // Main nav should be visible
      const nav = page.getByRole('navigation');
      await expect(nav.first()).toBeVisible();
    });

    test('should show nav section buttons', async ({ page }) => {
      await page.goto('/');
      
      // Check collapsible section buttons exist
      await expect(page.getByRole('button', { name: /work/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /code/i })).toBeVisible();
    });

    test('should toggle nav section on click', async ({ page }) => {
      await page.goto('/');
      
      // The sections are already expanded by default
      const bountiesLink = page.getByRole('link', { name: /bounties/i });
      await expect(bountiesLink).toBeVisible();
      
      // Click Work section to collapse
      await page.getByRole('button', { name: /work/i }).click();
      
      // Bounties link should be hidden now
      await expect(bountiesLink).not.toBeVisible();
    });

    test('should navigate to bounties', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: /bounties/i }).click();
      await expect(page).toHaveURL('/bounties');
    });

    test('should navigate to repositories', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: /repositories/i }).click();
      await expect(page).toHaveURL('/git');
    });

    test('should navigate to packages', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: /packages/i }).click();
      await expect(page).toHaveURL('/packages');
    });

    test('should navigate to models', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: /models/i }).click();
      await expect(page).toHaveURL('/models');
    });

    test('should navigate to feed', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Feed', exact: true }).click();
      await expect(page).toHaveURL('/feed');
    });

    test('should show search input', async ({ page }) => {
      await page.goto('/');
      
      const searchInput = page.getByPlaceholder(/search/i);
      await expect(searchInput).toBeVisible();
    });

    test('should show settings link', async ({ page }) => {
      await page.goto('/');
      
      await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
    });

    test('should highlight active link', async ({ page }) => {
      await page.goto('/bounties');
      
      const bountiesLink = page.getByRole('link', { name: /bounties/i });
      await expect(bountiesLink).toHaveClass(/text-accent/);
    });
  });

  test.describe('Page Navigation', () => {
    test('should load home page', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should load bounties page', async ({ page }) => {
      await page.goto('/bounties');
      await expect(page.getByRole('heading', { name: /bounties/i })).toBeVisible();
    });

    test('should load jobs page', async ({ page }) => {
      await page.goto('/jobs');
      await expect(page.getByRole('heading', { name: /jobs/i })).toBeVisible({ timeout: 10000 });
    });

    test('should load projects page', async ({ page }) => {
      await page.goto('/projects');
      await expect(page.getByRole('heading').first()).toBeVisible();
    });

    test('should load git page', async ({ page }) => {
      await page.goto('/git');
      await expect(page.getByRole('heading', { name: /repositories/i })).toBeVisible();
    });

    test('should load packages page', async ({ page }) => {
      await page.goto('/packages');
      await expect(page.getByRole('heading', { name: /packages/i })).toBeVisible();
    });

    test('should load containers page', async ({ page }) => {
      await page.goto('/containers');
      await expect(page.getByRole('heading').first()).toBeVisible();
    });

    test('should load models page', async ({ page }) => {
      await page.goto('/models');
      await expect(page.getByRole('heading', { name: /model/i })).toBeVisible();
    });

    test('should load feed page', async ({ page }) => {
      await page.goto('/feed');
      await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible();
    });

    test('should load agents page', async ({ page }) => {
      await page.goto('/agents');
      await expect(page.getByRole('heading', { name: /agent/i })).toBeVisible();
    });

    test('should load ci page', async ({ page }) => {
      await page.goto('/ci');
      await expect(page.getByRole('heading', { name: /ci/i })).toBeVisible();
    });
  });

  test.describe('Mobile Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
    });

    test('should show mobile header', async ({ page }) => {
      await page.goto('/');
      
      // Mobile header should be visible
      await expect(page.locator('header.lg\\:hidden')).toBeVisible();
    });

    test('should show mobile menu button', async ({ page }) => {
      await page.goto('/');
      
      // Menu button in header
      const menuButton = page.locator('header.lg\\:hidden button');
      await expect(menuButton.first()).toBeVisible();
    });
  });
});
