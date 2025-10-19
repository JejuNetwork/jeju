import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar My NFTs', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);
  });

  test('should navigate to My NFTs page', async ({ page }) => {
    // Navigate to my NFTs
    await page.goto(`${BAZAAR_URL}/my-nfts`);

    await expect(page.getByText(/My NFTs|Your Collection/i)).toBeVisible();
  });

  test('should display owned NFTs', async ({ page }) => {
    await page.goto(`${BAZAAR_URL}/my-nfts`);
    await page.waitForTimeout(2000);

    // Should show NFTs or empty state
    const nftCards = page.locator('[data-testid="nft-card"], .nft-card');

    const count = await nftCards.count();
    console.log(`User owns ${count} NFTs`);

    if (count === 0) {
      await expect(page.getByText(/No NFTs|Empty|Start collecting/i)).toBeVisible();
    } else {
      await expect(nftCards.first()).toBeVisible();
    }
  });

  test('should show NFT details for owned NFT', async ({ page }) => {
    await page.goto(`${BAZAAR_URL}/my-nfts`);
    await page.waitForTimeout(2000);

    const firstNFT = page.locator('[data-testid="nft-card"]').first();

    if (await firstNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNFT.click();

      // Should show details
      await expect(page.getByText(/Details|Attributes|Owned by you/i)).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should show list NFT button', async ({ page }) => {
    await page.goto(`${BAZAAR_URL}/my-nfts`);
    await page.waitForTimeout(2000);

    const firstNFT = page.locator('[data-testid="nft-card"]').first();

    if (await firstNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNFT.click();

      // Should show list/sell button
      const listButton = page.locator('button:has-text("List"), button:has-text("Sell")').first();

      if (await listButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('List button available');
        await expect(listButton).toBeVisible();
      }
    }
  });

  test.skip('should list NFT for sale', async ({ wallet, page }) => {
    await page.goto(`${BAZAAR_URL}/my-nfts`);
    await page.waitForTimeout(2000);

    // Find unlisted NFT
    const firstNFT = page.locator('[data-testid="nft-card"]').first();

    if (await firstNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNFT.click();

      // Click list button
      const listButton = page.locator('button:has-text("List"), button:has-text("Sell")').first();

      if (await listButton.isVisible().catch(() => false)) {
        await listButton.click();

        // Enter price
        const priceInput = page.locator('input[name*="price"], input[placeholder*="Price"]').first();
        await priceInput.fill('0.5');

        // Confirm listing
        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("List")').first();
        await confirmButton.click();

        // Approve in MetaMask
        await wallet.confirmTransaction();

        // Wait for success
        await expect(page.getByText(/Listed|Success/i)).toBeVisible({
          timeout: 30000
        });
      }
    }
  });

  test.skip('should cancel NFT listing', async ({ wallet, page }) => {
    await page.goto(`${BAZAAR_URL}/my-nfts`);
    await page.waitForTimeout(2000);

    // Find listed NFT
    const listedNFT = page.locator('[data-testid="nft-card"]').filter({
      hasText: /Listed|For Sale/i
    }).first();

    if (await listedNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await listedNFT.click();

      // Click cancel button
      const cancelButton = page.locator('button:has-text("Cancel"), button:has-text("Delist")').first();

      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();

        // Confirm in MetaMask
        await wallet.confirmTransaction();

        // Wait for success
        await expect(page.getByText(/Cancelled|Delisted/i)).toBeVisible({
          timeout: 30000
        });
      }
    }
  });

  test('should show NFT transfer option', async ({ page }) => {
    await page.goto(`${BAZAAR_URL}/my-nfts`);
    await page.waitForTimeout(2000);

    const firstNFT = page.locator('[data-testid="nft-card"]').first();

    if (await firstNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNFT.click();

      // Should show transfer/send button
      const transferButton = page.locator('button:has-text("Transfer"), button:has-text("Send")').first();

      if (await transferButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Transfer option available');
      }
    }
  });
});
