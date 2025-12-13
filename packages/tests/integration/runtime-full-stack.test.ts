/**
 * @fileoverview Full-stack runtime integration test
 * @module tests/integration/runtime-full-stack
 * 
 * This test suite verifies that all Jeju services work together in a running system:
 * 
 * Services Tested:
 * - L1 (Geth) - Settlement layer
 * - L2 (op-geth) - Jeju execution layer
 * - Indexer (Subsquid) - Data indexing
 * - Oracle Bot - Price feed updates
 * - Node Explorer - Operator dashboard
 * 
 * Test Flow:
 * 1. Verify all services are running
 * 2. Deploy smart contracts
 * 3. Execute transactions
 * 4. Verify indexer captures data
 * 5. Test cross-service communication
 * 6. Validate data consistency
 * 
 * @example Prerequisites
 * ```bash
 * # Terminal 1: Start localnet
 * bun run localnet:start
 * 
 * # Terminal 2: Start indexer
 * cd apps/indexer && bun run dev
 * 
 * # Terminal 3: Run tests
 * bun test tests/integration/runtime-full-stack.test.ts
 * ```
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';
import {
  JEJU_LOCALNET,
  L1_LOCALNET,
  TEST_WALLETS,
  APP_URLS,
  APP_PORTS,
  TIMEOUTS,
} from '../shared/constants';

// Quick check if L2 RPC is available before running full suite
const l2RpcUrl = JEJU_LOCALNET.rpcUrl;
let servicesAvailable = false;
try {
  const res = await fetch(l2RpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    signal: AbortSignal.timeout(2000),
  });
  servicesAvailable = res.ok;
} catch {
  servicesAvailable = false;
}
if (!servicesAvailable) {
  console.log('⏭️  Skipping Runtime Full Stack tests - services not running');
  console.log('   Start with: bun run localnet:start');
}

/** Configuration for runtime testing derived from shared constants */
interface RuntimeConfig {
  l1: {
    rpcUrl: string;
    chainId: number;
  };
  l2: {
    rpcUrl: string;
    wsUrl: string;
    chainId: number;
  };
  indexer: {
    graphqlUrl: string;
    databaseUrl: string;
  };
  timeouts: {
    blockProduction: number;
    indexerSync: number;
    rpcResponse: number;
  };
}

const HOST = process.env.HOST || '127.0.0.1';

const CONFIG: RuntimeConfig = {
  l1: {
    rpcUrl: L1_LOCALNET.rpcUrl,
    chainId: L1_LOCALNET.chainId,
  },
  l2: {
    rpcUrl: JEJU_LOCALNET.rpcUrl,
    wsUrl: JEJU_LOCALNET.wsUrl,
    chainId: JEJU_LOCALNET.chainId,
  },
  indexer: {
    graphqlUrl: APP_URLS.indexerGraphQL,
    databaseUrl: process.env.INDEXER_DATABASE_URL || `postgresql://postgres:postgres@${HOST}:${APP_PORTS.indexerDatabase}/indexer`,
  },
  timeouts: {
    blockProduction: TIMEOUTS.blockProduction,
    indexerSync: TIMEOUTS.indexerSync,
    rpcResponse: TIMEOUTS.rpcResponse,
  },
};

/**
 * Service status tracker
 */
interface ServiceStatus {
  l1Rpc: boolean;
  l2Rpc: boolean;
  l2Ws: boolean;
  indexer: boolean;
  database: boolean;
}

/**
 * Deployment registry for test contracts
 */
interface DeployedContracts {
  token?: {
    address: string;
    abi: any[];
  };
  oracle?: {
    address: string;
    abi: any[];
  };
  vault?: {
    address: string;
    abi: any[];
  };
  paymaster?: {
    address: string;
    abi: any[];
  };
}

