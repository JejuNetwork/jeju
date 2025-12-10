/**
 * EIL Hooks for React Apps
 * 
 * Shared hooks for Gateway and Bazaar:
 * - Cross-chain swaps without bridging
 * - Multi-token gas payment (pay gas with any token)
 * - XLP liquidity management
 * - L1 staking
 * - Fee estimation
 * - Best gas deal routing
 */

import { parseEther, formatEther, Address } from 'viem';

// ============ Types ============

export interface ChainInfo {
  id: number;
  name: string;
  icon: string;
  rpcUrl: string;
  paymasterAddress?: Address;
  crossChainPaymaster?: Address;
  isSource: boolean;
  isDestination: boolean;
}

export interface GasPaymentOption {
  token: Address;
  symbol: string;
  cost: bigint;
  costUsd: number;
  availableLiquidity: bigint;
  userBalance: bigint;
  isRecommended: boolean;
  chainId: number;
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
  // Cross-chain transfer functions
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
  // Token support and liquidity
  {
    type: 'function',
    name: 'supportedTokens',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getTotalLiquidity',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  // Gas payment functions (NEW)
  {
    type: 'function',
    name: 'previewTokenCost',
    inputs: [
      { name: 'estimatedGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'token', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getBestGasToken',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'gasCostETH', type: 'uint256' },
      { name: 'tokens', type: 'address[]' }
    ],
    outputs: [
      { name: 'bestToken', type: 'address' },
      { name: 'tokenCost', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'canSponsor',
    inputs: [
      { name: 'gasCost', type: 'uint256' },
      { name: 'paymentToken', type: 'address' },
      { name: 'userAddress', type: 'address' }
    ],
    outputs: [
      { name: 'canSponsor', type: 'bool' },
      { name: 'tokenCost', type: 'uint256' },
      { name: 'userBalance', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getPaymasterStatus',
    inputs: [],
    outputs: [
      { name: 'ethLiquidity', type: 'uint256' },
      { name: 'entryPointBalance', type: 'uint256' },
      { name: 'supportedTokenCount', type: 'uint256' },
      { name: 'totalGasFees', type: 'uint256' },
      { name: 'oracleSet', type: 'bool' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'tokenExchangeRates',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  // XLP liquidity functions
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
  // Events
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
  },
  {
    type: 'event',
    name: 'GasSponsored',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'paymentToken', type: 'address', indexed: true },
      { name: 'gasCostETH', type: 'uint256', indexed: false },
      { name: 'tokensCharged', type: 'uint256', indexed: false },
      { name: 'appAddress', type: 'address', indexed: false }
    ]
  },
  // App token preference integration
  {
    type: 'function',
    name: 'getBestPaymentTokenForApp',
    inputs: [
      { name: 'appAddress', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'gasCostETH', type: 'uint256' },
      { name: 'tokens', type: 'address[]' },
      { name: 'balances', type: 'uint256[]' }
    ],
    outputs: [
      { name: 'bestToken', type: 'address' },
      { name: 'tokenCost', type: 'uint256' },
      { name: 'reason', type: 'string' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'checkAppPreference',
    inputs: [
      { name: 'appAddress', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'balance', type: 'uint256' }
    ],
    outputs: [
      { name: 'hasPreferred', type: 'bool' },
      { name: 'preferredToken', type: 'address' }
    ],
    stateMutability: 'view'
  }
] as const;

// AppTokenPreference ABI for app-specific gas token selection
export const APP_TOKEN_PREFERENCE_ABI = [
  {
    type: 'function',
    name: 'registerApp',
    inputs: [
      { name: 'appAddress', type: 'address' },
      { name: 'preferredToken', type: 'address' },
      { name: 'allowFallback', type: 'bool' },
      { name: 'minBalance', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'updatePreferredToken',
    inputs: [
      { name: 'appAddress', type: 'address' },
      { name: 'newPreferredToken', type: 'address' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'setFallbackTokens',
    inputs: [
      { name: 'appAddress', type: 'address' },
      { name: 'tokens', type: 'address[]' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getAppPreference',
    inputs: [{ name: 'appAddress', type: 'address' }],
    outputs: [
      { name: 'appAddr', type: 'address' },
      { name: 'preferredToken', type: 'address' },
      { name: 'tokenSymbol', type: 'string' },
      { name: 'tokenDecimals', type: 'uint8' },
      { name: 'allowFallback', type: 'bool' },
      { name: 'minBalance', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
      { name: 'registrant', type: 'address' },
      { name: 'registrationTime', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getAppFallbackTokens',
    inputs: [{ name: 'appAddress', type: 'address' }],
    outputs: [{ type: 'address[]' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getGlobalDefaults',
    inputs: [],
    outputs: [{ type: 'address[]' }],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'AppPreferenceSet',
    inputs: [
      { name: 'appAddress', type: 'address', indexed: true },
      { name: 'preferredToken', type: 'address', indexed: true },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'allowFallback', type: 'bool', indexed: false },
      { name: 'registrant', type: 'address', indexed: false }
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

export interface AppPreference {
  appAddress: Address;
  preferredToken: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  allowFallback: boolean;
  minBalance: bigint;
  isActive: boolean;
  registrant: Address;
  registrationTime: bigint;
}

export interface EILConfig {
  crossChainPaymasters: Record<string, Address>;
  appTokenPreference: Address;
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
  appTokenPreference: '0x0000000000000000000000000000000000000000' as Address,
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

// ============ Gas Payment Helpers ============

/**
 * Generate paymasterAndData for CrossChainPaymaster token payment mode
 * This allows users to pay gas with any supported token
 */
export function buildTokenPaymentData(
  paymasterAddress: Address,
  paymentToken: Address,
  appAddress: Address,
  verificationGasLimit: bigint = 150000n,
  postOpGasLimit: bigint = 100000n
): `0x${string}` {
  let data = paymasterAddress.slice(2).toLowerCase();
  data += verificationGasLimit.toString(16).padStart(32, '0');
  data += postOpGasLimit.toString(16).padStart(32, '0');
  data += '00'; // mode = 0 for token payment
  data += paymentToken.slice(2).toLowerCase();
  data += appAddress.slice(2).toLowerCase();
  
  return `0x${data}` as `0x${string}`;
}

/**
 * Find the best token to pay gas with based on user balances and costs
 */
export function selectBestGasToken(
  options: GasPaymentOption[]
): GasPaymentOption | null {
  if (options.length === 0) return null;

  // Filter to tokens user can afford
  const viableOptions = options.filter(opt => opt.userBalance >= opt.cost);
  if (viableOptions.length === 0) return null;

  // Sort by USD cost (lowest first)
  viableOptions.sort((a, b) => a.costUsd - b.costUsd);

  // Return the cheapest option
  return { ...viableOptions[0], isRecommended: true };
}

/**
 * Format gas payment option for display
 */
export function formatGasPaymentOption(option: GasPaymentOption): string {
  const cost = formatEther(option.cost);
  return `${option.symbol}: ~${cost} (~$${option.costUsd.toFixed(4)})${option.isRecommended ? ' ✓ Best deal' : ''}`;
}

/**
 * Check if user can pay gas with a specific token
 */
export function canPayGasWithToken(
  userBalance: bigint,
  tokenCost: bigint,
  liquidity: bigint
): boolean {
  return userBalance >= tokenCost && liquidity >= tokenCost;
}

/**
 * Get the best gas payment token for a specific app
 * Considers app preferences, fallback tokens, and user balances
 */
export function getBestGasTokenForApp(
  appPreference: AppPreference | null,
  userBalances: GasPaymentOption[],
  globalDefaults: Address[] = []
): GasPaymentOption | null {
  // Filter to viable options (user has enough balance)
  const viable = userBalances.filter(opt => opt.userBalance >= opt.cost && opt.availableLiquidity >= opt.cost);
  if (viable.length === 0) return null;

  // Priority 1: App's preferred token
  if (appPreference?.isActive && appPreference.preferredToken !== '0x0000000000000000000000000000000000000000') {
    const preferred = viable.find(opt => 
      opt.token.toLowerCase() === appPreference.preferredToken.toLowerCase() &&
      opt.userBalance >= appPreference.minBalance
    );
    if (preferred) {
      return { ...preferred, isRecommended: true };
    }
  }

  // Priority 2: Global defaults
  for (const defaultToken of globalDefaults) {
    const defaultOpt = viable.find(opt => opt.token.toLowerCase() === defaultToken.toLowerCase());
    if (defaultOpt) {
      return { ...defaultOpt, isRecommended: true };
    }
  }

  // Priority 3: Cheapest available
  viable.sort((a, b) => a.costUsd - b.costUsd);
  return { ...viable[0], isRecommended: true };
}

/**
 * Build paymasterAndData for app-aware gas payment
 * Uses the app's preferred token if user has it, otherwise falls back to cheapest
 */
export function buildAppAwarePaymentData(
  paymasterAddress: Address,
  paymentToken: Address,
  appAddress: Address,
  verificationGasLimit: bigint = 150000n,
  postOpGasLimit: bigint = 100000n
): `0x${string}` {
  // Token payment mode format:
  // [paymaster(20)][verificationGas(16)][postOpGas(16)][mode(1)][token(20)][appAddress(20)]
  let data = paymasterAddress.slice(2).toLowerCase();
  data += verificationGasLimit.toString(16).padStart(32, '0');
  data += postOpGasLimit.toString(16).padStart(32, '0');
  data += '00'; // mode = 0 for token payment
  data += paymentToken.slice(2).toLowerCase();
  data += appAddress.slice(2).toLowerCase();
  
  return `0x${data}` as `0x${string}`;
}

