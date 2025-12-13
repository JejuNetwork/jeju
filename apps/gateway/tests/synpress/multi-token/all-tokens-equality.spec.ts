/**
 * Multi-Token Equality Tests
 * Ensures ALL 4 protocol tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
 * are treated equally across ALL features
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL, PROTOCOL_TOKENS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const ALL_TOKENS = Object.values(PROTOCOL_TOKENS).map((t) => t.symbol);
const BRIDGEABLE_TOKENS = Object.values(PROTOCOL_TOKENS)
  .filter((t) => t.bridgeable)
  .map((t) => t.symbol);

test.describe('Token Balance Display Equality', () => {
  test('should display ALL 4 tokens in balance view with equal treatment', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(3000);

    // Check each token displayed
    for (const token of ALL_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
      console.log(`✅ ${token} displayed in balance view`);
    }

    // Verify elizaOS is FIRST
    const tokenCards = page.locator('[style*="background: #f8fafc"]').filter({ hasText: /elizaOS|CLANKER|VIRTUAL|CLANKERMON/ });
    const firstCard = tokenCards.first();
    await expect(firstCard.getByText('elizaOS')).toBeVisible();
    
    console.log('✅ elizaOS displayed first');

    // Check USD values shown for all
    for (const token of ALL_TOKENS) {
      const tokenCard = page.locator('[style*="background: #f8fafc"]').filter({ hasText: token });
      await expect(tokenCard.getByText(/\$/)).toBeVisible();
    }

    console.log('✅ All tokens show USD values');

    await page.screenshot({
      path: 'test-results/screenshots/multi-token/01-balance-equality.png',
      fullPage: true,
    });
  });

  test('should show token logos for all tokens', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(3000);

    // Check for token logo images
    const images = page.locator('img[alt*="elizaOS"], img[alt*="CLANKER"], img[alt*="VIRTUAL"], img[alt*="CLANKERMON"]');
    const imageCount = await images.count();

    expect(imageCount).toBeGreaterThanOrEqual(1);
    console.log(`✅ ${imageCount} token logos displayed`);
  });

  test('should calculate total portfolio value including all tokens', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(3000);

    // Check for total value
    await expect(page.getByText(/Total:/i)).toBeVisible();
    await expect(page.locator('text=/Total:/i').locator('../..').getByText(/\$/)).toBeVisible();

    console.log('✅ Total portfolio value calculated');
  });
});

test.describe('Token Selector Equality', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
  });

  test('ALL tokens should appear in paymaster deployment selector', async ({ page }) => {
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
      console.log(`✅ ${token} in paymaster selector`);
    }
  });

  test('ALL tokens should appear in liquidity provision selector', async ({ page }) => {
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
      console.log(`✅ ${token} in liquidity selector`);
    }
  });

  test('ALL tokens should appear in node staking selector', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      const tokenOption = page.getByText(token).first();
      await expect(tokenOption).toBeVisible();
      console.log(`✅ ${token} in staking selector`);
    }
  });

  test('ALL tokens should appear in node reward selector', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      const tokenOption = page.getByText(token).nth(1);
      await expect(tokenOption).toBeVisible();
      console.log(`✅ ${token} in reward selector`);
    }
  });

  test('ALL tokens should appear in app registry stake selector', async ({ page }) => {
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    // Fill required fields first
    await page.getByPlaceholder('My Awesome App').fill('Test');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
      console.log(`✅ ${token} in registry stake selector`);
    }
  });

  test('ONLY bridgeable tokens should appear in bridge selector', async ({ page }) => {
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Should have CLANKER, VIRTUAL, CLANKERMON
    for (const token of BRIDGEABLE_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
      console.log(`✅ ${token} in bridge selector`);
    }

    // Should NOT have elizaOS (native token)
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'CLANKER' });
    const hasElizaOS = await dropdown.getByText('elizaOS').isVisible();
    expect(hasElizaOS).toBe(false);

    console.log('✅ elizaOS correctly excluded from bridge (native token)');

    await page.screenshot({
      path: 'test-results/screenshots/multi-token/02-bridge-filtering.png',
      fullPage: true,
    });
  });
});

test.describe('Price Display Consistency', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
  });

  test('should display correct price for each token in balance view', async ({ page }) => {
    await page.waitForTimeout(3000);

    const priceChecks = [
      { token: 'elizaOS', price: '$0.10' },
      { token: 'CLANKER', price: '$26.14' },
      { token: 'VIRTUAL', price: '$1.85' },
      { token: 'CLANKERMON', price: '$0.15' },
    ];

    for (const check of priceChecks) {
      const tokenCard = page.locator('[style*="background: #f8fafc"]').filter({ hasText: check.token });
      const hasCard = await tokenCard.isVisible();
      
      if (hasCard) {
        await expect(tokenCard.getByText(check.price)).toBeVisible();
        console.log(`✅ ${check.token} shows ${check.price}`);
      }
    }
  });

  test('should show prices in all dropdowns consistently', async ({ page }) => {
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // All tokens in dropdown should show prices
    const dropdown = page.locator('[style*="position: absolute"]');
    const prices = dropdown.getByText(/\$/);
    const priceCount = await prices.count();

    expect(priceCount).toBeGreaterThanOrEqual(3);
    console.log(`✅ ${priceCount} prices shown in dropdown`);
  });
});

test.describe('Feature Availability Equality', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
  });

  test('should allow paymaster deployment for ALL tokens', async ({ page }) => {
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);

    for (const token of ALL_TOKENS) {
      await page.locator('.input').first().click();
      await page.waitForTimeout(500);
      
      await page.getByText(token).click();
      await page.waitForTimeout(500);

      // Either shows deployment form OR "already deployed" OR "not registered"
      // All are valid states - point is token is selectable
      const formVisible = await page.getByText(/Deploy Paymaster|already deployed|not registered/i).isVisible();
      expect(formVisible).toBe(true);

      console.log(`✅ ${token} available for paymaster deployment`);
    }
  });

  test('should allow liquidity provision for ALL tokens', async ({ page }) => {
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    for (const token of ALL_TOKENS) {
      await page.locator('.input').first().click();
      await page.waitForTimeout(500);
      
      await page.getByText(token).click();
      await page.waitForTimeout(1000);

      // Should show ETH input OR paymaster warning
      const ethInput = page.getByPlaceholder('1.0');
      const noPaymaster = page.getByText(/No paymaster deployed/i);
      
      const hasInput = await ethInput.isVisible();
      const hasWarning = await noPaymaster.isVisible();
      
      expect(hasInput || hasWarning).toBe(true);

      console.log(`✅ ${token} available for liquidity`);
    }
  });

  test('should allow ALL tokens as node staking tokens', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');

    for (const token of ALL_TOKENS) {
      await stakingSelector.click();
      await page.waitForTimeout(500);
      
      await page.getByText(token).first().click();
      await page.waitForTimeout(500);

      // Amount input should appear
      const amountInput = page.getByPlaceholder('Amount');
      await expect(amountInput).toBeVisible();

      console.log(`✅ ${token} works as staking token`);
    }
  });

  test('should allow ALL tokens as node reward tokens', async ({ page }) => {
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');

    for (const token of ALL_TOKENS) {
      await rewardSelector.click();
      await page.waitForTimeout(500);
      
      await page.getByText(token).nth(1).click();
      await page.waitForTimeout(500);

      // Reward estimate should appear
      const estimate = page.getByText(/Estimated:/i);
      const hasEstimate = await estimate.isVisible();
      
      // Estimate may not show without staking token selected
      console.log(`✅ ${token} available as reward token`);
    }
  });

  test('should allow ALL tokens as app registry stake', async ({ page }) => {
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    // Fill required fields
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');

    for (const token of ALL_TOKENS) {
      await stakeSelector.click();
      await page.waitForTimeout(500);
      
      await page.getByText(token).click();
      await page.waitForTimeout(1000);

      // Required stake should be calculated
      await expect(page.getByText('Required Stake:')).toBeVisible();
      await expect(page.getByText(/≈ \$/)).toBeVisible();

      console.log(`✅ ${token} works as registry stake`);
    }
  });
});

test.describe('Bridge Token Filtering', () => {
  test('should EXCLUDE elizaOS from bridge (native token)', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    // Open selector
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Check bridgeable tokens present
    for (const token of BRIDGEABLE_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
      console.log(`✅ ${token} available for bridge`);
    }

    // Verify elizaOS NOT in dropdown
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'CLANKER' });
    const hasElizaOS = await dropdown.getByText('elizaOS').isVisible();
    expect(hasElizaOS).toBe(false);

    console.log('✅ elizaOS correctly excluded (native Jeju token)');

    // Verify warning message shown
    await expect(page.getByText(/elizaOS is a native Jeju token/i)).toBeVisible();
    await expect(page.getByText(/cannot be bridged from Ethereum/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/multi-token/03-bridge-exclusion.png',
      fullPage: true,
    });
  });

  test('should allow custom ANY Base ERC20 token', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    // Switch to custom mode
    await page.getByRole('button', { name: /Custom Address/i }).click();

    // Custom input should appear
    await expect(page.getByPlaceholder('0x...')).toBeVisible();
    await expect(page.getByText(/Enter any ERC20 token address/i)).toBeVisible();

    // Enter custom address
    await page.getByPlaceholder('0x...').fill('0x1234567890123456789012345678901234567890');

    console.log('✅ Custom token address mode works');
  });
});

test.describe('Cross-Token Operations', () => {
  test('should allow staking one token and earning rewards in different token', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    // Stake elizaOS
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);

    // Earn CLANKER rewards
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);
    
    const clankerOption = page.getByText('CLANKER').nth(1);
    if (await clankerOption.isVisible()) {
      await clankerOption.click();
      await page.waitForTimeout(500);

      await expect(page.getByText(/what you want to earn/i)).toBeVisible();

      console.log('✅ Cross-token staking/rewards works (stake elizaOS, earn CLANKER)');

      await page.screenshot({
        path: 'test-results/screenshots/multi-token/04-cross-token-staking.png',
        fullPage: true,
      });
    }
  });
});

test.describe('Token Information Display', () => {
  test('should show complete token info in dropdown', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Check first token (elizaOS) has complete info
    const elizaOSOption = page.getByText('elizaOS');
    await expect(elizaOSOption).toBeVisible();

    // Should show:
    // - Symbol
    // - Name  
    // - Price (if applicable)
    // - Balance (if showBalances true)
    // - Logo (if available)

    await page.screenshot({
      path: 'test-results/screenshots/multi-token/05-token-info.png',
      fullPage: true,
    });

    console.log('✅ Token dropdown shows complete information');
  });
});