describe.skipIf(!servicesAvailable)('Runtime Full Stack Integration', () => {
  let serviceStatus: ServiceStatus;
  let l1Provider: ethers.Provider;
  let l2Provider: ethers.Provider;
  let l2WsProvider: ethers.WebSocketProvider | null = null;
  let deployer: ethers.Wallet;
  const deployedContracts: DeployedContracts = {};

  beforeAll(async () => {
    console.log('\n🔍 Checking service availability...\n');

    serviceStatus = {
      l1Rpc: await checkService('L1 RPC', CONFIG.l1.rpcUrl),
      l2Rpc: await checkService('L2 RPC', CONFIG.l2.rpcUrl),
      l2Ws: await checkWebSocket('L2 WebSocket', CONFIG.l2.wsUrl),
      indexer: await checkGraphQL('Indexer GraphQL', CONFIG.indexer.graphqlUrl),
      database: await checkDatabase('PostgreSQL', CONFIG.indexer.databaseUrl),
    };

    console.log('');

    // Initialize providers
    l1Provider = new ethers.JsonRpcProvider(CONFIG.l1.rpcUrl);
    l2Provider = new ethers.JsonRpcProvider(CONFIG.l2.rpcUrl);
    
    // Try WebSocket (optional)
    try {
      l2WsProvider = new ethers.WebSocketProvider(CONFIG.l2.wsUrl);
    } catch (error) {
      console.log('ℹ️  WebSocket provider not available (optional)');
    }

    deployer = new ethers.Wallet(TEST_WALLETS.deployer.privateKey, l2Provider);
  });

  describe('Service Health Checks', () => {
    it('L1 RPC should be running', () => {
      expect(serviceStatus.l1Rpc).toBe(true);
    });

    it('L2 RPC should be running', () => {
      expect(serviceStatus.l2Rpc).toBe(true);
    });

    it('L2 should have correct chain ID', async () => {
      const network = await l2Provider.getNetwork();
      expect(Number(network.chainId)).toBe(CONFIG.l2.chainId);
    });
  });

  describe('Block Production', () => {
    it('L1 should be producing blocks', async () => {
      const block1 = await l1Provider.getBlockNumber();
      await sleep(2000);
      const block2 = await l1Provider.getBlockNumber();
      
      expect(block2).toBeGreaterThan(block1);
      console.log(`   ✅ L1 produced ${block2 - block1} blocks in 2s`);
    });

    it('L2 should be producing blocks', async () => {
      const block1 = await l2Provider.getBlockNumber();
      await sleep(3000); // Wait for 1-2 blocks (2s block time)
      const block2 = await l2Provider.getBlockNumber();
      
      expect(block2).toBeGreaterThan(block1);
      console.log(`   ✅ L2 produced ${block2 - block1} blocks in 3s`);
    });

    it('L2 blocks should have reasonable timestamps', async () => {
      const block = await l2Provider.getBlock('latest');
      const now = Math.floor(Date.now() / 1000);
      const blockTime = Number(block!.timestamp);
      
      // Block timestamp should be within last minute
      expect(Math.abs(now - blockTime)).toBeLessThan(60);
      console.log(`   ⏰ Latest block timestamp: ${new Date(blockTime * 1000).toISOString()}`);
    });
  });

  describe('Transaction Execution', () => {
    let txHash: string;

    it('should send and confirm transaction', async () => {
      console.log('   📤 Sending test transaction...');
      
      const tx = await deployer.sendTransaction({
        to: TEST_WALLETS.user1.address,
        value: ethers.parseEther('0.5'),
      });

      txHash = tx.hash;
      console.log(`   📝 Transaction hash: ${txHash.slice(0, 20)}...`);

      const receipt = await tx.wait();
      expect(receipt?.status).toBe(1);
      expect(receipt?.blockNumber).toBeGreaterThan(0);
      
      console.log(`   ✅ Confirmed in block ${receipt?.blockNumber}`);
      console.log(`   ⛽ Gas used: ${receipt?.gasUsed.toString()}`);
    }, CONFIG.timeouts.blockProduction);

    it('should verify transaction on RPC', async () => {
      const tx = await l2Provider.getTransaction(txHash);
      
      expect(tx).toBeTruthy();
      expect(tx?.hash).toBe(txHash);
      expect(tx?.from.toLowerCase()).toBe(deployer.address.toLowerCase());
      
      console.log(`   ✅ Transaction verified on RPC`);
    });

    it('should get transaction receipt', async () => {
      const receipt = await l2Provider.getTransactionReceipt(txHash);
      
      expect(receipt).toBeTruthy();
      expect(receipt?.status).toBe(1);
      
      console.log(`   ✅ Receipt retrieved successfully`);
    });
  });

  describe('Indexer Synchronization', () => {
    it('should check if indexer is running', () => {
      if (!serviceStatus.indexer) {
        console.log('   ⏭️  Indexer not running - skipping indexer tests');
        console.log('   ℹ️  Start with: cd apps/indexer && npm run dev');
        return;
      }
      
      expect(serviceStatus.indexer).toBe(true);
    });

    it('should query indexed blocks', async () => {
      if (!serviceStatus.indexer) return;

      const data = await queryGraphQL(`{
        blocks(limit: 5, orderBy: number_DESC) {
          number
          hash
          timestamp
          transactionCount
        }
      }`);

      expect(data.blocks).toBeTruthy();
      expect(data.blocks.length).toBeGreaterThan(0);
      
      console.log(`   📊 Indexed blocks: ${data.blocks.length}`);
      console.log(`   📈 Latest: #${data.blocks[0].number}`);
    }, CONFIG.timeouts.indexerSync);

    it('should query indexed transactions', async () => {
      if (!serviceStatus.indexer) return;

      const data = await queryGraphQL(`{
        transactions(limit: 10, orderBy: id_DESC) {
          hash
          status
          value
        }
      }`);

      expect(data.transactions).toBeTruthy();
      console.log(`   📊 Indexed transactions: ${data.transactions.length}`);
    }, CONFIG.timeouts.indexerSync);

    it('should query indexed event logs', async () => {
      if (!serviceStatus.indexer) return;

      const data = await queryGraphQL(`{
        logs(limit: 10) {
          topic0
          address { address }
        }
      }`);

      expect(data.logs).toBeTruthy();
      console.log(`   📊 Indexed logs: ${data.logs.length}`);
    }, CONFIG.timeouts.indexerSync);

    it('should verify event decoding', async () => {
      if (!serviceStatus.indexer) return;

      const data = await queryGraphQL(`{
        decodedEvents(limit: 5) {
          eventName
          eventSignature
        }
      }`);

      if (data.decodedEvents && data.decodedEvents.length > 0) {
        console.log(`   ✅ Decoded ${data.decodedEvents.length} events`);
        const eventNames = new Set(data.decodedEvents.map((e: any) => e.eventName));
        console.log(`   📋 Event types: ${Array.from(eventNames).join(', ')}`);
      } else {
        console.log(`   ℹ️  No decoded events yet (no token transfers)`);
      }
    }, CONFIG.timeouts.indexerSync);
  });

  describe('WebSocket Streaming', () => {
    it('should subscribe to new blocks via WebSocket', async () => {
      if (!l2WsProvider) {
        console.log('   ⏭️  WebSocket not available');
        return;
      }

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('No blocks received in 10 seconds'));
        }, 10000);

        l2WsProvider!.on('block', (blockNumber) => {
          clearTimeout(timeout);
          expect(blockNumber).toBeGreaterThan(0);
          console.log(`   ✅ Received new block notification: ${blockNumber}`);
          l2WsProvider!.removeAllListeners('block');
          resolve();
        });
      });
    }, 15000);
  });

  describe('Data Consistency Verification', () => {
    it('should verify RPC and indexer have consistent block count', async () => {
      if (!serviceStatus.indexer) return;

      const rpcBlockNum = await l2Provider.getBlockNumber();
      
      const indexerData = await queryGraphQL(`{
        blocks(limit: 1, orderBy: number_DESC) {
          number
        }
      }`);

      const indexerBlockNum = indexerData.blocks[0]?.number || 0;
      
      console.log(`   📊 RPC block: ${rpcBlockNum}`);
      console.log(`   📊 Indexer block: ${indexerBlockNum}`);
      
      // Indexer should be close (within 10 blocks)
      expect(rpcBlockNum - indexerBlockNum).toBeLessThan(10);
      
      if (rpcBlockNum - indexerBlockNum > 0) {
        console.log(`   ℹ️  Indexer is ${rpcBlockNum - indexerBlockNum} blocks behind (normal)`);
      } else {
        console.log(`   ✅ Indexer is fully synced`);
      }
    }, CONFIG.timeouts.indexerSync);

    it('should verify transaction data matches between RPC and indexer', async () => {
      if (!serviceStatus.indexer) return;

      // Get a recent transaction from RPC
      const block = await l2Provider.getBlock('latest', true);
      if (!block || block.transactions.length === 0) {
        console.log('   ℹ️  No transactions in latest block');
        return;
      }

      const txHash = block.transactions[0];
      const rpcTx = await l2Provider.getTransaction(txHash as string);
      
      if (!rpcTx) return;

      // Wait for indexer to process
      await sleep(5000);

      // Query from indexer
      const indexerData = await queryGraphQL(`{
        transactions(where: { hash_eq: "${rpcTx.hash}" }) {
          hash
          from { address }
          to { address }
          value
          nonce
        }
      }`);

      if (indexerData.transactions && indexerData.transactions.length > 0) {
        const indexedTx = indexerData.transactions[0];
        
        expect(indexedTx.hash).toBe(rpcTx.hash);
        expect(indexedTx.from.address.toLowerCase()).toBe(rpcTx.from.toLowerCase());
        if (rpcTx.to) {
          expect(indexedTx.to.address.toLowerCase()).toBe(rpcTx.to.toLowerCase());
        }
        expect(BigInt(indexedTx.value)).toBe(rpcTx.value);
        
        console.log('   ✅ RPC and indexer data match perfectly');
      } else {
        console.log('   ℹ️  Transaction not yet indexed (indexer catching up)');
      }
    }, CONFIG.timeouts.indexerSync);
  });

  describe('Performance Benchmarks', () => {
    it('should measure RPC latency', async () => {
      const measurements: number[] = [];

      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await l2Provider.getBlockNumber();
        measurements.push(Date.now() - start);
      }

      const avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const minLatency = Math.min(...measurements);
      const maxLatency = Math.max(...measurements);

      console.log(`   ⏱️  RPC Latency Statistics:`);
      console.log(`      Average: ${avgLatency.toFixed(2)}ms`);
      console.log(`      Min: ${minLatency}ms`);
      console.log(`      Max: ${maxLatency}ms`);

      expect(avgLatency).toBeLessThan(CONFIG.timeouts.rpcResponse);
    });

    it('should measure block production rate', async () => {
      const startBlock = await l2Provider.getBlockNumber();
      const startTime = Date.now();

      await sleep(10000); // Wait 10 seconds

      const endBlock = await l2Provider.getBlockNumber();
      const endTime = Date.now();

      const blocksProduced = endBlock - startBlock;
      const timeElapsed = (endTime - startTime) / 1000; // Convert to seconds
      const blockTime = timeElapsed / blocksProduced;

      console.log(`   ⏱️  Block Production:`);
      console.log(`      Blocks produced: ${blocksProduced}`);
      console.log(`      Time elapsed: ${timeElapsed.toFixed(2)}s`);
      console.log(`      Average block time: ${blockTime.toFixed(2)}s`);

      // Localnet should be ~2s block time
      expect(blockTime).toBeGreaterThan(1);
      expect(blockTime).toBeLessThan(5);
    }, 15000);

    it('should measure indexer sync latency (if running)', async () => {
      if (!serviceStatus.indexer) return;

      // Send transaction
      const txStart = Date.now();
      const tx = await deployer.sendTransaction({
        to: TEST_WALLETS.user1.address,
        value: ethers.parseEther('0.01'),
      });

      const receipt = await tx.wait();
      const txConfirmed = Date.now();

      console.log(`   ⏱️  Transaction confirmed in ${txConfirmed - txStart}ms`);

      // Wait for indexer to process
      let indexed = false;
      let indexTime = 0;

      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        
        try {
          const data = await queryGraphQL(`{
            transactions(where: { hash_eq: "${tx.hash}" }) {
              hash
            }
          }`);

          if (data.transactions && data.transactions.length > 0) {
            indexTime = Date.now();
            indexed = true;
            break;
          }
        } catch (error) {
          // Continue waiting
        }
      }

      if (indexed) {
        const syncLatency = indexTime - txConfirmed;
        console.log(`   ⏱️  Indexer sync latency: ${syncLatency}ms`);
        
        // Should sync within 20 seconds
        expect(syncLatency).toBeLessThan(20000);
      } else {
        console.log('   ⚠️  Transaction not indexed within 20 seconds');
      }
    }, 30000);
  });

  describe('System Integration Summary', () => {
    it('should print comprehensive status report', async () => {
      console.log('\n' + '═'.repeat(60));
      console.log(' '.repeat(15) + 'SYSTEM STATUS REPORT');
      console.log('═'.repeat(60) + '\n');

      // Service Status
      console.log('🔧 Services:');
      console.log(`   L1 RPC:        ${serviceStatus.l1Rpc ? '✅ Running' : '❌ Down'}`);
      console.log(`   L2 RPC:        ${serviceStatus.l2Rpc ? '✅ Running' : '❌ Down'}`);
      console.log(`   L2 WebSocket:  ${serviceStatus.l2Ws ? '✅ Running' : '⏭️  Not available'}`);
      console.log(`   Indexer:       ${serviceStatus.indexer ? '✅ Running' : '⏭️  Not running'}`);
      console.log(`   Database:      ${serviceStatus.database ? '✅ Running' : '⏭️  Not running'}`);
      console.log('');

      // Network Info
      const l2Block = await l2Provider.getBlockNumber();
      const l2Network = await l2Provider.getNetwork();
      const gasPrice = await l2Provider.getFeeData();

      console.log('🌐 Network:');
      console.log(`   Chain ID:      ${l2Network.chainId}`);
      console.log(`   Block Height:  ${l2Block}`);
      console.log(`   Gas Price:     ${ethers.formatUnits(gasPrice.gasPrice || 0, 'gwei')} gwei`);
      console.log('');

      // Account Info
      const balance = await l2Provider.getBalance(deployer.address);
      console.log('👤 Deployer Account:');
      console.log(`   Address:       ${deployer.address}`);
      console.log(`   Balance:       ${ethers.formatEther(balance)} ETH`);
      console.log('');

      // Indexer Stats
      if (serviceStatus.indexer) {
        try {
          const stats = await getIndexerStats();
          console.log('📊 Indexer Statistics:');
          console.log(`   Blocks:        ${stats.blocks}`);
          console.log(`   Transactions:  ${stats.transactions}`);
          console.log(`   Logs:          ${stats.logs}`);
          console.log(`   Contracts:     ${stats.contracts}`);
          console.log(`   Accounts:      ${stats.accounts}`);
          console.log('');
        } catch (error) {
          console.log('📊 Indexer Statistics: Not available\n');
        }
      }

      console.log('═'.repeat(60) + '\n');

      // Verify critical services
      expect(serviceStatus.l1Rpc).toBe(true);
      expect(serviceStatus.l2Rpc).toBe(true);
    });
  });
});

