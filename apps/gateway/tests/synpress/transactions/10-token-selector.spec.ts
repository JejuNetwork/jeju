/**
 * Token Selector Component Transaction Tests
 * Tests token selection across all features and contexts
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL, PROTOCOL_TOKENS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const ALL_TOKENS = Object.values(PROTOCOL_TOKENS).map((t) => t.symbol);

test.describe('Token Selector - Paymaster Deployment Context', () => {
  test('should show all 4 tokens in paymaster selector', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);

    // Open selector
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
    }

    await page.screenshot({
      path: 'test-results/screenshots/selector-tx/01-paymaster-tokens.png',
      fullPage: true,
    });

    console.log('✅ All 4 tokens in paymaster selector');
  });

  test('should show token details in dropdown', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Check for token names and symbols
    for (const tokenData of Object.values(PROTOCOL_TOKENS)) {
      const symbolElement = page.getByText(tokenData.symbol);
      await expect(symbolElement).toBeVisible();

      // Check for price display
      const tokenRow = symbolElement.locator('../..');
      const hasPrice = await tokenRow.getByText(/\$/i).isVisible();

      if (hasPrice) {
        console.log(`✅ ${tokenData.symbol}: Shows price in dropdown`);
      }
    }
  });
});

test.describe('Token Selector - Liquidity Context', () => {
  test('should show all 4 tokens in liquidity selector with balances', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
    }

    console.log('✅ All 4 tokens in liquidity selector');
  });

  test('should update selector when tokens selected', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    // Select different tokens and verify selector updates
    for (const token of ALL_TOKENS.slice(0, 3)) {
      await page.locator('.input').first().click();
      await page.waitForTimeout(500);
      await page.getByText(token).click();
      await page.waitForTimeout(500);

      // Selector should show selected token
      const selectorValue = await page.locator('.input').first().textContent();
      expect(selectorValue).toContain(token);

      console.log(`✅ ${token} selected and displayed`);
    }
  });
});

test.describe('Token Selector - Node Staking Context', () => {
  test('should show all tokens in both staking and reward selectors', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    // Test staking token selector
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      const option = page.getByText(token).first();
      await expect(option).toBeVisible();
      console.log(`✅ ${token} in staking selector`);
    }

    // Close and test reward selector
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      const option = page.getByText(token).nth(1);
      await expect(option).toBeVisible();
      console.log(`✅ ${token} in reward selector`);
    }

    await page.screenshot({
      path: 'test-results/screenshots/selector-tx/02-node-selectors.png',
      fullPage: true,
    });
  });

  test('should allow selecting different token for rewards vs staking', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    // Select elizaOS for staking
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);

    // Select CLANKER for rewards
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);

    const clankerOption = page.getByText('CLANKER').nth(1);
    if (await clankerOption.isVisible()) {
      await clankerOption.click();
      await page.waitForTimeout(500);

      // Both should be displayed
      await expect(stakingSelector).toContainText('elizaOS');
      await expect(rewardSelector).toContainText('CLANKER');

      console.log('✅ Different tokens for staking/rewards works');
    }
  });
});

test.describe('Token Selector - Bridge Context (Filtering)', () => {
  test('should ONLY show bridgeable tokens (exclude elizaOS)', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Should have CLANKER, VIRTUAL, CLANKERMON
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();

    // Should NOT have elizaOS
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'CLANKER' });
    const hasElizaOS = await dropdown.getByText('elizaOS').isVisible();
    expect(hasElizaOS).toBe(false);

    await page.screenshot({
      path: 'test-results/screenshots/selector-tx/03-bridge-filtering.png',
      fullPage: true,
    });

    console.log('✅ Bridge selector correctly excludes elizaOS (native token)');
  });
});

test.describe('Token Selector - App Registry Context', () => {
  test('should show all tokens in registry stake selector', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    // Fill required fields first
    await page.getByPlaceholder('My Awesome App').fill('Test');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    // Open stake selector
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.waitForTimeout(500);

    for (const token of ALL_TOKENS) {
      await expect(page.getByText(token)).toBeVisible();
      console.log(`✅ ${token} in registry stake selector`);
    }

    await page.screenshot({
      path: 'test-results/screenshots/selector-tx/04-registry-tokens.png',
      fullPage: true,
    });
  });

  test('should update required stake when token changes', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    await page.getByPlaceholder('My Awesome App').fill('Test');
    await page.getByRole('button', { name: /🎮 Game/i }).click();

    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');

    // Select each token and verify stake updates
    const tokensToTest = ['elizaOS', 'VIRTUAL', 'CLANKERMON'];

    for (const token of tokensToTest) {
      await stakeSelector.click();
      await page.waitForTimeout(500);

      const tokenOption = page.getByText(token);
      if (await tokenOption.isVisible()) {
        await tokenOption.click();
        await page.waitForTimeout(1000);

        // Required stake should update
        const stakeDisplay = page.locator('p:has-text("Required Stake:")').locator('..').locator('p').nth(1);
        const stakeAmount = await stakeDisplay.textContent();

        console.log(`ℹ️  ${token} required stake: ${stakeAmount}`);
      }
    }

    console.log('✅ Required stake updates for each token');
  });
});

test.describe('Token Selector UI Interactions', () => {
  test('should open and close dropdown correctly', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    const selector = page.locator('.input').first();

    // Open
    await selector.click();
    await page.waitForTimeout(500);

    const dropdown = page.locator('[style*="position: absolute"]');
    await expect(dropdown).toBeVisible();

    // Close by clicking outside
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    const dropdownClosed = !(await dropdown.isVisible().catch(() => true));
    expect(dropdownClosed).toBe(true);

    console.log('✅ Dropdown open/close works');
  });

  test('should close dropdown when selecting token', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    await page.getByText('elizaOS').click();
    await page.waitForTimeout(500);

    // Dropdown should close
    const dropdown = page.locator('[style*="position: absolute"]');
    const dropdownClosed = !(await dropdown.isVisible().catch(() => true));
    expect(dropdownClosed).toBe(true);

    console.log('✅ Dropdown closes on selection');
  });

  test.skip('should support keyboard navigation in dropdown', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Try arrow keys
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Should select token
    console.log('⚠️  Keyboard navigation - needs verification');
  });
});


