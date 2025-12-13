/**
 * On-chain Validation Helpers - Verify blockchain state in E2E tests
 * 
 * PURPOSE: Ensure tests actually change blockchain state, not just UI.
 * 
 * USAGE PATTERN:
 *   const before = await getEthBalance(address);
 *   // ... perform action in UI ...
 *   await verifyBalanceChanged(address, before, { direction: 'decrease' });
 * 
 * CLIENT CACHING:
 * - Clients are cached for 30s to avoid connection overhead
 * - Call clearClientCache() between test files if needed
 * 
 * LIMITATIONS:
 * - Assumes single chain (no multi-chain tests)
 * - Event verification is by signature, not decoded args
 */

import {
  createPublicClient,
  http,
  parseAbi,
  formatEther,
  type Address,
  type Hash,
  type Chain,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';

const DEFAULT_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545';
const DEFAULT_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');
const CLIENT_TTL_MS = 30_000; // Cached client TTL - balance staleness vs connection overhead

const clientCache = new Map<string, { client: PublicClient; createdAt: number }>();

function getPublicClient(rpcUrl?: string): PublicClient {
  const url = rpcUrl || DEFAULT_RPC_URL;
  const cached = clientCache.get(url);

  if (cached && Date.now() - cached.createdAt < CLIENT_TTL_MS) {
    return cached.client;
  }

  const client = createPublicClient({
    chain: {
      id: DEFAULT_CHAIN_ID,
      name: 'Jeju',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [url] } },
    } as Chain,
    transport: http(url),
  });

  clientCache.set(url, { client, createdAt: Date.now() });
  return client;
}

export function clearClientCache(): void {
  clientCache.clear();
}

export const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]);