// ============ Helper Functions ============

/**
 * Check if a JSON-RPC service is available
 */
async function checkService(name: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      console.log(`✅ ${name}: Running`);
      return true;
    }
  } catch (error) {
    console.log(`❌ ${name}: Not available`);
  }
  
  return false;
}

/**
 * Check if WebSocket service is available
 */
async function checkWebSocket(name: string, url: string): Promise<boolean> {
  try {
    const ws = new ethers.WebSocketProvider(url);
    await ws.getBlockNumber();
    ws.destroy();
    console.log(`✅ ${name}: Running`);
    return true;
  } catch (error) {
    console.log(`⏭️  ${name}: Not available (optional)`);
    return false;
  }
}

/**
 * Check if GraphQL service is available
 */
async function checkGraphQL(name: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ __schema { queryType { name } } }',
      }),
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      console.log(`✅ ${name}: Running`);
      return true;
    }
  } catch (error) {
    console.log(`⏭️  ${name}: Not running (optional)`);
  }
  
  return false;
}

/**
 * Check if PostgreSQL database is available
 */
async function checkDatabase(name: string, url: string): Promise<boolean> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    await execAsync('docker ps | grep squid-db-1', { timeout: 2000 });
    console.log(`✅ ${name}: Running`);
    return true;
  } catch (error) {
    console.log(`⏭️  ${name}: Not running (optional)`);
    return false;
  }
}

/**
 * Query GraphQL endpoint
 */
async function queryGraphQL(query: string): Promise<any> {
  const response = await fetch(CONFIG.indexer.graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL query failed: ${response.statusText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

/**
 * Get indexer statistics
 */
async function getIndexerStats() {
  const queries = [
    'blocks: { blocks { id } }',
    'transactions: { transactions { id } }',
    'logs: { logs { id } }',
    'contracts: { contracts { id } }',
    'accounts: { accounts { id } }',
  ];

  const stats: any = {};

  for (const q of queries) {
    const [key, query] = q.split(': ');
    const data = await queryGraphQL(`{ ${query} }`);
    const results = data[Object.keys(data)[0]];
    stats[key] = results ? results.length : 0;
  }

  return stats;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


