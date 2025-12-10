import { Page } from '@playwright/test';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:9545';

export async function rpcCall(page: Page, method: string, params: unknown[] = []): Promise<string> {
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

export async function getBalance(page: Page, address: string): Promise<bigint> {
  const result = await rpcCall(page, 'eth_getBalance', [address, 'latest']);
  return BigInt(result);
}

export async function getBlockNumber(page: Page): Promise<number> {
  const result = await rpcCall(page, 'eth_blockNumber');
  return parseInt(result, 16);
}

export async function getTokenBalance(page: Page, tokenAddress: string, walletAddress: string): Promise<bigint> {
  const data = `0x70a08231000000000000000000000000${walletAddress.slice(2)}`;
  const result = await rpcCall(page, 'eth_call', [{ to: tokenAddress, data }, 'latest']);
  return BigInt(result);
}

export async function getTransactionReceipt(page: Page, txHash: string): Promise<{
  status: string;
  blockNumber: string;
  gasUsed: string;
}> {
  const result = await rpcCall(page, 'eth_getTransactionReceipt', [txHash]);
  return JSON.parse(result);
}

export async function isContractDeployed(page: Page, address: string): Promise<boolean> {
  const code = await rpcCall(page, 'eth_getCode', [address, 'latest']);
  return code !== '0x' && code !== '0x0';
}

// Presale-specific helpers
export async function getPresalePhase(page: Page, presaleAddress: string): Promise<number> {
  // currentPhase() selector
  const data = '0xb7b0e61a';
  const result = await rpcCall(page, 'eth_call', [{ to: presaleAddress, data }, 'latest']);
  return parseInt(result, 16);
}

export async function getPresaleStats(page: Page, presaleAddress: string): Promise<{
  raised: bigint;
  participants: bigint;
  tokensSold: bigint;
}> {
  // getPresaleStats() selector - first 3 return values
  const data = '0x5f1b8a87';
  const result = await rpcCall(page, 'eth_call', [{ to: presaleAddress, data }, 'latest']);
  
  // Decode the result (6 uint256 values)
  const raised = BigInt('0x' + result.slice(2, 66));
  const participants = BigInt('0x' + result.slice(66, 130));
  const tokensSold = BigInt('0x' + result.slice(130, 194));
  
  return { raised, participants, tokensSold };
}

export async function getContribution(page: Page, presaleAddress: string, account: string): Promise<{
  ethAmount: bigint;
  tokenAllocation: bigint;
  bonusTokens: bigint;
  claimedTokens: bigint;
  claimable: bigint;
  refunded: boolean;
}> {
  // getContribution(address) selector
  const data = `0x946e00b8000000000000000000000000${account.slice(2)}`;
  const result = await rpcCall(page, 'eth_call', [{ to: presaleAddress, data }, 'latest']);
  
  const ethAmount = BigInt('0x' + result.slice(2, 66));
  const tokenAllocation = BigInt('0x' + result.slice(66, 130));
  const bonusTokens = BigInt('0x' + result.slice(130, 194));
  const claimedTokens = BigInt('0x' + result.slice(194, 258));
  const claimable = BigInt('0x' + result.slice(258, 322));
  const refunded = parseInt(result.slice(322, 386), 16) === 1;
  
  return { ethAmount, tokenAllocation, bonusTokens, claimedTokens, claimable, refunded };
}

export async function waitForTransaction(page: Page, txHash: string, timeout = 30000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const receipt = await rpcCall(page, 'eth_getTransactionReceipt', [txHash]).catch(() => null);
    if (receipt) return;
    await page.waitForTimeout(1000);
  }
  
  throw new Error(`Transaction ${txHash} not mined within ${timeout}ms`);
}
