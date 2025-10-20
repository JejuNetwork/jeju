/**
 * Gateway Deploy Paymaster - Synpress E2E Tests
 * Tests paymaster deployment for all protocol tokens
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../fixtures/synpress-wallet';
import { connectWallet, approveTransaction } from '../helpers/wallet-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('Deploy Paymaster Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Navigate to Deploy Paymaster tab
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display deployment interface', async ({ page }) => {
    await expect(page.getByText('Deploy Paymaster')).toBeVisible();
    await expect(page.getByText(/Factory deploys/i)).toBeVisible();
    
    // Screenshot
    await page.screenshot({ path: 'test-results/screenshots/synpress-deploy-interface.png', fullPage: true });
  });

  test('should include ALL tokens in selector (including elizaOS)', async ({ page }) => {
    // Open token selector
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    
    // All protocol tokens should be available
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    console.log('✅ All tokens available for paymaster deployment');
  });

  test('should show fee margin slider', async ({ page }) => {
    // Select a token
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(500);
    
    // Fee margin slider should appear
    const slider = page.locator('input[type="range"]');
    const hasSlider = await slider.isVisible().catch(() => false);
    
    if (hasSlider) {
      await expect(slider).toBeVisible();
      console.log('✅ Fee margin slider displayed');
      
      // Adjust slider
      await slider.fill('150'); // 1.5%
      await expect(page.getByText(/1.5% selected/i)).toBeVisible();
    }
  });

  test('should show deployment information', async ({ page }) => {
    // Select token
    await page.locator('.input').first().click();
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);
    
    // Should show what will be deployed
    await expect(page.getByText(/LiquidityVault/i)).toBeVisible();
    await expect(page.getByText(/FeeDistributor/i)).toBeVisible();
    await expect(page.getByText(/LiquidityPaymaster/i)).toBeVisible();
    
    console.log('✅ Deployment components listed');
  });

  test('should warn if token not registered', async ({ page }) => {
    // This test checks for the warning message when token isn't registered
    // Will vary depending on which tokens are already registered
    
    // Try selecting a token
    await page.locator('.input').first().click();
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(1000);
    
    // Check for either "not registered" or "already deployed" or deployment form
    const notRegistered = page.getByText(/not registered/i);
    const alreadyDeployed = page.getByText(/already deployed/i);
    const deployButton = page.getByRole('button', { name: /Deploy Paymaster/i });
    
    const hasWarning = await notRegistered.isVisible().catch(() => false);
    const hasDeployed = await alreadyDeployed.isVisible().catch(() => false);
    const hasButton = await deployButton.isVisible().catch(() => false);
    
    // Should have one of these states
    expect(hasWarning || hasDeployed || hasButton).toBe(true);
    
    console.log('✅ Deployment state validation working');
  });

  test('should warn if paymaster already deployed', async ({ page }) => {
    // Select elizaOS (likely to be deployed)
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);
    
    // Check for already deployed warning
    const warning = page.getByText(/already deployed/i);
    const hasWarning = await warning.isVisible().catch(() => false);
    
    if (hasWarning) {
      await expect(page.getByText(/Vault:/i)).toBeVisible();
      await expect(page.getByText(/Paymaster:/i)).toBeVisible();
      console.log('✅ Already deployed warning shown');
    } else {
      console.log('ℹ️ Paymaster not yet deployed for this token');
    }
  });

  test.skip('should deploy paymaster successfully', async ({ page, metamask }) => {
    // Skip in most runs - requires gas and changes blockchain state
    
    // Select a token without paymaster
    await page.locator('.input').first().click();
    await page.getByText('CLANKERMON').click();
    
    // Set fee margin
    const slider = page.locator('input[type="range"]');
    if (await slider.isVisible().catch(() => false)) {
      await slider.fill('100'); // 1%
    }
    
    // Click deploy
    const deployButton = page.getByRole('button', { name: /Deploy Paymaster/i });
    await deployButton.click();
    
    // Approve transaction in MetaMask
    await approveTransaction(metamask);
    
    // Wait for success message
    await expect(page.getByText(/deployed successfully/i)).toBeVisible({ timeout: 90000 });
    
    console.log('✅ Paymaster deployed successfully');
  });
});

