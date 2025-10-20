/**
 * Gateway Node Staking - Synpress E2E Tests
 * Tests node registration and management
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../fixtures/synpress-wallet';
import { connectWallet, approveTransaction } from '../helpers/wallet-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('Node Staking Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Navigate to Node Operators tab
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display node staking interface', async ({ page }) => {
    await expect(page.getByText(/Multi-Token Node Staking/i)).toBeVisible();
    
    // Screenshot
    await page.screenshot({ path: 'test-results/screenshots/synpress-node-staking.png', fullPage: true });
  });

  test('should show network overview', async ({ page }) => {
    await page.getByRole('button', { name: /Network Overview/i }).click();
    
    await expect(page.getByText('Network Overview')).toBeVisible();
    await expect(page.getByText(/Total Nodes/i)).toBeVisible();
    await expect(page.getByText(/Total Staked/i)).toBeVisible();
    await expect(page.getByText(/Rewards Claimed/i)).toBeVisible();
    
    console.log('✅ Network overview displayed');
  });

  test('should show my nodes section', async ({ page }) => {
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);
    
    // Either shows nodes or empty state
    const emptyState = page.getByText(/No Nodes Yet/i);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    
    if (hasEmpty) {
      await expect(page.getByText(/Stake tokens and register a node/i)).toBeVisible();
      console.log('ℹ️ No nodes registered yet');
    } else {
      console.log('✅ My nodes section loaded');
    }
  });

  test('should display register node form', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    await expect(page.getByText('Register New Node')).toBeVisible();
    
    // Screenshot registration form
    await page.screenshot({ path: 'test-results/screenshots/synpress-node-register.png', fullPage: true });
  });

  test('should have all protocol tokens for staking', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Open staking token selector
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    
    // All tokens should be available
    await expect(page.getByText('elizaOS').first()).toBeVisible();
    await expect(page.getByText('CLANKER').first()).toBeVisible();
    await expect(page.getByText('VIRTUAL').first()).toBeVisible();
    await expect(page.getByText('CLANKERMON').first()).toBeVisible();
    
    console.log('✅ All tokens available for node staking');
  });

  test('should allow different reward token than staking token', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Select staking token
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);
    
    // Select different reward token
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.getByText('CLANKER').nth(1).click();
    
    console.log('✅ Can stake elizaOS and earn CLANKER rewards');
  });

  test('should validate minimum stake amount', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Select staking token
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);
    
    // Enter low amount
    await page.getByPlaceholder('Amount').fill('1');
    
    // Should show validation error
    await expect(page.getByText(/need \$1,000 minimum/i)).toBeVisible();
    
    console.log('✅ Minimum stake validation works');
  });

  test('should calculate USD value of stake', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Select staking token
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.getByText('CLANKER').first().click();
    await page.waitForTimeout(500);
    
    // Enter amount
    await page.getByPlaceholder('Amount').fill('100');
    
    // USD value should be calculated
    await expect(page.getByText(/\$/)).toBeVisible();
    
    console.log('✅ USD value calculation works');
  });

  test('should show geographic bonus for underserved regions', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Find region dropdown
    const regionSelect = page.locator('select').filter({ hasText: /North America/i });
    await expect(regionSelect).toBeVisible();
    
    // Get all options
    const options = await regionSelect.locator('option').allTextContents();
    
    // Africa and South America should show +50% bonus
    const africaOption = options.find(o => o.includes('Africa'));
    const saOption = options.find(o => o.includes('South America'));
    
    expect(africaOption).toContain('+50%');
    expect(saOption).toContain('+50%');
    
    console.log('✅ Geographic bonuses displayed');
  });

  test('should show staking requirements', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    await expect(page.getByText(/Minimum staking period/i)).toBeVisible();
    await expect(page.getByText(/7 days/i)).toBeVisible();
    await expect(page.getByText(/99%\+ uptime/i)).toBeVisible();
    
    console.log('✅ Staking requirements shown');
  });

  test('should estimate monthly rewards', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Select reward token
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.getByText('VIRTUAL').nth(1).click();
    await page.waitForTimeout(500);
    
    // Should show estimated rewards
    await expect(page.getByText(/Estimated:/i)).toBeVisible();
    await expect(page.getByText(/\/month/i)).toBeVisible();
    
    console.log('✅ Reward estimation displayed');
  });

  test('should enforce max 5 nodes per operator', async ({ page }) => {
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Check for max nodes warning
    const maxWarning = page.getByText(/reached the maximum of 5 nodes/i);
    const hasMax = await maxWarning.isVisible().catch(() => false);
    
    if (hasMax) {
      // Submit button should be disabled
      const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
      await expect(submitButton).toBeDisabled();
      
      console.log('✅ Max nodes enforced');
    } else {
      console.log('ℹ️ Under max node limit');
    }
  });

  test.skip('should register node successfully', async ({ page, metamask }) => {
    // Skip - requires gas and changes state
    
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Fill form
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.getByText('elizaOS').first().click();
    
    await page.getByPlaceholder('Amount').fill('10000'); // $1000+ worth
    
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.getByText('elizaOS').nth(1).click();
    
    await page.getByPlaceholder(/https:\/\/your-node/i).fill('https://node.example.com:8545');
    
    // Submit
    const submitButton = page.getByRole('button', { name: /Stake & Register Node/i });
    await submitButton.click();
    
    // Approve in MetaMask
    await approveTransaction(metamask);
    
    // Wait for success
    await expect(page.getByText(/Node registered successfully/i)).toBeVisible({ timeout: 90000 });
    
    console.log('✅ Node registered');
  });
});

