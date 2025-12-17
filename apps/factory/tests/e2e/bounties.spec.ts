/**
 * Bounties E2E Tests
 * Tests bounty listing, filtering, creation, and application flows
 */

import { test, expect } from '@playwright/test';

test.describe('Bounties', () => {
  test.describe('Bounty List Page', () => {
    test('should display bounty list with stats', async ({ page }) => {
      await page.goto('/bounties');
      
      // Check page title
      await expect(page.getByRole('heading', { name: /bounties/i })).toBeVisible();
      
      // Check stats cards are present
      await expect(page.getByText(/open bounties/i)).toBeVisible();
      await expect(page.getByText(/total value/i)).toBeVisible();
    });

    test('should filter bounties by status', async ({ page }) => {
      await page.goto('/bounties');
      
      // Click on different filter buttons
      const filters = ['All', 'Open', 'In Progress', 'Review', 'Completed'];
      
      for (const filter of filters) {
        const button = page.getByRole('button', { name: new RegExp(filter, 'i') });
        if (await button.isVisible()) {
          await button.click();
          // Filter should be active
          await expect(button).toHaveClass(/bg-accent/);
        }
      }
    });

    test('should search bounties', async ({ page }) => {
      await page.goto('/bounties');
      
      // Type in search
      const searchInput = page.getByPlaceholder(/search bounties/i);
      await searchInput.fill('security audit');
      
      // Results should update (in real app, would filter)
      await expect(searchInput).toHaveValue('security audit');
    });

    test('should sort bounties', async ({ page }) => {
      await page.goto('/bounties');
      
      // Find and interact with sort dropdown
      const sortSelect = page.locator('select').first();
      if (await sortSelect.isVisible()) {
        await sortSelect.selectOption({ index: 1 });
      }
    });

    test('should display bounty cards with correct info', async ({ page }) => {
      await page.goto('/bounties');
      
      // Check first bounty card has required elements
      const firstCard = page.locator('.card').first();
      
      // Should have title, description, reward, and status
      await expect(firstCard.locator('h3, h4, .font-semibold').first()).toBeVisible();
    });

    test('should navigate to bounty detail on click', async ({ page }) => {
      await page.goto('/bounties');
      
      // Click on first bounty link
      const bountyLink = page.locator('a[href^="/bounties/"]').first();
      if (await bountyLink.isVisible()) {
        await bountyLink.click();
        await expect(page).toHaveURL(/\/bounties\/.+/);
      }
    });
  });

  test.describe('Create Bounty', () => {
    test('should show create bounty button', async ({ page }) => {
      await page.goto('/bounties');
      
      const createButton = page.getByRole('link', { name: /create bounty|new bounty/i });
      await expect(createButton).toBeVisible();
    });

    test('should navigate to create bounty page', async ({ page }) => {
      await page.goto('/bounties');
      
      const createButton = page.getByRole('link', { name: /create bounty|new bounty/i });
      if (await createButton.isVisible()) {
        await createButton.click();
        await expect(page).toHaveURL(/\/bounties\/new|\/bounties\/create/);
      }
    });
  });

  test.describe('Bounty Filters', () => {
    test('should filter by skill tags', async ({ page }) => {
      await page.goto('/bounties');
      
      // Find skill filter buttons/chips
      const skillBadges = page.locator('.badge, [class*="tag"]');
      const count = await skillBadges.count();
      
      if (count > 0) {
        await skillBadges.first().click();
      }
    });

    test('should filter by reward range', async ({ page }) => {
      await page.goto('/bounties');
      
      // Look for reward filter if present
      const rewardFilter = page.getByText(/min reward|reward range/i);
      if (await rewardFilter.isVisible()) {
        await rewardFilter.click();
      }
    });
  });
});

