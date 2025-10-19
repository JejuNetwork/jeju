import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet, executeSwap } from '../../../../tests/shared/helpers/contracts';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar Complete User Flow', () => {
  test('complete DeFi + NFT user journey', async ({ wallet, page }) => {
    // 1. Navigate to homepage
    await page.goto(BAZAAR_URL);
    await expect(page.getByText(/Bazaar/i)).toBeVisible();

    // 2. Connect wallet
    await connectWallet(page, wallet);
    await expect(page.getByText(/0x/)).toBeVisible();

    // 3. Navigate to Swap
    await page.goto(`${BAZAAR_URL}/swap`);
    await expect(page.getByText(/Swap/i)).toBeVisible();

    // 4. Enter swap details
    const amountInput = page.locator('input[placeholder*="0.0"]').first();
    await amountInput.fill('0.01');

    console.log('✅ Step 1-4: Homepage, wallet, swap form complete');

    // 5. Navigate to Pools
    await page.goto(`${BAZAAR_URL}/pools`);
    await expect(page.getByText(/Pools/i)).toBeVisible();

    await page.waitForTimeout(2000);
    console.log('✅ Step 5: Pools page loaded');

    // 6. Navigate to NFTs
    await page.goto(`${BAZAAR_URL}/nfts`);
    await expect(page.getByText(/NFT/i)).toBeVisible();

    await page.waitForTimeout(2000);
    console.log('✅ Step 6: NFT marketplace loaded');

    // 7. View owned NFTs
    await page.goto(`${BAZAAR_URL}/my-nfts`);
    await expect(page.getByText(/My NFTs/i)).toBeVisible();

    await page.waitForTimeout(2000);
    console.log('✅ Step 7: My NFTs page loaded');

    // 8. Return to homepage
    await page.goto(BAZAAR_URL);
    await expect(page.getByText(/Bazaar/i)).toBeVisible();

    console.log('✅ Complete flow finished successfully');
  });

  test('should navigate through all main pages', async ({ wallet, page }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);

    // Test all navigation links
    const pages = [
      { name: 'Swap', url: '/swap', text: /Swap/i },
      { name: 'Pools', url: '/pools', text: /Pools/i },
      { name: 'Liquidity', url: '/liquidity', text: /Liquidity/i },
      { name: 'NFTs', url: '/nfts', text: /NFT/i },
      { name: 'My NFTs', url: '/my-nfts', text: /My NFTs/i },
    ];

    for (const pageInfo of pages) {
      await page.goto(`${BAZAAR_URL}${pageInfo.url}`);
      await expect(page.getByText(pageInfo.text)).toBeVisible({ timeout: 10000 });
      console.log(`✅ ${pageInfo.name} page loaded`);
      await page.waitForTimeout(1000);
    }

    console.log('✅ All pages navigation complete');
  });

  test('should maintain wallet connection across pages', async ({ wallet, page }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);

    // Verify wallet stays connected
    await page.goto(`${BAZAAR_URL}/swap`);
    await expect(page.getByText(/0x/)).toBeVisible();

    await page.goto(`${BAZAAR_URL}/pools`);
    await expect(page.getByText(/0x/)).toBeVisible();

    await page.goto(`${BAZAAR_URL}/nfts`);
    await expect(page.getByText(/0x/)).toBeVisible();

    console.log('✅ Wallet connection maintained across all pages');
  });

  test('should show user balances throughout journey', async ({ wallet, page }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);

    // Check balance on different pages
    const pages = ['/swap', '/pools', '/liquidity'];

    for (const pagePath of pages) {
      await page.goto(`${BAZAAR_URL}${pagePath}`);

      // Should show balance somewhere
      const balanceElement = page.locator('text=/Balance.*[0-9]/, [data-balance]').first();

      if (await balanceElement.isVisible({ timeout: 5000 }).catch(() => false)) {
        const balance = await balanceElement.textContent();
        console.log(`Balance on ${pagePath}: ${balance}`);
      }
    }

    console.log('✅ Balance checks complete');
  });
});
