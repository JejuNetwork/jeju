/**
 * OIF/EIL Scripts Integration Tests
 * 
 * Tests the scripts against real RPC endpoints (read-only operations)
 * and validates contract interactions work correctly.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';
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
    const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
    const network = await provider.getNetwork();
    expect(Number(network.chainId)).toBe(chainId);
  });

  test('should timeout gracefully on unreachable RPC', async () => {
    const provider = new ethers.JsonRpcProvider('https://nonexistent.invalid', undefined, {
      staticNetwork: true,
    });
    
    await expect(provider.getBlockNumber()).rejects.toThrow();
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
    const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
    const code = await provider.getCode(contracts.solverRegistry);
    expect(code.length).toBeGreaterThan(2);
  });

  test.each(deployedChains)('chain $chainId: SolverRegistry.getStats() returns valid data', async ({ chainId, contracts }) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
    const registry = new ethers.Contract(contracts.solverRegistry, SOLVER_REGISTRY_ABI, provider);
    
    const [totalStaked, totalSlashed, activeSolvers] = await registry.getStats();
    
    expect(typeof totalStaked).toBe('bigint');
    expect(typeof totalSlashed).toBe('bigint');
    expect(typeof activeSolvers).toBe('bigint');
    expect(totalStaked).toBeGreaterThanOrEqual(0n);
    expect(totalSlashed).toBeGreaterThanOrEqual(0n);
    expect(activeSolvers).toBeGreaterThanOrEqual(0n);
    expect(totalStaked).toBeGreaterThanOrEqual(totalSlashed);
  });

  test.each(deployedChains)('chain $chainId: MIN_STAKE is reasonable', async ({ chainId, contracts }) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
    const registry = new ethers.Contract(contracts.solverRegistry, SOLVER_REGISTRY_ABI, provider);
    
    const minStake = await registry.MIN_STAKE();
    
    expect(minStake).toBeGreaterThan(0n);
    expect(minStake).toBeLessThanOrEqual(ethers.parseEther('100')); // Sanity check
  });

  test.each(deployedChains)('chain $chainId: isSolverActive returns bool for zero address', async ({ chainId, contracts }) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
    const registry = new ethers.Contract(contracts.solverRegistry, SOLVER_REGISTRY_ABI, provider);
    
    const isActive = await registry.isSolverActive(ethers.ZeroAddress);
    
    expect(typeof isActive).toBe('boolean');
    expect(isActive).toBe(false); // Zero address should never be active
  });

  test.each(deployedChains)('chain $chainId: InputSettler has code', async ({ chainId, contracts }) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
    const code = await provider.getCode(contracts.inputSettler);
    expect(code.length).toBeGreaterThan(2);
  });

  test.each(deployedChains)('chain $chainId: OutputSettler has code', async ({ chainId, contracts }) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
    const code = await provider.getCode(contracts.outputSettler);
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
    const provider = new ethers.JsonRpcProvider(rpcUrl(hubChainId), undefined, { staticNetwork: true });
    const code = await provider.getCode(eilConfig.hub.l1StakeManager);
    
    expect(code.length).toBeGreaterThan(2);
  });

  test('L1StakeManager.getProtocolStats() returns valid data', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const provider = new ethers.JsonRpcProvider(rpcUrl(eilConfig.hub.chainId), undefined, { staticNetwork: true });
    const manager = new ethers.Contract(eilConfig.hub.l1StakeManager, L1_STAKE_MANAGER_ABI, provider);
    
    const [totalStaked, totalSlashed, activeXLPs] = await manager.getProtocolStats();
    
    expect(typeof totalStaked).toBe('bigint');
    expect(typeof totalSlashed).toBe('bigint');
    expect(typeof activeXLPs).toBe('bigint');
  });

  test('L1StakeManager.MIN_STAKE is reasonable', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const provider = new ethers.JsonRpcProvider(rpcUrl(eilConfig.hub.chainId), undefined, { staticNetwork: true });
    const manager = new ethers.Contract(eilConfig.hub.l1StakeManager, L1_STAKE_MANAGER_ABI, provider);
    
    const minStake = await manager.MIN_STAKE();
    
    expect(minStake).toBeGreaterThan(0n);
    expect(minStake).toBeLessThanOrEqual(ethers.parseEther('100'));
  });

  test('L1StakeManager.l2Paymasters() returns address (may be zero)', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const provider = new ethers.JsonRpcProvider(rpcUrl(eilConfig.hub.chainId), undefined, { staticNetwork: true });
    const manager = new ethers.Contract(eilConfig.hub.l1StakeManager, L1_STAKE_MANAGER_ABI, provider);
    
    // Check for Base Sepolia
    const paymaster = await manager.l2Paymasters(84532);
    
    expect(typeof paymaster).toBe('string');
    expect(paymaster).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test('L1StakeManager.isXLPActive returns false for zero address', async () => {
    if (!eilConfig?.hub?.l1StakeManager) return;

    const provider = new ethers.JsonRpcProvider(rpcUrl(eilConfig.hub.chainId), undefined, { staticNetwork: true });
    const manager = new ethers.Contract(eilConfig.hub.l1StakeManager, L1_STAKE_MANAGER_ABI, provider);
    
    const isActive = await manager.isXLPActive(ethers.ZeroAddress);
    
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
        const checksummed = ethers.getAddress(address);
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
    const provider = new ethers.JsonRpcProvider(rpcUrl(11155111), undefined, { staticNetwork: true });
    const registry = new ethers.Contract('0x0000000000000000000000000000000000000001', SOLVER_REGISTRY_ABI, provider);
    
    // This should fail because there's no contract at this address
    await expect(registry.getStats()).rejects.toThrow();
  });

  test('should detect when contract has no code', async () => {
    const provider = new ethers.JsonRpcProvider(rpcUrl(11155111), undefined, { staticNetwork: true });
    const code = await provider.getCode('0x0000000000000000000000000000000000000001');
    
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
        const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
        const blockNumber = await provider.getBlockNumber();
        return { chainId, blockNumber };
      })
    );
    
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.blockNumber).toBeGreaterThan(0);
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
        const provider = new ethers.JsonRpcProvider(rpcUrl(chainId), undefined, { staticNetwork: true });
        const registry = new ethers.Contract(data.contracts!.solverRegistry, SOLVER_REGISTRY_ABI, provider);
        const stats = await registry.getStats();
        return { chainId, stats };
      })
    );
    
    expect(results.length).toBe(deployed.length);
    for (const result of results) {
      expect(result.stats).toBeDefined();
    }
  });
});
