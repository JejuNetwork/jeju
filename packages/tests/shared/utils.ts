/**
 * Shared Utilities for Test Infrastructure
 * 
 * Consolidates common functionality used across test modules:
 * - Workspace/monorepo root finding
 * - RPC health checking
 * - Service availability checking
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { parseChainIdResponse, parseBlockNumberResponse, parseGetCodeResponse } from './schemas';

// ============================================================================
// CANONICAL TEST CONSTANTS - Single Source of Truth
// ============================================================================

/** Standard test seed phrase (Anvil default) */
export const SEED_PHRASE = 'test test test test test test test test test test test junk';

/** Standard test wallet password for MetaMask */
export const PASSWORD = 'Tester@1234';

/** Default test wallet address (account 0 from seed phrase) */
export const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;

/** Chain ID for localnet - fixed for E2E consistency */
export const JEJU_CHAIN_ID = 1337;

/** RPC URL for localnet - fixed for E2E consistency */
export const JEJU_RPC_URL = 'http://127.0.0.1:9545';

/** Test accounts (Anvil defaults) - canonical source */
export const TEST_ACCOUNTS = {
  deployer: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const,
  },
  user1: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const,
  },
  user2: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const,
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const,
  },
  user3: {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as const,
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as const,
  },
  operator: {
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as const,
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' as const,
  },
} as const;

/** Network Localnet chain configuration for MetaMask */
export const JEJU_CHAIN = {
  chainId: JEJU_CHAIN_ID,
  chainIdHex: `0x${JEJU_CHAIN_ID.toString(16)}`,
  name: 'Jeju Localnet',
  rpcUrl: JEJU_RPC_URL,
  symbol: 'ETH',
  blockExplorerUrl: '',
} as const;

// ============================================================================
// Workspace Root Finding
// ============================================================================

/**
 * Find the Jeju monorepo root by looking for package.json with name "jeju"
 */
export function findJejuWorkspaceRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  const maxDepth = 15;
  
  for (let depth = 0; depth < maxDepth; depth++) {
    const pkgPath = join(dir, 'package.json');
    
    if (existsSync(pkgPath)) {
      const content = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name === 'jeju') {
        return dir;
      }
    }
    
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  
  // Fallback: look for bun.lock + packages directory
  dir = startDir;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  
  return process.env.JEJU_ROOT ?? process.cwd();
}

// ============================================================================
// RPC Health Checking
// ============================================================================

interface RpcHealthResult {
  available: boolean;
  chainId?: number;
  blockNumber?: number;
  error?: string;
}

/**
 * Check if an RPC endpoint is healthy and return chain info
 */
export async function checkRpcHealth(
  rpcUrl: string,
  timeout = 3000
): Promise<RpcHealthResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    // Check chain ID
    const chainIdResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: controller.signal,
    });
    
    if (!chainIdResponse.ok) {
      return { available: false, error: `HTTP ${chainIdResponse.status}` };
    }
    
    const chainIdData = await chainIdResponse.json();
    const chainId = parseChainIdResponse(chainIdData);
    
    // Check block number
    const blockResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 2 }),
      signal: controller.signal,
    });
    
    if (!blockResponse.ok) {
      return { available: true, chainId };
    }
    
    const blockData = await blockResponse.json();
    const blockNumber = parseBlockNumberResponse(blockData);
    
    return { available: true, chainId, blockNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Simple check if RPC is responding
 */
export async function isRpcAvailable(rpcUrl: string, timeout = 3000): Promise<boolean> {
  const result = await checkRpcHealth(rpcUrl, timeout);
  return result.available;
}

/**
 * Check if contracts are deployed at a known address
 */
export async function checkContractsDeployed(
  rpcUrl: string,
  contractAddress = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  timeout = 3000
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [contractAddress, 'latest'],
        id: 1,
      }),
      signal: controller.signal,
    });
    
    if (!response.ok) return false;
    
    const data = await response.json();
    const code = parseGetCodeResponse(data);
    return code !== '0x' && code.length > 2;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// HTTP Service Checking
// ============================================================================

interface ServiceHealthResult {
  available: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Check if an HTTP service is healthy
 */
export async function checkServiceHealth(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    timeout?: number;
    expectedStatuses?: number[];
  } = {}
): Promise<ServiceHealthResult> {
  const {
    method = 'GET',
    timeout = 3000,
    expectedStatuses = [200, 204],
  } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
    });
    
    const statusCode = response.status;
    const available = expectedStatuses.includes(statusCode) || response.ok;
    
    return { available, statusCode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Simple check if a service URL is responding
 */
export async function isServiceAvailable(url: string, timeout = 3000): Promise<boolean> {
  const result = await checkServiceHealth(url, { timeout });
  return result.available;
}

// ============================================================================
// Wait Utilities
// ============================================================================

/**
 * Wait for an RPC endpoint to become available
 */
export async function waitForRpc(
  rpcUrl: string,
  options: { maxWaitMs?: number; intervalMs?: number; expectedChainId?: number } = {}
): Promise<boolean> {
  const { maxWaitMs = 60000, intervalMs = 2000, expectedChainId } = options;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const result = await checkRpcHealth(rpcUrl);
    
    if (result.available) {
      if (expectedChainId !== undefined && result.chainId !== expectedChainId) {
        console.log(`Chain ID mismatch: expected ${expectedChainId}, got ${result.chainId}`);
      } else {
        return true;
      }
    }
    
    await new Promise(r => setTimeout(r, intervalMs));
  }
  
  return false;
}

/**
 * Wait for a service to become available
 */
export async function waitForService(
  url: string,
  options: { maxWaitMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const { maxWaitMs = 60000, intervalMs = 2000 } = options;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    if (await isServiceAvailable(url)) {
      return true;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  
  return false;
}

// ============================================================================
// Environment Utilities
// ============================================================================

/**
 * Get the effective RPC URL from environment
 */
export function getRpcUrl(): string {
  return process.env.L2_RPC_URL ?? process.env.JEJU_RPC_URL ?? JEJU_RPC_URL;
}

/**
 * Get the effective chain ID from environment
 */
export function getChainId(): number {
  const envChainId = process.env.CHAIN_ID;
  return envChainId ? parseInt(envChainId, 10) : JEJU_CHAIN_ID;
}

/**
 * Get test environment URLs
 */
export function getTestEnv(): Record<string, string> {
  return {
    L1_RPC_URL: process.env.L1_RPC_URL ?? 'http://127.0.0.1:6545',
    L2_RPC_URL: process.env.L2_RPC_URL ?? 'http://127.0.0.1:9545',
    JEJU_RPC_URL: process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545',
    CHAIN_ID: process.env.CHAIN_ID ?? '1337',
    INDEXER_GRAPHQL_URL: process.env.INDEXER_GRAPHQL_URL ?? 'http://127.0.0.1:4350/graphql',
    ORACLE_URL: process.env.ORACLE_URL ?? 'http://127.0.0.1:4301',
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899',
  };
}
