/**
 * @fileoverview Multi-token equality E2E tests
 * @module gateway/tests/e2e/multi-token-flows
 * 
 * Ensures all protocol tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
 * are treated equally throughout the UI
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';
 */

import { testWithWallet as test, expect } from '../fixtures/wallet';
import { connectWallet } from '@jejunetwork/tests/helpers/contracts';
import { assertAllProtocolTokens } from '../helpers/assertions';

test.describe('Multi-Token Equality Tests', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
  });

  test('should display all 4 protocol tokens in balance view', async ({ page }) => {
    await assertAllProtocolTokens(page);
    
    // Check for total USD value
    await expect(page.getByText(/Total:/i)).toBeVisible();
  });

  test('should show elizaOS FIRST in all token lists', async ({ page }) => {
    // Balance display
    const balanceCards = page.locator('[style*="background: #f8fafc"]').filter({ hasText: /elizaOS|CLANKER|VIRTUAL|CLANKERMON/ });
    const firstCard = balanceCards.first();
    await expect(firstCard.getByText('elizaOS')).toBeVisible();
  });

  test('all tokens should have equal UI treatment in selectors', async ({ page }) => {
    // Go to liquidity tab
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    
    // Open token selector
    await page.locator('.input').first().click();
    
    // All tokens should be in dropdown
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'elizaOS' });
    
    await expect(dropdown.getByText('elizaOS')).toBeVisible();
    await expect(dropdown.getByText('CLANKER')).toBeVisible();
    await expect(dropdown.getByText('VIRTUAL')).toBeVisible();
    await expect(dropdown.getByText('CLANKERMON')).toBeVisible();
  });

  test('all tokens should display USD values consistently', async ({ page }) => {
    const tokenCards = page.locator('[style*="background: #f8fafc"]').filter({ hasText: /elizaOS|CLANKER|VIRTUAL|CLANKERMON/ });
    const count = await tokenCards.count();
    
    // Each token card should show USD price
    for (let i = 0; i < count; i++) {
      const card = tokenCards.nth(i);
      await expect(card.getByText(/\$/)).toBeVisible();
    }
  });

  test('all tokens should be available for paymaster deployment', async ({ page }) => {
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    
    await page.locator('.input').first().click();
    
    // All protocol tokens should be options
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
  });

  test('all tokens should be available for liquidity provision', async ({ page }) => {
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    
    await page.locator('.input').first().click();
    
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
  });

  test('all tokens should be available for node staking', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Open staking token selector
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    
    await expect(page.getByText('elizaOS').first()).toBeVisible();
    await expect(page.getByText('CLANKER').first()).toBeVisible();
    await expect(page.getByText('VIRTUAL').first()).toBeVisible();
    await expect(page.getByText('CLANKERMON').first()).toBeVisible();
  });

  test('all tokens should be available as node rewards', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.getByRole('button', { name: /Register New Node/i }).click();
    
    // Open reward token selector
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    
    await expect(page.getByText('elizaOS').nth(1)).toBeVisible();
    await expect(page.getByText('CLANKER').nth(1)).toBeVisible();
    await expect(page.getByText('VIRTUAL').nth(1)).toBeVisible();
    await expect(page.getByText('CLANKERMON').nth(1)).toBeVisible();
  });

  test('all tokens should be available for app registry stakes', async ({ page }) => {
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.getByRole('button', { name: /Register App/i }).click();
    
    // Fill required fields first
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    
    // Open stake token selector
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
  });

  test('bridgeable tokens should EXCLUDE elizaOS', async ({ page }) => {
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    
    // Open token selector
    await page.locator('.input').first().click();
    
    // Should have Base tokens
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    // Should NOT have elizaOS (it's native, not bridgeable)
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'CLANKER' });
    await expect(dropdown.getByText('elizaOS')).not.toBeVisible();
  });

  test('all tokens should show logos in dropdowns', async ({ page }) => {
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    
    await page.locator('.input').first().click();
    
    // Check for token logos (img tags)
    const dropdown = page.locator('[style*="position: absolute"]');
    const images = dropdown.locator('img');
    const imageCount = await images.count();
    
    // Should have images for tokens that have logoUrl
    expect(imageCount).toBeGreaterThanOrEqual(1);
  });

  test('token prices should be displayed consistently', async ({ page }) => {
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    
    await page.locator('.input').first().click();
    
    // All tokens in dropdown should show prices
    const dropdown = page.locator('[style*="position: absolute"]');
    const prices = dropdown.getByText(/\$/);
    const priceCount = await prices.count();
    
    expect(priceCount).toBeGreaterThanOrEqual(3); // At least 3 tokens with prices
  });
});

test.describe('Token-Specific Price Validation', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
  });

  test('elizaOS should show $0.10 price', async ({ page }) => {
    const elizaCard = page.locator('[style*="background: #f8fafc"]').filter({ hasText: 'elizaOS' });
    await expect(elizaCard.getByText('$0.10')).toBeVisible();
  });

  test('CLANKER should show $26.14 price', async ({ page }) => {
    const clankerCard = page.locator('[style*="background: #f8fafc"]').filter({ hasText: 'CLANKER' });
    await expect(clankerCard.getByText('$26.14')).toBeVisible();
  });

  test('VIRTUAL should show $1.85 price', async ({ page }) => {
    const virtualCard = page.locator('[style*="background: #f8fafc"]').filter({ hasText: 'VIRTUAL' });
    await expect(virtualCard.getByText('$1.85')).toBeVisible();
  });

  test('CLANKERMON should show $0.15 price', async ({ page }) => {
    const clankermonCard = page.locator('[style*="background: #f8fafc"]').filter({ hasText: 'CLANKERMON' });
    await expect(clankermonCard.getByText('$0.15')).toBeVisible();
  });
});


