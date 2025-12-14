/**
 * Blockchain Helpers for Synpress Tests
 * Utilities for manipulating blockchain state (time, blocks, snapshots)
 */

import { Page } from '@playwright/test';

const RPC_URL = 'http://127.0.0.1:9545';

/**
 * Make RPC call to localnet
 */
async function rpcCall(page: Page, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await page.request.post(RPC_URL, {
    data: {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    },
  });
  
  const result = await response.json();
  
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }
  
  return result.result;
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
  const snapshotId = await rpcCall(page, 'evm_snapshot', []);
  console.log(`📸 Snapshot taken: ${snapshotId}`);
  return snapshotId as string;
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
  const blockHex = await rpcCall(page, 'eth_blockNumber', []);
  return parseInt(blockHex as string, 16);
}

/**
 * Get current block timestamp
 */
export async function getBlockTimestamp(page: Page): Promise<number> {
  const block = await rpcCall(page, 'eth_getBlockByNumber', ['latest', false]);
  const blockData = block as { timestamp: string };
  return parseInt(blockData.timestamp, 16);
}

/**
 * Get account balance
 */
export async function getBalance(page: Page, address: string): Promise<bigint> {
  const balanceHex = await rpcCall(page, 'eth_getBalance', [address, 'latest']);
  return BigInt(balanceHex as string);
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
  
  const result = await rpcCall(page, 'eth_call', [
    {
      to: tokenAddress,
      data,
    },
    'latest',
  ]);
  
  return BigInt(result as string);
}

/**
 * Set account balance (for testing)
 */
export async function setBalance(page: Page, address: string, balance: bigint): Promise<void> {
  const balanceHex = '0x' + balance.toString(16);
  await rpcCall(page, 'hardhat_setBalance', [address, balanceHex]);
  console.log(`💰 Set balance for ${address.slice(0, 10)}... to ${balance} wei`);
}

/**
 * Impersonate account (for testing)
 */
export async function impersonateAccount(page: Page, address: string): Promise<void> {
  await rpcCall(page, 'hardhat_impersonateAccount', [address]);
  console.log(`🎭 Impersonating ${address}`);
}

/**
 * Stop impersonating account
 */
export async function stopImpersonating(page: Page, address: string): Promise<void> {
  await rpcCall(page, 'hardhat_stopImpersonatingAccount', [address]);
  console.log(`🎭 Stopped impersonating ${address}`);
}

/**
 * Reset blockchain to initial state
 */
export async function resetBlockchain(page: Page): Promise<void> {
  await rpcCall(page, 'hardhat_reset', []);
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
  const code = await rpcCall(page, 'eth_getCode', [address, 'latest']);
  return code !== '0x' && code !== '0x0';
}

/**
 * Get transaction receipt
 */
export async function getTransactionReceipt(page: Page, txHash: string): Promise<unknown> {
  return await rpcCall(page, 'eth_getTransactionReceipt', [txHash]);
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


