import { expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('Gateway Wallet Connection', () => {
  test('should display homepage and connect wallet with screenshots', async ({ page, wallet }) => {
    // Screenshot 1: Navigate to homepage
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: 'test-results/screenshots/01-homepage.png', fullPage: true });
    console.log('📸 Screenshot 1: Homepage');
    
    await expect(page.getByText(/Gateway Portal|Protocol Infrastructure/i)).toBeVisible();
    
    // Screenshot 2: Before connection
    await page.screenshot({ path: 'test-results/screenshots/02-before-connect.png', fullPage: true });
    console.log('📸 Screenshot 2: Before connection');
    
    // Screenshot 3: Connect wallet
    await connectWallet(page, wallet);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/screenshots/03-wallet-connected.png', fullPage: true });
    console.log('📸 Screenshot 3: Wallet connected');
    
    await expect(page.getByText(/0x/)).toBeVisible({ timeout: 10000 });
  });

  test('should display multi-token balances with screenshots', async ({ page, wallet }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, wallet);
    
    // Wait for balances to load
    await page.waitForTimeout(3000);
    
    // Screenshot 4: Token balances
    await page.screenshot({ path: 'test-results/screenshots/04-token-balances.png', fullPage: true });
    console.log('📸 Screenshot 4: Token balances');
    
    // Verify all tokens visible
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    // Screenshot 5: Close-up of balances
    const balanceCard = page.locator('text=Token Balances').locator('..');
    await balanceCard.screenshot({ path: 'test-results/screenshots/05-balance-card.png' });
    console.log('📸 Screenshot 5: Balance card detail');
  });

  test('should navigate all tabs with screenshots', async ({ page, wallet }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, wallet);
    
    const tabs = [
      'Registered Tokens',
      'Bridge from Base',
      'Deploy Paymaster',
      'Add Liquidity',
      'My Earnings',
      'Node Operators',
      'App Registry'
    ];
    
    for (let i = 0; i < tabs.length; i++) {
      await page.getByRole('button', { name: tabs[i] }).click();
      await page.waitForTimeout(1000);
      await page.screenshot({ 
        path: `test-results/screenshots/06-tab-${i + 1}-${tabs[i].toLowerCase().replace(/\s+/g, '-')}.png`, 
        fullPage: true 
      });
      console.log(`📸 Screenshot ${6 + i}: ${tabs[i]} tab`);
    }
    
    // Verify all tabs are clickable
    await expect(page.getByText('Registered Tokens')).toBeVisible();
  });
});
