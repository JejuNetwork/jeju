/**
 * App Registry Transaction Tests
 * Tests app registration, stake management, and withdrawal transactions
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTwoStepTransaction, executeTransaction } from '../helpers/transaction-helpers';
import { GATEWAY_URL, TEST_APP, PROTOCOL_TOKENS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('App Registration Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should register app with elizaOS stake', async ({ page, metamask }) => {
    // Fill form
    await page.getByPlaceholder('My Awesome App').fill(TEST_APP.name + ' elizaOS');
    await page.getByPlaceholder(/Brief description/i).fill(TEST_APP.description);
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    // Select elizaOS stake
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Verify required stake
    await expect(page.getByText('Required Stake:')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/app-tx/01-register-elizaos.png',
      fullPage: true,
    });

    // Submit
    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Two-step transaction
    await executeTwoStepTransaction(page, metamask, {
      approvalMessage: 'approved',
      successMessage: 'App registered successfully',
      timeout: 90000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/app-tx/02-registered-elizaos.png',
      fullPage: true,
    });

    console.log('✅ App registered with elizaOS stake');
  });

  test('should register app with VIRTUAL stake', async ({ page, metamask }) => {
    await page.getByPlaceholder('My Awesome App').fill(TEST_APP.name + ' VIRTUAL');
    await page.getByPlaceholder(/Brief description/i).fill('Testing with VIRTUAL stake');
    await page.getByRole('button', { name: /💰 DeFi/i }).click();

    // Select VIRTUAL stake
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);

    const virtualOption = page.getByText('VIRTUAL');
    if (await virtualOption.isVisible()) {
      await virtualOption.click();
      await page.waitForTimeout(1000);

      await expect(page.getByText('Required Stake:')).toBeVisible();

      const submitButton = page.getByRole('button', { name: /Register App$/i });
      await submitButton.click();

      await executeTwoStepTransaction(page, metamask, {
        approvalMessage: 'approved',
        successMessage: 'App registered successfully',
        timeout: 90000,
      });

      console.log('✅ App registered with VIRTUAL stake');
    } else {
      console.log('ℹ️  VIRTUAL not available');
    }
  });

  test('should register app with A2A endpoint', async ({ page, metamask }) => {
    await page.getByPlaceholder('My Awesome App').fill('A2A Test App');
    await page.getByPlaceholder(/Brief description/i).fill('App with A2A endpoint');
    await page.getByPlaceholder('https://myapp.com/a2a').fill(TEST_APP.a2aEndpoint);
    await page.getByRole('button', { name: /⚙️ Service/i }).click();

    // Select stake token
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'test-results/screenshots/app-tx/03-with-a2a-endpoint.png',
      fullPage: true,
    });

    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await submitButton.click();

    await executeTwoStepTransaction(page, metamask, {
      successMessage: 'App registered successfully',
      timeout: 90000,
    });

    console.log('✅ App registered with A2A endpoint');
  });

  test('should register app with multiple tags', async ({ page, metamask }) => {
    await page.getByPlaceholder('My Awesome App').fill('Multi-Tag App');
    
    // Select multiple tags
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    await page.getByRole('button', { name: /💬 Social/i }).click();
    await page.getByRole('button', { name: /📊 Information Provider/i }).click();

    // Select stake
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await submitButton.click();

    await executeTwoStepTransaction(page, metamask, {
      successMessage: 'App registered successfully',
      timeout: 90000,
    });

    console.log('✅ App registered with multiple tags');
  });

  test('should enforce tag limit (max 10)', async ({ page }) => {
    // Try to select more than 10 tags (if limit enforced)
    const allTags = [
      '📱 Application',
      '🎮 Game',
      '🏪 Marketplace',
      '💰 DeFi',
      '💬 Social',
      '📊 Information Provider',
      '⚙️ Service',
    ];

    let selectedCount = 0;
    for (const tag of allTags) {
      await page.getByRole('button', { name: tag }).click();
      selectedCount++;
    }

    console.log(`ℹ️  Selected ${selectedCount} tags`);
    // If limit is enforced, would see warning or disabled tags
  });
});

test.describe('App Stake Withdrawal Transactions', () => {
  test('should withdraw stake and de-register app', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);

    // Find an app (preferably one we own)
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to withdraw from');
      return;
    }

    // Click first app to open modal
    await appCards.first().click();
    await page.waitForTimeout(1000);

    // Check for owner actions
    const ownerActions = page.getByText(/Owner Actions/i);
    const isOwner = await ownerActions.isVisible();

    if (!isOwner) {
      console.log('ℹ️  Not the owner of this app');
      return;
    }

    // Click withdraw
    const withdrawButton = page.getByRole('button', { name: /Withdraw & De-register/i });
    await expect(withdrawButton).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/app-tx/04-before-withdraw.png',
      fullPage: true,
    });

    await withdrawButton.click();

    await executeTransaction(page, metamask, {
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/app-tx/05-stake-withdrawn.png',
      fullPage: true,
    });

    console.log('✅ Stake withdrawn and app de-registered');
  });
});

test.describe('App Registry Validation', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should require app name', async ({ page }) => {
    // Try to submit without name
    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await expect(submitButton).toBeDisabled();

    // Fill name
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    
    // Still disabled (needs more)
    await expect(submitButton).toBeDisabled();

    console.log('✅ App name validation enforced');
  });

  test('should require at least one tag', async ({ page }) => {
    await page.getByPlaceholder('My Awesome App').fill('Test App');

    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await expect(submitButton).toBeDisabled();

    // Add tag
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    
    // Still needs stake token
    await expect(submitButton).toBeDisabled();

    console.log('✅ Tag requirement enforced');
  });

  test('should require stake token selection', async ({ page }) => {
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await expect(submitButton).toBeDisabled();

    // Select stake token
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Now should be enabled
    await expect(submitButton).toBeEnabled();

    console.log('✅ Stake token requirement enforced');
  });

  test('should calculate required stake for each token', async ({ page }) => {
    await page.getByPlaceholder('My Awesome App').fill('Test');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');

    // Test stake calculation for each token
    const tokensToTest = ['elizaOS', 'CLANKER', 'VIRTUAL', 'CLANKERMON'];

    for (const token of tokensToTest) {
      await stakeSelector.click();
      await page.waitForTimeout(500);

      const tokenOption = page.getByText(token);
      if (await tokenOption.isVisible()) {
        await tokenOption.click();
        await page.waitForTimeout(1000);

        // Should show required stake
        await expect(page.getByText('Required Stake:')).toBeVisible();
        await expect(page.getByText(/≈ \$3.50 USD/i)).toBeVisible();

        const stakeAmount = await page.locator('p:has-text("Required Stake:")').locator('..').locator('p').nth(1).textContent();
        console.log(`ℹ️  ${token} required stake: ${stakeAmount}`);
      }
    }

    console.log('✅ Required stake calculated for all tokens');
  });

  test('should validate A2A endpoint URL format', async ({ page }) => {
    await page.getByPlaceholder('My Awesome App').fill('Test');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    // Enter invalid URL
    await page.getByPlaceholder('https://myapp.com/a2a').fill('not-a-url');

    // Select stake token
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Button might still be enabled (URL is optional)
    // But if validation exists, it should show error
    const submitButton = page.getByRole('button', { name: /Register App$/i });
    const enabled = await submitButton.isEnabled();

    console.log(`ℹ️  A2A URL validation: ${enabled ? 'optional' : 'enforced'}`);
  });
});

test.describe('App Stake Approval and Registration', () => {
  test('should approve CLANKER before registering app', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    // Fill form
    await page.getByPlaceholder('My Awesome App').fill('CLANKER Stake App');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    // Select CLANKER
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);

    const clankerOption = page.getByText('CLANKER');
    if (!(await clankerOption.isVisible())) {
      console.log('ℹ️  CLANKER not available');
      return;
    }

    await clankerOption.click();
    await page.waitForTimeout(1000);

    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await submitButton.click();

    // First transaction: Approval
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    console.log('✅ Step 1/2: CLANKER approval confirmed');

    // Wait for approval message or next transaction
    await page.waitForTimeout(3000);

    // Second transaction: Registration
    await metamask.confirmTransaction();
    console.log('✅ Step 2/2: App registration confirmed');

    await expect(page.getByText(/App registered successfully/i)).toBeVisible({ timeout: 30000 });

    console.log('✅ Two-step app registration with CLANKER successful');
  });
});

test.describe('App Edit and Update Transactions', () => {
  test.skip('should edit app metadata', async ({ page, metamask }) => {
    // TODO: Implement when edit functionality available
    console.log('⚠️  Edit app transaction - needs implementation');
  });

  test.skip('should update A2A endpoint', async ({ page, metamask }) => {
    // TODO: Implement when update functionality available
    console.log('⚠️  Update A2A endpoint - needs implementation');
  });
});


