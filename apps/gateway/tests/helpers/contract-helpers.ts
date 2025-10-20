/**
 * @fileoverview Contract test helper functions
 * @module gateway/tests/helpers/contract-helpers
 */

import { PublicClient, WalletClient } from 'viem';

/**
 * Deploy ERC20 token for testing
 */
export async function deployTestToken(
  _walletClient: WalletClient,
  _name: string,
  _symbol: string
): Promise<`0x${string}`> {
  // TODO: Implement real token deployment for testing
  // For now, return a mock address
  return '0x1234567890123456789012345678901234567890' as `0x${string}`;
}

/**
 * Get token balance
 */
export async function getTokenBalance(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
  account: `0x${string}`
): Promise<bigint> {
  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: [{
      type: 'function',
      name: 'balanceOf',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ type: 'uint256' }],
      stateMutability: 'view',
    }],
    functionName: 'balanceOf',
    args: [account],
  });
  
  return balance as bigint;
}

/**
 * Approve token spending
 */
export async function approveToken(
  walletClient: WalletClient,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Promise<`0x${string}`> {
  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: [{
      type: 'function',
      name: 'approve',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      outputs: [{ type: 'bool' }],
      stateMutability: 'nonpayable',
    }],
    functionName: 'approve',
    args: [spender, amount],
  });
  
  return hash;
}

/**
 * Wait for transaction receipt
 */
export async function waitForTx(
  publicClient: PublicClient,
  hash: `0x${string}`,
  confirmations: number = 1
): Promise<boolean> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations,
  });
  
  return receipt.status === 'success';
}

/**
 * Check if address is valid contract
 */
export async function isContract(
  publicClient: PublicClient,
  address: `0x${string}`
): Promise<boolean> {
  const code = await publicClient.getBytecode({ address });
  return code !== undefined && code !== '0x';
}

/**
 * Get current block number
 */
export async function getCurrentBlock(publicClient: PublicClient): Promise<bigint> {
  return await publicClient.getBlockNumber();
}

/**
 * Mine blocks (for testing time-dependent features)
 */
export async function mineBlocks(publicClient: PublicClient, count: number): Promise<void> {
  // Send eth_mine RPC calls
  for (let i = 0; i < count; i++) {
    await publicClient.request({
      // @ts-expect-error - evm_mine not in standard RPC types
      method: 'evm_mine',
      params: [],
    });
  }
}

/**
 * Increase time (for testing time-locks)
 */
export async function increaseTime(publicClient: PublicClient, seconds: number): Promise<void> {
  await publicClient.request({
    // @ts-expect-error - evm_increaseTime not in standard RPC types
    method: 'evm_increaseTime',
    params: [seconds],
  });
  
  await mineBlocks(publicClient, 1);
}

/**
 * Snapshot and revert (for test isolation)
 */
export async function snapshot(publicClient: PublicClient): Promise<`0x${string}`> {
  const snapshotId = await publicClient.request({
    // @ts-expect-error - evm_snapshot not in standard RPC types
    method: 'evm_snapshot',
    params: [],
  });
  
  return snapshotId as `0x${string}`;
}

export async function revert(publicClient: PublicClient, snapshotId: `0x${string}`): Promise<void> {
  await publicClient.request({
    // @ts-expect-error - evm_revert not in standard RPC types
    method: 'evm_revert',
    params: [snapshotId],
  });
}


