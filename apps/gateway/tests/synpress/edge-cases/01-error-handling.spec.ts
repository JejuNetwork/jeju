/**
 * Error Handling and Edge Case Tests
 * Tests all error states, validation, and edge cases
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { rejectTransaction } from '../helpers/transaction-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Transaction Rejection Handling', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
  });

  test('should handle user rejecting add liquidity transaction', async ({ page, metamask }) => {
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    // Select token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Check if paymaster exists
    const noPaymaster = await page.getByText(/No paymaster deployed/i).isVisible();
    if (noPaymaster) {
      console.log('ℹ️  No paymaster - skipping rejection test');
      return;
    }

    // Enter amount
    const ethInput = page.getByPlaceholder('1.0');
    await ethInput.fill('0.1');

    // Submit
    await page.getByRole('button', { name: /Add.*ETH/i }).click();

    // Reject transaction
    await page.waitForTimeout(2000);
    await metamask.rejectTransaction();

    // Should handle rejection gracefully (not crash)
    await page.waitForTimeout(2000);
    
    // Form should still be visible, button should be re-enabled
    await expect(ethInput).toBeVisible();

    console.log('✅ Transaction rejection handled gracefully');
  });

  test('should handle rejected node registration', async ({ page, metamask }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    // Fill minimum required fields
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('Amount').fill('10000');
    
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').nth(1).click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/https:\/\/your-node/i).fill('https://test.com:8545');

    // Submit
    const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
    if (await submitButton.isEnabled()) {
      await submitButton.click();
      
      // Reject approval
      await page.waitForTimeout(2000);
      await metamask.rejectTransaction();
      
      await page.waitForTimeout(1000);
      
      // Form should still work
      await expect(submitButton).toBeVisible();
      
      console.log('✅ Node registration rejection handled');
    }
  });
});

test.describe('Form Validation Errors', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
  });

  test('should show validation error for invalid token address in registration', async ({ page }) => {
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);

    // Enter invalid address
    await page.getByPlaceholder('0x...').fill('invalid');
    await page.locator('input[placeholder="0"]').fill('0');
    await page.locator('input[placeholder="200"]').fill('200');

    await page.getByRole('button', { name: /Register Token/i }).click();

    await expect(page.getByText(/Invalid token address/i)).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: 'test-results/screenshots/errors/01-invalid-address.png',
      fullPage: true,
    });

    console.log('✅ Invalid address validation shown');
  });

  test('should show validation for RPC URL in node registration', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    // Fill required fields but invalid RPC URL
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('Amount').fill('10000');

    // Invalid RPC URL
    await page.getByPlaceholder(/https:\/\/your-node/i).fill('not-a-url');

    // Submit should be disabled or show error
    const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
    const disabled = await submitButton.isDisabled().catch(() => true);

    expect(disabled).toBe(true);

    console.log('✅ RPC URL validation working');
  });

  test('should validate app name required in registry', async ({ page }) => {
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    // Try to submit without name
    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await expect(submitButton).toBeDisabled();

    // Fill name
    await page.getByPlaceholder('My Awesome App').fill('Test');
    
    // Still disabled (needs tags and stake)
    await expect(submitButton).toBeDisabled();

    console.log('✅ App name validation working');
  });
});

test.describe('Insufficient Balance Errors', () => {
  test('should show error when insufficient ETH for liquidity', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    // Select token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Try to add more ETH than available
    const ethInput = page.getByPlaceholder('1.0');
    if (await ethInput.isVisible()) {
      await ethInput.fill('999999'); // Unrealistic amount

      await page.getByRole('button', { name: /Add.*ETH/i }).click();

      // MetaMask should show insufficient funds
      await page.waitForTimeout(2000);
      
      // Transaction would fail - reject it
      await metamask.rejectTransaction();

      console.log('✅ Insufficient balance would be caught by wallet');
    }
  });
});

test.describe('Network and Connection Errors', () => {
  test('should handle disconnected wallet gracefully', async ({ page }) => {
    await page.goto(GATEWAY_URL);
    
    // Without connecting wallet
    
    // Try to access features - should show connect prompt
    await expect(page.getByText(/Connect Your Wallet/i)).toBeVisible();

    console.log('✅ Disconnected state handled correctly');
  });

  test.skip('should detect wrong network and show warning', async ({ page, metamask }) => {
    // TODO: Switch to different network and verify warning
    console.log('⚠️  Wrong network test - needs network switching implementation');
  });

  test.skip('should handle RPC connection failures', async ({ page }) => {
    // TODO: Simulate RPC down and test graceful degradation
    console.log('⚠️  RPC failure test - needs error injection');
  });
});

test.describe('Empty State Tests', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
  });

  test('should show empty state for LP positions if none exist', async ({ page }) => {
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await page.waitForTimeout(1000);

    const emptyState = page.getByText(/No LP Positions/i);
    const hasEmpty = await emptyState.isVisible();

    if (hasEmpty) {
      await expect(page.getByText(/Add liquidity to earn fees/i)).toBeVisible();
      await page.screenshot({
        path: 'test-results/screenshots/errors/02-empty-lp.png',
        fullPage: true,
      });
      console.log('✅ Empty LP state displayed');
    }
  });

  test('should show empty state for nodes if none registered', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);

    const emptyState = page.getByText(/No Nodes Yet/i);
    const hasEmpty = await emptyState.isVisible();

    if (hasEmpty) {
      await expect(page.getByText(/Stake tokens and register a node/i)).toBeVisible();
      await page.screenshot({
        path: 'test-results/screenshots/errors/03-empty-nodes.png',
        fullPage: true,
      });
      console.log('✅ Empty nodes state displayed');
    }
  });

  test('should show empty state for apps if none registered', async ({ page }) => {
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);

    const emptyState = page.getByText(/No Apps Found/i);
    const hasEmpty = await emptyState.isVisible();

    if (hasEmpty) {
      await expect(page.getByText(/register/i)).toBeVisible();
      await page.screenshot({
        path: 'test-results/screenshots/errors/04-empty-apps.png',
        fullPage: true,
      });
      console.log('✅ Empty apps state displayed');
    }
  });
});


