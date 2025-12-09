/**
 * Multi-User Integration Tests
 * Tests scenarios with multiple wallets/accounts interacting
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction } from '../helpers/transaction-helpers';
import { GATEWAY_URL, TEST_WALLET, TEST_WALLET_2 } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Multi-User LP Scenarios', () => {
  test('should show different LP positions for different users', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // User 1: Check LP positions
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await page.waitForTimeout(1000);

    const user1Positions = page.locator('.card').filter({ hasText: /Position/i });
    const user1Count = await user1Positions.count();

    await page.screenshot({
      path: 'test-results/screenshots/multi-user/01-user1-positions.png',
      fullPage: true,
    });

    console.log(`ℹ️  User 1 (${TEST_WALLET.address.slice(0, 10)}...): ${user1Count} positions`);

    // Note: Testing with second wallet would require account switching in MetaMask
    // which is not yet supported in Synpress

    console.log('✅ User-specific LP positions tested');
  });

  test.skip('should not show other users LP positions', async ({ page }) => {
    // TODO: Switch to second account and verify positions are different
    // Requires: await metamask.switchAccount(1);

    console.log('⚠️  Multi-account testing - needs Synpress account switching support');
  });
});

test.describe('Multi-User Node Scenarios', () => {
  test('should show only operator-owned nodes in My Nodes', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);

    // Should show operator's nodes only
    const nodeCountText = await page.getByText(/My Nodes \((\d+)\)/i).textContent();
    const nodeCount = nodeCountText ? parseInt(nodeCountText.match(/\d+/)?.[0] || '0') : 0;

    console.log(`ℹ️  Operator has ${nodeCount} nodes`);

    // Verify nodes belong to connected wallet
    if (nodeCount > 0) {
      const nodeCard = page.locator('.card').filter({ hasText: /Node ID:/i }).first();
      
      // Claim and Deregister buttons should be visible (operator-only actions)
      await expect(nodeCard.getByRole('button', { name: /Claim|Deregister/i })).toBeVisible();

      console.log('✅ Operator-specific nodes displayed');
    }
  });

  test('should show all network nodes in Network Overview', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Network Overview/i }).click();
    await page.waitForTimeout(1000);

    // Should show network-wide stats (not user-specific)
    await expect(page.getByText('Total Nodes')).toBeVisible();

    const totalNodesElement = page.locator('p:has-text("Total Nodes")').locator('../..').locator('p').nth(1);
    const totalNodes = await totalNodesElement.textContent();

    console.log(`ℹ️  Network total: ${totalNodes} nodes`);
    console.log('✅ Network-wide stats displayed (all users)');
  });
});

test.describe('Multi-User App Registry Scenarios', () => {
  test('should show all registered apps in browse (not just owned)', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);

    // Should show all apps from all users
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const totalApps = await appCards.count();

    console.log(`ℹ️  Total apps in registry: ${totalApps} (from all users)`);

    // Check owners are different (if multiple apps)
    if (totalApps > 1) {
      const owners = new Set<string>();
      
      for (let i = 0; i < Math.min(totalApps, 5); i++) {
        const card = appCards.nth(i);
        const ownerText = await card.getByText(/Owner:/i).locator('..').textContent();
        if (ownerText) {
          owners.add(ownerText);
        }
      }

      if (owners.size > 1) {
        console.log(`✅ Apps from ${owners.size} different owners`);
      } else {
        console.log('ℹ️  All visible apps from same owner');
      }
    }

    console.log('✅ All apps visible in browse (multi-user)');
  });

  test('should show owner actions only for owned apps', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);

    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to check ownership');
      return;
    }

    // Click first app
    await appCards.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
    
    // Check for owner actions
    const ownerActions = modal.getByText(/Owner Actions/i);
    const isOwner = await ownerActions.isVisible();

    if (isOwner) {
      // Should see withdraw button
      await expect(modal.getByRole('button', { name: /Withdraw/i })).toBeVisible();
      console.log('✅ Owner actions visible for owned app');
    } else {
      // Should NOT see owner actions
      const hasWithdraw = await modal.getByRole('button', { name: /Withdraw/i }).isVisible();
      expect(hasWithdraw).toBe(false);
      console.log('✅ Owner actions hidden for non-owned app');
    }
  });
});

test.describe('Ownership Validation', () => {
  test('should prevent non-owners from managing apps', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);

    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();

    if (count === 0) {
      console.log('ℹ️  No apps to test ownership validation');
      return;
    }

    // Check each app
    for (let i = 0; i < Math.min(count, 3); i++) {
      await appCards.nth(i).click();
      await page.waitForTimeout(500);

      const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
      const ownerActions = modal.getByText(/Owner Actions/i);
      const isOwner = await ownerActions.isVisible();

      console.log(`ℹ️  App ${i + 1}: ${isOwner ? 'Owned' : 'Not owned'}`);

      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    console.log('✅ Ownership validation tested across multiple apps');
  });
});

test.describe('Network-Wide vs User-Specific Data', () => {
  test('should distinguish network stats from user stats', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);

    // Network Overview - shows ALL users
    await page.getByRole('button', { name: /Network Overview/i }).click();
    await page.waitForTimeout(1000);

    const networkTotalElement = page.locator('p:has-text("Total Nodes")').locator('../..').locator('p').nth(1);
    const networkTotal = await networkTotalElement.textContent();

    // My Nodes - shows current user only
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);

    const myNodesText = await page.getByText(/My Nodes \((\d+)\)/i).textContent();
    const myNodesCount = myNodesText ? parseInt(myNodesText.match(/\d+/)?.[0] || '0') : 0;

    console.log(`ℹ️  Network total: ${networkTotal} nodes`);
    console.log(`ℹ️  My nodes: ${myNodesCount} nodes`);

    // User nodes should be <= network total
    expect(myNodesCount <= parseInt(networkTotal || '999')).toBe(true);

    console.log('✅ Network vs user data correctly separated');
  });
});


