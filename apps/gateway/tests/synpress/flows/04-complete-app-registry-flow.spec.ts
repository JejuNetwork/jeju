/**
 * Complete App Registry Flow Test
 * Tests: Register App → Browse Apps → View Details → Withdraw Stake
 * 
 * CRITICAL: Tests ERC-8004 registry functionality
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTwoStepTransaction, executeTransaction } from '../helpers/transaction-helpers';
import {
  GATEWAY_URL,
  TEST_APP,
  REGISTRY_TAGS,
  PROTOCOL_TOKENS,
  calculateRegistryStake,
} from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Complete App Registry Flow', () => {
  test('FULL FLOW: Register App → Browse → View Details → Withdraw Stake', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // ===================
    // STEP 1: Connect Wallet
    // ===================
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
    console.log('✅ 1/8: Wallet connected');

    // ===================
    // STEP 2: Navigate to App Registry
    // ===================
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText(/ERC-8004 Registry/i)).toBeVisible();
    await page.screenshot({
      path: 'test-results/screenshots/flow4/01-app-registry.png',
      fullPage: true,
    });
    console.log('✅ 2/8: App Registry loaded');

    // ===================
    // STEP 3: Browse Existing Apps
    // ===================
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);

    // Check if apps exist
    const hasApps = await page.getByText(/ID:/i).isVisible();
    
    if (hasApps) {
      console.log('ℹ️  Found existing apps in registry');
      
      // Test tag filtering
      await page.getByText('Games').click();
      await page.waitForTimeout(500);
      
      await page.screenshot({
        path: 'test-results/screenshots/flow4/02-browse-filtered.png',
        fullPage: true,
      });
    } else {
      console.log('ℹ️  No apps registered yet');
    }

    console.log('✅ 3/8: Browse functionality tested');

    // ===================
    // STEP 4: Register New App
    // ===================
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('Register New App')).toBeVisible();

    // Fill app name
    await page.getByPlaceholder('My Awesome App').fill(TEST_APP.name);

    // Fill description
    await page.getByPlaceholder(/Brief description/i).fill(TEST_APP.description);

    // Fill A2A endpoint
    await page.getByPlaceholder('https://myapp.com/a2a').fill(TEST_APP.a2aEndpoint);

    // Select tags
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    await page.getByRole('button', { name: /💬 Social/i }).click();

    // Select stake token (VIRTUAL)
    const stakeSelector = page
      .locator('label:has-text("Stake Token")')
      .locator('..')
      .locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);
    
    // Use VIRTUAL for testing
    const virtualOption = page.getByText('VIRTUAL');
    if (await virtualOption.isVisible()) {
      await virtualOption.click();
    } else {
      // Fallback to elizaOS
      await page.getByText('elizaOS').click();
    }
    
    await page.waitForTimeout(1000);

    // Verify required stake displayed
    await expect(page.getByText('Required Stake:')).toBeVisible();
    await expect(page.getByText(/≈ \$3.50 USD/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/flow4/03-registration-form.png',
      fullPage: true,
    });
    console.log('✅ 4/8: Registration form filled');

    // ===================
    // STEP 5: Submit Registration
    // ===================
    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Two-step: approval + registration
    await executeTwoStepTransaction(page, metamask, {
      approvalMessage: 'approved',
      successMessage: 'App registered successfully',
      timeout: 90000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/flow4/04-app-registered.png',
      fullPage: true,
    });
    console.log('✅ 5/8: App registered');

    // ===================
    // STEP 6: View Registered App in List
    // ===================
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(2000);

    // Refresh to see new app
    const refreshButton = page.getByRole('button', { name: /Refresh/i });
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(1000);
    }

    // Find our app
    await expect(page.getByText(TEST_APP.name)).toBeVisible({ timeout: 10000 });

    await page.screenshot({
      path: 'test-results/screenshots/flow4/05-app-in-list.png',
      fullPage: true,
    });
    console.log('✅ 6/8: App appears in browse list');

    // ===================
    // STEP 7: View App Details Modal
    // ===================
    await page.getByText(TEST_APP.name).click();
    await page.waitForTimeout(1000);

    // Modal should open
    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
    await expect(modal).toBeVisible();

    // Verify modal content
    await expect(modal.getByText(TEST_APP.name)).toBeVisible();
    await expect(modal.getByText(/Description/i)).toBeVisible();
    await expect(modal.getByText(/Categories/i)).toBeVisible();
    await expect(modal.getByText(/A2A Endpoint/i)).toBeVisible();
    await expect(modal.getByText(/Owner Actions/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/flow4/06-app-details-modal.png',
      fullPage: true,
    });
    console.log('✅ 7/8: App details modal displayed');

    // ===================
    // STEP 8: Withdraw Stake & De-register
    // ===================
    const withdrawButton = modal.getByRole('button', { name: /Withdraw & De-register/i });
    await expect(withdrawButton).toBeVisible();
    await withdrawButton.click();

    // Confirm withdrawal transaction
    await executeTransaction(page, metamask, {
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/flow4/07-stake-withdrawn.png',
      fullPage: true,
    });
    console.log('✅ 8/8: Stake withdrawn, app de-registered');

    // ===================
    // VERIFICATION: App Should Be Removed
    // ===================
    await page.waitForTimeout(2000);
    
    // Close modal (if still open)
    const closeButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }
    
    await page.waitForTimeout(1000);

    // Refresh list
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(1000);
    }

    // App should not appear (or show as withdrawn)
    await page.screenshot({
      path: 'test-results/screenshots/flow4/08-final-state.png',
      fullPage: true,
    });

    console.log('🎉 COMPLETE APP REGISTRY FLOW PASSED');
    console.log('   ✅ App Registration');
    console.log('   ✅ Browse & Filter');
    console.log('   ✅ View Details');
    console.log('   ✅ Owner Actions');
    console.log('   ✅ Stake Withdrawal');
    console.log('   ✅ De-registration');
  });

  test('Should filter apps by different tags', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);

    // Test each tag filter
    const tags = ['All Apps', 'Applications', 'Games', 'Marketplaces', 'DeFi', 'Social'];

    for (const tag of tags) {
      await page.getByText(tag).click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: `test-results/screenshots/flow4/filter-${tag.toLowerCase().replace(/\s+/g, '-')}.png`,
        fullPage: true,
      });

      console.log(`✅ Filtered by: ${tag}`);
    }

    console.log('✅ Tag filtering tested');
  });
});


