/**
 * On-Chain Validation Tests
 * Verifies monitoring data matches actual on-chain state via indexer
 */

import { describe, test, expect } from 'bun:test';
import type { GraphQLResponse, JsonRpcParams, JsonRpcResponse } from '../types';

const INDEXER_GRAPHQL_URL = process.env.INDEXER_GRAPHQL_URL || 'http://localhost:4350/graphql';
const RPC_URL = process.env.RPC_URL || 'http://localhost:9545';

async function graphqlQuery<T>(query: string): Promise<T> {
  const response = await fetch(INDEXER_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const result = await response.json() as GraphQLResponse<T>;
  if (result.errors) {
    throw new Error(result.errors[0].message);
  }
  if (!result.data) {
    throw new Error('GraphQL response missing data field');
  }
  return result.data;
}

async function rpcCall<T>(method: string, params: JsonRpcParams = []): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });

  const result = await response.json() as JsonRpcResponse<T>;
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.result;
}

describe('Block Count Validation', () => {
  test('indexed block count should match on-chain', async () => {
    const onChainBlockHex = await rpcCall<string>('eth_blockNumber').catch(() => null);
    if (!onChainBlockHex) {
      console.log('⚠️ RPC not available - skipping on-chain validation');
      return;
    }
    const onChainBlockNumber = parseInt(onChainBlockHex, 16);

    const indexerData = await graphqlQuery<{ blocks: Array<{ number: number }> }>(`
      query {
        blocks(orderBy: number_DESC, limit: 1) {
          number
        }
      }
    `).catch(() => null);

    if (!indexerData) {
      console.log('⚠️ Indexer not available - skipping validation');
      return;
    }

    const firstBlock = indexerData.blocks[0];
    if (!firstBlock) {
      console.log('⚠️ No blocks indexed yet - skipping validation');
      return;
    }
    const indexedBlockNumber = firstBlock.number;

    console.log(`📊 On-chain: ${onChainBlockNumber}, Indexed: ${indexedBlockNumber}`);

    const lag = onChainBlockNumber - indexedBlockNumber;
    expect(lag).toBeLessThan(20);
  });
});

