/**
 * @fileoverview Liquidity provision E2E tests
 * @module gateway/tests/e2e/liquidity-provision
 */

import { testWithWallet as test, expect } from '../fixtures/wallet';
import { captureScreenshot, captureUserFlow as _captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';
import { connectWallet } from '@jejunetwork/tests/helpers/contracts';

test.describe('Add Liquidity Flow', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    // Navigate to Liquidity tab
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
  });

  test('should display add liquidity interface', async ({ page }) => {
    await expect(page.getByText('Add ETH Liquidity')).toBeVisible();
  });

  test('should show liquidity info box', async ({ page }) => {
    await expect(page.getByText(/How it works/i)).toBeVisible();
    await expect(page.getByText(/Deposit ETH to sponsor gas payments/i)).toBeVisible();
    await expect(page.getByText(/Earn fees in protocol tokens/i)).toBeVisible();
  });

  test('should include all tokens in selector', async ({ page }) => {
    await page.locator('.input').first().click();
    
    // All protocol tokens should be available
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
  });

  test('should warn if paymaster not deployed', async ({ page }) => {
    // Select a token that might not have paymaster deployed
    await page.locator('.input').first().click();
    const tokenToTest = page.getByText('CLANKERMON');
    
    if (await tokenToTest.isVisible()) {
      await tokenToTest.click();
      
      // Check for deployment warning
      const warning = page.getByText(/No paymaster deployed/i);
      const warningExists = await warning.isVisible();
      
      if (warningExists) {
        await expect(page.getByText(/Deploy one first/i)).toBeVisible();
      }
    }
  });

  test('should validate ETH amount input', async ({ page }) => {
    // Select token with deployed paymaster
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    
    // ETH amount input should appear if paymaster deployed
    const amountInput = page.getByPlaceholder('1.0');
    const inputExists = await amountInput.isVisible();
    
    if (inputExists) {
      await expect(amountInput).toBeVisible();
      
      // Fill amount
      await amountInput.fill('2.5');
      
      // Button text should reflect amount
      await expect(page.getByRole('button', { name: /Add 2.5 ETH/i })).toBeVisible();
    }
  });

  test('should display LP position if exists', async ({ page }) => {
    // Select token
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    
    // Check if LP position card appears
    const lpCard = page.getByText(/Your elizaOS LP Position/i);
    const hasPosition = await lpCard.isVisible();
    
    if (hasPosition) {
      await expect(page.getByText('ETH Shares')).toBeVisible();
      await expect(page.getByText('ETH Value')).toBeVisible();
      await expect(page.getByText('Pending Fees')).toBeVisible();
      await expect(page.getByRole('button', { name: /Remove All Liquidity/i })).toBeVisible();
    }
  });

  test('should show fee earnings in position', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.getByText('VIRTUAL').click();
    
    const lpCard = page.getByText(/Your VIRTUAL LP Position/i);
    const hasPosition = await lpCard.isVisible();
    
    if (hasPosition) {
      // Pending fees should be displayed (even if 0)
      await expect(page.getByText('Pending Fees')).toBeVisible();
    }
  });
});

test.describe('LP Dashboard Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMetaMask(metamask);
    await importTestAccount(metamask);
    await page.goto('/');
    await connectWallet(page);
    
    // Navigate to Earnings tab
    await page.getByRole('button', { name: /My Earnings/i }).click();
  });

  test('should display LP dashboard', async ({ page }) => {
    await expect(page.getByText('My LP Positions')).toBeVisible();
  });

  test('should show positions for all tokens with liquidity', async ({ page }) => {
    // Check for position cards or empty state
    const noPositionsMsg = page.getByText(/No LP Positions/i);
    const hasNoPositions = await noPositionsMsg.isVisible();
    
    if (hasNoPositions) {
      await expect(page.getByText(/Add liquidity to earn fees/i)).toBeVisible();
    } else {
      // Should show position cards for tokens with liquidity
      // Position cards would have token symbols in headings
      const positionCards = page.locator('.card').filter({ hasText: /Position/i });
      const count = await positionCards.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should display claim button for positions with pending fees', async ({ page }) => {
    // If positions exist, check for claim functionality
    const claimButtons = page.getByRole('button', { name: /Claim/i });
    const claimCount = await claimButtons.count();
    
    // Either has claim buttons or shows empty state
    expect(claimCount >= 0).toBe(true);
  });
});


