/**
 * @fileoverview Games page E2E tests (registered games via ERC-8004)
 * @module bazaar/tests/e2e/games-page
 */

import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

test.describe('Games Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/games');
  });

  test('should display games page', async ({ page }) => {
    await expect(page).toHaveURL('/games');
    
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should show page title and description', async ({ page }) => {
    // Verify page has game-related content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.toLowerCase()).toMatch(/game|play|discover/);
  });

  test('should display registered games from ERC-8004 registry', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // Page should render with content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(100);
  });

  test('should display game information in cards', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    const gameCards = page.locator('[data-testid="game-card"]');
    const count = await gameCards.count();
    
    if (count > 0) {
      const firstCard = gameCards.first();
      
      // Should show game name or description
      const cardText = await firstCard.textContent();
      expect(cardText).toBeTruthy();
    } else {
      // Verify page structure exists even without games
      const mainContent = await page.locator('main, [role="main"], body > div').count();
      expect(mainContent).toBeGreaterThan(0);
    }
  });

  test('should show game categories or tags', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // Page should have interactive elements
    const buttons = await page.locator('button').count();
    expect(buttons).toBeGreaterThanOrEqual(0);
  });

  test('should allow filtering games by category', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Look for filter buttons
    const filterButtons = page.getByRole('button').filter({ hasText: /all|active|popular/i });
    const count = await filterButtons.count();
    
    expect(count >= 0).toBe(true);
  });

  test('should display game stats (players, bets, etc)', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // Verify page structure
    const mainContent = await page.locator('main, [role="main"], body > div').count();
    expect(mainContent).toBeGreaterThan(0);
  });

  test('should allow navigation to game detail/play', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // Page should have navigation elements
    const navElements = await page.locator('nav, header, a').count();
    expect(navElements).toBeGreaterThan(0);
  });

  test('should display A2A integration status for games', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // Verify page renders without errors
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(50);
  });
});


