/**
 * Blockchain Helpers for Synpress Tests
 * Utilities for manipulating blockchain state (time, blocks, snapshots)
 */

import { Page } from '@playwright/test';

const RPC_URL = 'http://127.0.0.1:9545';

/** JSON-RPC primitive value */
type JsonPrimitive = string | number | boolean | null;

/** JSON-RPC compatible value */
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** JSON-RPC response structure */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: JsonValue;
  error?: { code: number; message: string };
}

/** Ethereum block structure from eth_getBlockByNumber */
interface EthBlock {
  timestamp: string;
  number: string;
  hash: string;
  parentHash: string;
  nonce: string;
  sha3Uncles: string;
  logsBloom: string;
  transactionsRoot: string;
  stateRoot: string;
  receiptsRoot: string;
  miner: string;
  difficulty: string;
  totalDifficulty: string;
  extraData: string;
  size: string;
  gasLimit: string;
  gasUsed: string;
  transactions: string[];
}

/** Transaction receipt structure from eth_getTransactionReceipt */
interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    transactionHash: string;
    transactionIndex: string;
    blockHash: string;
    logIndex: string;
    removed: boolean;
  }>;
  logsBloom: string;
  status: string;
  effectiveGasPrice?: string;
  type?: string;
}

/**
 * Make RPC call to localnet
 */
async function rpcCall<T = JsonValue>(page: Page, method: string, params: JsonValue[] = []): Promise<T> {
  const response = await page.request.post(RPC_URL, {
    data: {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    },
  });
  
  const result = await response.json() as JsonRpcResponse;
  
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }
  
  return result.result as T;
}

/**
 * Mine a single block
 */
export async function mineBlock(page: Page): Promise<void> {
  await rpcCall(page, 'evm_mine', []);
  console.log('⛏️  Mined 1 block');
}

/**
 * Mine multiple blocks
 */
export async function mineBlocks(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await rpcCall(page, 'evm_mine', []);
  }
  console.log(`⛏️  Mined ${count} blocks`);
}

/**
 * Increase blockchain time by seconds
 */
export async function increaseTime(page: Page, seconds: number): Promise<void> {
  await rpcCall(page, 'evm_increaseTime', [seconds]);
  await mineBlock(page);
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  
  if (days > 0) {
    console.log(`⏰ Fast-forwarded ${days} days ${hours} hours`);
  } else {
    console.log(`⏰ Fast-forwarded ${hours} hours`);
  }
}

/**
 * Set next block timestamp
 */
export async function setNextBlockTimestamp(page: Page, timestamp: number): Promise<void> {
  await rpcCall(page, 'evm_setNextBlockTimestamp', [timestamp]);
  console.log(`⏰ Set next block timestamp to ${new Date(timestamp * 1000).toISOString()}`);
}

/**
 * Take EVM snapshot (for reverting state)
 */
export async function takeSnapshot(page: Page): Promise<string> {
  const snapshotId = await rpcCall<string>(page, 'evm_snapshot', []);
  console.log(`📸 Snapshot taken: ${snapshotId}`);
  return snapshotId;
}

/**
 * Revert to EVM snapshot
 */
export async function revertToSnapshot(page: Page, snapshotId: string): Promise<void> {
  await rpcCall(page, 'evm_revert', [snapshotId]);
  console.log(`⏮️  Reverted to snapshot: ${snapshotId}`);
}

/**
 * Get current block number
 */
export async function getBlockNumber(page: Page): Promise<number> {
  const blockHex = await rpcCall<string>(page, 'eth_blockNumber', []);
  return parseInt(blockHex, 16);
}

/**
 * Get current block timestamp
 */
export async function getBlockTimestamp(page: Page): Promise<number> {
  const block = await rpcCall<EthBlock>(page, 'eth_getBlockByNumber', ['latest', false]);
  return parseInt(block.timestamp, 16);
}

/**
 * Get account balance
 */