export const ERC721_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export async function verifyTransactionMined(
  txHash: Hash,
  options: { timeout?: number; rpcUrl?: string } = {}
): Promise<TransactionReceipt> {
  const { timeout = 60000, rpcUrl } = options;
  const client = getPublicClient(rpcUrl);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    timeout,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Transaction ${txHash} failed with status: ${receipt.status}`);
  }

  console.log(`✅ Transaction mined: ${txHash}`);
  console.log(`   Block: ${receipt.blockNumber}, Gas used: ${receipt.gasUsed}`);

  return receipt;
}

export async function verifyBalanceChanged(
  address: Address,
  balanceBefore: bigint,
  options: {
    expectedChange?: bigint;
    direction?: 'increase' | 'decrease' | 'any';
    tolerance?: bigint;
    rpcUrl?: string;
  } = {}
): Promise<{ balanceAfter: bigint; change: bigint }> {
  const { direction = 'any', tolerance = 0n, rpcUrl } = options;
  const balanceAfter = await getPublicClient(rpcUrl).getBalance({ address });
  const change = balanceAfter - balanceBefore;
  const absChange = change < 0n ? -change : change;

  if (direction === 'any' && absChange === 0n) {
    throw new Error(`Balance unchanged at ${formatEther(balanceAfter)} ETH`);
  }
  if (direction === 'increase' && change <= 0n) {
    throw new Error(`Expected increase, got ${formatEther(change)} ETH`);
  }
  if (direction === 'decrease' && change >= 0n) {
    throw new Error(`Expected decrease, got ${formatEther(change)} ETH`);
  }
  if (options.expectedChange !== undefined) {
    const diff = absChange - options.expectedChange;
    if ((diff < 0n ? -diff : diff) > tolerance) {
      throw new Error(`Expected ${formatEther(options.expectedChange)} ETH change, got ${formatEther(change)} ETH`);
    }
  }

  console.log(`✅ Balance: ${formatEther(balanceBefore)} -> ${formatEther(balanceAfter)} ETH`);
  return { balanceAfter, change };
}

export async function verifyTokenBalanceChanged(
  tokenAddress: Address,
  accountAddress: Address,
  balanceBefore: bigint,
  options: { direction?: 'increase' | 'decrease' | 'any'; rpcUrl?: string } = {}
): Promise<{ balanceAfter: bigint; change: bigint }> {
  const { direction = 'any', rpcUrl } = options;
  const balanceAfter = await getPublicClient(rpcUrl).readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [accountAddress],
  });
  const change = balanceAfter - balanceBefore;

  if (direction === 'any' && change === 0n) throw new Error(`Token balance unchanged at ${balanceAfter}`);
  if (direction === 'increase' && change <= 0n) throw new Error(`Expected increase, got ${change}`);
  if (direction === 'decrease' && change >= 0n) throw new Error(`Expected decrease, got ${change}`);

  console.log(`✅ Token: ${balanceBefore} -> ${balanceAfter}`);
  return { balanceAfter, change };
}

export async function verifyContractEvent(
  receipt: TransactionReceipt,
  options: {
    contractAddress?: Address;
    eventSignature?: string;
    expectedTopics?: string[];
    minLogs?: number;
  } = {}
): Promise<Log[]> {
  const { contractAddress, eventSignature, expectedTopics, minLogs = 1 } = options;
  let logs = receipt.logs;

  if (contractAddress) {
    logs = logs.filter(l => l.address.toLowerCase() === contractAddress.toLowerCase());
  }

  if (eventSignature) {
    const { keccak256, toBytes } = await import('viem');
    const topic = keccak256(toBytes(eventSignature));
    logs = logs.filter(l => l.topics[0]?.toLowerCase() === topic.toLowerCase());
  }

  if (expectedTopics?.length) {
    logs = logs.filter(log =>
      expectedTopics.every((t, i) => !t || log.topics[i + 1]?.toLowerCase() === t.toLowerCase())
    );
  }

  if (logs.length < minLogs) {
    throw new Error(`Expected ${minLogs}+ events, found ${logs.length} in tx ${receipt.transactionHash}`);
  }

  console.log(`✅ Found ${logs.length} event(s)${eventSignature ? ` (${eventSignature})` : ''}`);
  return logs;
}

export async function verifyContractState<T>(
  contractAddress: Address,
  abi: readonly unknown[],
  functionName: string,
  args: unknown[],
  expected: T,
  options: { rpcUrl?: string } = {}
): Promise<T> {
  const actual = await getPublicClient(options.rpcUrl).readContract({
    address: contractAddress,
    abi,
    functionName,
    args,
  });

  if (actual !== expected) {
    throw new Error(`${functionName}: expected ${expected}, got ${actual}`);
  }
  console.log(`✅ ${functionName} = ${actual}`);
  return actual as T;
}

export async function getEthBalance(address: Address, options: { rpcUrl?: string } = {}): Promise<bigint> {
  return getPublicClient(options.rpcUrl).getBalance({ address });
}

export async function getTokenBalance(
  tokenAddress: Address,
  accountAddress: Address,
  options: { rpcUrl?: string } = {}
): Promise<bigint> {
  return getPublicClient(options.rpcUrl).readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [accountAddress],
  });
}

export async function verifyContractDeployed(address: Address, options: { rpcUrl?: string } = {}): Promise<void> {
  const code = await getPublicClient(options.rpcUrl).getCode({ address });
  if (!code || code === '0x') throw new Error(`No contract at ${address}`);
  console.log(`✅ Contract at ${address}`);
}

export async function verifyNFTOwnership(
  nftAddress: Address,
  tokenId: bigint,
  expectedOwner: Address,
  options: { rpcUrl?: string } = {}
): Promise<void> {
  const owner = await getPublicClient(options.rpcUrl).readContract({
    address: nftAddress,
    abi: ERC721_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });

  if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(`NFT ${tokenId}: expected ${expectedOwner}, got ${owner}`);
  }
  console.log(`✅ NFT ${tokenId} -> ${owner}`);
}

export async function createAccountSnapshot(
  address: Address,
  tokenAddresses: Address[] = [],
  options: { rpcUrl?: string } = {}
): Promise<{ ethBalance: bigint; tokenBalances: Map<Address, bigint>; blockNumber: bigint }> {
  const client = getPublicClient(options.rpcUrl);
  const [ethBalance, blockNumber] = await Promise.all([
    client.getBalance({ address }),
    client.getBlockNumber(),
  ]);

  const tokenBalances = new Map<Address, bigint>();
  for (const token of tokenAddresses) {
    tokenBalances.set(token, await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    }));
  }
  return { ethBalance, tokenBalances, blockNumber };
}

export function compareSnapshots(
  before: Awaited<ReturnType<typeof createAccountSnapshot>>,
  after: Awaited<ReturnType<typeof createAccountSnapshot>>
): { ethChange: bigint; tokenChanges: Map<Address, bigint>; blocksDiff: bigint } {
  const tokenChanges = new Map<Address, bigint>();
  for (const [addr, bal] of before.tokenBalances) {
    tokenChanges.set(addr, (after.tokenBalances.get(addr) || 0n) - bal);
  }
  return {
    ethChange: after.ethBalance - before.ethBalance,
    tokenChanges,
    blocksDiff: after.blockNumber - before.blockNumber,
  };
}
