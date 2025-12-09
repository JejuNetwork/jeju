/**
 * EIL Hooks for React Apps
 * 
 * Shared hooks for Gateway and Bazaar:
 * - Cross-chain swaps
 * - XLP liquidity management
 * - L1 staking
 * - Fee estimation
 */

import { parseEther, formatEther, Address } from 'viem';

// ============ Types ============

export interface ChainInfo {
  id: number;
  name: string;
  icon: string;
  rpcUrl: string;
  paymasterAddress?: Address;
  isSource: boolean;
  isDestination: boolean;
}

export interface CrossChainSwapParams {
  sourceToken: Address;
  destinationToken: Address;
  amount: bigint;
  sourceChainId: number;
  destinationChainId: number;
  minAmountOut?: bigint;
  recipient?: Address;
}

export interface XLPPosition {
  stakedAmount: bigint;
  unbondingAmount: bigint;
  unbondingStartTime: number;
  slashedAmount: bigint;
  isActive: boolean;
  registeredAt: number;
  supportedChains: number[];
  tokenLiquidity: Map<Address, bigint>;
  ethBalance: bigint;
  pendingFees: bigint;
  totalEarnings: bigint;
}

export interface EILStats {
  totalXLPs: number;
  totalVolume24h: bigint;
  totalLiquidity: bigint;
  avgFillTime: number;
  successRate: number;
  topTokens: { address: Address; volume: bigint }[];
}

export type SwapStatus = 'idle' | 'approving' | 'creating' | 'waiting' | 'complete' | 'error';
export type StakeStatus = 'idle' | 'pending' | 'complete' | 'error';

// ============ Supported Chains ============

