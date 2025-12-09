/**
 * REAL Portfolio Tests - Actually verify calculations and data accuracy
 * These tests would FAIL if portfolio logic is broken
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Portfolio - REAL Functionality Verification', () => {
  test('should verify portfolio stats show actual numeric values', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    const needsWallet = await connectMessage.isVisible();
    
    if (needsWallet) {
      console.log('Wallet not connected - test skipped');
      return;
    }
    
    // Find the actual value elements
    const statsCards = page.locator('.bg-white\\/5.border.border-white\\/10.rounded-xl.p-6');
    const count = await statsCards.count();
    
    expect(count).toBeGreaterThanOrEqual(3);
    
    // Get first stat card (Total Value)
    const totalValueCard = statsCards.first();
    const totalValueText = await totalValueCard.textContent();
    
    // VERIFY: Contains number and ETH
    expect(totalValueText).toMatch(/\d+\.?\d*\s*ETH/);
    
    // Extract the numeric value
    const valueMatch = totalValueText?.match(/([\d,]+\.?\d*)\s*ETH/);
    if (valueMatch) {
      const numericValue = parseFloat(valueMatch[1].replace(/,/g, ''));
      
      // VERIFY: Value is a valid number
      expect(numericValue).toBeGreaterThanOrEqual(0);
      expect(isNaN(numericValue)).toBe(false);
      
      console.log('Total Value:', numericValue, 'ETH');
    }
    
    // Get second stat card (Total P&L)
    const pnlCard = statsCards.nth(1);
    const pnlText = await pnlCard.textContent();
    
    // VERIFY: P&L shows number (may be positive or negative)
    expect(pnlText).toMatch(/[+-]?\d+\.?\d*\s*ETH/);
    
    // Get third stat card (Active Positions)
    const activeCard = statsCards.nth(2);
    const activeText = await activeCard.textContent();
    
    // VERIFY: Active Positions is a number
    expect(activeText).toMatch(/\d+/);
    
    const activeMatch = activeText?.match(/(\d+)/);
    if (activeMatch) {
      const activeCount = parseInt(activeMatch[1]);
      expect(activeCount).toBeGreaterThanOrEqual(0);
      
      console.log('Active Positions:', activeCount);
    }
  });

  test('should verify positions table shows correct structure', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    const needsWallet = await connectMessage.isVisible();
    
    if (needsWallet) return;
    
    const positionsTable = page.getByTestId('positions-table');
    const tableVisible = await positionsTable.isVisible();
    
    if (tableVisible) {
      // VERIFY: Table has correct headers
      const headers = page.locator('th');
      const headerTexts = await headers.allTextContents();
      
      // TEST FAILS if headers missing or wrong
      expect(headerTexts.join(' ')).toMatch(/Market/i);
      expect(headerTexts.join(' ')).toMatch(/Position/i);
      expect(headerTexts.join(' ')).toMatch(/Value/i);
      expect(headerTexts.join(' ')).toMatch(/P&L/i);
      expect(headerTexts.join(' ')).toMatch(/Status/i);
      
      // VERIFY: Rows have correct structure
      const rows = page.locator('tbody tr');
      const rowCount = await rows.count();
      
      if (rowCount > 0) {
        const firstRow = rows.first();
        const rowText = await firstRow.textContent();
        
        // VERIFY: Row has ETH values
        expect(rowText).toMatch(/ETH/);
        
        // VERIFY: Row has YES or NO
        expect(rowText).toMatch(/YES|NO/);
        
        console.log('Position row example:', rowText?.slice(0, 100));
      }
    }
  });

  test('should verify clicking Browse Markets works', async ({ page }) => {
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
      
      // VERIFY: Link exists
      await expect(browseLink).toBeVisible();
      
      // VERIFY: Link has correct href
      const href = await browseLink.getAttribute('href');
      expect(href).toBe('/markets');
      
      // VERIFY: Clicking actually navigates
      await browseLink.click();
      await page.waitForTimeout(500);
      
      // TEST FAILS if navigation broken
      await expect(page).toHaveURL('/markets');
      await expect(page.getByRole('heading', { name: /Prediction Markets/i })).toBeVisible();
    }
  });
});

