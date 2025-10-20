import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';
import basicSetup from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { describe } = test;

describe('Route Navigation and Screenshots', () => {
  test('should navigate to homepage and capture screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/routes/01-homepage.png',
      fullPage: true
    });

    // Verify page loads
    await expect(page).toHaveTitle(/Jeju Network Leaderboard/i);
    await expect(page.locator('main')).toBeVisible();
  });

  test('should navigate to leaderboard page', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/routes/02-leaderboard.png',
      fullPage: true
    });

    // Verify leaderboard content
    await expect(page.locator('h1, h2')).toContainText(/leaderboard/i);
    await expect(page.locator('main')).toBeVisible();
  });

  test('should navigate to repositories page', async ({ page }) => {
    await page.goto('/repos');
    await page.waitForLoadState('networkidle');

    // Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/routes/03-repos.png',
      fullPage: true
    });

    // Verify repos content
    await expect(page.locator('main')).toBeVisible();
  });

  test('should navigate to rewards page', async ({ page }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');

    // Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/routes/04-rewards.png',
      fullPage: true
    });

    // Verify rewards content
    await expect(page.locator('main')).toBeVisible();
  });

  test('should navigate to about page', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    // Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/routes/05-about.png',
      fullPage: true
    });

    // Verify about content
    await expect(page.locator('main')).toBeVisible();
  });

  test('should use navigation menu to browse pages', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Screenshot initial state
    await page.screenshot({
      path: 'test-results/screenshots/navigation/01-nav-initial.png',
      fullPage: true
    });

    // Find and click Leaderboard link
    const leaderboardLink = page.getByRole('link', { name: /leaderboard/i }).first();
    if (await leaderboardLink.isVisible()) {
      await leaderboardLink.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: 'test-results/screenshots/navigation/02-nav-leaderboard.png',
        fullPage: true
      });
    }

    // Click Repos link
    const reposLink = page.getByRole('link', { name: /repos/i }).first();
    if (await reposLink.isVisible()) {
      await reposLink.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: 'test-results/screenshots/navigation/03-nav-repos.png',
        fullPage: true
      });
    }

    // Click Rewards link
    const rewardsLink = page.getByRole('link', { name: /rewards/i }).first();
    if (await rewardsLink.isVisible()) {
      await rewardsLink.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: 'test-results/screenshots/navigation/04-nav-rewards.png',
        fullPage: true
      });
    }

    // Click About link
    const aboutLink = page.getByRole('link', { name: /about/i }).first();
    if (await aboutLink.isVisible()) {
      await aboutLink.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: 'test-results/screenshots/navigation/05-nav-about.png',
        fullPage: true
      });
    }
  });

  test('should handle back navigation', async ({ page }) => {
    await page.goto('/');
    await page.goto('/leaderboard');
    await page.screenshot({
      path: 'test-results/screenshots/navigation/06-before-back.png',
      fullPage: true
    });

    await page.goBack();
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/screenshots/navigation/07-after-back.png',
      fullPage: true
    });

    await expect(page).toHaveURL('/');
  });
});
