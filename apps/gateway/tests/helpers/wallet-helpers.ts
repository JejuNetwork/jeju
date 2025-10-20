/**
 * Wallet interaction helpers for Synpress tests
 */

import { MetaMask } from '@synthetixio/synpress/playwright';
import { Page } from '@playwright/test';

/**
 * Connect wallet to dApp via RainbowKit
 */
export async function connectWallet(page: Page, metamask: MetaMask): Promise<void> {
  // Click Connect button
  const connectButton = page.locator('button:has-text("Connect")').first();
  await connectButton.click();
  
  // Wait for wallet modal
  await page.waitForTimeout(1000);
  
  // Look for MetaMask option
  const metaMaskOption = page.locator('text="MetaMask"');
  const isVisible = await metaMaskOption.isVisible({ timeout: 5000 });
  
  if (isVisible) {
    await metaMaskOption.click();
  }
  
  // Connect in MetaMask
  await metamask.connectToDapp();
  
  // Wait for connection confirmation
  await page.waitForSelector('button:has-text(/0x/)', { timeout: 15000 });
  
  console.log('✅ Wallet connected successfully');
}

/**
 * Approve transaction in MetaMask
 */
export async function approveTransaction(metamask: MetaMask): Promise<void> {
  await metamask.confirmTransaction();
  console.log('✅ Transaction approved');
}

/**
 * Reject transaction in MetaMask
 */
export async function rejectTransaction(metamask: MetaMask): Promise<void> {
  await metamask.rejectTransaction();
  console.log('❌ Transaction rejected');
}

/**
 * Sign message in MetaMask
 */
export async function signMessage(metamask: MetaMask): Promise<void> {
  await metamask.confirmSignature();
  console.log('✅ Message signed');
}

/**
 * Switch network in MetaMask
 */
export async function switchNetwork(metamask: MetaMask, networkName: string): Promise<void> {
  await metamask.switchNetwork(networkName);
  console.log(`✅ Switched to ${networkName}`);
}

/**
 * Get current account address from MetaMask
 */
export async function getWalletAddress(page: Page): Promise<string> {
  // Extract address from connected wallet display
  const addressElement = page.locator('button:has-text(/0x/)').first();
  const text = await addressElement.textContent();
  const match = text?.match(/(0x[a-fA-F0-9]{40})/);
  return match ? match[1] : '';
}

/**
 * Wait for transaction confirmation on page
 */
export async function waitForTransactionSuccess(page: Page, timeout: number = 30000): Promise<void> {
  await page.waitForSelector('text=/success|confirmed|complete/i', { timeout });
  console.log('✅ Transaction confirmed on page');
}

/**
 * Check wallet balance
 */
export async function checkBalance(page: Page, expectedToken?: string): Promise<void> {
  if (expectedToken) {
    await page.waitForSelector(`text=${expectedToken}`, { timeout: 10000 });
  }
  await page.waitForSelector('text=/balance|\\$/i', { timeout: 10000 });
  console.log('✅ Balance loaded');
}