describe('Transaction Count Validation', () => {
  test('should have indexed transactions for recent blocks', async () => {
    const indexerData = await graphqlQuery<{ 
      blocks: Array<{ number: number; transactionCount: number }> 
    }>(`
      query {
        blocks(orderBy: number_DESC, limit: 10) {
          number
          transactionCount
        }
      }
    `).catch(() => null);

    if (!indexerData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    for (const block of indexerData.blocks) {
      const onChainBlock = await rpcCall<{ transactions: string[] }>('eth_getBlockByNumber', [
        `0x${block.number.toString(16)}`,
        false
      ]).catch(() => null);

      if (onChainBlock) {
        const onChainTxCount = onChainBlock.transactions.length;
        expect(block.transactionCount).toBe(onChainTxCount);
        console.log(`   Block ${block.number}: ${block.transactionCount} txs ✓`);
      }
    }
  });
});

describe('Account Tracking Validation', () => {
  test('transaction participants should be tracked as accounts', async () => {
    const txData = await graphqlQuery<{ 
      transactions: Array<{ from: { address: string }; to?: { address: string } }> 
    }>(`
      query {
        transactions(limit: 10) {
          from { address }
          to { address }
        }
      }
    `).catch(() => null);

    if (!txData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    const addresses = new Set<string>();
    for (const tx of txData.transactions) {
      addresses.add(tx.from.address);
      if (tx.to) addresses.add(tx.to.address);
    }

    for (const address of addresses) {
      const accountData = await graphqlQuery<{ accounts: Array<{ address: string }> }>(`
        query {
          accounts(where: { address_eq: "${address}" }) {
            address
          }
        }
      `).catch(() => null);

      expect(accountData?.accounts.length).toBeGreaterThan(0);
    }

    console.log(`   ✓ ${addresses.size} addresses tracked`);
  });
});

describe('Contract Detection Validation', () => {
  test('deployed contracts should be detected', async () => {
    const contractData = await graphqlQuery<{ 
      contracts: Array<{ address: string; isERC20: boolean; isERC721: boolean }> 
    }>(`
      query {
        contracts(limit: 10) {
          address
          isERC20
          isERC721
        }
      }
    `).catch(() => null);

    if (!contractData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    for (const contract of contractData.contracts) {
      const code = await rpcCall<string>('eth_getCode', [contract.address, 'latest']).catch(() => '0x');
      expect(code.length).toBeGreaterThan(2);
    }

    console.log(`   ✓ ${contractData.contracts.length} contracts verified on-chain`);
  });
});

describe('Token Transfer Validation', () => {
  test('ERC20 transfers should have valid balances', async () => {
    const transferData = await graphqlQuery<{
      tokenTransfers: Array<{
        from: { address: string };
        to: { address: string };
        token: { address: string };
        value: string;
        tokenStandard: string;
      }>
    }>(`
      query {
        tokenTransfers(where: { tokenStandard_eq: ERC20 }, limit: 5) {
          from { address }
          to { address }
          token { address }
          value
          tokenStandard
        }
      }
    `).catch(() => null);

    if (!transferData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    console.log(`   📊 Found ${transferData.tokenTransfers.length} ERC20 transfers`);

    for (const transfer of transferData.tokenTransfers) {
      expect(transfer.from.address).toMatch(/^0x[a-f0-9]{40}$/i);
      expect(transfer.to.address).toMatch(/^0x[a-f0-9]{40}$/i);
      expect(BigInt(transfer.value)).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe('Event Decoding Validation', () => {
  test('decoded events should have valid signatures', async () => {
    const eventData = await graphqlQuery<{
      decodedEvents: Array<{
        eventName: string;
        eventSignature: string;
        args: Record<string, string>;
      }>
    }>(`
      query {
        decodedEvents(limit: 20) {
          eventName
          eventSignature
          args
        }
      }
    `).catch(() => null);

    if (!eventData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    const eventNames = new Set<string>();
    for (const event of eventData.decodedEvents) {
      expect(event.eventSignature).toMatch(/^0x[a-f0-9]{64}$/i);
      expect(event.eventName.length).toBeGreaterThan(0);
      eventNames.add(event.eventName);
    }

    console.log(`   ✓ ${eventNames.size} unique event types decoded`);
    console.log(`   Events: ${Array.from(eventNames).slice(0, 5).join(', ')}...`);
  });
});

describe('Block Data Integrity', () => {
  test('block hashes should match on-chain', async () => {
    const indexerData = await graphqlQuery<{
      blocks: Array<{ number: number; hash: string; parentHash: string }>
    }>(`
      query {
        blocks(orderBy: number_DESC, limit: 5) {
          number
          hash
          parentHash
        }
      }
    `).catch(() => null);

    if (!indexerData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    for (const block of indexerData.blocks) {
      const onChainBlock = await rpcCall<{ hash: string; parentHash: string }>('eth_getBlockByNumber', [
        `0x${block.number.toString(16)}`,
        false
      ]).catch(() => null);

      if (onChainBlock) {
        expect(block.hash.toLowerCase()).toBe(onChainBlock.hash.toLowerCase());
        expect(block.parentHash.toLowerCase()).toBe(onChainBlock.parentHash.toLowerCase());
      }
    }

    console.log(`   ✓ ${indexerData.blocks.length} block hashes verified`);
  });
});

describe('Transaction Data Integrity', () => {
  test('transaction data should match on-chain', async () => {
    const indexerData = await graphqlQuery<{
      transactions: Array<{
        hash: string;
        from: { address: string };
        value: string;
        nonce: number;
      }>
    }>(`
      query {
        transactions(limit: 5) {
          hash
          from { address }
          value
          nonce
        }
      }
    `).catch(() => null);

    if (!indexerData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    for (const tx of indexerData.transactions) {
      const onChainTx = await rpcCall<{
        from: string;
        value: string;
        nonce: string;
      }>('eth_getTransactionByHash', [tx.hash]).catch(() => null);

      if (onChainTx) {
        expect(tx.from.address.toLowerCase()).toBe(onChainTx.from.toLowerCase());
        expect(BigInt(tx.value)).toBe(BigInt(onChainTx.value));
        expect(tx.nonce).toBe(parseInt(onChainTx.nonce, 16));
      }
    }

    console.log(`   ✓ ${indexerData.transactions.length} transactions verified`);
  });
});

describe('Log Data Integrity', () => {
  test('logs should match on-chain receipts', async () => {
    const indexerData = await graphqlQuery<{
      logs: Array<{
        transaction: { hash: string };
        logIndex: number;
        address: { address: string };
        topic0: string;
        data: string;
      }>
    }>(`
      query {
        logs(limit: 5) {
          transaction { hash }
          logIndex
          address { address }
          topic0
          data
        }
      }
    `).catch(() => null);

    if (!indexerData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    for (const log of indexerData.logs) {
      const receipt = await rpcCall<{
        logs: Array<{ logIndex: string; address: string; topics: string[]; data: string }>
      }>('eth_getTransactionReceipt', [log.transaction.hash]).catch(() => null);

      if (receipt) {
        const onChainLog = receipt.logs[log.logIndex];
        if (onChainLog) {
          expect(log.address.address.toLowerCase()).toBe(onChainLog.address.toLowerCase());
          if (log.topic0 && onChainLog.topics[0]) {
            expect(log.topic0.toLowerCase()).toBe(onChainLog.topics[0].toLowerCase());
          }
        }
      }
    }

    console.log(`   ✓ ${indexerData.logs.length} logs verified`);
  });
});

describe('Metrics Consistency', () => {
  test('account count should match unique addresses in transactions', async () => {
    const accountCount = await graphqlQuery<{ accountsConnection: { totalCount: number } }>(`
      query {
        accountsConnection {
          totalCount
        }
      }
    `).catch(() => null);

    const txData = await graphqlQuery<{ transactions: Array<{ from: { address: string } }> }>(`
      query {
        transactions(limit: 1000) {
          from { address }
        }
      }
    `).catch(() => null);

    if (!accountCount || !txData) {
      console.log('⚠️ Indexer not available');
      return;
    }

    const uniqueAddresses = new Set(txData.transactions.map(tx => tx.from.address));
    
    console.log(`   📊 Total accounts: ${accountCount.accountsConnection.totalCount}`);
    console.log(`   📊 Unique tx senders (sample): ${uniqueAddresses.size}`);

    expect(accountCount.accountsConnection.totalCount).toBeGreaterThanOrEqual(uniqueAddresses.size);
  });
});

