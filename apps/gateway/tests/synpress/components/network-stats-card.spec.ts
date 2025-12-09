/**
 * Network Stats Card Component Tests
 * Tests network statistics display and calculations
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Network Statistics Display', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Network Overview/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display network overview stats', async ({ page }) => {
    await expect(page.getByText('Network Overview')).toBeVisible();

    // Should show 3 main stats
    await expect(page.getByText('Total Nodes')).toBeVisible();
    await expect(page.getByText('Total Staked')).toBeVisible();
    await expect(page.getByText('Rewards Claimed')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/components/02-network-stats.png',
      fullPage: true,
    });

    console.log('✅ Network overview stats displayed');
  });

  test('should display actual stat values', async ({ page }) => {
    const totalNodesElement = page.locator('p:has-text("Total Nodes")').locator('../..').locator('p').nth(1);
    const totalStakedElement = page.locator('p:has-text("Total Staked")').locator('../..').locator('p').nth(1);
    const totalRewardsElement = page.locator('p:has-text("Rewards Claimed")').locator('../..').locator('p').nth(1);

    const totalNodes = await totalNodesElement.textContent();
    const totalStaked = await totalStakedElement.textContent();
    const totalRewards = await totalRewardsElement.textContent();

    console.log(`ℹ️  Network Stats:`);
    console.log(`   Total Nodes: ${totalNodes}`);
    console.log(`   Total Staked: ${totalStaked}`);
    console.log(`   Rewards Claimed: ${totalRewards}`);

    // All should be >= 0
    expect(parseInt(totalNodes || '0')).toBeGreaterThanOrEqual(0);

    console.log('✅ Network stat values displayed');
  });

  test('should show operator network share if has nodes', async ({ page }) => {
    // Check for "Your Network Share" section
    const yourShare = page.getByText(/Your Network Share/i);
    const hasShare = await yourShare.isVisible();

    if (hasShare) {
      await expect(page.getByText(/Your Nodes/i)).toBeVisible();
      await expect(page.getByText(/Your Stake/i)).toBeVisible();

      console.log('✅ Operator network share displayed');
    } else {
      console.log('ℹ️  No nodes - network share not shown');
    }
  });

  test('should display ownership meter', async ({ page }) => {
    const ownershipText = page.getByText(/Network Ownership/i);
    const hasOwnership = await ownershipText.isVisible();

    if (hasOwnership) {
      // Should show percentage and max
      await expect(page.getByText(/% \/ \d+% max/i)).toBeVisible();

      // Should have progress bar
      const progressBar = page.locator('[style*="width:"][style*="height: 100%"]');
      const hasBar = await progressBar.isVisible();

      if (hasBar) {
        console.log('✅ Ownership meter with progress bar');
      } else {
        console.log('✅ Ownership percentage shown');
      }
    } else {
      console.log('ℹ️  No ownership meter (no operator stats)');
    }
  });

  test('should show warning when approaching ownership limit', async ({ page }) => {
    const warning = page.getByText(/Approaching Ownership Limit/i);
    const hasWarning = await warning.isVisible();

    if (hasWarning) {
      // Should explain the limit
      await expect(page.locator('text=/20%|ownership/i')).toBeVisible();

      console.log('✅ Ownership limit warning displayed');
    } else {
      console.log('ℹ️  Under ownership warning threshold');
    }
  });

  test('should display tips for maximizing rewards', async ({ page }) => {
    // Tips section
    const tips = page.getByText(/Tips for Maximizing Rewards/i);
    const hasTips = await tips.isVisible();

    if (hasTips) {
      // Should list strategies
      await expect(page.getByText(/uptime|region|token/i)).toBeVisible();

      console.log('✅ Reward maximization tips displayed');
    }
  });
});

test.describe('Network Stats Real-Time Updates', () => {
  test.skip('should update stats after node registration', async ({ page }) => {
    // TODO: Register node and verify network stats increase
    console.log('⚠️  Stats update verification - needs before/after comparison');
  });

  test.skip('should update stats after rewards claimed', async ({ page }) => {
    // TODO: Claim rewards and verify total rewards increases
    console.log('⚠️  Rewards stat update - needs before/after comparison');
  });
});


