/**
 * Wallet Helpers for Synpress Tests
 * Utilities for wallet connection and management
 */

import { MetaMask } from '@synthetixio/synpress/playwright';
import { Page, BrowserContext } from '@playwright/test';
import { basicSetup } from '../../../synpress.config';

/**
 * Connect wallet to dApp using MetaMask
 */
export async function connectWallet(
  page: Page,
  metamask: MetaMask
): Promise<void> {
  // Wait for page to be ready
  await page.waitForLoadState('networkidle');

  // Find and click connect button
  const connectButton = page.locator('button:has-text("Connect")').first();
  await connectButton.click();
  await page.waitForTimeout(1000);

  // Handle MetaMask connection popup
  await metamask.connectToDapp();

  // Wait for wallet address to appear (confirms connection)
  await page.waitForSelector('button:has-text(/0x/)', { timeout: 15000 });

  console.log('✅ Wallet connected');
}

/**
 * Create MetaMask instance from context
 */
export function createMetaMask(
  context: BrowserContext,
  metamaskPage: Page,
  extensionId: string
): MetaMask {
  return new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
}

/**
 * Disconnect wallet (if UI supports it)
 */
export async function disconnectWallet(page: Page): Promise<void> {
  const walletButton = page.locator('button:has-text(/0x/)').first();
  
  if (await walletButton.isVisible()) {
    await walletButton.click();
    await page.waitForTimeout(500);

    const disconnectOption = page.getByText(/Disconnect/i);
    if (await disconnectOption.isVisible()) {
      await disconnectOption.click();
      await page.waitForTimeout(1000);
      console.log('✅ Wallet disconnected');
    }
  }
}

/**
 * Switch MetaMask network
 */
export async function switchNetwork(
  metamask: MetaMask,
  networkName: string
): Promise<void> {
  await metamask.switchNetwork(networkName);
  console.log(`✅ Switched to network: ${networkName}`);
}

/**
 * Add and switch to Jeju Localnet
 */
export async function setupJejuNetwork(metamask: MetaMask): Promise<void> {
  await metamask.addNetwork({
    networkName: 'Jeju Localnet',
    rpcUrl: 'http://127.0.0.1:9545',
    chainId: 1337,
    symbol: 'ETH',
  });

  await metamask.switchNetwork('Jeju Localnet');
  console.log('✅ Jeju Localnet configured');
}

/**
 * Get connected wallet address from UI
 */
export async function getConnectedAddress(page: Page): Promise<string | null> {
  const walletButton = page.locator('button:has-text(/0x/)').first();
  
  if (await walletButton.isVisible()) {
    const text = await walletButton.textContent();
    const match = text?.match(/(0x[a-fA-F0-9]{4,})|(0x\.\.\.[a-fA-F0-9]{4})/);
    return match ? match[1] : null;
  }
  
  return null;
}

/**
 * Check if wallet is connected
 */
export async function isWalletConnected(page: Page): Promise<boolean> {
  const walletButton = page.locator('button:has-text(/0x/)');
  return walletButton.isVisible();
}

/**
 * Wait for wallet to be connected
 */
export async function waitForConnection(
  page: Page,
  timeout: number = 15000
): Promise<void> {
  await page.waitForSelector('button:has-text(/0x/)', { timeout });
}

/**
 * Reconnect wallet after page reload
 */
export async function reconnectWallet(
  page: Page,
  metamask: MetaMask
): Promise<void> {
  const alreadyConnected = await isWalletConnected(page);

  if (!alreadyConnected) {
    await connectWallet(page, metamask);
  } else {
    console.log('ℹ️  Wallet already connected');
  }
}

/**
 * Get wallet ETH balance from RPC
 */
export async function getWalletBalance(
  page: Page,
  address: string
): Promise<bigint> {
  const response = await page.request.post('http://127.0.0.1:9545', {
    data: {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    },
  });

  const result = await response.json();
  return BigInt(result.result);
}

/**
 * Get token balance from RPC
 */
export async function getTokenBalance(
  page: Page,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const data = `0x70a08231000000000000000000000000${walletAddress.slice(2)}`;

  const response = await page.request.post('http://127.0.0.1:9545', {
    data: {
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest'],
      id: 1,
    },
  });

  const result = await response.json();
  return BigInt(result.result);
}

/**
 * Wait for balance change
 */
export async function waitForBalanceChange(
  page: Page,
  address: string,
  previousBalance: bigint,
  timeout: number = 30000
): Promise<bigint> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const currentBalance = await getWalletBalance(page, address);

    if (currentBalance !== previousBalance) {
      console.log('✅ Balance changed');
      return currentBalance;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('Timeout waiting for balance change');
}

