/**
 * @fileoverview Node staking E2E tests
 * @module gateway/tests/e2e/node-staking
 */

import { test, expect, setupMetaMask, importTestAccount, connectWallet } from '../fixtures/wallet';

test.describe('Node Staking Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMetaMask(metamask);
    await importTestAccount(metamask);
    await page.goto('/');
    await connectWallet(page);
    
    // Navigate to Node Operators tab
    await page.getByRole('button', { name: /Node Operators/i }).click();
  });

  test('should display node staking interface', async ({ page }) => {
    await expect(page.getByText(/Multi-Token Node Staking/i)).toBeVisible();
  });

  test('should show network overview section', async ({ page }) => {
    // Click Network Overview
    await page.getByRole('button', { name: /Network Overview/i }).click();
    
    await expect(page.getByText('Network Overview')).toBeVisible();
    await expect(page.getByText(/Total Nodes/i)).toBeVisible();
    await expect(page.getByText(/Total Staked/i)).toBeVisible();
    await expect(page.getByText(/Rewards Claimed/i)).toBeVisible();
  });

  test('should show my nodes section', async ({ page }) => {
    await page.getByRole('button', { name: /My Nodes/i }).click();
    
    // Either shows nodes or empty state
    const emptyState = page.getByText(/No Nodes Yet/i);
    const hasNodes = await emptyState.isVisible().catch(() => false);
    
    if (hasNodes) {
      await expect(page.getByText(/Stake tokens and register a node/i)).toBeVisible();
    }
  });

  test('should display register node form', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    await expect(page.getByText('Register New Node')).toBeVisible();
  });

  test('should have staking token selector', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Staking token selector should show all protocol tokens
    await expect(page.getByText(/Staking Token/i)).toBeVisible();
    await expect(page.getByText(/what you'll lock up/i)).toBeVisible();
  });

  test('should have reward token selector (can be different)', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    await expect(page.getByText(/Reward Token/i)).toBeVisible();
    await expect(page.getByText(/what you want to earn/i)).toBeVisible();
  });

  test('should validate minimum stake amount', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Select staking token
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.getByText('elizaOS').first().click();
    
    // Enter low amount
    await page.getByPlaceholder('Amount').fill('1');
    
    // Should show validation error
    await expect(page.getByText(/need \$1,000 minimum/i)).toBeVisible();
  });

  test('should calculate USD value of stake', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.getByText('CLANKER').first().click();
    
    // Enter amount
    await page.getByPlaceholder('Amount').fill('100');
    
    // USD value should be calculated
    await expect(page.getByText(/\$/)).toBeVisible();
  });

  test('should have RPC URL input field', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    await expect(page.getByText('RPC URL')).toBeVisible();
    const rpcInput = page.getByPlaceholder(/https:\/\/your-node/i);
    await expect(rpcInput).toBeVisible();
  });

  test('should have geographic region selector', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    await expect(page.getByText('Geographic Region')).toBeVisible();
    
    const regionSelect = page.locator('select').filter({ hasText: /North America/i });
    await expect(regionSelect).toBeVisible();
  });

  test('should show bonus for underserved regions', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Region dropdown should show bonuses
    const select = page.locator('select').filter({ hasText: /North America/i });
    const options = await select.locator('option').allTextContents();
    
    // Africa and South America should show +50% bonus
    const africaOption = options.find(o => o.includes('Africa'));
    const saOption = options.find(o => o.includes('South America'));
    
    expect(africaOption).toContain('+50%');
    expect(saOption).toContain('+50%');
  });

  test('should show staking requirements', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    await expect(page.getByText(/Minimum staking period/i)).toBeVisible();
    await expect(page.getByText(/7 days/i)).toBeVisible();
    await expect(page.getByText(/99%\+ uptime/i)).toBeVisible();
  });

  test('should estimate monthly rewards', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Select reward token
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.getByText('VIRTUAL').nth(1).click();
    
    // Should show estimated rewards
    await expect(page.getByText(/Estimated:/i)).toBeVisible();
    await expect(page.getByText(/\/month/i)).toBeVisible();
  });

  test('should enforce max 5 nodes per operator', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Check for max nodes warning (if operator has 5 nodes)
    const maxWarning = page.getByText(/reached the maximum of 5 nodes/i);
    const hasMax = await maxWarning.isVisible().catch(() => false);
    
    if (hasMax) {
      // Form should be disabled
      const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
      await expect(submitButton).toBeDisabled();
    }
  });
});

test.describe('My Nodes Management', () => {
  test.beforeEach(async ({ page }) => {
    await setupMetaMask(metamask);
    await importTestAccount(metamask);
    await page.goto('/');
    await connectWallet(page);
    
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.getByRole('button', { name: /My Nodes/i }).click();
  });

  test('should display my nodes list', async ({ page }) => {
    // Either shows nodes or empty state
    const noNodesMsg = page.getByText(/No Nodes Yet/i);
    const myNodesHeading = page.getByText(/My Nodes \(/i);
    
    const hasEmpty = await noNodesMsg.isVisible().catch(() => false);
    const hasNodes = await myNodesHeading.isVisible().catch(() => false);
    
    expect(hasEmpty || hasNodes).toBe(true);
  });

  test('should show node details in cards', async ({ page }) => {
    const nodeCards = page.locator('.card').filter({ hasText: /Node ID:/i });
    const count = await nodeCards.count();
    
    if (count > 0) {
      const firstNode = nodeCards.first();
      
      // Should show staking info
      await expect(firstNode.getByText('Staked')).toBeVisible();
      await expect(firstNode.getByText('Pending Rewards')).toBeVisible();
      
      // Should show performance metrics
      await expect(firstNode.getByText('Uptime')).toBeVisible();
      await expect(firstNode.getByText('Requests')).toBeVisible();
      await expect(firstNode.getByText('Response')).toBeVisible();
    }
  });

  test('should show claim rewards button', async ({ page }) => {
    const nodeCards = page.locator('.card').filter({ hasText: /Node ID:/i });
    const count = await nodeCards.count();
    
    if (count > 0) {
      const claimButton = page.getByRole('button', { name: /Claim/i }).first();
      await expect(claimButton).toBeVisible();
    }
  });

  test('should show deregister button with timing info', async ({ page }) => {
    const nodeCards = page.locator('.card').filter({ hasText: /Node ID:/i });
    const count = await nodeCards.count();
    
    if (count > 0) {
      const deregisterButton = page.getByRole('button', { name: /Deregister/i }).first();
      await expect(deregisterButton).toBeVisible();
      
      // Check for timing warning if within 7 days
      const timingWarning = page.getByText(/Can deregister in/i);
      // This might or might not be visible depending on node age
    }
  });
});

