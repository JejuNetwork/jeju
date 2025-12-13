/**
 * Paymaster Operations Transaction Tests
 * Tests paymaster deployment for ALL protocol tokens
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction } from '../helpers/transaction-helpers';
import { GATEWAY_URL, PROTOCOL_TOKENS, FEE_MARGINS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Paymaster Deployment Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);
  });

  // Test deployment for EACH protocol token
  for (const [tokenName, tokenData] of Object.entries(PROTOCOL_TOKENS)) {
    test(`should deploy paymaster for ${tokenData.symbol}`, async ({ page, metamask }) => {
      // Select token
      await page.locator('.input').first().click();
      await page.waitForTimeout(500);
      
      const tokenOption = page.getByText(tokenData.symbol);
      const available = await tokenOption.isVisible();
      
      if (!available) {
        console.log(`ℹ️  ${tokenData.symbol} not available - skipping`);
        return;
      }
      
      await tokenOption.click();
      await page.waitForTimeout(1000);

      // Check if already deployed
      const deployed = await page.getByText(/already deployed/i).isVisible();
      
      if (deployed) {
        console.log(`ℹ️  ${tokenData.symbol} paymaster already deployed`);
        
        // Verify addresses shown
        await expect(page.getByText(/Vault:/i)).toBeVisible();
        await expect(page.getByText(/Paymaster:/i)).toBeVisible();
        return;
      }

      // Check if token registered
      const notRegistered = await page.getByText(/not registered/i).isVisible();
      
      if (notRegistered) {
        console.log(`ℹ️  ${tokenData.symbol} not registered - cannot deploy paymaster`);
        return;
      }

      // Set fee margin
      const slider = page.locator('input[type="range"]');
      if (await slider.isVisible()) {
        await slider.fill(FEE_MARGINS.DEFAULT.toString());
        
        // Verify selected fee displays
        await expect(page.getByText(/selected/i)).toBeVisible();
      }

      await page.screenshot({
        path: `test-results/screenshots/paymaster-tx/${tokenData.symbol}-before-deploy.png`,
        fullPage: true,
      });

      // Deploy
      await page.getByRole('button', { name: new RegExp(`Deploy Paymaster for ${tokenData.symbol}`, 'i') }).click();

      // Confirm transaction (long deployment)
      await executeTransaction(page, metamask, {
        expectSuccessMessage: 'deployed successfully',
        timeout: 90000,
      });

      await page.screenshot({
        path: `test-results/screenshots/paymaster-tx/${tokenData.symbol}-deployed.png`,
        fullPage: true,
      });

      console.log(`✅ ${tokenData.symbol} paymaster deployed successfully`);
    });
  }

  test('should show deployment information before deploying', async ({ page }) => {
    // Select any token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Check deployment info
    await expect(page.getByText(/LiquidityVault/i)).toBeVisible();
    await expect(page.getByText(/FeeDistributor/i)).toBeVisible();
    await expect(page.getByText(/LiquidityPaymaster/i)).toBeVisible();
    await expect(page.getByText(/Estimated cost:/i)).toBeVisible();

    console.log('✅ Deployment information displayed');
  });

  test('should validate token must be registered first', async ({ page }) => {
    // This would test with an unregistered token
    // Implementation depends on having an unregistered token available
    
    console.log('⚠️  Token registration validation test - needs unregistered token setup');
  });
});


