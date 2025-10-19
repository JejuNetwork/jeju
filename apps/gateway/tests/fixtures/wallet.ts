/**
 * @fileoverview MetaMask wallet fixtures for E2E testing
 * @module gateway/tests/fixtures/wallet
 * 
 * Note: Using Playwright test without MetaMask automation for now
 * MetaMask automation can be added with @synthetixio/synpress-metamask
 * but requires Cypress integration. For pure Playwright, we test the UI flows
 * and validate contract interactions programmatically in separate tests.
 */

import { test as base, expect as baseExpect } from '@playwright/test';

export const test = base;
export const expect = baseExpect;

// Test wallet configuration
export const TEST_WALLET = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil test account 0
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  network: {
    chainId: 1337,
    name: 'Jeju Localnet',
    rpcUrl: 'http://127.0.0.1:9545',
  },
};

export const SECOND_TEST_WALLET = {
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Anvil test account 1
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
};

/**
 * Setup MetaMask with Jeju Localnet
 * Note: Manual MetaMask setup required for now
 */
export async function setupMetaMask(_metamask?: unknown) {
  // Manual setup: Users should have MetaMask installed and configured
  // with Jeju Localnet before running E2E tests
  console.log('MetaMask should be pre-configured with Jeju Localnet (Chain ID 1337, RPC http://127.0.0.1:9545)');
}

/**
 * Import test account into MetaMask
 * Note: Manual import required
 */
export async function importTestAccount(_metamask?: unknown, _privateKey?: string) {
  // Manual: Import TEST_WALLET.privateKey into MetaMask before running tests
  console.log(`Import private key into MetaMask: ${TEST_WALLET.privateKey}`);
}

/**
 * Connect wallet to dApp
 * Note: Manual connection for E2E tests
 */
export async function connectWallet(page: any, _metamask?: unknown) {
  // For E2E tests, testers will manually connect MetaMask
  // We validate the UI state transitions
  await page.goto('/');
  
  // Check if already connected (MetaMask auto-connects in testing)
  const connectButton = page.getByRole('button', { name: /connect/i });
  const isVisible = await connectButton.isVisible().catch(() => false);
  
  if (isVisible) {
    console.log('Note: Click "Connect" and approve in MetaMask manually during E2E tests');
    // In automated mode, wallet would already be connected from previous session
  }
}

