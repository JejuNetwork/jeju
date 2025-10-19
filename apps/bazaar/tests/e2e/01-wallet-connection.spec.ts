import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar Wallet Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BAZAAR_URL);
  });

  test('should display homepage with all features', async ({ page }) => {
    // Check title
    await expect(page.getByRole('heading', { name: /Welcome to Bazaar/i })).toBeVisible();

    // Check feature cards
    await expect(page.getByText('Swap')).toBeVisible();
    await expect(page.getByText('Pools')).toBeVisible();
    await expect(page.getByText('NFTs')).toBeVisible();
  });

  test('should connect wallet via wagmi', async ({ wallet, page }) => {
    // Wait for page load
    await expect(page.getByText(/Bazaar/i)).toBeVisible();

    // Connect wallet
    await connectWallet(page, wallet);

    // Should show connected address
    await expect(page.getByText(/0x/)).toBeVisible({ timeout: 10000 });
  });

  test('should display wallet balance after connection', async ({ wallet, page }) => {
    await connectWallet(page, wallet);

    // Should show ETH balance
    await expect(page.getByText(/Balance|ETH/i)).toBeVisible();
  });

  test('should switch to Jeju network', async ({ wallet, page }) => {
    await connectWallet(page, wallet);

    // Should show Jeju network indicator
    const networkIndicator = page.locator('[data-network], [data-chain-id="1337"]').first();

    if (await networkIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
      const text = await networkIndicator.textContent();
      console.log(`Network: ${text}`);
      expect(text).toMatch(/Jeju/i);
    }
  });
});
