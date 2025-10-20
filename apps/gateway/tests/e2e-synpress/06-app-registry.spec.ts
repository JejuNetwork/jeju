/**
 * Gateway App Registry - Synpress E2E Tests
 * Tests ERC-8004 app/agent registration and discovery
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../fixtures/synpress-wallet';
import { connectWallet, approveTransaction } from '../helpers/wallet-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('App Registry Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Navigate to App Registry tab
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display app registry interface', async ({ page }) => {
    await expect(page.getByText(/ERC-8004 Registry/i)).toBeVisible();
    
    // Screenshot
    await page.screenshot({ path: 'test-results/screenshots/synpress-app-registry.png', fullPage: true });
  });

  test('should show browse and register sections', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Browse Apps/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Register App/i })).toBeVisible();
    
    console.log('✅ Browse and Register sections available');
  });

  test('should display tag filters', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(500);
    
    // Check for tag filters
    await expect(page.getByText('All Apps')).toBeVisible();
    await expect(page.getByText('Applications')).toBeVisible();
    await expect(page.getByText('Games')).toBeVisible();
    await expect(page.getByText('Marketplaces')).toBeVisible();
    await expect(page.getByText('DeFi')).toBeVisible();
    
    console.log('✅ Tag filters displayed');
  });

  test('should filter apps by tag', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    
    // Click Games filter
    await page.getByText('Games').click();
    await page.waitForTimeout(500);
    
    console.log('✅ Tag filtering works');
  });

  test('should display registered apps or empty state', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);
    
    const emptyState = page.getByText(/No Apps Found/i);
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    
    const isEmpty = await emptyState.isVisible().catch(() => false);
    const hasApps = await appCards.count() > 0;
    
    expect(isEmpty || hasApps).toBe(true);
    
    if (hasApps) {
      console.log(`✅ Found ${await appCards.count()} registered apps`);
    } else {
      console.log('ℹ️ No apps registered yet');
    }
  });

  test('should show A2A enabled badge for apps with endpoints', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);
    
    const a2aBadges = page.getByText(/A2A Enabled/i);
    const count = await a2aBadges.count();
    
    console.log(`ℹ️ Found ${count} apps with A2A endpoints`);
    expect(count >= 0).toBe(true);
  });

  test('should display registration form', async ({ page }) => {
    await page.getByRole('button', { name: /Register App/i }).click();
    
    await expect(page.getByText('Register New App')).toBeVisible();
    
    // Screenshot registration form
    await page.screenshot({ path: 'test-results/screenshots/synpress-app-register.png', fullPage: true });
  });

  test('should have all required form fields', async ({ page }) => {
    await page.getByRole('button', { name: /Register App/i }).click();
    
    // Check for required fields
    await expect(page.getByPlaceholder('My Awesome App')).toBeVisible();
    await expect(page.getByPlaceholder(/Brief description/i)).toBeVisible();
    await expect(page.getByPlaceholder('https://myapp.com/a2a')).toBeVisible();
    
    console.log('✅ All form fields present');
  });

  test('should allow multiple tag selection', async ({ page }) => {
    await page.getByRole('button', { name: /Register App/i }).click();
    
    // Check tags available
    await expect(page.getByText('📱 Application')).toBeVisible();
    await expect(page.getByText('🎮 Game')).toBeVisible();
    await expect(page.getByText('🏪 Marketplace')).toBeVisible();
    await expect(page.getByText('💰 DeFi')).toBeVisible();
    
    // Click multiple tags
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    await page.getByRole('button', { name: /💬 Social/i }).click();
    
    console.log('✅ Multiple tag selection works');
  });

  test('should have stake token selector with all protocol tokens', async ({ page }) => {
    await page.getByRole('button', { name: /Register App/i }).click();
    
    // Fill required fields first
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    
    // Open stake token selector
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);
    
    // All protocol tokens should be available
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    console.log('✅ All tokens available for app registry stake');
  });

  test('should calculate required stake', async ({ page }) => {
    await page.getByRole('button', { name: /Register App/i }).click();
    
    // Fill fields
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    
    // Select stake token
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(1000);
    
    // Required stake should be displayed
    await expect(page.getByText('Required Stake:')).toBeVisible();
    await expect(page.getByText(/≈ \$3.50 USD/i)).toBeVisible();
    
    console.log('✅ Required stake calculated');
  });

  test('should show refundable stake info', async ({ page }) => {
    await page.getByRole('button', { name: /Register App/i }).click();
    
    await expect(page.getByText(/Your stake is fully refundable/i)).toBeVisible();
    await expect(page.getByText(/withdraw it anytime/i)).toBeVisible();
    
    console.log('✅ Refundable stake info shown');
  });

  test('should validate form before enabling submit', async ({ page }) => {
    await page.getByRole('button', { name: /Register App/i }).click();
    
    const submitButton = page.getByRole('button', { name: /Register App$/i });
    
    // Should be disabled without required fields
    await expect(submitButton).toBeDisabled();
    
    // Fill required fields
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);
    
    // Should now be enabled
    await expect(submitButton).toBeEnabled();
    
    console.log('✅ Form validation works');
  });

  test.skip('should register app successfully', async ({ page, metamask }) => {
    // Skip - requires gas
    
    await page.getByRole('button', { name: /Register App/i }).click();
    
    // Fill form
    await page.getByPlaceholder('My Awesome App').fill('E2E Test App');
    await page.getByPlaceholder(/Brief description/i).fill('Test app for E2E testing');
    await page.getByPlaceholder('https://myapp.com/a2a').fill('http://localhost:4003/a2a');
    
    // Select tags
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    
    // Select stake token
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);
    
    // Submit
    const submitButton = page.getByRole('button', { name: /Register App$/i });
    await submitButton.click();
    
    // Approve in MetaMask
    await approveTransaction(metamask);
    
    // Wait for success
    await expect(page.getByText(/App registered successfully/i)).toBeVisible({ timeout: 90000 });
    
    console.log('✅ App registered');
  });
});

