/**
 * Deep interaction tests for Portfolio page - EVERY button, EVERY action
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Portfolio Page - Deep Button Testing', () => {
  test('should test all stats card displays', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    // If not connected, test connect wallet message
    const connectMessage = page.getByTestId('connect-wallet-message');
    const needsWallet = await connectMessage.isVisible();
    
    if (needsWallet) {
      // Verify all elements in connect message
      await expect(page.getByText(/Connect Your Wallet/i)).toBeVisible();
      await expect(page.getByText(/View your market positions/i)).toBeVisible();
      
      // Click connect wallet button in header
      const connectButton = page.getByRole('button', { name: /Connect Wallet/i });
      await connectButton.click();
      await page.waitForTimeout(500);
      await assertNoPageErrors(page);
    } else {
      // Test stats displays
      const totalValue = page.getByText(/Total Value/i);
      const totalPNL = page.getByText(/Total P&L/i);
      const activePositions = page.getByText(/Active Positions/i);
      
      await expect(totalValue).toBeVisible();
      await expect(totalPNL).toBeVisible();
      await expect(activePositions).toBeVisible();
    }
  });

  test('should test clicking positions table links', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    const needsWallet = await connectMessage.isVisible();
    
    if (needsWallet) return;
    
    const positionsTable = page.getByTestId('positions-table');
    const tableVisible = await positionsTable.isVisible();
    
    if (tableVisible) {
      // Click first market link in table
      const marketLinks = page.locator('a[href^="/markets/"]');
      const linkCount = await marketLinks.count();
      
      if (linkCount > 0) {
        const firstLink = marketLinks.first();
        await firstLink.click();
        await page.waitForTimeout(500);
        await assertNoPageErrors(page);
        await expect(page).toHaveURL(/\/markets\/.+/);
      }
    }
  });

  test('should test all claim buttons if present', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    const needsWallet = await connectMessage.isVisible();
    
    if (needsWallet) return;
    
    const claimButtons = page.getByRole('button', { name: /^Claim$/i });
    const count = await claimButtons.count();
    
    console.log(`Found ${count} claim buttons`);
    
    if (count > 0) {
      // Hover over each claim button
      for (let i = 0; i < count; i++) {
        const button = claimButtons.nth(i);
        await button.hover();
        await page.waitForTimeout(200);
        await assertNoPageErrors(page);
      }
      
      // Try clicking first one (will fail without contract but shouldn't crash)
      const firstClaim = claimButtons.first();
      await firstClaim.click();
      await page.waitForTimeout(500);
      await assertNoPageErrors(page);
    }
  });

  test('should test Browse Markets link when no positions', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    const needsWallet = await connectMessage.isVisible();
    
    if (needsWallet) return;
    
    const noPositions = page.getByTestId('no-positions');
    const noPositionsVisible = await noPositions.isVisible();
    
    if (noPositionsVisible) {
      const browseLink = page.getByRole('link', { name: /Browse markets/i });
      await browseLink.click();
      await page.waitForTimeout(500);
      await assertNoPageErrors(page);
      await expect(page).toHaveURL('/markets');
    }
  });

  test('should test all navigation from portfolio', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    // Click all nav links from portfolio page
    const navLinks = ['Home', 'Tokens', 'Markets'];
    
    for (const linkText of navLinks) {
      await page.goto('/portfolio');
      await page.waitForTimeout(500);
      
      const link = page.getByRole('link', { name: new RegExp(`^${linkText}$`, 'i') });
      const linkVisible = await link.first().isVisible();
      
      if (linkVisible) {
        await link.first().click();
        await page.waitForTimeout(500);
        await assertNoPageErrors(page);
      }
    }
  });

  test('should test position hover states', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    const needsWallet = await connectMessage.isVisible();
    
    if (needsWallet) return;
    
    const positionsTable = page.getByTestId('positions-table');
    const tableVisible = await positionsTable.isVisible();
    
    if (tableVisible) {
      const rows = page.locator('tbody tr');
      const rowCount = await rows.count();
      
      for (let i = 0; i < Math.min(rowCount, 3); i++) {
        const row = rows.nth(i);
        await row.hover();
        await page.waitForTimeout(200);
        await assertNoPageErrors(page);
      }
    }
  });
});

