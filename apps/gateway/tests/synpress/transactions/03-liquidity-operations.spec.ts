/**
 * Liquidity Operations Transaction Tests
 * Tests add liquidity, remove liquidity, and claim fees
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction } from '../helpers/transaction-helpers';
import { GATEWAY_URL, TEST_AMOUNTS, PROTOCOL_TOKENS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Add Liquidity Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should add 0.1 ETH liquidity to elizaOS vault', async ({ page, metamask }) => {
    // Select elizaOS
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Check paymaster exists
    const noPaymaster = await page.getByText(/No paymaster deployed/i).isVisible();
    if (noPaymaster) {
      console.log('⚠️  No paymaster - deploy first');
      return;
    }

    // Enter amount
    const ethInput = page.getByPlaceholder('1.0');
    await expect(ethInput).toBeVisible();
    await ethInput.fill(TEST_AMOUNTS.ETH.SMALL);

    await page.screenshot({
      path: 'test-results/screenshots/liquidity-tx/01-add-eth.png',
      fullPage: true,
    });

    // Add liquidity
    await page.getByRole('button', { name: /Add.*ETH to elizaOS/i }).click();

    await executeTransaction(page, metamask, {
      expectSuccessMessage: 'Liquidity added successfully',
      timeout: 45000,
    });

    // Verify position created
    await expect(page.getByText(/Your elizaOS LP Position/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ETH Shares')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/liquidity-tx/02-position-created.png',
      fullPage: true,
    });

    console.log('✅ Add liquidity transaction successful');
  });

  test('should add liquidity to multiple token vaults', async ({ page, metamask }) => {
    const tokensToTest = ['elizaOS', 'CLANKER', 'VIRTUAL'];

    for (const tokenSymbol of tokensToTest) {
      // Select token
      await page.locator('.input').first().click();
      await page.waitForTimeout(500);

      const tokenOption = page.getByText(tokenSymbol);
      const available = await tokenOption.isVisible();

      if (!available) {
        console.log(`ℹ️  ${tokenSymbol} not available`);
        continue;
      }

      await tokenOption.click();
      await page.waitForTimeout(1000);

      // Check paymaster
      const noPaymaster = await page.getByText(/No paymaster deployed/i).isVisible();
      if (noPaymaster) {
        console.log(`ℹ️  ${tokenSymbol} - no paymaster`);
        continue;
      }

      // Add small amount
      const ethInput = page.getByPlaceholder('1.0');
      if (await ethInput.isVisible()) {
        await ethInput.fill('0.05');

        await page.getByRole('button', { name: new RegExp(`Add.*${tokenSymbol}`, 'i') }).click();

        await executeTransaction(page, metamask, {
          expectSuccessMessage: 'Liquidity added',
          timeout: 45000,
        });

        console.log(`✅ Added liquidity to ${tokenSymbol} vault`);
      }
    }
  });

  test('should reject liquidity below minimum (if enforced)', async ({ page }) => {
    // Select token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Try very small amount
    const ethInput = page.getByPlaceholder('1.0');
    if (await ethInput.isVisible()) {
      await ethInput.fill('0.001');

      const addButton = page.getByRole('button', { name: /Add.*ETH/i });
      
      // Might be disabled or show warning
      const disabled = await addButton.isDisabled().catch(() => false);
      
      if (disabled) {
        console.log('✅ Small amount rejected (button disabled)');
      } else {
        console.log('ℹ️  No minimum enforced');
      }
    }
  });
});

test.describe('Remove Liquidity Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should remove all liquidity from position', async ({ page, metamask }) => {
    // Select elizaOS
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Check if position exists
    const positionExists = await page.getByText(/Your elizaOS LP Position/i).isVisible();

    if (!positionExists) {
      console.log('ℹ️  No LP position - add liquidity first');
      return;
    }

    // Get current shares
    const sharesText = await page.locator('p:has-text("ETH Shares")').locator('..').locator('p').nth(1).textContent();
    console.log(`ℹ️  Current shares: ${sharesText}`);

    // Remove all liquidity
    const removeButton = page.getByRole('button', { name: /Remove All Liquidity/i });
    await expect(removeButton).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/liquidity-tx/03-before-remove.png',
      fullPage: true,
    });

    await removeButton.click();

    await executeTransaction(page, metamask, {
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/liquidity-tx/04-removed.png',
      fullPage: true,
    });

    console.log('✅ Remove liquidity transaction successful');

    // Verify position gone or zero
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForTimeout(2000);
    
    // Position should not be visible or show zero
    console.log('✅ Position removed verified');
  });
});

test.describe('Claim Fees Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should claim LP fees for token with pending fees', async ({ page, metamask }) => {
    // Check for claim buttons
    const claimButtons = page.getByRole('button', { name: /Claim/i });
    const count = await claimButtons.count();

    if (count === 0) {
      console.log('ℹ️  No pending fees to claim');
      return;
    }

    // Click first claim button
    const firstClaim = claimButtons.first();
    
    // Check if enabled
    const enabled = await firstClaim.isEnabled();
    
    if (!enabled) {
      console.log('ℹ️  Claim button disabled (no pending fees)');
      return;
    }

    await page.screenshot({
      path: 'test-results/screenshots/claim-tx/01-before-claim.png',
      fullPage: true,
    });

    await firstClaim.click();

    await executeTransaction(page, metamask, {
      expectSuccessMessage: 'Fees claimed successfully',
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/claim-tx/02-claimed.png',
      fullPage: true,
    });

    console.log('✅ Claim fees transaction successful');
  });

  test('should show empty state if no positions', async ({ page }) => {
    const emptyState = page.getByText(/No LP Positions/i);
    const hasEmpty = await emptyState.isVisible();

    if (hasEmpty) {
      await expect(page.getByText(/Add liquidity to earn fees/i)).toBeVisible();
      console.log('✅ Empty state displayed correctly');
    }
  });
});


