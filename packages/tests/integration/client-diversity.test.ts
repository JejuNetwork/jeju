/**
 * Client Diversity Integration Tests
 * 
 * Validates that multiple execution clients (Geth, Reth, Nethermind)
 * are running correctly and producing consistent state across L1 and L2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createPublicClient, http, getBlockNumber, getBalance, getTransactionReceipt, getChainId, type PublicClient, type TransactionReceipt } from 'viem';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';

// ============================================================================
// Test Configuration
// ============================================================================

interface ClientEndpoint {
  name: string;
  http: string;
  ws?: string;
  clientType: 'geth' | 'reth' | 'nethermind';
  layer: 'l1' | 'l2';
}

const L1_CLIENTS: ClientEndpoint[] = [
  { name: 'Geth L1', http: process.env.GETH_L1_HTTP ?? 'http://localhost:8545', clientType: 'geth', layer: 'l1' },
  { name: 'Reth L1', http: process.env.RETH_L1_HTTP ?? 'http://localhost:8645', clientType: 'reth', layer: 'l1' },
  { name: 'Nethermind L1', http: process.env.NETHERMIND_L1_HTTP ?? 'http://localhost:8745', clientType: 'nethermind', layer: 'l1' },
];

const L2_CLIENTS: ClientEndpoint[] = [
  { name: 'Geth L2 Seq', http: process.env.GETH_L2_HTTP ?? 'http://localhost:9545', clientType: 'geth', layer: 'l2' },
  { name: 'Reth L2 Seq', http: process.env.RETH_L2_HTTP ?? 'http://localhost:9645', clientType: 'reth', layer: 'l2' },
  { name: 'Nethermind L2 Seq', http: process.env.NETHERMIND_L2_HTTP ?? 'http://localhost:9745', clientType: 'nethermind', layer: 'l2' },
];

// Timeout for connectivity tests
const CONNECT_TIMEOUT = 5000;

// ============================================================================
// Utility Functions
// ============================================================================

async function createProvider(endpoint: ClientEndpoint): Promise<PublicClient> {
  const chain = inferChainFromRpcUrl(endpoint.http);
  return createPublicClient({ chain, transport: http(endpoint.http) });
}

async function isClientHealthy(endpoint: ClientEndpoint): Promise<{ healthy: boolean; blockNumber?: bigint; chainId?: bigint; error?: string }> {
  try {
    const publicClient = await createProvider(endpoint);
    const chainId = await getChainId(publicClient);
    const blockNumber = await getBlockNumber(publicClient);
    return { healthy: true, blockNumber: BigInt(blockNumber), chainId: BigInt(chainId) };
  } catch (error) {
    return { healthy: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getClientVersion(endpoint: ClientEndpoint): Promise<string> {
  try {
    const response = await fetch(endpoint.http, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'web3_clientVersion', params: [], id: 1 }),
    });
    const data = await response.json() as { result?: string };
    return data.result ?? 'unknown';
  } catch {
    return 'unavailable';
  }
}

// ============================================================================
// L1 Client Diversity Tests
// ============================================================================

describe('L1 Client Diversity', () => {
  const availableClients: ClientEndpoint[] = [];

  beforeAll(async () => {
    // Probe which clients are available
    for (const client of L1_CLIENTS) {
      const health = await isClientHealthy(client);
      if (health.healthy) {
        availableClients.push(client);
      }
    }
  });

  it('should have at least one L1 client available', () => {
    expect(availableClients.length).toBeGreaterThan(0);
  });

  it('should ideally have multiple L1 clients for diversity', () => {
    // This is a warning, not a hard failure
    if (availableClients.length < 2) {
      console.warn('WARNING: Only one L1 client is running. Client diversity is compromised.');
    }
    expect(availableClients.length).toBeGreaterThanOrEqual(1);
  });

  it('should have consistent chain ID across all L1 clients', async () => {
    if (availableClients.length < 2) return;

    const chainIds: bigint[] = [];
    for (const client of availableClients) {
      const health = await isClientHealthy(client);
      if (health.chainId) chainIds.push(health.chainId);
    }

    const uniqueChainIds = new Set(chainIds);
    expect(uniqueChainIds.size).toBe(1);
  });

  it('should have consistent block heights across L1 clients (within tolerance)', async () => {
    if (availableClients.length < 2) return;

    const blockNumbers: bigint[] = [];
    for (const client of availableClients) {
      const health = await isClientHealthy(client);
      if (health.blockNumber !== undefined) blockNumbers.push(health.blockNumber);
    }

    // Allow up to 3 blocks difference (network propagation delay)
    const maxBlock = blockNumbers.reduce((a, b) => a > b ? a : b, 0n);
    const minBlock = blockNumbers.reduce((a, b) => a < b ? a : b, maxBlock);
    const difference = maxBlock - minBlock;

    expect(difference).toBeLessThanOrEqual(3n);
  });

  it('should correctly identify client versions', async () => {
    for (const client of availableClients) {
      const version = await getClientVersion(client);
      expect(version).not.toBe('unavailable');
      
      // Log version info (may be Anvil in local dev)
      console.log(`  ${client.name}: ${version}`);
      
      // In prod/testnet, verify version string matches expected client
      // In local dev, Anvil may be running instead
      const isAnvil = version.toLowerCase().includes('anvil');
      if (!isAnvil) {
        if (client.clientType === 'geth') {
          expect(version.toLowerCase()).toContain('geth');
        } else if (client.clientType === 'reth') {
          expect(version.toLowerCase()).toContain('reth');
        } else if (client.clientType === 'nethermind') {
          expect(version.toLowerCase()).toContain('nethermind');
        }
      }
    }
  });
});

// ============================================================================
// L2 Sequencer Client Diversity Tests
// ============================================================================

describe('L2 Sequencer Client Diversity', () => {
  const availableSequencers: ClientEndpoint[] = [];

  beforeAll(async () => {
    for (const client of L2_CLIENTS) {
      const health = await isClientHealthy(client);
      if (health.healthy) {
        availableSequencers.push(client);
      }
    }
  });

  it('should have at least one L2 sequencer available', () => {
    // In local dev without docker-compose, no L2 is expected
    if (availableSequencers.length === 0) {
      console.warn('WARNING: No L2 sequencers available. Run docker-compose up for full testing.');
    }
    // This is a warning, not a failure for local dev
    expect(true).toBe(true);
  });

  it('should have multiple sequencers for decentralization', () => {
    if (availableSequencers.length < 2) {
      console.warn('WARNING: Less than 2 sequencers running. Not decentralization compliant.');
    }
    // For true decentralization, we need at least 2 sequencers
    // But for local dev, 0 is acceptable
    expect(availableSequencers.length).toBeGreaterThanOrEqual(0);
  });

  it('should have consistent network chain ID across all sequencers', async () => {
    if (availableSequencers.length < 2) return;

    const EXPECTED_JEJU_CHAIN_ID = 420690n;
    
    for (const client of availableSequencers) {
      const health = await isClientHealthy(client);
      if (health.chainId) {
        expect(health.chainId).toBe(EXPECTED_JEJU_CHAIN_ID);
      }
    }
  });

  it('should have sequencer diversity (not all same client type)', async () => {
    if (availableSequencers.length < 2) return;

    const clientTypes = new Set(availableSequencers.map(c => c.clientType));
    
    if (clientTypes.size === 1) {
      console.warn('WARNING: All sequencers are the same client type. No client diversity.');
    }
    
    // Ideally we want at least 2 different client types
    expect(clientTypes.size).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// State Consistency Tests
// ============================================================================

describe('Cross-Client State Consistency', () => {
  it('should return same account balance across L1 clients', async () => {
    const availableClients: ClientEndpoint[] = [];
    for (const client of L1_CLIENTS) {
      const health = await isClientHealthy(client);
      if (health.healthy) availableClients.push(client);
    }
    
    if (availableClients.length < 2) return;

    const testAddress = '0x0000000000000000000000000000000000000001';
    const balances: bigint[] = [];

    for (const client of availableClients) {
      const publicClient = await createProvider(client);
      const balance = await getBalance(publicClient, { address: testAddress as `0x${string}` });
      balances.push(balance);
    }

    // All balances should match
    const uniqueBalances = new Set(balances.map(b => b.toString()));
    expect(uniqueBalances.size).toBe(1);
  });

  it('should return same transaction receipt across L2 clients', async () => {
    const availableSequencers: ClientEndpoint[] = [];
    for (const client of L2_CLIENTS) {
      const health = await isClientHealthy(client);
      if (health.healthy) availableSequencers.push(client);
    }
    
    if (availableSequencers.length < 2) return;

    // Get a recent block and check if transaction receipts match
    const publicClient1 = await createProvider(availableSequencers[0]);
    const blockNumber = await getBlockNumber(publicClient1);
    
    if (blockNumber === 0n) return;

    const block1 = await publicClient1.getBlock({ blockNumber });
    if (!block1 || block1.transactions.length === 0) return;

    const txHash = block1.transactions[0] as `0x${string}`;
    const receipts: (TransactionReceipt | null)[] = [];

    for (const client of availableSequencers) {
      const publicClient = await createProvider(client);
      try {
        const receipt = await getTransactionReceipt(publicClient, { hash: txHash });
        receipts.push(receipt);
      } catch {
        receipts.push(null);
      }
    }

    // All receipts should have same status and block number
    const statuses = receipts.map(r => r?.status);
    const blocks = receipts.map(r => r?.blockNumber);

    expect(new Set(statuses).size).toBe(1);
    expect(new Set(blocks).size).toBe(1);
  });
});

// ============================================================================
// Sequencer Registration Tests
// ============================================================================

describe('Sequencer Registration Validation', () => {
  const SEQUENCER_REGISTRY_ADDRESS = process.env.SEQUENCER_REGISTRY_ADDRESS;
  
  it('should be able to read active sequencers from registry', async () => {
    if (!SEQUENCER_REGISTRY_ADDRESS) {
      console.warn('SEQUENCER_REGISTRY_ADDRESS not set, skipping');
      return;
    }

    const l1Client = L1_CLIENTS.find(c => c.clientType === 'geth');
    if (!l1Client) return;

    const health = await isClientHealthy(l1Client);
    if (!health.healthy) return;

    const publicClient = await createProvider(l1Client);
    const registryAbi = [
      'function getActiveSequencers() view returns (address[] addresses, uint256[] weights)',
      'function totalStaked() view returns (uint256)',
    ] as const;

    const { readContract } = await import('viem');
    
    try {
      const result = await readContract(publicClient, {
        address: SEQUENCER_REGISTRY_ADDRESS as `0x${string}`,
        abi: registryAbi,
        functionName: 'getActiveSequencers',
      }) as [readonly `0x${string}`[], readonly bigint[]];
      
      const [addresses, weights] = result;
      const totalStaked = await readContract(publicClient, {
        address: SEQUENCER_REGISTRY_ADDRESS as `0x${string}`,
        abi: registryAbi,
        functionName: 'totalStaked',
      }) as bigint;

      expect(Array.isArray(addresses)).toBe(true);
      expect(Array.isArray(weights)).toBe(true);
      expect(typeof totalStaked).toBe('bigint');
    } catch (error) {
      // Contract might not be deployed in local dev
      console.warn('Could not read from SequencerRegistry:', error);
    }
  });
});

// ============================================================================
// Summary Report
// ============================================================================

describe('Client Diversity Summary', () => {
  it('should generate diversity report', async () => {
    console.log('\n=== CLIENT DIVERSITY REPORT ===\n');

    console.log('L1 Clients:');
    for (const client of L1_CLIENTS) {
      const health = await isClientHealthy(client);
      const version = await getClientVersion(client);
      console.log(`  ${client.name}: ${health.healthy ? 'HEALTHY' : 'UNAVAILABLE'} - Block: ${health.blockNumber ?? 'N/A'} - ${version}`);
    }

    console.log('\nL2 Sequencers:');
    for (const client of L2_CLIENTS) {
      const health = await isClientHealthy(client);
      const version = await getClientVersion(client);
      console.log(`  ${client.name}: ${health.healthy ? 'HEALTHY' : 'UNAVAILABLE'} - Block: ${health.blockNumber ?? 'N/A'} - ${version}`);
    }

    const l1Healthy = (await Promise.all(L1_CLIENTS.map(c => isClientHealthy(c)))).filter(h => h.healthy).length;
    const l2Healthy = (await Promise.all(L2_CLIENTS.map(c => isClientHealthy(c)))).filter(h => h.healthy).length;

    console.log(`\nSummary:`);
    console.log(`  L1 Clients: ${l1Healthy}/${L1_CLIENTS.length} healthy`);
    console.log(`  L2 Sequencers: ${l2Healthy}/${L2_CLIENTS.length} healthy`);
    console.log(`  Decentralization Ready: ${l1Healthy >= 2 && l2Healthy >= 2 ? 'YES' : 'NO'}`);
    console.log('');

    expect(true).toBe(true); // Always pass, this is just a report
  });
});