export async function getBalance(page: Page, address: string): Promise<bigint> {
  const balanceHex = await rpcCall<string>(page, 'eth_getBalance', [address, 'latest']);
  return BigInt(balanceHex);
}

/**
 * Get ERC20 token balance
 */
export async function getTokenBalance(
  page: Page,
  tokenAddress: string,
  accountAddress: string
): Promise<bigint> {
  // balanceOf(address) call
  const data = `0x70a08231000000000000000000000000${accountAddress.slice(2)}`;
  
  const result = await rpcCall<string>(page, 'eth_call', [
    {
      to: tokenAddress,
      data,
    },
    'latest',
  ]);
  
  return BigInt(result);
}

/**
 * Set account balance (for testing)
 */
export async function setBalance(page: Page, address: string, balance: bigint): Promise<void> {
  const balanceHex = '0x' + balance.toString(16);
  await rpcCall(page, 'anvil_setBalance', [address, balanceHex]);
  console.log(`💰 Set balance for ${address.slice(0, 10)}... to ${balance} wei`);
}

/**
 * Impersonate account (for testing)
 */
export async function impersonateAccount(page: Page, address: string): Promise<void> {
  await rpcCall(page, 'anvil_impersonateAccount', [address]);
  console.log(`🎭 Impersonating ${address}`);
}

/**
 * Stop impersonating account
 */
export async function stopImpersonating(page: Page, address: string): Promise<void> {
  await rpcCall(page, 'anvil_stopImpersonatingAccount', [address]);
  console.log(`🎭 Stopped impersonating ${address}`);
}

/**
 * Reset blockchain to initial state
 */
export async function resetBlockchain(page: Page): Promise<void> {
  await rpcCall(page, 'anvil_reset', []);
  console.log('🔄 Blockchain reset to initial state');
}

/**
 * Fast-forward 7 days (for node deregistration testing)
 */
export async function fastForward7Days(page: Page): Promise<void> {
  await increaseTime(page, 7 * 24 * 60 * 60);
}

/**
 * Fast-forward to specific date
 */
export async function fastForwardToDate(page: Page, targetDate: Date): Promise<void> {
  const currentTimestamp = await getBlockTimestamp(page);
  const targetTimestamp = Math.floor(targetDate.getTime() / 1000);
  const secondsToAdd = targetTimestamp - currentTimestamp;
  
  if (secondsToAdd > 0) {
    await increaseTime(page, secondsToAdd);
  }
}

/**
 * Wait for blocks to be mined (for confirmation)
 */
export async function waitForBlocks(page: Page, blockCount: number): Promise<void> {
  const startBlock = await getBlockNumber(page);
  const targetBlock = startBlock + blockCount;
  
  while ((await getBlockNumber(page)) < targetBlock) {
    await page.waitForTimeout(500);
  }
  
  console.log(`⛓️  Waited for ${blockCount} blocks`);
}

/**
 * Verify contract deployed at address
 */
export async function isContractDeployed(page: Page, address: string): Promise<boolean> {
  const code = await rpcCall<string>(page, 'eth_getCode', [address, 'latest']);
  return code !== '0x' && code !== '0x0';
}

/**
 * Get transaction receipt
 */
export async function getTransactionReceipt(page: Page, txHash: string): Promise<TransactionReceipt | null> {
  return await rpcCall<TransactionReceipt | null>(page, 'eth_getTransactionReceipt', [txHash]);
}

/**
 * Wait for transaction to be mined
 */
export async function waitForTransaction(
  page: Page,
  txHash: string,
  timeout: number = 30000
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const receipt = await getTransactionReceipt(page, txHash);
    
    if (receipt && receipt.blockNumber) {
      console.log(`✅ Transaction ${txHash.slice(0, 10)}... mined`);
      return;
    }
    
    await page.waitForTimeout(1000);
  }
  
  throw new Error(`Transaction ${txHash} not mined within ${timeout}ms`);
}


