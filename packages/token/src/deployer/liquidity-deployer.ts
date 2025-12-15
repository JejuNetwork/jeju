/**
 * Liquidity Deployer (EVM-only)
 * 
 * Adds liquidity to DEXes on EVM chains.
 * For Solana liquidity deployment, use @jeju/solana package.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem';
import type { ChainDeployment, LiquidityAllocation } from '../types';

// ============================================================================
// ABIs
// ============================================================================

// Uniswap V2 Router ABI (used by most DEXes)
const UNISWAP_V2_ROUTER_ABI = parseAbi([
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function WETH() external view returns (address)',
]);

// Uniswap V3 NonFungiblePositionManager ABI
const UNISWAP_V3_NPM_ABI = parseAbi([
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)',
]);

// ERC20 ABI for approvals
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
]);

// LP Locker ABI
const LP_LOCKER_ABI = parseAbi([
  'function lock(address token, uint256 amount, uint256 unlockTime, address owner) external returns (uint256 lockId)',
  'function unlock(uint256 lockId) external',
  'function getLock(uint256 lockId) external view returns (address token, uint256 amount, uint256 unlockTime, address owner, bool withdrawn)',
]);

// ============================================================================
// Types
// ============================================================================

export type DexProtocol = 'uniswap-v2' | 'uniswap-v3' | 'sushiswap' | 'pancakeswap';

export interface LiquidityDeploymentParams {
  publicClient: PublicClient;
  walletClient: WalletClient;
  tokenAddress: Address;
  routerAddress: Address;
  tokenAmount: bigint;
  ethAmount: bigint;
  recipient: Address;
  deadline?: bigint;
  protocol?: DexProtocol;
}

export interface LiquidityDeploymentResult {
  txHash: Hex;
  lpTokenAmount: bigint;
  tokenAmountUsed: bigint;
  ethAmountUsed: bigint;
  poolAddress?: Address;
}

export interface V3LiquidityParams extends LiquidityDeploymentParams {
  nonfungiblePositionManager: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  token0: Address;
  token1: Address;
}

export interface LPLockParams {
  publicClient: PublicClient;
  walletClient: WalletClient;
  lpTokenAddress: Address;
  amount: bigint;
  lockDuration: number;
  lockerContract: Address;
}

// ============================================================================
// Uniswap V2 Liquidity
// ============================================================================

/**
 * Add liquidity to a Uniswap V2-style DEX
 */
