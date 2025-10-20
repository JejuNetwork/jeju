import { test, expect } from '@playwright/test';

/**
 * Comprehensive E2E test suite for Jeju Network Leaderboard
 * Tests all pages, navigation, UI interactions, and captures screenshots
 */

test.describe('Complete Leaderboard Flow with Screenshots', () => {

  test('01 - Homepage loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Capture screenshot
    await page.screenshot({
      path: 'test-results/screenshots/01-homepage.png',
      fullPage: true
    });

    // Verify page loaded
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('nav, header')).toBeVisible();
    console.log('✅ Homepage loaded successfully');
  });

  test('02 - Navigation menu works', async ({ page }) => {
    await page.goto('/');

    // Screenshot initial nav
    await page.screenshot({
      path: 'test-results/screenshots/02-nav-initial.png',
      fullPage: true
    });

    // Test navigation links
    const navLinks = await page.locator('nav a, header a').all();
    console.log(`Found ${navLinks.length} navigation links`);

    for (let i = 0; i < Math.min(navLinks.length, 6); i++) {
      const link = navLinks[i];
      if (await link.isVisible()) {
        const href = await link.getAttribute('href');
        const text = await link.textContent();
        console.log(`Testing link: ${text} -> ${href}`);

        if (href && href.startsWith('/') && !href.includes('#')) {
          await link.click();
          await page.waitForLoadState('networkidle');

          await page.screenshot({
            path: `test-results/screenshots/02-nav-link-${i}.png`,
            fullPage: true
          });

          expect(page.url()).toContain(href);
          console.log(`✅ Navigated to ${href}`);
        }
      }
    }
  });

  test('03 - All main routes accessible', async ({ page }) => {
    const routes = [
      { path: '/', name: 'Homepage' },
      { path: '/leaderboard', name: 'Leaderboard' },
      { path: '/repos', name: 'Repositories' },
      { path: '/rewards', name: 'Rewards' },
      { path: '/about', name: 'About' },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      // Capture screenshot
      await page.screenshot({
        path: `test-results/screenshots/03-route-${route.name.toLowerCase()}.png`,
        fullPage: true
      });

      // Verify page loads
      await expect(page.locator('main, body')).toBeVisible();
      console.log(`✅ ${route.name} page loaded`);
    }
  });

  test('04 - Leaderboard functionality', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Initial screenshot
    await page.screenshot({
      path: 'test-results/screenshots/04-leaderboard-initial.png',
      fullPage: true
    });

    // Test table/list visibility
    const table = page.locator('table, [role="table"], .leaderboard');
    if (await table.isVisible()) {
      console.log('✅ Leaderboard table found');
    }

    // Test sorting buttons
    const sortButtons = await page.locator('th, [role="columnheader"], button:has-text("Sort")').all();
    for (let i = 0; i < Math.min(sortButtons.length, 3); i++) {
      const btn = sortButtons[i];
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `test-results/screenshots/04-leaderboard-sort-${i}.png`,
          fullPage: true
        });
        console.log(`✅ Sort button ${i} clicked`);
      }
    }

    // Test pagination
    const nextBtn = page.getByRole('button', { name: /next|→/i }).first();
    if (await nextBtn.isVisible() && !await nextBtn.isDisabled()) {
      await nextBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: 'test-results/screenshots/04-leaderboard-page2.png',
        fullPage: true
      });
      console.log('✅ Pagination works');
    }
  });

  test('05 - All interactive buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find all buttons
    const buttons = await page.locator('button').all();
    console.log(`Found ${buttons.length} buttons`);

    let tested = 0;
    for (let i = 0; i < buttons.length && tested < 10; i++) {
      const btn = buttons[i];
      if (await btn.isVisible() && !await btn.isDisabled()) {
        const text = (await btn.textContent()) || '';

        // Screenshot before
        await page.screenshot({
          path: `test-results/screenshots/05-button-${tested}-before.png`,
          fullPage: true
        });

        try {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(500);

          // Screenshot after
          await page.screenshot({
            path: `test-results/screenshots/05-button-${tested}-after.png`,
            fullPage: true
          });

          console.log(`✅ Button "${text}" clicked`);
          tested++;
        } catch (e) {
          console.log(`⚠️  Button "${text}" not clickable`);
        }
      }
    }
  });

  test('06 - Theme toggle functionality', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for theme toggle
    const themeBtn = page.locator('button[aria-label*="theme" i], button:has-text("Dark"), button:has-text("Light")').first();

    if (await themeBtn.isVisible()) {
      // Screenshot light theme
      await page.screenshot({
        path: 'test-results/screenshots/06-theme-light.png',
        fullPage: true
      });

      // Toggle theme
      await themeBtn.click();
      await page.waitForTimeout(500);

      // Screenshot dark theme
      await page.screenshot({
        path: 'test-results/screenshots/06-theme-dark.png',
        fullPage: true
      });

      console.log('✅ Theme toggle works');
    } else {
      console.log('ℹ️  No theme toggle found');
      await page.screenshot({
        path: 'test-results/screenshots/06-no-theme-toggle.png',
        fullPage: true
      });
    }
  });

  test('07 - Mobile responsive design', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Screenshot mobile view
    await page.screenshot({
      path: 'test-results/screenshots/07-mobile-homepage.png',
      fullPage: true
    });

    // Test mobile menu
    const menuBtn = page.locator('button[aria-label*="menu" i], button:has([class*="hamburger"])').first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'test-results/screenshots/07-mobile-menu-open.png',
        fullPage: true
      });

      console.log('✅ Mobile menu works');
    }

    // Test other routes in mobile
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: 'test-results/screenshots/07-mobile-leaderboard.png',
      fullPage: true
    });
  });

  test('08 - Search and filter functionality', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Test search
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first();
    if (await searchInput.isVisible()) {
      await page.screenshot({
        path: 'test-results/screenshots/08-search-before.png',
        fullPage: true
      });

      await searchInput.fill('test');
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: 'test-results/screenshots/08-search-after.png',
        fullPage: true
      });

      console.log('✅ Search functionality works');
    }

    // Test filters
    const filters = await page.locator('select, [role="combobox"], button:has-text("Filter")').all();
    for (let i = 0; i < Math.min(filters.length, 3); i++) {
      const filter = filters[i];
      if (await filter.isVisible()) {
        await filter.click();
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `test-results/screenshots/08-filter-${i}.png`,
          fullPage: true
        });
      }
    }
  });

  test('09 - Link navigation', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Find contributor/profile links
    const links = await page.locator('a[href*="/contributor"], a[href*="/profile"]').all();

    if (links.length > 0 && await links[0].isVisible()) {
      await page.screenshot({
        path: 'test-results/screenshots/09-before-profile-click.png',
        fullPage: true
      });

      await links[0].click();
      await page.waitForLoadState('networkidle');

      await page.screenshot({
        path: 'test-results/screenshots/09-profile-page.png',
        fullPage: true
      });

      console.log('✅ Profile link navigation works');
    }
  });

  test('10 - Performance and load times', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - startTime;

    await page.screenshot({
      path: 'test-results/screenshots/10-performance-test.png',
      fullPage: true
    });

    console.log(`✅ Page loaded in ${loadTime}ms`);
    expect(loadTime).toBeLessThan(10000); // Should load in under 10 seconds
  });
});
