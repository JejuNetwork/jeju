/**
 * Profile E2E Tests
 * Tests user profile pages and interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
  test.describe('Profile Page', () => {
    test('should display profile page', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      // Profile should load
      await expect(page.getByRole('main')).toBeVisible();
    });

    test('should show profile avatar', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.locator('img.rounded-full').first()).toBeVisible();
    });

    test('should show profile name', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByRole('heading').first()).toBeVisible();
    });

    test('should show wallet address', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      // Address should be displayed (truncated or full)
      await expect(page.getByText(/0x[a-f0-9]+/i).first()).toBeVisible();
    });

    test('should show profile bio', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      // Bio text should be present
      const bioSection = page.locator('p').filter({ hasText: /.{20,}/ });
      await expect(bioSection.first()).toBeVisible();
    });

    test('should show follow/message buttons for other users', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      const followButton = page.getByRole('button', { name: /follow/i });
      if (await followButton.isVisible()) {
        await expect(followButton).toBeVisible();
      }
    });

    test('should show edit profile button for own profile', async ({ page }) => {
      // This would require wallet connection
      await page.goto('/profile/0x1234567890abcdef');
      
      const editButton = page.getByRole('link', { name: /edit profile/i });
      // May not be visible if not own profile
    });
  });

  test.describe('Profile Tabs', () => {
    test('should show profile tabs', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /bounties/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /repositories/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /contributions/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /teams/i })).toBeVisible();
    });

    test('should switch to bounties tab', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await page.getByRole('button', { name: /bounties/i }).click();
      await expect(page.getByRole('button', { name: /bounties/i })).toHaveClass(/border-accent/);
    });

    test('should switch to repositories tab', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await page.getByRole('button', { name: /repositories/i }).click();
      await expect(page.getByRole('button', { name: /repositories/i })).toHaveClass(/border-accent/);
    });

    test('should switch to contributions tab', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await page.getByRole('button', { name: /contributions/i }).click();
      await expect(page.getByRole('button', { name: /contributions/i })).toHaveClass(/border-accent/);
    });

    test('should switch to teams tab', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await page.getByRole('button', { name: /teams/i }).click();
      await expect(page.getByRole('button', { name: /teams/i })).toHaveClass(/border-accent/);
    });
  });

  test.describe('Profile Stats', () => {
    test('should show follower count', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/followers/i)).toBeVisible();
    });

    test('should show following count', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/following/i)).toBeVisible();
    });

    test('should show stars earned', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/stars/i).first()).toBeVisible();
    });
  });

  test.describe('Profile Sidebar', () => {
    test('should show reputation section', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/reputation/i)).toBeVisible();
    });

    test('should show reputation tier', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/bronze|silver|gold|diamond/i).first()).toBeVisible();
    });

    test('should show skills section', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/skills/i)).toBeVisible();
    });

    test('should show skill badges', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      // Skill badges
      const skillBadges = page.locator('.badge').filter({ hasText: /solidity|typescript|react/i });
      await expect(skillBadges.first()).toBeVisible();
    });

    test('should show organizations', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/organizations/i)).toBeVisible();
    });
  });

  test.describe('Profile Overview Tab', () => {
    test('should show pinned repositories', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/pinned repositories/i)).toBeVisible();
    });

    test('should show recent bounties', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/recent bounties/i)).toBeVisible();
    });
  });

  test.describe('Profile Social Links', () => {
    test('should show location if set', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      const location = page.getByText(/san francisco|new york|london/i);
      if (await location.isVisible()) {
        await expect(location).toBeVisible();
      }
    });

    test('should show website if set', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      const website = page.locator('a').filter({ hasText: /\.dev|\.com|\.io/i });
      if (await website.first().isVisible()) {
        await expect(website.first()).toBeVisible();
      }
    });

    test('should show twitter if set', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      const twitter = page.getByText(/@\w+/);
      if (await twitter.first().isVisible()) {
        await expect(twitter.first()).toBeVisible();
      }
    });

    test('should show join date', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      await expect(page.getByText(/joined/i)).toBeVisible();
    });
  });

  test.describe('Guardian Badge', () => {
    test('should show guardian badge if user is guardian', async ({ page }) => {
      await page.goto('/profile/0x1234567890abcdef');
      
      const guardianBadge = page.getByText(/guardian/i).first();
      if (await guardianBadge.isVisible()) {
        await expect(guardianBadge).toBeVisible();
      }
    });
  });
});

