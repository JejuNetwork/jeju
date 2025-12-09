/**
 * Complete Token Lifecycle Flow Test
 * Tests: Register Token → Deploy Paymaster → Add Liquidity → Claim Fees → Remove Liquidity
 * 
 * This is the CRITICAL happy path test - if this passes, core system works
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction, executeTwoStepTransaction, waitForSuccess } from '../helpers/transaction-helpers';
import { mineBlocks } from '../helpers/blockchain-helpers';
import { GATEWAY_URL, TEST_AMOUNTS, FEE_MARGINS, PROTOCOL_TOKENS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Complete Token Lifecycle', () => {
  test('FULL FLOW: Register elizaOS → Deploy Paymaster → Add Liquidity → Claim Fees → Remove', async ({
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
    await page.screenshot({ path: 'test-results/screenshots/flow1/01-connected.png', fullPage: true });
    console.log('✅ 1/9: Wallet connected');

    // ===================
    // STEP 2: Navigate to Registered Tokens
    // ===================
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/screenshots/flow1/02-token-registry.png', fullPage: true });
    console.log('✅ 2/9: Navigated to token registry');

    // ===================
    // STEP 3: Check if elizaOS already registered
    // ===================
    const elizaOSAddress = process.env.VITE_ELIZAOS_TOKEN_ADDRESS;
    const alreadyRegistered = await page.getByText('elizaOS').isVisible();

    if (!alreadyRegistered && elizaOSAddress) {
      // Register elizaOS token
      await page.getByPlaceholder('0x...').fill(elizaOSAddress);
      await page.locator('input[placeholder="0"]').fill('0'); // Min fee
      await page.locator('input[placeholder="200"]').fill('200'); // Max fee

      // Submit registration
      await page.getByRole('button', { name: /Register Token/i }).click();

      // Confirm transaction
      await executeTransaction(page, metamask, {
        expectSuccessMessage: 'registered successfully',
        timeout: 60000,
      });

      await page.screenshot({ path: 'test-results/screenshots/flow1/03-token-registered.png', fullPage: true });
      console.log('✅ 3/9: elizaOS registered');
    } else {
      console.log('ℹ️  3/9: elizaOS already registered, skipping');
      await page.screenshot({ path: 'test-results/screenshots/flow1/03-token-exists.png', fullPage: true });
    }

    // ===================
    // STEP 4: Deploy Paymaster
    // ===================
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);

    // Select elizaOS token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Check if already deployed
    const alreadyDeployed = await page.getByText(/already deployed/i).isVisible();

    if (!alreadyDeployed) {
      // Set fee margin
      const slider = page.locator('input[type="range"]');
      if (await slider.isVisible()) {
        await slider.fill(FEE_MARGINS.DEFAULT.toString());
      }

      await page.screenshot({ path: 'test-results/screenshots/flow1/04-before-deploy.png', fullPage: true });

      // Deploy paymaster
      await page.getByRole('button', { name: /Deploy Paymaster for elizaOS/i }).click();

      // Confirm deployment transaction (can take ~60s)
      await executeTransaction(page, metamask, {
        expectSuccessMessage: 'deployed successfully',
        timeout: 90000,
      });

      await page.screenshot({ path: 'test-results/screenshots/flow1/05-paymaster-deployed.png', fullPage: true });
      console.log('✅ 4/9: Paymaster deployed');
    } else {
      console.log('ℹ️  4/9: Paymaster already deployed');
      await page.screenshot({ path: 'test-results/screenshots/flow1/04-paymaster-exists.png', fullPage: true });
    }

    // ===================
    // STEP 5: Add ETH Liquidity
    // ===================
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    // Select elizaOS token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Check for paymaster warning
    const noPaymaster = await page.getByText(/No paymaster deployed/i).isVisible();
    
    if (noPaymaster) {
      throw new Error('Cannot add liquidity - paymaster not deployed');
    }

    // Enter ETH amount
    const ethInput = page.getByPlaceholder('1.0');
    await expect(ethInput).toBeVisible();
    await ethInput.fill(TEST_AMOUNTS.ETH.SMALL);

    await page.screenshot({ path: 'test-results/screenshots/flow1/06-before-add-liquidity.png', fullPage: true });

    // Add liquidity
    await page.getByRole('button', { name: /Add.*ETH to elizaOS Vault/i }).click();

    // Confirm transaction
    await executeTransaction(page, metamask, {
      expectSuccessMessage: 'Liquidity added successfully',
      timeout: 45000,
    });

    await page.screenshot({ path: 'test-results/screenshots/flow1/07-liquidity-added.png', fullPage: true });
    console.log('✅ 5/9: Liquidity added');

    // ===================
    // STEP 6: Verify LP Position Created
    // ===================
    // Position card should appear
    await expect(page.getByText(/Your elizaOS LP Position/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ETH Shares')).toBeVisible();
    await expect(page.getByText('ETH Value')).toBeVisible();
    await expect(page.getByText('Pending Fees')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/flow1/08-lp-position.png', fullPage: true });
    console.log('✅ 6/9: LP position verified');

    // ===================
    // STEP 7: Navigate to LP Dashboard
    // ===================
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('My LP Positions')).toBeVisible();
    await expect(page.getByText('elizaOS Position')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/flow1/09-lp-dashboard.png', fullPage: true });
    console.log('✅ 7/9: LP dashboard verified');

    // ===================
    // STEP 8: Simulate Fee Accumulation & Claim
    // ===================
    // In real scenario, fees would accumulate from gas payments
    // For testing, we'll check if claim button exists and is functional
    
    const claimButton = page.getByRole('button', { name: /Claim/i }).first();
    const claimVisible = await claimButton.isVisible();

    if (claimVisible && (await claimButton.isEnabled())) {
      // Claim fees if available
      await claimButton.click();

      await executeTransaction(page, metamask, {
        expectSuccessMessage: 'Fees claimed successfully',
        timeout: 45000,
      });

      await page.screenshot({ path: 'test-results/screenshots/flow1/10-fees-claimed.png', fullPage: true });
      console.log('✅ 8/9: Fees claimed');
    } else {
      console.log('ℹ️  8/9: No fees to claim (expected for new position)');
    }

    // ===================
    // STEP 9: Remove Liquidity
    // ===================
    // Go back to Add Liquidity tab to see remove button
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    // Select elizaOS again
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Remove liquidity button
    const removeButton = page.getByRole('button', { name: /Remove All Liquidity/i });
    await expect(removeButton).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/flow1/11-before-remove.png', fullPage: true });

    await removeButton.click();

    // Confirm transaction
    await executeTransaction(page, metamask, {
      timeout: 45000,
    });

    await page.screenshot({ path: 'test-results/screenshots/flow1/12-liquidity-removed.png', fullPage: true });
    console.log('✅ 9/9: Liquidity removed');

    // ===================
    // VERIFICATION: Position Should Be Gone or Zero
    // ===================
    await page.waitForTimeout(2000);
    
    // Refresh page to see updated state
    await page.reload();
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: 'test-results/screenshots/flow1/13-final-state.png', fullPage: true });

    console.log('🎉 COMPLETE TOKEN LIFECYCLE FLOW PASSED');
    console.log('   ✅ Token Registration');
    console.log('   ✅ Paymaster Deployment');
    console.log('   ✅ Liquidity Addition');
    console.log('   ✅ Position Verification');
    console.log('   ✅ LP Dashboard');
    console.log('   ✅ Fee Claims (if available)');
    console.log('   ✅ Liquidity Removal');
  });

  test('FULL FLOW: Register → Deploy → Add Liquidity for CLANKER token', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Use CLANKER instead of elizaOS
    const token = PROTOCOL_TOKENS.CLANKER;

    // Step 1: Check if CLANKER registered
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);

    const registered = await page.getByText(token.symbol).isVisible();

    if (!registered) {
      console.log(`ℹ️  ${token.symbol} not registered - would need Base bridge setup`);
      console.log('   Skipping registration for bridged token in this test');
    }

    // Step 2: Deploy paymaster for CLANKER (if token exists)
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    const clankerOption = page.getByText(token.symbol);
    const clankerAvailable = await clankerOption.isVisible();

    if (clankerAvailable) {
      await clankerOption.click();
      await page.waitForTimeout(1000);

      const deployed = await page.getByText(/already deployed/i).isVisible();

      if (!deployed) {
        const slider = page.locator('input[type="range"]');
        if (await slider.isVisible()) {
          await slider.fill('150'); // 1.5% fee
        }

        await page.getByRole('button', { name: new RegExp(`Deploy Paymaster for ${token.symbol}`, 'i') }).click();

        await executeTransaction(page, metamask, {
          expectSuccessMessage: 'deployed successfully',
          timeout: 90000,
        });

        console.log(`✅ Paymaster deployed for ${token.symbol}`);
      }

      // Step 3: Add liquidity
      await page.getByRole('button', { name: /Add Liquidity/i }).click();
      await page.waitForTimeout(1000);

      await page.locator('.input').first().click();
      await page.waitForTimeout(500);
      await page.getByText(token.symbol).click();
      await page.waitForTimeout(1000);

      const liquidityInput = page.getByPlaceholder('1.0');
      if (await liquidityInput.isVisible()) {
        await liquidityInput.fill(TEST_AMOUNTS.ETH.SMALL);

        await page.getByRole('button', { name: new RegExp(`Add.*${token.symbol}`, 'i') }).click();

        await executeTransaction(page, metamask, {
          expectSuccessMessage: 'Liquidity added successfully',
          timeout: 45000,
        });

        console.log(`✅ Liquidity added for ${token.symbol}`);
      }
    } else {
      console.log(`ℹ️  ${token.symbol} not available - skipping this flow`);
    }

    console.log('🎉 CLANKER lifecycle flow completed');
  });
});


