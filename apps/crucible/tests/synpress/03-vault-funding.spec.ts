/**
 * Vault Funding Tests
 * Tests agent vault funding and balance management
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Vault Funding', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();
    await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
  });

  test('should display vault balance', async ({ page }) => {
    // Navigate to agent detail
    const agentCard = page.getByTestId('agent-card').first();
    await agentCard.click();
    
    const vaultBalance = page.getByTestId('vault-balance');
    await expect(vaultBalance).toBeVisible();
    await expect(vaultBalance).toContainText('ETH');
  });

  test('should show fund vault dialog', async ({ page }) => {
    const agentCard = page.getByTestId('agent-card').first();
    await agentCard.click();
    
    await page.getByTestId('fund-vault-btn').click();
    
    const fundDialog = page.getByTestId('fund-dialog');
    await expect(fundDialog).toBeVisible();
    
    const amountInput = page.getByTestId('fund-amount-input');
    await expect(amountInput).toBeVisible();
  });

  test('should fund vault with ETH', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    const agentCard = page.getByTestId('agent-card').first();
    await agentCard.click();
    
    // Get initial balance
    const initialBalance = await page.getByTestId('vault-balance').textContent();
    
    // Fund vault
    await page.getByTestId('fund-vault-btn').click();
    await page.getByTestId('fund-amount-input').fill('0.01');
    await page.getByTestId('confirm-fund-btn').click();
    
    // Confirm transaction in MetaMask
    await metamask.confirmTransaction();
    
    // Wait for transaction confirmation
    await page.waitForTimeout(5000);
    
    // Verify balance updated
    const newBalance = await page.getByTestId('vault-balance').textContent();
    expect(newBalance).not.toBe(initialBalance);
  });

  test('should show spend limit', async ({ page }) => {
    const agentCard = page.getByTestId('agent-card').first();
    await agentCard.click();
    
    const spendLimit = page.getByTestId('spend-limit');
    await expect(spendLimit).toBeVisible();
  });

  test('should update spend limit', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    const agentCard = page.getByTestId('agent-card').first();
    await agentCard.click();
    
    await page.getByTestId('edit-spend-limit-btn').click();
    await page.getByTestId('spend-limit-input').fill('0.05');
    await page.getByTestId('confirm-spend-limit-btn').click();
    
    // Confirm transaction
    await metamask.confirmTransaction();
    
    // Verify limit updated
    const spendLimit = page.getByTestId('spend-limit');
    await expect(spendLimit).toContainText('0.05', { timeout: 15000 });
  });

  test('should show transaction history', async ({ page }) => {
    const agentCard = page.getByTestId('agent-card').first();
    await agentCard.click();
    
    await page.getByTestId('transaction-history-tab').click();
    
    const txList = page.getByTestId('transaction-list');
    await expect(txList).toBeVisible();
  });

  test('should show low balance warning', async ({ page }) => {
    // Find agent with low balance
    const agentCard = page.getByTestId('agent-card-low-balance').first();
    if (await agentCard.isVisible()) {
      const warningBadge = agentCard.getByTestId('low-balance-warning');
      await expect(warningBadge).toBeVisible();
    }
  });
});
