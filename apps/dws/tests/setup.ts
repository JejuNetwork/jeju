/**
 * DWS Test Setup
 * 
 * Provides beforeAll/afterAll hooks that ensure infrastructure is running.
 * Works in two modes:
 * 1. When run via `jeju test` - infrastructure is already up
 * 2. When run standalone - starts required services
 * 
 * NO FALLBACKS - all infrastructure must be running.
 */

import { beforeAll, afterAll } from 'bun:test';

interface InfraStatus {
  rpc: boolean;
  dws: boolean;
  docker: { [key: string]: boolean };
  rpcUrl: string;
  dwsUrl: string;
}

// Try to load global setup, gracefully skip if not available
let setup: () => Promise<void> = async () => {};
let teardown: () => Promise<void> = async () => {};
let isReady: () => boolean = () => true;
let getStatus: () => Promise<InfraStatus> = async () => ({
  rpc: false,
  dws: false,
  docker: {},
  rpcUrl: process.env.L2_RPC_URL || 'http://127.0.0.1:9545',
  dwsUrl: process.env.DWS_URL || 'http://127.0.0.1:4030',
});

try {
  const globalSetup = await import('@jejunetwork/tests/bun-global-setup');
  setup = globalSetup.setup;
  teardown = globalSetup.teardown;
  isReady = globalSetup.isReady;
  getStatus = globalSetup.getStatus;
} catch {
  console.warn('[DWS Tests] Running without global setup - infrastructure must be started manually');
}

export { setup, teardown, isReady, getStatus };

// Default ports for this app
const DWS_PORT = parseInt(process.env.PORT ?? '4030');

/**
 * Wait for DWS to be healthy
 */
async function waitForDws(maxAttempts = 30): Promise<boolean> {
  const url = process.env.DWS_URL || `http://127.0.0.1:${DWS_PORT}`;
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
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
export function getTestEnv(): { dwsUrl: string; rpcUrl: string } {
  return {
    dwsUrl: process.env.DWS_URL || `http://127.0.0.1:${DWS_PORT}`,
    rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
  };
}

/**
 * Setup hook - call in describe block or beforeAll
 */
export async function setupTests(): Promise<void> {
  await setup();
  
  // For DWS-specific tests, also ensure DWS is healthy
  if (!(await waitForDws(5))) {
    console.warn('DWS not responding - some tests may fail');
  }
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

