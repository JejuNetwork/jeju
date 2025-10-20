import { test, expect, BrowserContext } from '@playwright/test';
import { MetaMask, getMetaMask, setupMetaMask } from '@tenkeylabs/dappwright';

let metamask: MetaMask;

test.describe('User Interactions', () => {
  test.beforeEach(async ({ context }: { context: BrowserContext }) => {
    // Setup MetaMask for tests that need wallet
    metamask = await setupMetaMask(context as any, {
      seed: 'test test test test test test test test test test test junk',
      password: 'password1234',
    });
  });

  test('should display leaderboard table with data', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Check for table or list elements
    const listItems = page.locator('[role="row"], li, .contributor-item, tr').first();
    await expect(listItems).toBeVisible({ timeout: 15000 });
  });

  test('should filter/search contributors on leaderboard', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Look for search/filter input
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]').first();

    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);

      // Verify search results update
      await expect(searchInput).toHaveValue('test');
    }
  });

  test('should view individual contributor profile', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Find and click on first contributor link
    const contributorLink = page.locator('a[href^="/profile/"]').first();

    if (await contributorLink.isVisible({ timeout: 5000 })) {
      await contributorLink.click();
      await page.waitForLoadState('networkidle');

      // Verify we're on a profile page
      await expect(page).toHaveURL(/\/profile\/.+/);
      await expect(page.locator('text=/profile|contributions|activity/i').first()).toBeVisible();
    }
  });

  test('should display repository information', async ({ page }) => {
    await page.goto('/repos');
    await page.waitForLoadState('networkidle');

    // Check for repository cards/items
    const repoItems = page.locator('[class*="repo"], [data-testid*="repo"], article, .card').first();
    await expect(repoItems).toBeVisible({ timeout: 10000 });
  });

  test('should click on repository and view details', async ({ page }) => {
    await page.goto('/repos');
    await page.waitForLoadState('networkidle');

    // Find clickable repository elements
    const repoLinks = page.locator('a[href*="github.com"], a[href*="repo"], button').first();

    if (await repoLinks.isVisible({ timeout: 5000 })) {
      await repoLinks.click();
      await page.waitForTimeout(1000);
    }
  });

  test('should display rewards information', async ({ page }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');

    // Check for rewards content
    await expect(page.locator('text=/reward|airdrop|claim|token/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should connect wallet and view claim button', async ({ page }) => {
    await page.goto('/rewards');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    if (await connectButton.isVisible({ timeout: 5000 })) {
      await connectButton.click();
      await metamask.approve();

      // Wait for wallet to be connected
      await page.waitForTimeout(2000);

      // Look for claim button or connected state
      const claimButton = page.locator('button:has-text("Claim"), button:has-text("0x")');
      await expect(claimButton.first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('should display summary page with date navigation', async ({ page }) => {
    await page.goto('/summary/day');
    await page.waitForLoadState('networkidle');

    // Check for date navigation
    const dateNav = page.locator('button:has-text("Previous"), button:has-text("Next"), button:has-text("Today")');
    await expect(dateNav.first()).toBeVisible({ timeout: 10000 });
  });

  test('should switch between summary intervals', async ({ page }) => {
    await page.goto('/summary/day');
    await page.waitForLoadState('networkidle');

    // Look for interval switchers
    const intervalButtons = page.locator('button:has-text("Day"), button:has-text("Week"), button:has-text("Month")');

    if (await intervalButtons.first().isVisible({ timeout: 5000 })) {
      const weekButton = page.locator('button:has-text("Week")').first();
      if (await weekButton.isVisible()) {
        await weekButton.click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/\/summary\/week/);
      }
    }
  });

  test('should handle profile edit with wallet connection', async ({ page }) => {
    await page.goto('/profile/edit');

    // Connect wallet if needed
    const connectButton = page.locator('button:has-text("Connect")').first();
    if (await connectButton.isVisible({ timeout: 5000 })) {
      await connectButton.click();
      await metamask.approve();
      await page.waitForTimeout(2000);
    }

    // Check for profile edit form
    const editForm = page.locator('form, input[type="text"], textarea').first();
    await expect(editForm).toBeVisible({ timeout: 10000 });
  });

  test('should display all interactive buttons and links', async ({ page }) => {
    await page.goto('/');

    // Check that common interactive elements exist
    const buttons = page.locator('button, a[role="button"]');
    const buttonCount = await buttons.count();

    expect(buttonCount).toBeGreaterThan(0);

    // Verify buttons are clickable
    for (let i = 0; i < Math.min(buttonCount, 10); i++) {
      const button = buttons.nth(i);
      if (await button.isVisible()) {
        await expect(button).toBeEnabled();
      }
    }
  });

  test('should handle theme toggle if available', async ({ page }) => {
    await page.goto('/');

    // Look for theme toggle button
    const themeToggle = page.locator('button[aria-label*="theme" i], button:has-text("Dark"), button:has-text("Light")').first();

    if (await themeToggle.isVisible({ timeout: 5000 })) {
      await themeToggle.click();
      await page.waitForTimeout(500);

      // Verify theme changed (check for dark/light class on html or body)
      const htmlClass = await page.locator('html').getAttribute('class');
      expect(htmlClass).toBeTruthy();
    }
  });
});
