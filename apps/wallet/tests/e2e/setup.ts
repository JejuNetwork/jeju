/**
 * E2E Test Setup
 * 
 * Test infrastructure for network Wallet E2E tests.
 * Uses the localnet (started via `jeju dev --minimal`).
 * 
 * To run tests:
 * 1. Start localnet: bun run jeju dev --minimal
 * 2. Run wallet dev: cd apps/wallet && bun run dev
 * 3. Run tests: bun run test:e2e
 */

import { createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TEST_ACCOUNTS, TEST_NETWORKS } from '../fixtures/accounts';

// Re-export for convenience
export { TEST_ACCOUNTS, TEST_NETWORKS };

// Network default ports (from packages/cli/src/types.ts)
export const JEJU_PORTS = {
  l1Rpc: 8545,
  l2Rpc: 9545,
  l2Ws: 9546,
  gateway: 4001,
  wallet: 4015,
} as const;

// Test configuration
export const TEST_CONFIG = {
  rpcUrl: process.env.JEJU_RPC_URL || TEST_NETWORKS.jeju.rpcUrl,
  chainId: TEST_NETWORKS.jeju.chainId,
  walletUrl: process.env.BASE_URL || `http://localhost:${JEJU_PORTS.wallet}`,
  testAccount: TEST_ACCOUNTS.primary,
  rpcTimeout: 5000,
} as const;

/**
 * Check if network localnet is running
 */
export async function isLocalnetRunning(): Promise<boolean> {
  try {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl, { timeout: TEST_CONFIG.rpcTimeout }),
    });
    const chainId = await client.getChainId();
    return chainId === TEST_CONFIG.chainId;
  } catch {
    return false;
  }
}

/**
 * Get test account balance
 */
export async function getTestAccountBalance(): Promise<string> {
  const client = createPublicClient({
    transport: http(TEST_CONFIG.rpcUrl),
  });
  const balance = await client.getBalance({
    address: TEST_CONFIG.testAccount.address,
  });
  return formatEther(balance);
}

/**
 * Get the test account signer
 */
export function getTestSigner() {
  return privateKeyToAccount(TEST_CONFIG.testAccount.privateKey);
}

/**
 * Assert that test infrastructure is running.
 * Call this in beforeAll() hooks.
 */
export async function assertInfrastructureRunning(): Promise<void> {
  const localnetUp = await isLocalnetRunning();
  if (!localnetUp) {
    throw new Error(
      'network localnet not running.\n' +
      'Start it with: bun run jeju dev --minimal\n' +
      `Expected chain at: ${TEST_CONFIG.rpcUrl}`
    );
  }
}