export const SUPPORTED_CHAINS: ChainInfo[] = [
  { id: 420691, name: 'Jeju', icon: '🏝️', rpcUrl: 'https://rpc.jeju.network', isSource: true, isDestination: true },
  { id: 420690, name: 'Jeju Testnet', icon: '🏝️', rpcUrl: 'https://testnet-rpc.jeju.network', isSource: true, isDestination: true },
  { id: 42161, name: 'Arbitrum', icon: '🔵', rpcUrl: 'https://arb1.arbitrum.io/rpc', isSource: true, isDestination: true },
  { id: 10, name: 'Optimism', icon: '🔴', rpcUrl: 'https://mainnet.optimism.io', isSource: true, isDestination: true },
  { id: 1, name: 'Ethereum', icon: '💎', rpcUrl: 'https://eth.llamarpc.com', isSource: true, isDestination: true },
  { id: 11155111, name: 'Sepolia', icon: '🧪', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', isSource: true, isDestination: true },
];

// ============ ABIs ============

export const CROSS_CHAIN_PAYMASTER_ABI = [
  {
    type: 'function',
    name: 'createVoucherRequest',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'destinationToken', type: 'address' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'gasOnDestination', type: 'uint256' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'feeIncrement', type: 'uint256' }
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'getCurrentFee',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'supportedTokens',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'depositLiquidity',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'depositETH',
    inputs: [],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'withdrawLiquidity',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'withdrawETH',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getXLPLiquidity',
    inputs: [
      { name: 'xlp', type: 'address' },
      { name: 'token', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getXLPETH',
    inputs: [{ name: 'xlp', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'VoucherRequested',
    inputs: [
      { name: 'requestId', type: 'bytes32', indexed: true },
      { name: 'requester', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'destinationChainId', type: 'uint256', indexed: false },
      { name: 'recipient', type: 'address', indexed: false },
      { name: 'maxFee', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'VoucherFulfilled',
    inputs: [
      { name: 'voucherId', type: 'bytes32', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false }
    ]
  }
] as const;

export const L1_STAKE_MANAGER_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [{ name: 'chains', type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'addStake',
    inputs: [],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'startUnbonding',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'completeUnbonding',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getXLPStake',
    inputs: [{ name: 'xlp', type: 'address' }],
    outputs: [
      { name: 'stakedAmount', type: 'uint256' },
      { name: 'unbondingAmount', type: 'uint256' },
      { name: 'unbondingStartTime', type: 'uint256' },
      { name: 'slashedAmount', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
      { name: 'registeredAt', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getXLPChains',
    inputs: [{ name: 'xlp', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
    stateMutability: 'view'
  }
] as const;

// ============ Configuration ============

export interface EILConfig {
  crossChainPaymasters: Record<string, Address>;
  l1StakeManager: Address;
  supportedTokens: Address[];
  minStake: bigint;
  unbondingPeriod: number;
}

// Default configuration (would be loaded from config file in actual usage)
export const DEFAULT_EIL_CONFIG: EILConfig = {
  crossChainPaymasters: {
    '420691': '0x0000000000000000000000000000000000000000' as Address,
    '420690': '0x0000000000000000000000000000000000000000' as Address,
    '42161': '0x0000000000000000000000000000000000000000' as Address,
    '10': '0x0000000000000000000000000000000000000000' as Address,
  },
  l1StakeManager: '0x0000000000000000000000000000000000000000' as Address,
  supportedTokens: [],
  minStake: parseEther('0.1'),
  unbondingPeriod: 7 * 24 * 60 * 60, // 7 days
};

// ============ Fee Calculation ============

export function calculateSwapFee(
  amount: bigint,
  sourceChainId: number,
  destinationChainId: number
): { networkFee: bigint; xlpFee: bigint; totalFee: bigint } {
  // Network fee
  const networkFee = parseEther('0.001');
  
  // XLP fee (0.05% of amount)
  const xlpFee = amount * 5n / 10000n;
  
  // Cross-chain premium if different chains
  const crossChainPremium = sourceChainId !== destinationChainId 
    ? parseEther('0.0005') 
    : 0n;
  
  return {
    networkFee: networkFee + crossChainPremium,
    xlpFee,
    totalFee: networkFee + crossChainPremium + xlpFee,
  };
}

export function estimateSwapTime(
  sourceChainId: number,
  destinationChainId: number
): number {
  if (sourceChainId === destinationChainId) return 0;
  
  // Estimate based on chain pair (seconds)
  const l1Chains = [1];
  const isL1ToL2 = l1Chains.includes(sourceChainId);
  const isL2ToL1 = l1Chains.includes(destinationChainId);
  
  if (isL1ToL2) return 15; // ~15s
  if (isL2ToL1) return 600; // ~10 min with challenge
  return 10; // L2 to L2
}

// ============ Formatting Utilities ============

export function formatSwapRoute(sourceChain: ChainInfo, destChain: ChainInfo): string {
  return `${sourceChain.icon} ${sourceChain.name} → ${destChain.icon} ${destChain.name}`;
}

export function formatXLPPosition(position: XLPPosition): {
  staked: string;
  unbonding: string;
  eth: string;
  pendingFees: string;
  status: 'active' | 'inactive' | 'unbonding';
} {
  let status: 'active' | 'inactive' | 'unbonding' = 'inactive';
  if (position.isActive) status = 'active';
  if (position.unbondingAmount > 0n) status = 'unbonding';
  
  return {
    staked: formatEther(position.stakedAmount),
    unbonding: formatEther(position.unbondingAmount),
    eth: formatEther(position.ethBalance),
    pendingFees: formatEther(position.pendingFees),
    status,
  };
}

export function getChainById(chainId: number): ChainInfo | undefined {
  return SUPPORTED_CHAINS.find(c => c.id === chainId);
}

export function isCrossChainSwap(sourceChainId: number, destChainId: number): boolean {
  return sourceChainId !== destChainId;
}

// ============ Validation ============

export function validateSwapParams(params: CrossChainSwapParams): { valid: boolean; error?: string } {
  if (params.amount <= 0n) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }
  
  if (!getChainById(params.sourceChainId)) {
    return { valid: false, error: 'Unsupported source chain' };
  }
  
  if (!getChainById(params.destinationChainId)) {
    return { valid: false, error: 'Unsupported destination chain' };
  }
  
  const destChain = getChainById(params.destinationChainId);
  if (destChain && !destChain.isDestination) {
    return { valid: false, error: `${destChain.name} is not a supported destination` };
  }
  
  return { valid: true };
}

// ============ Transaction Builders ============

export function buildSwapTransaction(
  params: CrossChainSwapParams,
  paymasterAddress: Address
): { to: Address; data: `0x${string}`; value: bigint } {
  const maxFee = parseEther('0.01');
  const isETH = params.sourceToken === '0x0000000000000000000000000000000000000000';
  const value = isETH ? params.amount + maxFee : maxFee;
  
  return {
    to: paymasterAddress,
    data: '0x' as `0x${string}`,
    value,
  };
}

export function buildXLPStakeTransaction(
  amount: bigint,
  stakeManagerAddress: Address
): { to: Address; data: `0x${string}`; value: bigint } {
  return {
    to: stakeManagerAddress,
    data: '0x' as `0x${string}`,
    value: amount,
  };
}

export function buildLiquidityDepositTransaction(
  token: Address,
  amount: bigint,
  paymasterAddress: Address
): { to: Address; data: `0x${string}`; value: bigint } {
  const isETH = token === '0x0000000000000000000000000000000000000000';
  
  return {
    to: paymasterAddress,
    data: '0x' as `0x${string}`,
    value: isETH ? amount : 0n,
  };
}

