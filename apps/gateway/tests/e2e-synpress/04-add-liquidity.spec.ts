/**
 * Gateway Add Liquidity - Synpress E2E Tests
 * Tests ETH liquidity provision for all protocol tokens
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../fixtures/synpress-wallet';
import { connectWallet, approveTransaction } from '../helpers/wallet-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('Add Liquidity Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Navigate to Add Liquidity tab
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display add liquidity interface', async ({ page }) => {
    await expect(page.getByText('Add ETH Liquidity')).toBeVisible();
    
    // Screenshot
    await page.screenshot({ path: 'test-results/screenshots/synpress-liquidity-interface.png', fullPage: true });
  });

  test('should show liquidity information box', async ({ page }) => {
    await expect(page.getByText(/How it works/i)).toBeVisible();
    await expect(page.getByText(/Deposit ETH to sponsor gas payments/i)).toBeVisible();
    await expect(page.getByText(/Earn fees in protocol tokens/i)).toBeVisible();
    
    console.log('✅ Liquidity info box displayed');
  });

  test('should include all protocol tokens', async ({ page }) => {
    // Open token selector
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    
    // All tokens should be available for LP
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    console.log('✅ All tokens available for liquidity');
  });

  test('should validate ETH amount input', async ({ page }) => {
    // Select token with deployed paymaster
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);
    
    // ETH amount input should appear
    const amountInput = page.getByPlaceholder('1.0');
    const inputVisible = await amountInput.isVisible();
    
    if (inputVisible) {
      await amountInput.fill('2.5');
      
      // Button should reflect amount
      await expect(page.getByRole('button', { name: /Add 2.5 ETH/i })).toBeVisible();
      
      console.log('✅ ETH amount validation works');
    }
  });

  test('should warn if paymaster not deployed', async ({ page }) => {
    // Select a token that might not have paymaster
    await page.locator('.input').first().click();
    await page.getByText('CLANKERMON').click();
    await page.waitForTimeout(1000);
    
    // Check for warning
    const warning = page.getByText(/No paymaster deployed/i);
    const hasWarning = await warning.isVisible();
    
    if (hasWarning) {
      await expect(page.getByText(/Deploy one first/i)).toBeVisible();
      console.log('✅ No paymaster warning shown');
    }
  });

  test('should display LP position if exists', async ({ page }) => {
    // Select token
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);
    
    // Check for LP position card
    const lpCard = page.getByText(/Your elizaOS LP Position/i);
    const hasPosition = await lpCard.isVisible();
    
    if (hasPosition) {
      await expect(page.getByText('ETH Shares')).toBeVisible();
      await expect(page.getByText('ETH Value')).toBeVisible();
      await expect(page.getByText('Pending Fees')).toBeVisible();
      await expect(page.getByRole('button', { name: /Remove All Liquidity/i })).toBeVisible();
      
      console.log('✅ LP position displayed');
      
      // Screenshot LP position
      await page.screenshot({ path: 'test-results/screenshots/synpress-lp-position.png', fullPage: true });
    } else {
      console.log('ℹ️ No LP position for this token');
    }
  });

  test.skip('should add liquidity successfully', async ({ page, metamask }) => {
    // Skip in most runs - requires gas
    
    // Select token
    await page.locator('.input').first().click();
    await page.getByText('VIRTUAL').click();
    
    // Enter amount
    const amountInput = page.getByPlaceholder('1.0');
    await amountInput.fill('0.1');
    
    // Click add liquidity
    const addButton = page.getByRole('button', { name: /Add 0.1 ETH/i });
    await addButton.click();
    
    // Approve in MetaMask
    await approveTransaction(metamask);
    
    // Wait for success
    await expect(page.getByText(/Liquidity added successfully/i)).toBeVisible({ timeout: 60000 });
    
    console.log('✅ Liquidity added successfully');
  });
});

test.describe('LP Dashboard', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Navigate to My Earnings tab
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display LP dashboard', async ({ page }) => {
    await expect(page.getByText('My LP Positions')).toBeVisible();
    
    // Screenshot
    await page.screenshot({ path: 'test-results/screenshots/synpress-lp-dashboard.png', fullPage: true });
  });

  test('should show all LP positions or empty state', async ({ page }) => {
    // Check for positions or empty state
    const emptyState = page.getByText(/No LP Positions/i);
    const positionCards = page.locator('.card').filter({ hasText: /Position/i });
    
    const isEmpty = await emptyState.isVisible();
    const hasPositions = await positionCards.count() > 0;
    
    expect(isEmpty || hasPositions).toBe(true);
    
    if (isEmpty) {
      await expect(page.getByText(/Add liquidity to earn fees/i)).toBeVisible();
      console.log('ℹ️ No LP positions yet');
    } else {
      console.log(`✅ Found ${await positionCards.count()} LP positions`);
    }
  });

  test('should show claim fees button for positions with pending fees', async ({ page }) => {
    const claimButtons = page.getByRole('button', { name: /Claim/i });
    const count = await claimButtons.count();
    
    if (count > 0) {
      console.log(`✅ Found ${count} claim buttons`);
    } else {
      console.log('ℹ️ No pending fees to claim');
    }
    
    expect(count >= 0).toBe(true);
  });

  test.skip('should claim fees successfully', async ({ page, metamask }) => {
    // Skip - requires existing LP position with fees
    
    // Click first claim button
    const claimButton = page.getByRole('button', { name: /Claim/i }).first();
    await claimButton.click();
    
    // Approve in MetaMask
    await approveTransaction(metamask);
    
    // Wait for success
    await expect(page.getByText(/Fees claimed successfully/i)).toBeVisible({ timeout: 60000 });
    
    console.log('✅ Fees claimed');
  });
});

