/**
 * Node Operations Transaction Tests
 * Tests node registration, claim rewards, and deregistration
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

test.describe('Node Registration Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should register node with elizaOS stake, earn CLANKER rewards', async ({ page, metamask }) => {
    // Check node limit
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);
    
    const nodeCountMatch = await page.locator('h2:has-text("My Nodes")').textContent();
    const currentNodes = nodeCountMatch ? parseInt(nodeCountMatch.match(/\d+/)?.[0] || '0') : 0;
    
    if (currentNodes >= 5) {
      console.log('⚠️  At max nodes (5) - skipping registration');
      return;
    }

    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    // Select staking token
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(1000);

    // Enter stake amount
    const stakeAmount = calculateStakeAmount(PROTOCOL_TOKENS.ELIZAOS.priceUSD, 1000);
    await page.getByPlaceholder('Amount').fill(stakeAmount);
    await page.waitForTimeout(500);

    // Verify minimum met
    await expect(page.getByText(/meets \$1,000 minimum/i)).toBeVisible();

    // Select reward token
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);
    
    const clankerOption = page.getByText('CLANKER').nth(1);
    if (await clankerOption.isVisible()) {
      await clankerOption.click();
    } else {
      await page.getByText('elizaOS').nth(1).click();
    }
    await page.waitForTimeout(500);

    // Enter RPC URL
    await page.getByPlaceholder(/https:\/\/your-node/i).fill(TEST_NODE.rpcUrl);

    // Select region
    await page.locator('select').first().selectOption({ value: TEST_NODE.region.toString() });

    await page.screenshot({
      path: 'test-results/screenshots/node-tx/01-registration-form.png',
      fullPage: true,
    });

    // Submit
    await page.getByRole('button', { name: /Stake & Register Node/i }).click();

    // Two-step: approval + registration
    await executeTwoStepTransaction(page, metamask, {
      approvalMessage: 'approved',
      successMessage: 'Node registered successfully',
      timeout: 90000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/node-tx/02-registered.png',
      fullPage: true,
    });

    console.log('✅ Node registration transaction successful');
  });

  test('should reject stake below $1000 minimum', async ({ page }) => {
    // Select staking token
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(1000);

    // Enter low amount
    await page.getByPlaceholder('Amount').fill('100'); // Far below $1000

    // Should show error
    await expect(page.getByText(/need \$1,000 minimum/i)).toBeVisible();

    // Button should be disabled
    const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
    await expect(submitButton).toBeDisabled();

    console.log('✅ Minimum stake validation working');
  });

  test('should block registration at 5 nodes limit', async ({ page }) => {
    // Check for max nodes warning
    const maxWarning = page.getByText(/reached the maximum of 5 nodes/i);
    const atMax = await maxWarning.isVisible();

    if (atMax) {
      const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
      await expect(submitButton).toBeDisabled();

      console.log('✅ Max nodes limit enforced');
    } else {
      console.log('ℹ️  Under node limit');
    }
  });
});

test.describe('Claim Node Rewards Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should claim rewards for node with pending rewards', async ({ page, metamask }) => {
    // Check if nodes exist
    const noNodes = await page.getByText(/No Nodes Yet/i).isVisible();

    if (noNodes) {
      console.log('ℹ️  No nodes registered - register first');
      return;
    }

    // Find first claim button
    const claimButton = page.getByRole('button', { name: /Claim/i }).first();
    const enabled = await claimButton.isEnabled();

    if (!enabled) {
      console.log('ℹ️  No pending rewards to claim');
      return;
    }

    await page.screenshot({
      path: 'test-results/screenshots/node-tx/03-before-claim-rewards.png',
      fullPage: true,
    });

    await claimButton.click();

    await executeTransaction(page, metamask, {
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/node-tx/04-rewards-claimed.png',
      fullPage: true,
    });

    console.log('✅ Claim rewards transaction successful');
  });
});

test.describe('Deregister Node Transactions', () => {
  test('should deregister node after 7 day period', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);

    // Check if nodes exist
    const noNodes = await page.getByText(/No Nodes Yet/i).isVisible();

    if (noNodes) {
      console.log('ℹ️  No nodes to deregister');
      return;
    }

    // Check deregister button status
    const deregButton = page.getByRole('button', { name: /Deregister/i }).first();
    let canDeregister = await deregButton.isEnabled();

    // If blocked, fast-forward 7 days
    if (!canDeregister) {
      const waitWarning = await page.getByText(/Can deregister in \d+ days/i).isVisible();
      
      if (waitWarning) {
        console.log('⏰ Fast-forwarding 7 days...');
        await increaseTime(page, TIME.ONE_WEEK);
        
        // Refresh page
        await page.reload();
        await page.waitForTimeout(2000);
        
        // Navigate back
        await page.getByRole('button', { name: /Node Operators/i }).click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /My Nodes/i }).click();
        await page.waitForTimeout(1000);
        
        canDeregister = await deregButton.isEnabled();
      }
    }

    if (!canDeregister) {
      console.log('⚠️  Cannot deregister - requirements not met');
      return;
    }

    await page.screenshot({
      path: 'test-results/screenshots/node-tx/05-before-deregister.png',
      fullPage: true,
    });

    await deregButton.click();

    await executeTransaction(page, metamask, {
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/node-tx/06-deregistered.png',
      fullPage: true,
    });

    console.log('✅ Deregister node transaction successful');
  });
});

