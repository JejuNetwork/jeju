/**
 * Crucible Test Setup
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
  storageUrl: string;
  computeUrl: string;
}

/**
 * Wait for infrastructure to be healthy
 */
async function waitForInfra(maxAttempts = 30): Promise<boolean> {
  const status = await getStatus();
  
  if (!status.rpc) {
    console.warn('RPC not available - chain-dependent tests will fail');
    return false;
  }
  
  if (!status.dws) {
    console.warn('DWS not available - storage/compute tests will fail');
    return false;
  }
  
  return true;
}

/**
 * Get test environment
 */
export function getTestEnv(): TestEnv {
  const dwsUrl = process.env.DWS_URL || `http://127.0.0.1:${DWS_PORT}`;
  
  return {
    dwsUrl,
    rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || `http://127.0.0.1:${RPC_PORT}`,
    storageUrl: process.env.STORAGE_API_URL || `${dwsUrl}/storage`,
    computeUrl: process.env.COMPUTE_MARKETPLACE_URL || `${dwsUrl}/compute`,
  };
}

/**
 * Setup hook - call in describe block or beforeAll
 */
export async function setupTests(): Promise<void> {
  await setup();
  
  // Verify infrastructure is healthy
  const ready = await waitForInfra(5);
  if (!ready) {
    console.warn('Infrastructure not fully available - tests may be skipped');
  }
  
  // Set environment variables for Crucible
  const env = getTestEnv();
  process.env.DWS_URL = env.dwsUrl;
  process.env.STORAGE_API_URL = env.storageUrl;
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

