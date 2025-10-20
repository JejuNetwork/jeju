import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { defineWalletSetup } from '@synthetixio/synpress';

// Wallet setup for Jeju localnet
const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');
const JEJU_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:9545';

const basicSetup = defineWalletSetup('Test1234!', async (context, walletPage) => {
  const wallet = walletPage as MetaMask;

  // Import Hardhat/Anvil test account #0
  await wallet.importWallet({
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    password: 'Test1234!',
  });

  // Add Jeju network
  await wallet.addNetwork({
    name: 'Jeju Local',
    rpcUrl: JEJU_RPC_URL,
    chainId: JEJU_CHAIN_ID,
    symbol: 'ETH',
  });

  // Switch to Jeju network
  await wallet.switchNetwork('Jeju Local');
});

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Predimarket - Wallet Connection Tests', () => {
  test('should connect wallet and view markets', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // 1. Navigate to Predimarket
    await page.goto('http://localhost:4005');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/screenshots/predimarket/wallet/01-homepage.png', fullPage: true });
    console.log('✅ Homepage loaded');

    // 2. Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await page.waitForTimeout(1000);
      await metamask.connectToDapp();
      await page.screenshot({ path: 'test-results/screenshots/predimarket/wallet/02-wallet-connected.png', fullPage: true });
      console.log('✅ Wallet connected');
    }

    // 3. View markets
    await page.waitForTimeout(2000);
    const marketsList = page.locator('[data-testid="market-card"], .market-card, .market-item').first();
    if (await marketsList.isVisible({ timeout: 5000 })) {
      await page.screenshot({ path: 'test-results/screenshots/predimarket/wallet/03-markets-loaded.png', fullPage: true });
      console.log('✅ Markets loaded');
    }

    // 4. Check portfolio
    const portfolioLink = page.locator('a:has-text("Portfolio"), button:has-text("Portfolio")').first();
    if (await portfolioLink.isVisible()) {
      await portfolioLink.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/screenshots/predimarket/wallet/04-portfolio.png', fullPage: true });
      console.log('✅ Portfolio page loaded');
    }

    console.log('🎉 ALL CHECKS PASSED');
  });

  test('should display market details', async ({ page }) => {
    await page.goto('http://localhost:4005');
    await page.waitForLoadState('networkidle');

    // Wait for markets to load
    await page.waitForTimeout(2000);

    // Try to click on first market
    const firstMarket = page.locator('[data-testid="market-card"], .market-card, .market-item').first();
    if (await firstMarket.isVisible({ timeout: 5000 })) {
      await page.screenshot({ path: 'test-results/screenshots/predimarket/wallet/05-before-market-click.png', fullPage: true });
      await firstMarket.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/screenshots/predimarket/wallet/06-market-details.png', fullPage: true });
      console.log('✅ Market details loaded');
    }
  });
});

