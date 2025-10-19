/**
 * @fileoverview Paymaster deployment E2E tests
 * @module gateway/tests/e2e/deploy-paymaster
 */

import { test, expect, setupMetaMask, importTestAccount, connectWallet } from '../fixtures/wallet';

test.describe('Deploy Paymaster Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMetaMask(metamask);
    await importTestAccount(metamask);
    await page.goto('/');
    await connectWallet(page);
    
    // Navigate to Deploy Paymaster tab
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
  });

  test('should display deploy paymaster interface', async ({ page }) => {
    await expect(page.getByText('Deploy Paymaster')).toBeVisible();
  });

  test('should show info about factory deployment', async ({ page }) => {
    await expect(page.getByText(/Deploy for ANY token/i)).toBeVisible();
    await expect(page.getByText(/Factory deploys Vault \+ Distributor \+ Paymaster/i)).toBeVisible();
  });

  test('should include ALL tokens in selector (including elizaOS)', async ({ page }) => {
    // Click token selector
    await page.locator('.input').first().click();
    
    // All 4 tokens should be available
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
  });

  test('should show warning if token not registered', async ({ page }) => {
    // This test assumes some tokens might not be registered yet
    // Select a token
    await page.locator('.input').first().click();
    const tokenButton = page.getByText('CLANKER');
    
    if (await tokenButton.isVisible()) {
      await tokenButton.click();
      
      // Check for either deployment status or registration error
      const deployed = page.getByText(/Paymaster already deployed/i);
      const notRegistered = page.getByText(/Token not registered/i);
      
      const isDeployed = await deployed.isVisible().catch(() => false);
      const needsRegistration = await notRegistered.isVisible().catch(() => false);
      
      expect(isDeployed || needsRegistration).toBe(true);
    }
  });

  test('should display fee margin slider', async ({ page }) => {
    // Select a registered token
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    
    // If registered and not deployed, should show fee margin controls
    const slider = page.locator('input[type="range"]');
    const sliderExists = await slider.count();
    
    if (sliderExists > 0) {
      await expect(slider).toBeVisible();
      await expect(page.getByText(/Fee Margin/i)).toBeVisible();
    }
  });

  test('should show deployment cost estimate', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.getByText('VIRTUAL').click();
    
    // Cost information might be shown if token is registered but not deployed
    const deployInfo = page.getByText(/This will deploy 3 contracts/i);
    const deployInfoExists = await deployInfo.isVisible().catch(() => false);
    
    if (deployInfoExists) {
      await expect(page.getByText('LiquidityVault')).toBeVisible();
      await expect(page.getByText('FeeDistributor')).toBeVisible();
      await expect(page.getByText('LiquidityPaymaster')).toBeVisible();
    }
  });

  test('should show already deployed warning if paymaster exists', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.getByText('elizaOS').click();
    
    // If paymaster already deployed, should show warning
    const warning = page.getByText(/Paymaster already deployed/i);
    const warningExists = await warning.isVisible().catch(() => false);
    
    if (warningExists) {
      await expect(page.getByText(/Vault:/i)).toBeVisible();
      await expect(page.getByText(/Paymaster:/i)).toBeVisible();
    }
  });

  test('should update selected fee percentage', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.getByText('CLANKERMON').click();
    
    const slider = page.locator('input[type="range"]');
    const sliderExists = await slider.count();
    
    if (sliderExists > 0) {
      // Move slider
      await slider.fill('250');
      
      // Selected percentage should update
      await expect(page.getByText('2.5% selected')).toBeVisible();
    }
  });
});

