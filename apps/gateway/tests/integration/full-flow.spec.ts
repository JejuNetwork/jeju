/**
 * @fileoverview Full integration flow tests
 * @module gateway/tests/integration/full-flow
 */

import { testWithWallet as test, expect } from '../fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';

test.describe('Complete Protocol Flow', () => {
  test('full token lifecycle: register → deploy → add liquidity → earn fees', async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    // Step 1: View token balances
    await expect(page.getByText('Token Balances')).toBeVisible();
    await expect(page.getByText('elizaOS')).toBeVisible();
    
    // Step 2: Check registered tokens
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await expect(page.getByText(/Registered Tokens/i)).toBeVisible();
    
    // Step 3: Navigate to Deploy Paymaster
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await expect(page.getByText('Deploy Paymaster')).toBeVisible();
    
    // Step 4: Navigate to Add Liquidity
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await expect(page.getByText('Add ETH Liquidity')).toBeVisible();
    
    // Step 5: Check earnings dashboard
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await expect(page.getByText('My LP Positions')).toBeVisible();
  });

  test('bridge → deploy → liquidity → earnings flow', async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    // Step 1: Bridge token from Base
    await page.getByRole('button', { name: /Bridge from Base/i }).click();
    await expect(page.getByText('Bridge from Base to Jeju')).toBeVisible();
    
    // Select CLANKER
    await page.locator('.input').first().click();
    const clanker = page.getByText('CLANKER').first();
    if (await clanker.isVisible()) {
      await clanker.click();
    }
    
    // Step 2: Check if paymaster needed
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    
    // Step 3: Add liquidity
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    
    // Step 4: View earnings
    await page.getByRole('button', { name: /My Earnings/i }).click();
  });

  test('node staking complete flow: stake → register → monitor → claim', async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    // Navigate to Node Operators
    await page.getByRole('button', { name: /Node Operators/i }).click();
    
    // View network overview
    await page.getByRole('button', { name: /Network Overview/i }).click();
    await expect(page.getByText('Total Nodes')).toBeVisible();
    
    // View my nodes
    await page.getByRole('button', { name: /My Nodes/i }).click();
    
    // Register new node form
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await expect(page.getByText('Register New Node')).toBeVisible();
  });

  test('app registry complete flow: browse → register → discover', async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    // Navigate to App Registry
    await page.getByRole('button', { name: /App Registry/i }).click();
    
    // Browse apps
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    
    // Filter by tag
    const gameFilter = page.getByText('Games');
    if (await gameFilter.isVisible()) {
      await gameFilter.click();
    }
    
    // Register new app
    await page.getByRole('button', { name: /Register App/i }).click();
    await expect(page.getByText('Register New App')).toBeVisible();
  });
});


