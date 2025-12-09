/**
 * Shared Paymaster Integration Library
 * 
 * Shared paymaster functionality for all Jeju apps.
 * Supports multi-token gas payments via PaymasterFactory.
 */

import { createPublicClient, http, parseAbi, parseEther, formatEther, Address, encodePacked, type PublicClient } from 'viem';

async function safeReadContract<T>(
  client: PublicClient, 
  params: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.readContract(params as any) as Promise<T>;
}

// ============ Types ============

export interface PaymasterInfo {
  address: Address;
  token: Address;
  tokenSymbol: string;
  tokenName: string;
  stakedEth: bigint;
  isActive: boolean;
  exchangeRate: bigint;
}

export interface PaymasterConfig {
  factoryAddress: Address;
  minStakedEth: bigint;
  rpcUrl: string;
  chainId: number;
}

export interface PaymasterOption {
  paymaster: PaymasterInfo;
  estimatedCost: bigint;
  estimatedCostFormatted: string;
  isRecommended: boolean;
}

// ============ ABIs ============

const FACTORY_ABI = parseAbi([
  'function getAllPaymasters() view returns (address[])',
  'function getPaymasterInfo(address paymaster) view returns (address token, uint256 stakedEth, bool isActive)',
  'function getPaymasterByToken(address token) view returns (address)',
  'function paymasterStake(address paymaster) view returns (uint256)',
]);

const PAYMASTER_ABI = parseAbi([
  'function token() view returns (address)',
  'function getQuote(uint256 ethAmount) view returns (uint256)',
  'function availableLiquidity() view returns (uint256)',
]);

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// ============ Default Configuration ============

const DEFAULT_CONFIG: PaymasterConfig = {
  factoryAddress: (process.env.PAYMASTER_FACTORY_ADDRESS || 
    '0x0000000000000000000000000000000000000000') as Address,
  minStakedEth: parseEther(process.env.MIN_PAYMASTER_STAKE || '1.0'),
  rpcUrl: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
  chainId: Number(process.env.CHAIN_ID) || 1337,
};

// ============ Client Factory ============

function getClient(config: PaymasterConfig = DEFAULT_CONFIG) {
  return createPublicClient({
    chain: {
      id: config.chainId,
      name: 'Jeju',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: http(config.rpcUrl),
  });
}

// ============ Core Functions ============

/**
 * Get all available paymasters meeting minimum stake
 */
export async function getAvailablePaymasters(
  config: Partial<PaymasterConfig> = {}
): Promise<PaymasterInfo[]> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (fullConfig.factoryAddress === '0x0000000000000000000000000000000000000000') {
    return [];
  }

  const client = getClient(fullConfig);
  
  const paymasterAddresses = await safeReadContract<Address[]>(client, {
    address: fullConfig.factoryAddress,
    abi: FACTORY_ABI,
    functionName: 'getAllPaymasters',
  });

  const paymasters: PaymasterInfo[] = [];

  for (const addr of paymasterAddresses) {
    const [token, stakedEth, isActive] = await safeReadContract<[Address, bigint, boolean]>(client, {
      address: fullConfig.factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'getPaymasterInfo',
      args: [addr],
    });

    if (stakedEth < fullConfig.minStakedEth || !isActive) continue;

    const [tokenSymbol, tokenName, exchangeRate] = await Promise.all([
      safeReadContract<string>(client, { address: token, abi: ERC20_ABI, functionName: 'symbol' }),
      safeReadContract<string>(client, { address: token, abi: ERC20_ABI, functionName: 'name' }),
      safeReadContract<bigint>(client, { 
        address: addr, 
        abi: PAYMASTER_ABI, 
        functionName: 'getQuote', 
        args: [parseEther('1')] 
      }),
    ]);

    paymasters.push({
      address: addr,
      token,
      tokenSymbol,
      tokenName,
      stakedEth,
      isActive,
      exchangeRate,
    });
  }

  return paymasters;
}

/**
 * Get paymaster for a specific token
 */
export async function getPaymasterForToken(
  tokenAddress: Address,
  config: Partial<PaymasterConfig> = {}
): Promise<PaymasterInfo | null> {
  const paymasters = await getAvailablePaymasters(config);
  return paymasters.find(pm => 
    pm.token.toLowerCase() === tokenAddress.toLowerCase()
  ) || null;
}

