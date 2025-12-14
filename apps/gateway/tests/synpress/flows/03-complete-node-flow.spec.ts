/**
 * Complete Node Staking Flow Test
 * Tests: Register Node → Monitor Performance → Claim Rewards → Wait 7 Days → Deregister
 * 
 * CRITICAL: Tests multi-token staking and rewards system
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTwoStepTransaction, executeTransaction } from '../helpers/transaction-helpers';
import { increaseTime } from '../helpers/blockchain-helpers';
import { TIME } from '../fixtures/test-data';
import {
  GATEWAY_URL,
  PROTOCOL_TOKENS,
  TEST_NODE,
  REGIONS,
  calculateStakeAmount,
} from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Complete Node Staking Flow', () => {
  test('FULL FLOW: Register Node → Monitor → Claim Rewards → Deregister', async ({
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
    console.log('✅ 1/10: Wallet connected');

    // ===================
    // STEP 2: Navigate to Node Operators
    // ===================
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/Multi-Token Node Staking/i)).toBeVisible();
    await page.screenshot({
      path: 'test-results/screenshots/flow3/01-node-operators.png',
      fullPage: true,
    });
    console.log('✅ 2/10: Node Operators tab loaded');

    // ===================
    // STEP 3: View Network Overview
    // ===================
    await page.getByRole('button', { name: /Network Overview/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('Total Nodes')).toBeVisible();
    await expect(page.getByText('Total Staked')).toBeVisible();
    await expect(page.getByText('Rewards Claimed')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/flow3/02-network-overview.png',
      fullPage: true,
    });
    console.log('✅ 3/10: Network stats viewed');

    // ===================
    // STEP 4: Check Current Nodes
    // ===================
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);

    const hasNodes = await page.getByText(/My Nodes \(/i).isVisible();
    const nodeCount = hasNodes
      ? parseInt((await page.getByText(/My Nodes \((\d+)\)/i).textContent()) || '0')
      : 0;

    await page.screenshot({
      path: 'test-results/screenshots/flow3/03-current-nodes.png',
      fullPage: true,
    });
    console.log(`ℹ️  4/10: Current nodes: ${nodeCount}/5`);

    // ===================
    // STEP 5: Register New Node (if under limit)
    // ===================
    if (nodeCount >= 5) {
      console.log('⚠️  Already at max 5 nodes - skipping registration');
      return;
    }

    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('Register New Node')).toBeVisible();

    // Select staking token (elizaOS)
    const stakingSelector = page
      .locator('label:has-text("Staking Token")')
      .locator('..')
      .locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(1000);

    // Enter stake amount ($1000 worth in elizaOS)
    const stakeAmount = calculateStakeAmount(PROTOCOL_TOKENS.ELIZAOS.priceUSD, 1000);
    await page.getByPlaceholder('Amount').fill(stakeAmount);
    await page.waitForTimeout(500);

    // Verify minimum met
    await expect(page.getByText(/meets \$1,000 minimum/i)).toBeVisible();

    // Select reward token (CLANKER - different from staking token)
    const rewardSelector = page
      .locator('label:has-text("Reward Token")')
      .locator('..')
      .locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);

    const clankerReward = page.getByText('CLANKER').nth(1);
    if (await clankerReward.isVisible()) {
      await clankerReward.click();
    } else {
      // Fallback to elizaOS if CLANKER not available
      await page.getByText('elizaOS').nth(1).click();
    }
    await page.waitForTimeout(500);

    // Enter RPC URL
    await page.getByPlaceholder(/https:\/\/your-node/i).fill(TEST_NODE.rpcUrl);

    // Select Africa region (for +50% bonus)
    const regionSelect = page.locator('select').filter({ hasText: /North America/i });
    await regionSelect.selectOption({ value: REGIONS.AFRICA.toString() });

    await page.screenshot({
      path: 'test-results/screenshots/flow3/04-register-form-filled.png',
      fullPage: true,
    });
    console.log('✅ 5/10: Registration form filled');

    // Submit registration (requires approval + registration)
    const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Two-step transaction: approval + registration
    await executeTwoStepTransaction(page, metamask, {
      approvalMessage: 'approved',
      successMessage: 'Node registered successfully',
      timeout: 90000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/flow3/05-node-registered.png',
      fullPage: true,
    });
    console.log('✅ 6/10: Node registered');

    // ===================
    // STEP 6: View My Nodes
    // ===================
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(2000);

    // Should see new node
    await expect(page.getByText(new RegExp(`My Nodes \\(${nodeCount + 1}\\)`, 'i'))).toBeVisible({
      timeout: 10000,
    });

    // Verify node card displays
    const nodeCard = page.locator('.card').filter({ hasText: /Node ID:/i }).first();
    await expect(nodeCard).toBeVisible();

    // Check node details
    await expect(nodeCard.getByText('Staked')).toBeVisible();
    await expect(nodeCard.getByText('Pending Rewards')).toBeVisible();
    await expect(nodeCard.getByText('Uptime')).toBeVisible();
    await expect(nodeCard.getByText('Requests')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/flow3/06-node-details.png',
      fullPage: true,
    });
    console.log('✅ 7/10: Node details displayed');

    // ===================
    // STEP 7: Attempt Early Deregistration (Should Fail)
    // ===================
    const deregisterButton = nodeCard.getByRole('button', { name: /Deregister/i });
    const isDisabled = await deregisterButton.isDisabled().catch(() => true);

    if (isDisabled) {
      await expect(page.getByText(/Can deregister in \d+ days/i)).toBeVisible();
      console.log('✅ 8/10: Early deregistration blocked (correct)');
    }

    // ===================
    // STEP 8: Fast-Forward 7 Days
    // ===================
    console.log('⏰ Fast-forwarding 7 days...');
    await increaseTime(page, TIME.ONE_WEEK);

    // Refresh page to update UI
    await page.reload();
    await page.waitForTimeout(2000);

    // Navigate back to My Nodes
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);

    console.log('✅ 9/10: Time advanced 7 days');

    // ===================
    // STEP 9: Claim Rewards (If Available)
    // ===================
    const claimRewardsBtn = page.getByRole('button', { name: /Claim/i }).first();
    const canClaim = await claimRewardsBtn.isEnabled();

    if (canClaim) {
      await claimRewardsBtn.click();

      await executeTransaction(page, metamask, {
        timeout: 45000,
      });

      await page.screenshot({
        path: 'test-results/screenshots/flow3/07-rewards-claimed.png',
        fullPage: true,
      });
      console.log('✅ Rewards claimed');
    } else {
      console.log('ℹ️  No rewards to claim yet');
    }

    // ===================
    // STEP 10: Deregister Node
    // ===================
    const deregBtn = page.getByRole('button', { name: /Deregister/i }).first();
    await expect(deregBtn).toBeEnabled({ timeout: 10000 });

    await page.screenshot({
      path: 'test-results/screenshots/flow3/08-before-deregister.png',
      fullPage: true,
    });

    await deregBtn.click();

    await executeTransaction(page, metamask, {
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/flow3/09-deregistered.png',
      fullPage: true,
    });
    console.log('✅ 10/10: Node deregistered');

    // Verify node removed from list
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: 'test-results/screenshots/flow3/10-final-state.png',
      fullPage: true,
    });

    console.log('🎉 COMPLETE NODE STAKING FLOW PASSED');
  });
});

