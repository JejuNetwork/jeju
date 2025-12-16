/**
 * OIF/EIL Scripts Integration Tests
 * 
 * Tests the scripts against real RPC endpoints (read-only operations)
 * and validates contract interactions work correctly.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, parseAbi, readContract, getCode, getChainId, getBlockNumber, formatEther, parseEther, zeroAddress, getAddress, type Address, type PublicClient } from 'viem';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Import shared chains
import { PUBLIC_RPCS, CHAIN_NAMES, chainName, rpcUrl, getChainIds } from '../../../scripts/shared/chains';

// Contract ABIs (minimal for testing)
const SOLVER_REGISTRY_ABI = [
  'function getStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeSolvers)',
  'function MIN_STAKE() view returns (uint256)',
  'function isSolverActive(address) view returns (bool)',
];

const L1_STAKE_MANAGER_ABI = [
  'function getProtocolStats() view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeXLPs)',
  'function MIN_STAKE() view returns (uint256)',
  'function isXLPActive(address) view returns (bool)',
  'function l2Paymasters(uint256) view returns (address)',
];

interface OIFDeployment {
  status: string;
  contracts?: {
    solverRegistry: string;
    inputSettler: string;
    outputSettler: string;
    oracle: string;
  };
}

interface EILConfig {
  hub?: {
    chainId: number;
    l1StakeManager: string;
  };
  chains?: Record<string, { chainId: number; crossChainPaymaster: string }>;
}

// Load deployment configs
function loadOIFDeployments(network: 'testnet' | 'mainnet'): Record<string, OIFDeployment> {
  const path = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')).chains || {};
}

function loadEILConfig(network: 'testnet' | 'mainnet'): EILConfig | null {
  const path = resolve(process.cwd(), 'packages/config/eil.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'))[network] || null;
}

describe('RPC Connectivity', () => {
  const testnetChains = getChainIds('testnet');

  test.each(testnetChains.filter(id => id !== 420690))('should connect to chain %i', async (chainId) => {
    const chain = inferChainFromRpcUrl(rpcUrl(chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
    const actualChainId = await getChainId(publicClient);
    expect(actualChainId).toBe(chainId);
  });

  test('should timeout gracefully on unreachable RPC', async () => {
    const chain = inferChainFromRpcUrl('https://nonexistent.invalid');
    const publicClient = createPublicClient({ chain, transport: http('https://nonexistent.invalid') });
    
    await expect(getBlockNumber(publicClient)).rejects.toThrow();
  });
});

describe('OIF Contract Verification', () => {
  const deployments = loadOIFDeployments('testnet');
  const deployedChains = Object.entries(deployments)
    .filter(([, d]) => d.status === 'deployed' && d.contracts?.solverRegistry)
    .map(([id, d]) => ({ chainId: Number(id), contracts: d.contracts! }));

  test('should have at least one deployed chain', () => {
    expect(deployedChains.length).toBeGreaterThan(0);
  });

  test.each(deployedChains)('chain $chainId: SolverRegistry has code', async ({ chainId, contracts }) => {
    const chain = inferChainFromRpcUrl(rpcUrl(chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
    const code = await getCode(publicClient, { address: contracts.solverRegistry as Address });
    expect(code.length).toBeGreaterThan(2);
  });

  test.each(deployedChains)('chain $chainId: SolverRegistry.getStats() returns valid data', async ({ chainId, contracts }) => {
    const chain = inferChainFromRpcUrl(rpcUrl(chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
    const registryAbi = parseAbi(SOLVER_REGISTRY_ABI);
    
    const result = await readContract(publicClient, {
      address: contracts.solverRegistry as Address,
      abi: registryAbi,
      functionName: 'getStats',
    }) as [bigint, bigint, bigint];
    
    const [totalStaked, totalSlashed, activeSolvers] = result;
    
    expect(typeof totalStaked).toBe('bigint');
    expect(typeof totalSlashed).toBe('bigint');
    expect(typeof activeSolvers).toBe('bigint');
    expect(totalStaked).toBeGreaterThanOrEqual(0n);
    expect(totalSlashed).toBeGreaterThanOrEqual(0n);
    expect(activeSolvers).toBeGreaterThanOrEqual(0n);
    expect(totalStaked).toBeGreaterThanOrEqual(totalSlashed);
  });

  test.each(deployedChains)('chain $chainId: MIN_STAKE is reasonable', async ({ chainId, contracts }) => {
    const chain = inferChainFromRpcUrl(rpcUrl(chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
    const registryAbi = parseAbi(SOLVER_REGISTRY_ABI);
    
    const minStake = await readContract(publicClient, {
      address: contracts.solverRegistry as Address,
      abi: registryAbi,
      functionName: 'MIN_STAKE',
    }) as bigint;
    
    expect(minStake).toBeGreaterThan(0n);
    expect(minStake).toBeLessThanOrEqual(parseEther('100')); // Sanity check
  });

  test.each(deployedChains)('chain $chainId: isSolverActive returns bool for zero address', async ({ chainId, contracts }) => {
    const chain = inferChainFromRpcUrl(rpcUrl(chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
    const registryAbi = parseAbi(SOLVER_REGISTRY_ABI);
    
    const isActive = await readContract(publicClient, {
      address: contracts.solverRegistry as Address,
      abi: registryAbi,
      functionName: 'isSolverActive',
      args: [zeroAddress],
    }) as boolean;
    
    expect(typeof isActive).toBe('boolean');
    expect(isActive).toBe(false); // Zero address should never be active
  });

  test.each(deployedChains)('chain $chainId: InputSettler has code', async ({ chainId, contracts }) => {
    const chain = inferChainFromRpcUrl(rpcUrl(chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
    const code = await getCode(publicClient, { address: contracts.inputSettler as Address });
    expect(code.length).toBeGreaterThan(2);
  });

  test.each(deployedChains)('chain $chainId: OutputSettler has code', async ({ chainId, contracts }) => {
    const chain = inferChainFromRpcUrl(rpcUrl(chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
    const code = await getCode(publicClient, { address: contracts.outputSettler as Address });
    expect(code.length).toBeGreaterThan(2);
  });
});

describe('EIL Contract Verification', () => {
  const eilConfig = loadEILConfig('testnet');

  test('should have EIL config loaded', () => {
    expect(eilConfig).not.toBeNull();
  });

  test('L1StakeManager should have code', async () => {
    if (!eilConfig?.hub?.l1StakeManager) {
      console.warn('L1StakeManager not configured, skipping');
      return;
    }

    const hubChainId = eilConfig.hub.chainId;
    const chain = inferChainFromRpcUrl(rpcUrl(hubChainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(hubChainId)) });
    const code = await getCode(publicClient, { address: eilConfig.hub.l1StakeManager as Address });
    
    expect(code.length).toBeGreaterThan(2);
  });

  test('L1StakeManager.getProtocolStats() returns valid data', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const chain = inferChainFromRpcUrl(rpcUrl(eilConfig.hub.chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(eilConfig.hub.chainId)) });
    const managerAbi = parseAbi(L1_STAKE_MANAGER_ABI);
    
    const result = await readContract(publicClient, {
      address: eilConfig.hub.l1StakeManager as Address,
      abi: managerAbi,
      functionName: 'getProtocolStats',
    }) as [bigint, bigint, bigint];
    
    const [totalStaked, totalSlashed, activeXLPs] = result;
    
    expect(typeof totalStaked).toBe('bigint');
    expect(typeof totalSlashed).toBe('bigint');
    expect(typeof activeXLPs).toBe('bigint');
  });

  test('L1StakeManager.MIN_STAKE is reasonable', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const chain = inferChainFromRpcUrl(rpcUrl(eilConfig.hub.chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(eilConfig.hub.chainId)) });
    const managerAbi = parseAbi(L1_STAKE_MANAGER_ABI);
    
    const minStake = await readContract(publicClient, {
      address: eilConfig.hub.l1StakeManager as Address,
      abi: managerAbi,
      functionName: 'MIN_STAKE',
    }) as bigint;
    
    expect(minStake).toBeGreaterThan(0n);
    expect(minStake).toBeLessThanOrEqual(parseEther('100'));
  });

  test('L1StakeManager.l2Paymasters() returns address (may be zero)', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const chain = inferChainFromRpcUrl(rpcUrl(eilConfig.hub.chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(eilConfig.hub.chainId)) });
    const managerAbi = parseAbi(L1_STAKE_MANAGER_ABI);
    
    // Check for Base Sepolia
    const paymaster = await readContract(publicClient, {
      address: eilConfig.hub.l1StakeManager as Address,
      abi: managerAbi,
      functionName: 'l2Paymasters',
      args: [84532],
    }) as Address;
    
    expect(typeof paymaster).toBe('string');
    expect(paymaster).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test('L1StakeManager.isXLPActive returns false for zero address', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const chain = inferChainFromRpcUrl(rpcUrl(eilConfig.hub.chainId));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(eilConfig.hub.chainId)) });
    const managerAbi = parseAbi(L1_STAKE_MANAGER_ABI);
    
    const isActive = await readContract(publicClient, {
      address: eilConfig.hub.l1StakeManager as Address,
      abi: managerAbi,
      functionName: 'isXLPActive',
      args: [zeroAddress],
    }) as boolean;
    
    expect(isActive).toBe(false);
  });
});

describe('Config File Consistency', () => {
  test('OIF deployment file exists and is valid JSON', () => {
    const path = resolve(process.cwd(), 'packages/contracts/deployments/oif-testnet.json');
    expect(existsSync(path)).toBe(true);
    
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content).toHaveProperty('chains');
  });

  test('EIL config file exists and is valid JSON', () => {
    const path = resolve(process.cwd(), 'packages/config/eil.json');
    expect(existsSync(path)).toBe(true);
    
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content).toHaveProperty('testnet');
  });

  test('contracts.json exists and has OIF entries', () => {
    const path = resolve(process.cwd(), 'packages/config/contracts.json');
    expect(existsSync(path)).toBe(true);
    
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    // Should have external chains with OIF
    expect(content).toHaveProperty('external');
  });

  test('all OIF deployed addresses are checksummed', () => {
    const deployments = loadOIFDeployments('testnet');
    
    for (const [chainId, data] of Object.entries(deployments)) {
      if (!data.contracts) continue;
      
      for (const [name, address] of Object.entries(data.contracts)) {
        // Skip non-address values (e.g., "oracleType": "simple")
        if (!address || typeof address !== 'string' || !address.startsWith('0x') || address.length !== 42) continue;
        const checksummed = getAddress(address);
        expect(address).toBe(checksummed);
      }
    }
  });

  test('EIL hub uses correct L1 (Sepolia for testnet)', () => {
    const eilConfig = loadEILConfig('testnet');
    expect(eilConfig?.hub?.chainId).toBe(11155111); // Sepolia
    expect(eilConfig?.hub?.l1StakeManager).toBeDefined();
  });
});

describe('Cross-Chain Route Validation', () => {
  test('OIF deployment has cross-chain routes defined', () => {
    const path = resolve(process.cwd(), 'packages/contracts/deployments/oif-testnet.json');
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    
    expect(content).toHaveProperty('crossChainRoutes');
    expect(Array.isArray(content.crossChainRoutes)).toBe(true);
    expect(content.crossChainRoutes.length).toBeGreaterThan(0);
  });

  test('all routes have valid from/to chain IDs', () => {
    const path = resolve(process.cwd(), 'packages/contracts/deployments/oif-testnet.json');
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    
    const validChainIds = new Set([11155111, 84532, 421614, 11155420, 420690]);
    
    for (const route of content.crossChainRoutes) {
      expect(validChainIds.has(route.from)).toBe(true);
      expect(validChainIds.has(route.to)).toBe(true);
      expect(route.from).not.toBe(route.to); // No self-routes
      expect(route.enabled).toBe(true);
    }
  });

  test('routes form a connected graph (bidirectional)', () => {
    const path = resolve(process.cwd(), 'packages/contracts/deployments/oif-testnet.json');
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    
    const routeSet = new Set(
      content.crossChainRoutes.map((r: { from: number; to: number }) => `${r.from}-${r.to}`)
    );
    
    // For each route A→B, check B→A exists
    for (const route of content.crossChainRoutes) {
      const reverse = `${route.to}-${route.from}`;
      expect(routeSet.has(reverse)).toBe(true);
    }
  });
});

describe('Error Handling', () => {
  test('should handle invalid contract address gracefully', async () => {
    const chain = inferChainFromRpcUrl(rpcUrl(11155111));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(11155111)) });
    const registryAbi = parseAbi(SOLVER_REGISTRY_ABI);
    
    // This should fail because there's no contract at this address
    await expect(readContract(publicClient, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      abi: registryAbi,
      functionName: 'getStats',
    })).rejects.toThrow();
  });

  test('should detect when contract has no code', async () => {
    const chain = inferChainFromRpcUrl(rpcUrl(11155111));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl(11155111)) });
    const code = await getCode(publicClient, { address: '0x0000000000000000000000000000000000000001' as Address });
    
    expect(code).toBe('0x');
  });

  test('chainName handles negative chain IDs', () => {
    // Edge case - negative IDs
    expect(chainName(-1)).toBe('Chain -1');
  });
});

describe('Concurrent Operations', () => {
  test('should handle parallel RPC calls to multiple chains', async () => {
    const chainIds = [11155111, 84532]; // Sepolia and Base Sepolia
    
    const results = await Promise.all(
      chainIds.map(async (chainId) => {
        const chain = inferChainFromRpcUrl(rpcUrl(chainId));
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
        const blockNumber = await getBlockNumber(publicClient);
        return { chainId, blockNumber };
      })
    );
    
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.blockNumber).toBeGreaterThan(0n);
    }
  });

  test('should handle parallel contract reads', async () => {
    const deployments = loadOIFDeployments('testnet');
    const deployed = Object.entries(deployments)
      .filter(([, d]) => d.status === 'deployed' && d.contracts?.solverRegistry)
      .slice(0, 2); // Test first 2

    const results = await Promise.all(
      deployed.map(async ([chainIdStr, data]) => {
        const chainId = Number(chainIdStr);
        const chain = inferChainFromRpcUrl(rpcUrl(chainId));
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl(chainId)) });
        const registryAbi = parseAbi(SOLVER_REGISTRY_ABI);
        const stats = await readContract(publicClient, {
          address: data.contracts!.solverRegistry as Address,
          abi: registryAbi,
          functionName: 'getStats',
        }) as [bigint, bigint, bigint];
        return { chainId, stats };
      })
    );
    
    expect(results.length).toBe(deployed.length);
    for (const result of results) {
      expect(result.stats).toBeDefined();
    }
  });
});
