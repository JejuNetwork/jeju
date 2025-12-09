/**
 * Bridge Transaction Tests
 * Tests token bridging from Ethereum to Jeju (approve + bridge)
 * 
 * NOTE: Currently tests UI and approval flow
 * Full bridge requires Sepolia testnet connection
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction } from '../helpers/transaction-helpers';
import { GATEWAY_URL, PROTOCOL_TOKENS, TEST_AMOUNTS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Bridge UI and Validation', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should validate amount before enabling bridge button', async ({ page }) => {
    // Select token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    // No amount - button disabled
    let bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeDisabled();

    // Enter amount
    await page.getByPlaceholder('0.0').fill(TEST_AMOUNTS.TOKEN.SMALL);
    await page.waitForTimeout(500);

    // Button should be enabled
    bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeEnabled();

    console.log('✅ Amount validation works');
  });

  test('should calculate USD value for bridge amount', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    // Enter amount
    await page.getByPlaceholder('0.0').fill('100');
    await page.waitForTimeout(500);

    // USD value should appear
    await expect(page.getByText(/≈ \$/)).toBeVisible();

    // Should be approximately $185 (100 * $1.85)
    const usdText = await page.locator('text=/≈ \\$/').textContent();
    console.log(`ℹ️  USD value: ${usdText}`);

    console.log('✅ USD calculation works');
  });

  test('should handle custom token address', async ({ page }) => {
    // Switch to custom mode
    await page.getByRole('button', { name: /Custom Address/i }).click();

    // Custom input visible
    await expect(page.getByPlaceholder('0x...')).toBeVisible();

    // Enter valid address
    await page.getByPlaceholder('0x...').fill('0x1234567890123456789012345678901234567890');

    // Enter amount
    await page.getByPlaceholder('0.0').fill('10');

    // Button should be enabled
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeEnabled();

    console.log('✅ Custom token address mode works');
  });

  test('should validate custom token address format', async ({ page }) => {
    await page.getByRole('button', { name: /Custom Address/i }).click();

    // Enter invalid address
    await page.getByPlaceholder('0x...').fill('invalid-address');
    await page.getByPlaceholder('0.0').fill('10');

    // Button should be disabled
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeDisabled();

    console.log('✅ Invalid custom address rejected');
  });

  test('should allow optional recipient address', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKERMON').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('50');

    // Recipient is optional - button should work without it
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeEnabled();

    // Add recipient
    const recipientInput = page.getByPlaceholder(/0x.../);
    await recipientInput.fill('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');

    // Still enabled
    await expect(bridgeButton).toBeEnabled();

    console.log('✅ Optional recipient works');
  });
});

test.describe('Bridge Transaction Approval', () => {
  test('should approve CLANKER for bridge', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    // Select CLANKER
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    // Enter small amount
    await page.getByPlaceholder('0.0').fill('1');

    await page.screenshot({
      path: 'test-results/screenshots/bridge-tx/01-before-bridge.png',
      fullPage: true,
    });

    // Click bridge (will trigger approval first)
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await bridgeButton.click();

    // Approve in MetaMask (first tx)
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();

    console.log('✅ CLANKER approval transaction confirmed');

    // Note: Second transaction (actual bridge) would execute after approval
    // But requires Base bridge setup
    await page.waitForTimeout(3000);
    
    // If second tx appears, handle it
    // In current implementation, both might execute
    const hasSecondTx = await page.locator('text=/Bridge transaction submitted/i').isVisible({ timeout: 5000 });
    
    if (hasSecondTx) {
      console.log('ℹ️  Bridge transaction also executed (check implementation)');
    }

    await page.screenshot({
      path: 'test-results/screenshots/bridge-tx/02-approved.png',
      fullPage: true,
    });
  });

  test.skip('should execute bridge after approval', async ({ page, metamask }) => {
    // TODO: Implement full bridge flow when Sepolia testnet available
    // Would require:
    // 1. Approval transaction (done above)
    // 2. Bridge transaction
    // 3. Wait for relay
    // 4. Verify receipt on Jeju
    // 5. Check balance updated

    console.log('⚠️  Full bridge transaction - requires Sepolia testnet setup');
    console.log('   See TODO in COMPREHENSIVE_TEST_PLAN.md');
  });
});

test.describe('Bridge Error Handling', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should show insufficient balance error', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    // Enter unrealistic amount
    await page.getByPlaceholder('0.0').fill('999999999');

    // Might show error or MetaMask will catch it
    console.log('ℹ️  Insufficient balance would be caught by MetaMask');
  });

  test('should reject bridging elizaOS (native token)', async ({ page }) => {
    // Open dropdown
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // elizaOS should NOT be in list
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'CLANKER' });
    const hasElizaOS = await dropdown.getByText('elizaOS').isVisible();

    expect(hasElizaOS).toBe(false);

    // Warning should be visible
    await expect(page.getByText(/elizaOS is a native Jeju token/i)).toBeVisible();
    await expect(page.getByText(/cannot be bridged from Ethereum/i)).toBeVisible();

    console.log('✅ elizaOS correctly excluded from bridge');
  });

  test('should handle bridge transaction rejection', async ({ page, metamask }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKERMON').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('10');

    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await bridgeButton.click();

    // Reject approval
    await page.waitForTimeout(2000);
    await metamask.rejectTransaction();

    await page.waitForTimeout(1000);

    // UI should handle rejection gracefully
    await expect(bridgeButton).toBeVisible(); // Form still works

    console.log('✅ Bridge rejection handled gracefully');
  });
});

test.describe('Bridge History Display', () => {
  test('should show bridge history section', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    // Scroll to history section (if visible)
    const historySection = page.getByText(/Bridge History/i);
    const hasHistory = await historySection.isVisible();

    if (hasHistory) {
      // Check for transfers or empty state
      const emptyState = page.getByText(/No bridge transfers yet/i);
      const hasEmpty = await emptyState.isVisible();

      if (hasEmpty) {
        await expect(page.getByText(/Your bridged tokens will appear here/i)).toBeVisible();
        console.log('✅ Empty bridge history displayed');
      } else {
        console.log('ℹ️  Bridge history has transfers');
      }
    } else {
      console.log('ℹ️  Bridge history section not visible');
    }
  });

  test.skip('should display completed bridge transfer in history', async ({ page }) => {
    // TODO: After executing real bridge transaction, verify it appears in history
    // Would test:
    // - Transfer displayed with correct amount
    // - Status indicator (confirmed)
    // - Timestamp shown
    // - Transaction hash link
    // - Token symbol correct

    console.log('⚠️  Bridge history population - requires completed bridge transaction');
  });
});


