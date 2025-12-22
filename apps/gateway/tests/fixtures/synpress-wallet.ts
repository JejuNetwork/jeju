/**
 * Synpress Wallet Fixtures for Gateway Portal
 * Standalone definitions to avoid ESM/CommonJS conflicts with @jejunetwork/tests
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import type { Page } from '@playwright/test';

// ============================================================================
// CANONICAL TEST CONSTANTS
// ============================================================================

/** Standard test seed phrase (Anvil default) */
export const SEED_PHRASE = 'test test test test test test test test test test test junk';

/** Standard test wallet password for MetaMask */
export const PASSWORD = 'Tester@1234';

/** Default test wallet address (account 0 from seed phrase) */
export const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

/** Chain ID for localnet */
export const JEJU_CHAIN_ID = 1337;

/** RPC URL for localnet */
export const JEJU_RPC_URL = 'http://127.0.0.1:9545';

/** Localnet chain config for MetaMask */
export const JEJU_CHAIN = {
  chainId: JEJU_CHAIN_ID,
  chainIdHex: `0x${JEJU_CHAIN_ID.toString(16)}`,
  name: 'Jeju Localnet',
  rpcUrl: JEJU_RPC_URL,
  symbol: 'ETH',
  blockExplorerUrl: '',
} as const;

// ============================================================================
// WALLET SETUP
// ============================================================================

export interface WalletSetupResult {
  seedPhrase: string;
  walletPassword: string;
  addNetwork: boolean;
  switchToNetwork: boolean;
  chain: typeof JEJU_CHAIN;
  testWalletAddress: string;
}

export function createWalletSetup(): WalletSetupResult {
  return {
    seedPhrase: SEED_PHRASE,
    walletPassword: PASSWORD,
    addNetwork: true,
    switchToNetwork: true,
    chain: JEJU_CHAIN,
    testWalletAddress: TEST_WALLET_ADDRESS,
  };
}

// Create and export basicSetup
export const basicSetup = createWalletSetup();

// Export test with properly configured MetaMask fixtures
export const test = testWithSynpress(metaMaskFixtures(basicSetup));

// Re-export expect for convenience
export { expect } from '@playwright/test';

// Export wallet password
export const walletPassword = basicSetup.walletPassword;

// Re-export MetaMask class
export { MetaMask } from '@synthetixio/synpress/playwright';

// Default export
export default basicSetup;

// ============================================================================
// WALLET HELPERS
// ============================================================================

/** Connect wallet and verify connection */
export async function connectAndVerify(
  page: Page,
  metamask: MetaMask,
  options?: {
    connectButtonText?: string | RegExp;
    walletOptionText?: string;
    expectedAddress?: string;
    timeout?: number;
  }
): Promise<string> {
  const {
    connectButtonText = /Connect/i,
    walletOptionText = 'MetaMask',
    expectedAddress = TEST_WALLET_ADDRESS,
    timeout = 15000,
  } = options || {};

  const connectButton = page.getByRole('button', { name: connectButtonText });
  await connectButton.click({ timeout });
  await page.waitForTimeout(500);

  const metamaskOption = page.locator(`text="${walletOptionText}"`);
  if (await metamaskOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await metamaskOption.click();
  }

  await metamask.connectToDapp();

  const truncatedPrefix = expectedAddress.slice(0, 6);
  const addressLocator = page.getByText(new RegExp(truncatedPrefix, 'i'));
  await addressLocator.waitFor({ state: 'visible', timeout });

  console.log(`✅ Wallet connected and verified: ${expectedAddress}`);
  return expectedAddress;
}

/** Verify wallet is authenticated */
export async function verifyAuth(
  page: Page,
  options?: { expectedAddress?: string; timeout?: number }
): Promise<string> {
  const { expectedAddress = TEST_WALLET_ADDRESS, timeout = 15000 } = options || {};
  const truncatedPrefix = expectedAddress.slice(0, 6);
  const addressLocator = page.getByText(new RegExp(truncatedPrefix, 'i'));
  await addressLocator.waitFor({ state: 'visible', timeout });
  return expectedAddress;
}

/** Check if wallet is connected */
export async function isAuthenticated(page: Page, timeout = 5000): Promise<boolean> {
  const truncatedPrefix = TEST_WALLET_ADDRESS.slice(0, 6);
  const addressLocator = page.getByText(new RegExp(truncatedPrefix, 'i'));
  return addressLocator.isVisible({ timeout }).catch(() => false);
}

/** Verify wallet is disconnected */
export async function verifyDisconnected(
  page: Page,
  options?: { connectButtonText?: string | RegExp; timeout?: number }
): Promise<void> {
  const { connectButtonText = /Connect/i, timeout = 10000 } = options || {};
  const connectButton = page.getByRole('button', { name: connectButtonText });
  await connectButton.waitFor({ state: 'visible', timeout });
  
  const isConnected = await isAuthenticated(page, 2000);
  if (isConnected) {
    throw new Error('Expected wallet to be disconnected but found connected state');
  }
}

/** Connect wallet */
export async function connectWallet(
  page: Page,
  metamask: MetaMask,
  options?: { connectButtonText?: string | RegExp; walletOptionText?: string; timeout?: number }
): Promise<void> {
  const { connectButtonText = /Connect/i, walletOptionText = 'MetaMask', timeout = 10000 } = options || {};
  const connectButton = page.getByRole('button', { name: connectButtonText });
  await connectButton.click({ timeout });
  await page.waitForTimeout(500);
  
  const metamaskOption = page.locator(`text="${walletOptionText}"`);
  if (await metamaskOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await metamaskOption.click();
  }
  
  await metamask.connectToDapp();
}

/** Approve transaction */
export async function approveTransaction(metamask: MetaMask): Promise<void> {
  await metamask.confirmTransaction();
}

/** Sign message */
export async function signMessage(metamask: MetaMask): Promise<void> {
  await metamask.confirmSignature();
}

/** Reject transaction */
export async function rejectTransaction(metamask: MetaMask): Promise<void> {
  await metamask.rejectTransaction();
}

/** Switch network */
export async function switchNetwork(metamask: MetaMask, networkName: string): Promise<void> {
  await metamask.switchNetwork(networkName);
}

/** Get wallet address from page */
export async function getWalletAddress(page: Page): Promise<string> {
  const addressSelector = [
    '[data-testid="wallet-address"]',
    'button:has-text(/0x[a-fA-F0-9]{4,}/)',
    'span:has-text(/0x[a-fA-F0-9]{4,}/)',
    'div:has-text(/0x[a-fA-F0-9]{4,}/)',
  ].join(', ');

  const addressElement = page.locator(addressSelector).first();
  const text = await addressElement.textContent({ timeout: 5000 });

  const match = text?.match(/0x[a-fA-F0-9]{4,}/);
  if (!match) {
    throw new Error('Could not find wallet address in page');
  }
  return match[0];
}

// ============================================================================
// LEGACY EXPORTS
// ============================================================================

export const JEJU_TEST_WALLET = {
  seed: SEED_PHRASE,
  password: PASSWORD,
  address: TEST_WALLET_ADDRESS,
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

export const JEJU_NETWORK = {
  name: 'Network Local',
  networkName: 'Network Local',
  rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || JEJU_RPC_URL,
  chainId: parseInt(process.env.CHAIN_ID || String(JEJU_CHAIN_ID)),
  symbol: 'ETH',
};