/**
 * Get paymaster options with cost estimates
 */
export async function getPaymasterOptions(
  estimatedGas: bigint,
  gasPrice: bigint,
  config: Partial<PaymasterConfig> = {}
): Promise<PaymasterOption[]> {
  const paymasters = await getAvailablePaymasters(config);
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const client = getClient(fullConfig);
  const ethCost = estimatedGas * gasPrice;
  
  const options: PaymasterOption[] = [];

  for (const pm of paymasters) {
    let tokenCost = ethCost;
    
    const quote = await safeReadContract<bigint>(client, {
      address: pm.address,
      abi: PAYMASTER_ABI,
      functionName: 'getQuote',
      args: [ethCost],
    });
    
    tokenCost = quote;

    options.push({
      paymaster: pm,
      estimatedCost: tokenCost,
      estimatedCostFormatted: `~${formatEther(tokenCost)} ${pm.tokenSymbol}`,
      isRecommended: pm.tokenSymbol === 'USDC' || pm.tokenSymbol.includes('eliza'),
    });
  }

  // Sort by cost
  return options.sort((a, b) => Number(a.estimatedCost - b.estimatedCost));
}

/**
 * Estimate token cost for gas
 */
export function estimateTokenCost(
  gasEstimate: bigint,
  gasPrice: bigint,
  exchangeRate: bigint = parseEther('1')
): bigint {
  const ethCost = gasEstimate * gasPrice;
  return (ethCost * exchangeRate) / parseEther('1');
}

/**
 * Check if paymaster has approval for amount
 */
export async function checkPaymasterApproval(
  userAddress: Address,
  tokenAddress: Address,
  paymasterAddress: Address,
  amount: bigint,
  config: Partial<PaymasterConfig> = {}
): Promise<boolean> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const client = getClient(fullConfig);

  const allowance = await safeReadContract<bigint>(client, {
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, paymasterAddress],
  });

  return allowance >= amount;
}

/**
 * Get user's balance of token
 */
export async function getTokenBalance(
  userAddress: Address,
  tokenAddress: Address,
  config: Partial<PaymasterConfig> = {}
): Promise<bigint> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const client = getClient(fullConfig);

  return safeReadContract<bigint>(client, {
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  });
}

// ============ Data Encoding ============

/**
 * Prepare paymaster data for UserOperation
 */
export function preparePaymasterData(
  paymasterAddress: Address,
  tokenAddress: Address,
  maxTokenAmount: bigint
): { paymaster: Address; paymasterData: `0x${string}` } {
  const paymasterData = `0x${
    tokenAddress.slice(2)}${
    maxTokenAmount.toString(16).padStart(64, '0')
  }` as `0x${string}`;

  return { paymaster: paymasterAddress, paymasterData };
}

/**
 * Generate ERC-4337 paymaster data with gas limits
 */
export function generatePaymasterData(
  paymasterAddress: Address,
  verificationGasLimit: bigint = 100000n,
  postOpGasLimit: bigint = 50000n
): `0x${string}` {
  return encodePacked(
    ['address', 'uint128', 'uint128'],
    [paymasterAddress, verificationGasLimit, postOpGasLimit]
  );
}

/**
 * Get approval transaction data
 */
export function getApprovalTxData(
  tokenAddress: Address,
  paymasterAddress: Address,
  amount: bigint
): { to: Address; data: `0x${string}` } {
  const approveSelector = '0x095ea7b3';
  const data = `${approveSelector}${
    paymasterAddress.slice(2).padStart(64, '0')}${
    amount.toString(16).padStart(64, '0')
  }` as `0x${string}`;

  return { to: tokenAddress, data };
}

// ============ Configuration ============

/**
 * Load paymaster config from environment
 */
export function loadPaymasterConfig(): PaymasterConfig {
  return {
    factoryAddress: (process.env.PAYMASTER_FACTORY_ADDRESS ||
      process.env.NEXT_PUBLIC_PAYMASTER_FACTORY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    minStakedEth: parseEther(
      process.env.MIN_PAYMASTER_STAKE ||
      process.env.NEXT_PUBLIC_PAYMASTER_MIN_STAKE ||
      '1.0'
    ),
    rpcUrl: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    chainId: Number(process.env.CHAIN_ID) || 1337,
  };
}

