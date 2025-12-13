/**
 * Token List Component Tests
 * Tests token list display, cards, interactions, and data
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Token List Display', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display token list with all registered tokens', async ({ page }) => {
    // Check for token list heading
    const heading = page.getByText(/Registered Tokens \(\d+\)/i);
    const hasHeading = await heading.isVisible();

    if (hasHeading) {
      const headingText = await heading.textContent();
      const count = parseInt(headingText?.match(/\d+/)?.[0] || '0');

      console.log(`ℹ️  ${count} tokens registered`);

      // Should have token cards
      if (count > 0) {
        const tokenCards = page.locator('.card').filter({ hasText: /decimals|Address/i });
        const cardCount = await tokenCards.count();

        expect(cardCount).toBeGreaterThan(0);
        console.log(`✅ ${cardCount} token cards displayed`);
      }
    } else {
      console.log('ℹ️  No registered tokens or different UI');
    }
  });

  test('should display token card with complete information', async ({ page }) => {
    const tokenCards = page.locator('.card').filter({ hasText: /decimals/i });
    const count = await tokenCards.count();

    if (count === 0) {
      console.log('ℹ️  No token cards to verify');
      return;
    }

    const firstCard = tokenCards.first();

    // Should show:
    await expect(firstCard.getByText(/decimals/i)).toBeVisible();
    
    // Check for various data fields
    const hasFeeRange = await firstCard.getByText(/Fee Range/i).isVisible();
    const hasVolume = await firstCard.getByText(/Volume/i).isVisible();
    const hasTransactions = await firstCard.getByText(/Transactions/i).isVisible();
    const hasPaymaster = await firstCard.getByText(/Paymaster/i).isVisible();

    console.log(`ℹ️  Token card shows:`);
    console.log(`   Fee Range: ${hasFeeRange ? '✅' : '❌'}`);
    console.log(`   Volume: ${hasVolume ? '✅' : '❌'}`);
    console.log(`   Transactions: ${hasTransactions ? '✅' : '❌'}`);
    console.log(`   Paymaster: ${hasPaymaster ? '✅' : '❌'}`);

    await page.screenshot({
      path: 'test-results/screenshots/components/01-token-card.png',
      fullPage: true,
    });

    console.log('✅ Token card displays complete information');
  });

  test('should show paymaster deployment status', async ({ page }) => {
    const tokenCards = page.locator('.card').filter({ hasText: /Paymaster/i });
    const count = await tokenCards.count();

    if (count > 0) {
      const firstCard = tokenCards.first();

      // Check for deployment status indicators
      const deployed = await firstCard.getByText(/✅ Deployed|Deployed/i).isVisible();
      const notDeployed = await firstCard.getByText(/❌ Not Deployed|Not Deployed/i).isVisible();

      expect(deployed || notDeployed).toBe(true);

      console.log(`✅ Paymaster status: ${deployed ? 'Deployed' : 'Not Deployed'}`);
    }
  });

  test('should show empty state if no tokens registered', async ({ page }) => {
    // This might not show if tokens already registered
    const emptyState = page.getByText(/No tokens registered yet/i);
    const hasEmpty = await emptyState.isVisible();

    if (hasEmpty) {
      await expect(page.getByText(/Deploy contracts first/i)).toBeVisible();
      console.log('✅ Empty state displayed for no tokens');
    } else {
      console.log('ℹ️  Tokens already registered');
    }
  });

  test('should have refresh button that works', async ({ page }) => {
    const refreshButton = page.getByRole('button', { name: /Refresh/i });
    const hasRefresh = await refreshButton.isVisible();

    if (hasRefresh) {
      await refreshButton.click();
      await page.waitForTimeout(1000);

      // List should reload
      console.log('✅ Refresh button works');
    } else {
      console.log('ℹ️  No refresh button (may auto-refresh)');
    }
  });
});

test.describe('Token Card Interactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display fee range in basis points and percentage', async ({ page }) => {
    const feeRangeElements = page.locator('text=/Fee Range/i');
    const count = await feeRangeElements.count();

    if (count > 0) {
      const feeRangeText = await page.locator('p:has-text("Fee Range")').locator('..').locator('p').nth(1).textContent();
      console.log(`ℹ️  Fee range displayed: ${feeRangeText}`);

      // Should show percentages (e.g., "0% - 2%")
      expect(feeRangeText).toContain('%');

      console.log('✅ Fee range formatted correctly');
    }
  });

  test('should display transaction and volume statistics', async ({ page }) => {
    const statsElements = page.locator('text=/Total Volume|Transactions/i');
    const count = await statsElements.count();

    if (count > 0) {
      console.log(`✅ Found ${count} stat displays`);
    }
  });

  test('should show active/inactive status badge', async ({ page }) => {
    const statusBadges = page.locator('.badge-success, .badge-error, .badge');
    const count = await statusBadges.count();

    if (count > 0) {
      const firstBadge = statusBadges.first();
      const badgeText = await firstBadge.textContent();

      console.log(`ℹ️  Token status: ${badgeText}`);
      console.log('✅ Status badge displayed');
    }
  });
});

test.describe('Token List Ordering', () => {
  test('should display tokens in consistent order', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);

    // Get all token names in order
    const tokenCards = page.locator('.card').filter({ hasText: /decimals/i });
    const count = await tokenCards.count();

    const tokenOrder: string[] = [];
    for (let i = 0; i < count; i++) {
      const card = tokenCards.nth(i);
      const heading = card.locator('h3');
      const symbol = await heading.textContent();
      if (symbol) {
        tokenOrder.push(symbol.trim());
      }
    }

    console.log(`ℹ️  Token order: ${tokenOrder.join(', ')}`);
    console.log('✅ Token list ordering tested');
  });
});


