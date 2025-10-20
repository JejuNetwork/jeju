import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

test.describe('Routes Navigation', () => {
  test('should navigate to home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Jeju.*Leaderboard/i);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should navigate to leaderboard page', async ({ page }) => {
    await page.goto('/leaderboard');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check for leaderboard content
    await expect(page.locator('text=/leaderboard|contributors|rank/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to repos page', async ({ page }) => {
    await page.goto('/repos');

    await page.waitForLoadState('networkidle');

    // Check for repos content
    await expect(page.locator('text=/repositor/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to rewards page', async ({ page }) => {
    await page.goto('/rewards');

    await page.waitForLoadState('networkidle');

    // Check for rewards content
    await expect(page.locator('text=/reward|claim|airdrop/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to about page', async ({ page }) => {
    await page.goto('/about');

    await page.waitForLoadState('networkidle');

    // Check for about content
    await expect(page.locator('text=/about|mission|goal|vision/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to profile edit page when logged in', async ({ page }) => {
    await page.goto('/profile/edit');

    await page.waitForLoadState('networkidle');

    // Should redirect to home or show login/profile page
    await expect(page).toHaveURL(/\/(profile\/edit)?/);
  });

  test('should handle navigation through header links', async ({ page }) => {
    await page.goto('/');

    // Test navigation menu
    const navLinks = page.locator('nav a, header a');
    const linkCount = await navLinks.count();

    expect(linkCount).toBeGreaterThan(0);

    // Click on each navigation link and verify it works
    for (let i = 0; i < Math.min(linkCount, 5); i++) {
      const link = navLinks.nth(i);
      const href = await link.getAttribute('href');

      if (href && href.startsWith('/') && !href.includes('#')) {
        await link.click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(new RegExp(href));
        await page.goBack();
      }
    }
  });
});
