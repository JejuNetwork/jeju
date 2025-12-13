/** Playwright global setup for E2E tests */

import type { FullConfig } from '@playwright/test';
import { LockManager } from './lock-manager';
import { runPreflightChecks, waitForChain } from './preflight';
import { quickWarmup } from './warmup';

const MIN_PLAYWRIGHT_VERSION = '1.55.1';

function checkPlaywrightVersion(): void {
  try {
    const pkg = require('@playwright/test/package.json');
    const version = pkg.version as string;
    const [major, minor, patch] = version.split('.').map(Number);
    const [minMajor, minMinor, minPatch] = MIN_PLAYWRIGHT_VERSION.split('.').map(Number);
    
    const current = major * 10000 + minor * 100 + patch;
    const minimum = minMajor * 10000 + minMinor * 100 + minPatch;
    
    if (current < minimum) {
      console.warn(`⚠️  Playwright ${version} has known vulnerabilities. Upgrade to >=${MIN_PLAYWRIGHT_VERSION}`);
    }
  } catch {
    // Can't check version, continue anyway
  }
}

let lockManager: LockManager | null = null;

export default async function globalSetup(_config: FullConfig): Promise<() => void> {
  const skipLock = process.env.SKIP_TEST_LOCK === 'true';
  const skipPreflight = process.env.SKIP_PREFLIGHT === 'true';
  const skipWarmup = process.env.SKIP_WARMUP === 'true';
  const force = process.env.FORCE_TESTS === 'true';
  const rpcUrl = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545';
  const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : 1337;
  const apps = process.env.WARMUP_APPS?.split(',');

  console.log('\n=== E2E GLOBAL SETUP ===\n');
  checkPlaywrightVersion();

  if (!skipLock) {
    lockManager = new LockManager({ force });
    const result = lockManager.acquireLock();
    if (!result.acquired) {
      throw new Error(result.message || 'Lock not acquired');
    }
  }

  if (!skipPreflight) {
    if (!await waitForChain({ rpcUrl, chainId }, 30000)) {
      lockManager?.releaseLock();
      throw new Error('Chain not ready');
    }
    const result = await runPreflightChecks({ rpcUrl, chainId });
    if (!result.success) {
      lockManager?.releaseLock();
      throw new Error('Preflight failed');
    }
  }

  if (!skipWarmup) {
    await quickWarmup(apps);
  }

  console.log('\n=== SETUP COMPLETE ===\n');

  return () => {
    lockManager?.releaseLock();
    lockManager = null;
  };
}

export async function globalTeardown(): Promise<void> {
  lockManager?.releaseLock();
  console.log('Teardown complete');
}

/** For programmatic setup - sets env vars and calls globalSetup */
export async function setupTestEnvironment(options: {
  skipLock?: boolean;
  skipPreflight?: boolean;
  skipWarmup?: boolean;
  force?: boolean;
  rpcUrl?: string;
  chainId?: number;
  apps?: string[];
} = {}): Promise<() => void> {
  if (options.skipLock) process.env.SKIP_TEST_LOCK = 'true';
  if (options.skipPreflight) process.env.SKIP_PREFLIGHT = 'true';
  if (options.skipWarmup) process.env.SKIP_WARMUP = 'true';
  if (options.force) process.env.FORCE_TESTS = 'true';
  if (options.rpcUrl) process.env.L2_RPC_URL = options.rpcUrl;
  if (options.chainId) process.env.CHAIN_ID = String(options.chainId);
  if (options.apps) process.env.WARMUP_APPS = options.apps.join(',');

  return globalSetup({} as FullConfig);
}
