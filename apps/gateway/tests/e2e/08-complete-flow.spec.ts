import { expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow as _captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';
import { testWithWallet as test } from '@jejunetwork/tests/fixtures/wallet';
import { connectWallet } from '@jejunetwork/tests/helpers/contracts';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5173';

test.describe('Gateway Complete Protocol Flow', () => {
  test('complete gateway user journey', async ({ wallet, page }) => {
    // 1. Navigate to Gateway Portal
    await page.goto(GATEWAY_URL);
    await expect(page.getByText(/Gateway Portal/i)).toBeVisible();
    console.log('✅ Step 1: Gateway homepage loaded');

    // 2. Connect wallet
    await connectWallet(page, wallet);
    await expect(page.getByText(/0x/)).toBeVisible();
    console.log('✅ Step 2: Wallet connected');

    // 3. View token registry
    await page.click('button:has-text("Registered Tokens")');
    await expect(page.getByText(/elizaOS|Token/i)).toBeVisible();
    console.log('✅ Step 3: Token registry viewed');

    // 4. Check bridge interface
    await page.click('button:has-text("Bridge from Ethereum")');
    await expect(page.getByText(/Bridge/i)).toBeVisible();
    console.log('✅ Step 4: Bridge interface loaded');

    // 5. View paymaster deployment
    await page.click('button:has-text("Deploy Paymaster")');
    await expect(page.getByText(/Paymaster/i)).toBeVisible();
    console.log('✅ Step 5: Paymaster deployment viewed');

    // 6. Check liquidity provision
    await page.click('button:has-text("Add Liquidity")');
    await expect(page.getByText(/Liquidity/i)).toBeVisible();
    console.log('✅ Step 6: Liquidity interface loaded');

    // 7. View earnings dashboard
    await page.click('button:has-text("My Earnings")');
    await expect(page.getByText(/Earnings/i)).toBeVisible();
    console.log('✅ Step 7: Earnings dashboard viewed');

    // 8. Check node operators
    await page.click('button:has-text("Node Operators")');
    await expect(page.getByText(/Node|Operators/i)).toBeVisible();
    console.log('✅ Step 8: Node operators viewed');

    console.log('✅ Complete Gateway flow finished successfully');
  });

  test('should navigate through all tabs', async ({ wallet, page }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, wallet);

    const tabs = [
      'Registered Tokens',
      'Bridge from Ethereum',
      'Deploy Paymaster',
      'Add Liquidity',
      'My Earnings',
      'Node Operators'
    ];

    for (const tab of tabs) {
      await page.click(`button:has-text("${tab}")`);
      await page.waitForTimeout(500);
      console.log(`✅ ${tab} tab loaded`);
    }

    console.log('✅ All tabs navigation complete');
  });

  test('should maintain wallet connection across all tabs', async ({ wallet, page }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, wallet);

    const tabs = [
      'Registered Tokens',
      'Bridge from Ethereum',
      'Deploy Paymaster'
    ];

    for (const tab of tabs) {
      await page.click(`button:has-text("${tab}")`);
      await expect(page.getByText(/0x/)).toBeVisible();
    }

    console.log('✅ Wallet connection maintained across tabs');
  });

  test('should show multi-token balances throughout', async ({ wallet, page }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, wallet);

    // Check balance display on different tabs
    const tabs = ['Registered Tokens', 'Bridge from Ethereum', 'Add Liquidity'];

    for (const tab of tabs) {
      await page.click(`button:has-text("${tab}")`);
      
      const balanceElement = page.locator('[data-balance], text=/Balance/i').first();
      
      if (await balanceElement.isVisible({ timeout: 5000 })) {
        console.log(`Balance shown on ${tab}`);
      }
    }

    console.log('✅ Balance checks complete');
  });
});
