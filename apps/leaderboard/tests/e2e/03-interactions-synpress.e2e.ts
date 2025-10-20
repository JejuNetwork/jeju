import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';
import basicSetup from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { describe } = test;

describe('User Interactions and UI Elements', () => {
  test('should test all clickable buttons on homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Screenshot initial state
    await page.screenshot({
      path: 'test-results/screenshots/interactions/01-homepage-buttons.png',
      fullPage: true
    });

    // Find all buttons
    const buttons = await page.locator('button').all();
    console.log(`Found ${buttons.length} buttons on homepage`);

    // Test each button (except wallet connect which requires metamask)
    for (let i = 0; i < Math.min(buttons.length, 5); i++) {
      const button = buttons[i];
      if (await button.isVisible()) {
        const buttonText = await button.textContent();
        console.log(`Testing button: ${buttonText}`);

        // Screenshot before click
        await page.screenshot({
          path: `test-results/screenshots/interactions/button-${i}-before.png`,
          fullPage: true
        });

        // If it's not a navigation button, click and see what happens
        if (buttonText && !buttonText.toLowerCase().includes('connect')) {
          try {
            await button.click({ timeout: 5000 });
            await page.waitForTimeout(1000);

            // Screenshot after click
            await page.screenshot({
              path: `test-results/screenshots/interactions/button-${i}-after.png`,
              fullPage: true
            });
          } catch (e) {
            console.log(`Button ${i} (${buttonText}) not clickable or caused error:`, e);
          }
        }
      }
    }
  });

  test('should test wallet connect button and modal', async ({ page, metamask }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find Connect Wallet button
    const connectButton = page.getByRole('button', { name: /connect/i }).first();
    await expect(connectButton).toBeVisible();

    // Screenshot before connecting
    await page.screenshot({
      path: 'test-results/screenshots/interactions/02-wallet-before.png',
      fullPage: true
    });

    // Click connect
    await connectButton.click();

    // Connect through MetaMask
    await metamask.connectToDapp();

    // Screenshot after connecting
    await page.screenshot({
      path: 'test-results/screenshots/interactions/02-wallet-after.png',
      fullPage: true
    });

    // Verify connection
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}/i')).toBeVisible();
  });

  test('should test leaderboard interactions', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Screenshot initial state
    await page.screenshot({
      path: 'test-results/screenshots/interactions/03-leaderboard-initial.png',
      fullPage: true
    });

    // Test sorting if available
    const sortButtons = await page.locator('button[role="columnheader"], th[role="columnheader"], button:has-text("Sort")').all();
    for (let i = 0; i < Math.min(sortButtons.length, 3); i++) {
      const sortButton = sortButtons[i];
      if (await sortButton.isVisible()) {
        await sortButton.click();
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `test-results/screenshots/interactions/03-leaderboard-sort-${i}.png`,
          fullPage: true
        });
      }
    }

    // Test pagination if available
    const nextButton = page.getByRole('button', { name: /next|→|>/i }).first();
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: 'test-results/screenshots/interactions/03-leaderboard-page2.png',
        fullPage: true
      });
    }

    // Click on a contributor if available
    const contributorLinks = await page.locator('a[href^="/contributors/"], a[href^="/profile/"]').all();
    if (contributorLinks.length > 0 && await contributorLinks[0].isVisible()) {
      await contributorLinks[0].click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: 'test-results/screenshots/interactions/03-contributor-profile.png',
        fullPage: true
      });
    }
  });

  test('should test rewards page interactions', async ({ page, metamask }) => {
    await page.goto('/rewards');
    await page.waitForLoadState('networkidle');

    // Screenshot initial state
    await page.screenshot({
      path: 'test-results/screenshots/interactions/04-rewards-initial.png',
      fullPage: true
    });

    // Connect wallet if not connected
    const connectButton = page.getByRole('button', { name: /connect/i }).first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(2000);
    }

    // Screenshot after wallet connection
    await page.screenshot({
      path: 'test-results/screenshots/interactions/04-rewards-connected.png',
      fullPage: true
    });

    // Test claim buttons if available
    const claimButtons = await page.getByRole('button', { name: /claim/i }).all();
    for (let i = 0; i < Math.min(claimButtons.length, 2); i++) {
      const claimButton = claimButtons[i];
      if (await claimButton.isVisible() && !await claimButton.isDisabled()) {
        // Screenshot before claim
        await page.screenshot({
          path: `test-results/screenshots/interactions/04-rewards-before-claim-${i}.png`,
          fullPage: true
        });

        // Click claim (might trigger MetaMask)
        await claimButton.click();
        await page.waitForTimeout(1000);

        // Screenshot after claim attempt
        await page.screenshot({
          path: `test-results/screenshots/interactions/04-rewards-after-claim-${i}.png`,
          fullPage: true
        });
      }
    }
  });

  test('should test search and filter functionality', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]').first();
    if (await searchInput.isVisible()) {
      // Screenshot before search
      await page.screenshot({
        path: 'test-results/screenshots/interactions/05-search-before.png',
        fullPage: true
      });

      // Type in search
      await searchInput.fill('test');
      await page.waitForTimeout(1000);

      // Screenshot after search
      await page.screenshot({
        path: 'test-results/screenshots/interactions/05-search-after.png',
        fullPage: true
      });
    }

    // Look for filter buttons/dropdowns
    const filterButtons = await page.locator('button:has-text("Filter"), select, [role="combobox"]').all();
    for (let i = 0; i < Math.min(filterButtons.length, 3); i++) {
      const filterButton = filterButtons[i];
      if (await filterButton.isVisible()) {
        await filterButton.click();
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `test-results/screenshots/interactions/05-filter-${i}.png`,
          fullPage: true
        });
      }
    }
  });

  test('should test theme toggle if available', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for theme toggle button
    const themeButton = page.locator('button[aria-label*="theme" i], button:has-text("Dark"), button:has-text("Light")').first();
    if (await themeButton.isVisible()) {
      // Screenshot light mode
      await page.screenshot({
        path: 'test-results/screenshots/interactions/06-theme-light.png',
        fullPage: true
      });

      // Toggle theme
      await themeButton.click();
      await page.waitForTimeout(500);

      // Screenshot dark mode
      await page.screenshot({
        path: 'test-results/screenshots/interactions/06-theme-dark.png',
        fullPage: true
      });
    }
  });

  test('should test mobile menu if available', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Screenshot mobile view
    await page.screenshot({
      path: 'test-results/screenshots/interactions/07-mobile-initial.png',
      fullPage: true
    });

    // Look for hamburger menu
    const menuButton = page.locator('button[aria-label*="menu" i], button:has-text("☰")').first();
    if (await menuButton.isVisible()) {
      await menuButton.click();
      await page.waitForTimeout(500);

      // Screenshot with menu open
      await page.screenshot({
        path: 'test-results/screenshots/interactions/07-mobile-menu-open.png',
        fullPage: true
      });
    }
  });
});
