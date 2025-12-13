/**
 * Gateway Bridge Tokens - Synpress E2E Tests
 * Tests token bridging from Ethereum to Jeju
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../fixtures/synpress-wallet';
import { connectWallet, approveTransaction } from '../helpers/wallet-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('Bridge from Ethereum Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Navigate to Bridge tab
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display bridge interface', async ({ page }) => {
    await expect(page.getByText('Bridge from Ethereum to Jeju')).toBeVisible();
    
    // Screenshot
    await page.screenshot({ path: 'test-results/screenshots/synpress-bridge-interface.png', fullPage: true });
  });

  test('should show elizaOS warning (native token)', async ({ page }) => {
    // elizaOS is native Jeju and should not be bridgeable
    await expect(page.getByText(/elizaOS is a native Jeju token/i)).toBeVisible();
    await expect(page.getByText(/cannot be bridged from Ethereum/i)).toBeVisible();
    
    console.log('✅ Native token warning displayed');
  });

  test('should only show bridgeable tokens', async ({ page }) => {
    // Open token selector
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    
    // Should show Base tokens
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    // Should NOT show elizaOS
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'CLANKER' });
    const hasElizaOS = await dropdown.getByText('elizaOS').isVisible();
    expect(hasElizaOS).toBe(false);
    
    console.log('✅ Only bridgeable tokens shown');
  });

  test('should allow custom token address', async ({ page }) => {
    // Switch to custom mode
    await page.getByRole('button', { name: /Custom Address/i }).click();
    
    // Custom address input should appear
    await expect(page.getByPlaceholder('0x...')).toBeVisible();
    await expect(page.getByText(/Enter any ERC20 token address/i)).toBeVisible();
    
    // Enter custom address
    const customInput = page.getByPlaceholder('0x...');
    await customInput.fill('0x1234567890123456789012345678901234567890');
    
    console.log('✅ Custom token address mode works');
  });

  test('should validate amount input and show USD value', async ({ page }) => {
    // Select token
    await page.locator('.input').first().click();
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);
    
    // Enter amount
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('100');
    
    // USD value should be calculated
    await expect(page.getByText(/≈ \$/)).toBeVisible({ timeout: 5000 });
    
    console.log('✅ Amount validation and USD calculation working');
  });

  test('should show bridge transaction details', async ({ page }) => {
    await expect(page.getByText(/Estimated Time/i)).toBeVisible();
    await expect(page.getByText(/~2 minutes/i)).toBeVisible();
    await expect(page.getByText(/OP Stack Standard Bridge/i)).toBeVisible();
    
    console.log('✅ Bridge details displayed');
  });

  test('should handle optional recipient address', async ({ page }) => {
    // Select token and amount
    await page.locator('.input').first().click();
    await page.getByText('VIRTUAL').click();
    await page.getByPlaceholder('0.0').fill('50');
    
    // Recipient should be optional
    const recipientInput = page.getByPlaceholder(/0x.../);
    await expect(recipientInput).toBeVisible();
    
    // Bridge button should be enabled without recipient
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeEnabled();
    
    console.log('✅ Optional recipient works');
  });

  test.skip('should execute bridge transaction', async ({ page, metamask }) => {
    // Skip in CI - requires real tokens and Base connection
    
    // Select token
    await page.locator('.input').first().click();
    await page.getByText('CLANKERMON').click();
    
    // Enter amount
    await page.getByPlaceholder('0.0').fill('1');
    
    // Click bridge
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await bridgeButton.click();
    
    // Approve in MetaMask
    await approveTransaction(metamask);
    
    // Wait for success message
    await expect(page.getByText(/Bridge transaction submitted/i)).toBeVisible({ timeout: 60000 });
    
    console.log('✅ Bridge transaction executed');
  });
});

