/**
 * Autocrat Test Setup
 * 
 * Provides beforeAll/afterAll hooks that ensure infrastructure is running.
 * Works in two modes:
 * 1. When run via `jeju test` - infrastructure is already up
 * 2. When run standalone - starts required services
 */

import { beforeAll, afterAll } from 'bun:test';
import { setup, teardown, isReady, getStatus } from '@jejunetwork/tests/bun-global-setup';

// Export for manual use
export { setup, teardown, isReady, getStatus };

// Default ports
const DWS_PORT = 4030;
const RPC_PORT = 9545;

interface TestEnv {
  dwsUrl: string;
  rpcUrl: string;
  computeUrl: string;
}

/**
 * Wait for RPC to be healthy
 */
async function waitForRpc(maxAttempts = 30): Promise<boolean> {
  const rpcUrl = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || `http://127.0.0.1:${RPC_PORT}`;
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      // Retry
    }
    await Bun.sleep(1000);
  }
  return false;
}

/**
 * Get test environment
 */
export function getTestEnv(): TestEnv {
  const dwsUrl = process.env.DWS_URL || `http://127.0.0.1:${DWS_PORT}`;
  
  return {
    dwsUrl,
    rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || `http://127.0.0.1:${RPC_PORT}`,
    computeUrl: process.env.COMPUTE_MARKETPLACE_URL || `${dwsUrl}/compute`,
  };
}

/**
 * Setup hook - call in describe block or beforeAll
 */
export async function setupTests(): Promise<void> {
  await setup();
  
  // Autocrat needs RPC for on-chain operations
  if (!(await waitForRpc(5))) {
    console.warn('RPC not responding - on-chain tests will fail');
  }
  
  // Set environment variables
  const env = getTestEnv();
  process.env.DWS_URL = env.dwsUrl;
  process.env.COMPUTE_MARKETPLACE_URL = env.computeUrl;
}

/**
 * Teardown hook - call in afterAll
 */
export async function teardownTests(): Promise<void> {
  await teardown();
}

// Auto-setup when file is imported in test context
if (process.env.BUN_TEST === 'true') {
  beforeAll(setupTests);
  afterAll(teardownTests);
}

