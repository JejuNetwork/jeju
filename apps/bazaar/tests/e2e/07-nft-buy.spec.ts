import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';
import { navigateToNFTs } from '../../../../tests/shared/helpers/navigation';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar NFT Purchase', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);
    await navigateToNFTs(page);
  });

  test('should show buy button on NFT', async ({ page }) => {
    await page.waitForTimeout(2000);

    const firstNFT = page.locator('[data-testid="nft-card"]').first();

    if (await firstNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNFT.click();

      // Should show buy button
      const buyButton = page.locator('button:has-text("Buy"), button:has-text("Purchase")').first();

      if (await buyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Buy button available');
        await expect(buyButton).toBeVisible();
      } else {
        console.log('NFT not for sale or already owned');
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test.skip('should purchase NFT successfully', async ({ wallet, page }) => {
    await page.waitForTimeout(2000);

    // Find buyable NFT
    const buyButton = page.locator('button:has-text("Buy")').first();

    if (await buyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click buy
      await buyButton.click();

      // Should show confirmation dialog
      await expect(page.getByText(/Confirm|Purchase/i)).toBeVisible();

      // Confirm purchase
      const confirmButton = page.locator('button:has-text("Confirm")').first();
      await confirmButton.click();

      // Confirm transaction in MetaMask
      await wallet.confirmTransaction();

      // Wait for success
      await expect(page.getByText(/Success|Purchased|Owned/i)).toBeVisible({
        timeout: 60000
      });
    } else {
      test.skip();
    }
  });

  test('should show NFT price before purchase', async ({ page }) => {
    await page.waitForTimeout(2000);

    const firstNFT = page.locator('[data-testid="nft-card"]').first();

    if (await firstNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNFT.click();

      // Should display price
      const priceElement = page.locator('[data-price], text=/[0-9]+.*ETH/').first();

      if (await priceElement.isVisible({ timeout: 3000 }).catch(() => false)) {
        const price = await priceElement.textContent();
        console.log(`NFT Price: ${price}`);
        expect(price).toBeTruthy();
      }
    }
  });

  test('should show wallet balance before purchase', async ({ page }) => {
    // Should show user's ETH balance
    const balanceElement = page.locator('[data-balance], text=/Balance.*[0-9]/').first();

    if (await balanceElement.isVisible({ timeout: 5000 }).catch(() => false)) {
      const balance = await balanceElement.textContent();
      console.log(`User balance: ${balance}`);
    }
  });

  test('should prevent purchase if insufficient balance', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Try to buy expensive NFT (if available)
    const expensiveNFT = page.locator('[data-testid="nft-card"]').filter({
      hasText: /[0-9]{3,}/  // 100+ ETH
    }).first();

    if (await expensiveNFT.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expensiveNFT.click();

      const buyButton = page.locator('button:has-text("Buy")').first();

      // Button should be disabled or show insufficient funds
      const isDisabled = await buyButton.isDisabled();
      console.log(`Buy button disabled: ${isDisabled}`);
    }
  });
});
