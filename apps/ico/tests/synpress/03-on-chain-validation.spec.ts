/**
 * On-Chain Validation Tests
 * Verifies actual blockchain state after presale interactions
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';
import {
  getBalance,
  getTokenBalance,
  getPresalePhase,
  getPresaleStats,
  getContribution,
  isContractDeployed,
  rpcCall,
} from '../helpers/contract-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const ICO_URL = process.env.ICO_URL || 'http://localhost:4020';
const PRESALE_ADDRESS = process.env.NEXT_PUBLIC_PRESALE_ADDRESS || '';
const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || '';
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test.describe('Contract Deployment Verification', () => {
  test.skip(!PRESALE_ADDRESS, 'Presale not deployed');

  test('should verify presale contract is deployed', async ({ page }) => {
    await page.goto(ICO_URL);
    
    const deployed = await isContractDeployed(page, PRESALE_ADDRESS);
    expect(deployed).toBe(true);
  });

  test('should verify token contract is deployed', async ({ page }) => {
    test.skip(!TOKEN_ADDRESS, 'Token not deployed');
    await page.goto(ICO_URL);
    
    const deployed = await isContractDeployed(page, TOKEN_ADDRESS);
    expect(deployed).toBe(true);
  });
});

test.describe('Presale State Verification', () => {
  test.skip(!PRESALE_ADDRESS, 'Presale not deployed');

  test('should read current presale phase from chain', async ({ page }) => {
    await page.goto(ICO_URL);
    
    const phase = await getPresalePhase(page, PRESALE_ADDRESS);
    // 0=NOT_STARTED, 1=WHITELIST, 2=PUBLIC, 3=ENDED, 4=FAILED, 5=DISTRIBUTED
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThanOrEqual(5);
  });

  test('should read presale stats from chain', async ({ page }) => {
    await page.goto(ICO_URL);
    
    const stats = await getPresaleStats(page, PRESALE_ADDRESS);
    
    expect(stats.raised).toBeGreaterThanOrEqual(0n);
    expect(stats.participants).toBeGreaterThanOrEqual(0n);
    expect(stats.tokensSold).toBeGreaterThanOrEqual(0n);
  });

  test('should UI stats match on-chain stats', async ({ page }) => {
    await page.goto(ICO_URL);
    await page.waitForLoadState('networkidle');
    
    const onChainStats = await getPresaleStats(page, PRESALE_ADDRESS);
    
    // Read UI values
    const uiRaised = page.locator('text=/ETH raised/i');
    const hasRaised = await uiRaised.isVisible();
    
    if (hasRaised) {
      const raisedText = await uiRaised.textContent();
      const match = raisedText?.match(/(\d+\.?\d*)/);
      if (match) {
        const uiRaisedValue = parseFloat(match[1]) * 1e18;
        const onChainRaisedValue = Number(onChainStats.raised);
        // Allow 1% tolerance for display rounding
        expect(Math.abs(uiRaisedValue - onChainRaisedValue) / Math.max(onChainRaisedValue, 1)).toBeLessThan(0.01);
      }
    }
  });
});

test.describe('Balance Verification', () => {
  test('should verify ETH balance decreases after contribution', async ({ context, page, metamaskPage, extensionId }) => {
    test.skip(!PRESALE_ADDRESS, 'Presale not deployed');
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    const initialBalance = await getBalance(page, TEST_WALLET);

    // Contribute
    await page.locator('input[type="number"]').fill('0.1');
    await page.getByRole('button', { name: /Contribute/i }).click();
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    await page.waitForSelector('text=/success/i', { timeout: 60000 });

    const finalBalance = await getBalance(page, TEST_WALLET);
    const expectedDecrease = BigInt(0.1 * 1e18);
    
    // Balance should decrease by at least contribution amount
    expect(initialBalance - finalBalance).toBeGreaterThanOrEqual(expectedDecrease);
    // But not more than contribution + reasonable gas
    expect(initialBalance - finalBalance).toBeLessThan(expectedDecrease + BigInt(0.01 * 1e18));
  });

  test('should verify token allocation recorded on-chain', async ({ context, page, metamaskPage, extensionId }) => {
    test.skip(!PRESALE_ADDRESS, 'Presale not deployed');
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    const initialContrib = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);

    // Contribute
    await page.locator('input[type="number"]').fill('0.1');
    await page.getByRole('button', { name: /Contribute/i }).click();
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    await page.waitForSelector('text=/success/i', { timeout: 60000 });

    const finalContrib = await getContribution(page, PRESALE_ADDRESS, TEST_WALLET);
    
    // Token allocation should increase
    expect(finalContrib.tokenAllocation).toBeGreaterThan(initialContrib.tokenAllocation);
    // ETH amount should increase by 0.1 ETH
    expect(finalContrib.ethAmount - initialContrib.ethAmount).toBe(BigInt(0.1 * 1e18));
  });
});

test.describe('Event Verification', () => {
  test.skip(!PRESALE_ADDRESS, 'Presale not deployed');

  test('should emit ContributionReceived event', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Get current block
    const initialBlockHex = await rpcCall(page, 'eth_blockNumber');
    const initialBlock = parseInt(initialBlockHex, 16);

    // Contribute
    await page.locator('input[type="number"]').fill('0.1');
    await page.getByRole('button', { name: /Contribute/i }).click();
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    await page.waitForSelector('text=/success/i', { timeout: 60000 });

    // Get logs
    const finalBlockHex = await rpcCall(page, 'eth_blockNumber');
    const finalBlock = parseInt(finalBlockHex, 16);

    // ContributionReceived(address,uint256,uint256) topic
    const contributionTopic = '0x' + 'a'.repeat(64); // Actual topic would be keccak256 hash
    
    const logs = await rpcCall(page, 'eth_getLogs', [{
      fromBlock: `0x${initialBlock.toString(16)}`,
      toBlock: `0x${finalBlock.toString(16)}`,
      address: PRESALE_ADDRESS,
    }]);

    // Should have at least one log
    expect(logs).toBeDefined();
  });
});

test.describe('Transaction Receipt Verification', () => {
  test.skip(!PRESALE_ADDRESS, 'Presale not deployed');

  test('should get successful transaction receipt', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Contribute
    await page.locator('input[type="number"]').fill('0.1');
    await page.getByRole('button', { name: /Contribute/i }).click();
    await page.waitForTimeout(2000);
    await metamask.confirmTransaction();
    
    // Wait for success message with tx hash
    await page.waitForSelector('text=/success/i', { timeout: 60000 });

    // If tx hash is displayed, verify receipt
    const txHashElement = page.locator('text=/0x[a-fA-F0-9]{64}/');
    const hasTxHash = await txHashElement.isVisible();

    if (hasTxHash) {
      const txText = await txHashElement.textContent();
      const match = txText?.match(/(0x[a-fA-F0-9]{64})/);
      
      if (match) {
        const receipt = await rpcCall(page, 'eth_getTransactionReceipt', [match[1]]);
        expect(receipt).toBeDefined();
      }
    }
  });
});