export async function addLiquidityV2(
  params: LiquidityDeploymentParams
): Promise<LiquidityDeploymentResult> {
  const {
    publicClient,
    walletClient,
    tokenAddress,
    routerAddress,
    tokenAmount,
    ethAmount,
    recipient,
  } = params;

  const account = walletClient.account;
  if (!account) throw new Error('WalletClient must have an account');

  // Default deadline: 20 minutes from now
  const deadline =
    params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 1200);

  // 1. Approve router to spend tokens
  console.log(
    `Approving router ${routerAddress} to spend ${tokenAmount} tokens...`
  );
  const approvalHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [routerAddress, tokenAmount],
    chain: walletClient.chain ?? null,
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash: approvalHash });
  console.log(`Approval confirmed: ${approvalHash}`);

  // 2. Add liquidity
  console.log(`Adding liquidity: ${tokenAmount} tokens + ${ethAmount} ETH...`);

  // Allow 1% slippage
  const minTokenAmount = (tokenAmount * 99n) / 100n;
  const minEthAmount = (ethAmount * 99n) / 100n;

  const txHash = await walletClient.writeContract({
    address: routerAddress,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: 'addLiquidityETH',
    args: [
      tokenAddress,
      tokenAmount,
      minTokenAmount,
      minEthAmount,
      recipient,
      deadline,
    ],
    value: ethAmount,
    chain: walletClient.chain ?? null,
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Add liquidity failed: ${txHash}`);
  }

  console.log(`Liquidity added: ${txHash}`);

  return {
    txHash,
    lpTokenAmount: 0n, // Would need to parse logs
    tokenAmountUsed: tokenAmount,
    ethAmountUsed: ethAmount,
  };
}

// ============================================================================
// Uniswap V3 Liquidity
// ============================================================================

/**
 * Add concentrated liquidity to Uniswap V3
 */
export async function addLiquidityV3(
  params: V3LiquidityParams
): Promise<LiquidityDeploymentResult> {
  const {
    publicClient,
    walletClient,
    tokenAddress,
    nonfungiblePositionManager,
    tokenAmount,
    ethAmount,
    recipient,
    fee,
    tickLower,
    tickUpper,
    token0,
    token1,
  } = params;

  const account = walletClient.account;
  if (!account) throw new Error('WalletClient must have an account');

  const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 1200);

  // Determine which is token0 and token1 (sorted by address)
  const isToken0 = token0.toLowerCase() < token1.toLowerCase();
  const amount0Desired = isToken0 ? tokenAmount : ethAmount;
  const amount1Desired = isToken0 ? ethAmount : tokenAmount;

  // Approve token spending
  console.log('Approving token for V3 position manager...');
  const approvalHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [nonfungiblePositionManager, tokenAmount],
    chain: walletClient.chain ?? null,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approvalHash });

  // Mint position
  console.log('Minting V3 liquidity position...');
  const txHash = await walletClient.writeContract({
    address: nonfungiblePositionManager,
    abi: UNISWAP_V3_NPM_ABI,
    functionName: 'mint',
    args: [{
      token0,
      token1,
      fee,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min: 0n,
      amount1Min: 0n,
      recipient,
      deadline,
    }],
    value: isToken0 ? 0n : ethAmount,
    chain: walletClient.chain ?? null,
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`V3 liquidity mint failed: ${txHash}`);
  }

  console.log(`V3 position created: ${txHash}`);

  return {
    txHash,
    lpTokenAmount: 0n, // NFT position
    tokenAmountUsed: tokenAmount,
    ethAmountUsed: ethAmount,
  };
}

// ============================================================================
// LP Token Locking
// ============================================================================

/**
 * Lock LP tokens in a locker contract
 */
export async function lockLPTokens(params: LPLockParams): Promise<{
  txHash: Hex;
  lockId: bigint;
  unlockTime: bigint;
}> {
  const { publicClient, walletClient, lpTokenAddress, amount, lockDuration, lockerContract } = params;

  const account = walletClient.account;
  if (!account) throw new Error('WalletClient must have an account');

  // Approve locker
  console.log('Approving LP tokens for locker...');
  const approvalHash = await walletClient.writeContract({
    address: lpTokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [lockerContract, amount],
    chain: walletClient.chain ?? null,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approvalHash });

  // Lock tokens
  const unlockTime = BigInt(Math.floor(Date.now() / 1000) + lockDuration);
  
  console.log(`Locking ${amount} LP tokens until ${new Date(Number(unlockTime) * 1000).toISOString()}...`);
  
  const txHash = await walletClient.writeContract({
    address: lockerContract,
    abi: LP_LOCKER_ABI,
    functionName: 'lock',
    args: [lpTokenAddress, amount, unlockTime, account.address],
    chain: walletClient.chain ?? null,
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`LP lock failed: ${txHash}`);
  }

  console.log(`LP tokens locked: ${txHash}`);

  // Parse lock ID from logs (simplified - would need to decode)
  return {
    txHash,
    lockId: 0n, // Would parse from logs
    unlockTime,
  };
}

// ============================================================================
// Deploy Liquidity (Legacy Interface)
// ============================================================================

/**
 * Deploy liquidity for a chain (legacy single-chain function)
 */
export async function deployLiquidity(
  publicClient: PublicClient,
  walletClient: WalletClient,
  deployment: ChainDeployment,
  allocation: LiquidityAllocation,
  dexRouter: Address,
  ethAmount: bigint
): Promise<Hex | null> {
  const account = walletClient.account;
  if (!account) throw new Error('WalletClient must have an account');

  // Get token balance
  const tokenBalance = await publicClient.readContract({
    address: deployment.token as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (tokenBalance === 0n) {
    console.log(`No tokens to add as liquidity on chain ${deployment.chainId}`);
    return null;
  }

  // Calculate token amount based on allocation percentage
  const tokenAmount = (tokenBalance * BigInt(allocation.percentage)) / 100n;

  console.log(`Deploying liquidity on ${allocation.dex}:`);
  console.log(`  Tokens: ${tokenAmount}`);
  console.log(`  ETH: ${ethAmount}`);
  console.log(`  Router: ${dexRouter}`);

  const result = await addLiquidityV2({
    publicClient,
    walletClient,
    tokenAddress: deployment.token as Address,
    routerAddress: dexRouter,
    tokenAmount,
    ethAmount,
    recipient: account.address,
  });

  return result.txHash;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate price to tick for V3
 */
export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

/**
 * Calculate tick to price for V3
 */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

/**
 * Get full range ticks for V3
 */
export function getFullRangeTicks(): { tickLower: number; tickUpper: number } {
  return {
    tickLower: -887272,
    tickUpper: 887272,
  };
}

/**
 * Get common fee tier ticks for V3
 */
export function getFeeTierTickSpacing(fee: number): number {
  const spacings: Record<number, number> = {
    500: 10,    // 0.05%
    3000: 60,   // 0.3%
    10000: 200, // 1%
  };
  return spacings[fee] ?? 60;
}
