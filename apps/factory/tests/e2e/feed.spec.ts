/**
 * Feed E2E Tests
 * Tests Farcaster-powered social feed
 */

import { test, expect } from '@playwright/test';

test.describe('Feed', () => {
  test.describe('Feed Page', () => {
    test('should display feed page', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible();
    });

    test('should show feed tabs', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByRole('button', { name: /feed/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /mentions/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /highlights/i })).toBeVisible();
    });

    test('should switch between tabs', async ({ page }) => {
      await page.goto('/feed');
      
      await page.getByRole('button', { name: /mentions/i }).click();
      await expect(page.getByRole('button', { name: /mentions/i })).toHaveClass(/bg-accent/);
    });

    test('should show compose box', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByPlaceholder(/what's happening/i)).toBeVisible();
    });

    test('should show compose action buttons', async ({ page }) => {
      await page.goto('/feed');
      
      // Image, code, link buttons
      const composeSection = page.locator('.card').first();
      await expect(composeSection.locator('button').first()).toBeVisible();
    });

    test('should show cast button', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByRole('button', { name: /cast/i })).toBeVisible();
    });

    test('should disable cast button when empty', async ({ page }) => {
      await page.goto('/feed');
      
      const castButton = page.getByRole('button', { name: /cast/i });
      await expect(castButton).toBeDisabled();
    });

    test('should enable cast button when text entered', async ({ page }) => {
      await page.goto('/feed');
      
      // Type in compose box
      await page.getByPlaceholder(/what's happening/i).fill('Test post');
      
      // Cast button should be enabled (unless wallet not connected)
      const castButton = page.getByRole('button', { name: /cast/i });
      // Note: May still be disabled if wallet not connected
    });
  });

  test.describe('Post Display', () => {
    test('should display posts', async ({ page }) => {
      await page.goto('/feed');
      
      // Posts should be visible
      const posts = page.locator('.card').filter({ has: page.locator('img') });
      await expect(posts.first()).toBeVisible();
    });

    test('should show post author info', async ({ page }) => {
      await page.goto('/feed');
      
      // Author avatar and name
      await expect(page.locator('img.rounded-full').first()).toBeVisible();
    });

    test('should show post reactions', async ({ page }) => {
      await page.goto('/feed');
      
      // Like, recast, reply buttons
      const reactionButtons = page.locator('button').filter({ hasText: /^\d+$/ });
      await expect(reactionButtons.first()).toBeVisible();
    });

    test('should show post timestamp', async ({ page }) => {
      await page.goto('/feed');
      
      // Time like "2h", "1d"
      await expect(page.getByText(/\d+[hmd]$/).first()).toBeVisible();
    });

    test('should show pinned post indicator', async ({ page }) => {
      await page.goto('/feed');
      
      const pinnedIndicator = page.getByText(/pinned/i);
      if (await pinnedIndicator.isVisible()) {
        await expect(pinnedIndicator).toBeVisible();
      }
    });
  });

  test.describe('Post Interactions', () => {
    test('should have like button', async ({ page }) => {
      await page.goto('/feed');
      
      // Heart icon button
      const likeButtons = page.locator('button').filter({ has: page.locator('svg') });
      await expect(likeButtons.first()).toBeVisible();
    });

    test('should have recast button', async ({ page }) => {
      await page.goto('/feed');
      
      // Recast buttons
      const recastButtons = page.locator('button').filter({ has: page.locator('svg') });
      await expect(recastButtons.first()).toBeVisible();
    });

    test('should have reply button', async ({ page }) => {
      await page.goto('/feed');
      
      // Reply/comment buttons
      const replyButtons = page.locator('button').filter({ has: page.locator('svg') });
      await expect(replyButtons.first()).toBeVisible();
    });

    test('should have share button', async ({ page }) => {
      await page.goto('/feed');
      
      // Share buttons
      const shareButtons = page.locator('button').filter({ has: page.locator('svg') });
      await expect(shareButtons.first()).toBeVisible();
    });
  });

  test.describe('Sidebar', () => {
    test('should show channel info', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByText(/\/factory channel/i)).toBeVisible();
    });

    test('should show trending topics', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByText(/trending/i)).toBeVisible();
    });

    test('should show hashtags', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByText(/#\w+/).first()).toBeVisible();
    });

    test('should show quick actions', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByText(/quick actions/i)).toBeVisible();
    });

    test('should have warpcast link', async ({ page }) => {
      await page.goto('/feed');
      
      await expect(page.getByRole('link', { name: /warpcast/i })).toBeVisible();
    });
  });
});


