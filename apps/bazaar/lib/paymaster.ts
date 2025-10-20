/**
 * Multicoin Paymaster Integration for Bazaar
 * Enables gas payment in any supported token
 * Integrates with Gateway's PaymasterFactory
 */

import { Address, createPublicClient, http, parseEther } from 'viem';
import { JEJU_CHAIN_ID, jeju } from '../config/chains';

export interface PaymasterInfo {
  address: Address;
  token: Address;
  tokenSymbol: string;
  tokenName: string;
  stakedEth: bigint;
  isActive: boolean;
  exchangeRate: bigint; // How many tokens per 1 ETH of gas
}

export interface PaymasterFactoryConfig {
  factoryAddress: Address;
  minStakedEth: bigint; // Minimum ETH stake to trust paymaster
}

// Default config - will be loaded from Gateway deployment
const DEFAULT_CONFIG: PaymasterFactoryConfig = {
  factoryAddress: '0x0000000000000000000000000000000000000000' as Address, // TODO: Load from Gateway
  minStakedEth: parseEther('1.0'), // Require at least 1 ETH staked
};

/**
 * Query available paymasters from the factory
 * Actually queries the PaymasterFactory contract
 */
export async function getAvailablePaymasters(
  config: PaymasterFactoryConfig = DEFAULT_CONFIG
): Promise<PaymasterInfo[]> {
  try {
    const { createPublicClient, http, parseAbi } = await import('viem');
    const { jeju } = await import('../config/chains');
    
    const publicClient = createPublicClient({
      chain: jeju,
      transport: http(),
    });

    // PaymasterFactory ABI (minimal interface)
    const factoryAbi = parseAbi([
      'function getAllPaymasters() view returns (address[])',
      'function getPaymasterInfo(address paymaster) view returns (address token, uint256 stakedEth, bool isActive)',
    ]);

    // ERC20 ABI for token info
    const erc20Abi = parseAbi([
      'function symbol() view returns (string)',
      'function name() view returns (string)',
    ]);

    // If factory not configured, return empty array
    if (config.factoryAddress === '0x0000000000000000000000000000000000000000') {
      console.warn('[Paymaster] Factory not configured, returning empty list');
      return [];
    }

    // Query factory for all paymasters
    const paymasterAddresses = await publicClient.readContract({
      address: config.factoryAddress,
      abi: factoryAbi,
      functionName: 'getAllPaymasters',
    }) as Address[];

    // Get info for each paymaster
    const paymasters: PaymasterInfo[] = [];

    for (const paymasterAddress of paymasterAddresses) {
      try {
        const info = await publicClient.readContract({
          address: config.factoryAddress,
          abi: factoryAbi,
          functionName: 'getPaymasterInfo',
          args: [paymasterAddress],
        }) as [Address, bigint, boolean];

        const [tokenAddress, stakedEth, isActive] = info;

        // Skip if below minimum stake
        if (stakedEth < config.minStakedEth) continue;
        if (!isActive) continue;

        // Get token metadata
        const [tokenSymbol, tokenName] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'symbol',
          }) as Promise<string>,
          publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'name',
          }) as Promise<string>,
        ]);

        paymasters.push({
          address: paymasterAddress,
          token: tokenAddress,
          tokenSymbol,
          tokenName,
          stakedEth,
          isActive,
          exchangeRate: BigInt('1000000000000000000'), // Default 1:1, could query from oracle
        });
      } catch (error) {
        console.error(`[Paymaster] Error querying paymaster ${paymasterAddress}:`, error);
        continue;
      }
    }

    return paymasters;
  } catch (error) {
    console.error('[Paymaster] Error querying factory:', error);
    // Return empty array on error (fail gracefully)
    return [];
  }
}

/**
 * Get paymaster for a specific token
 */
export async function getPaymasterForToken(
  tokenAddress: Address,
  config: PaymasterFactoryConfig = DEFAULT_CONFIG
): Promise<PaymasterInfo | null> {
  const paymasters = await getAvailablePaymasters(config);
  return paymasters.find(pm => 
    pm.token.toLowerCase() === tokenAddress.toLowerCase()
  ) || null;
}

/**
 * Estimate gas cost in a specific token
 */
export function estimateTokenCost(
  gasEstimate: bigint,
  gasPrice: bigint,
  paymaster: PaymasterInfo
): bigint {
  // Calculate ETH cost
  const ethCost = gasEstimate * gasPrice;
  
  // Convert to token amount using exchange rate
  // exchangeRate is tokens per 1 ETH
  const tokenCost = (ethCost * paymaster.exchangeRate) / parseEther('1');
  
  return tokenCost;
}

/**
 * Prepare paymaster data for transaction
 * This formats the paymaster and paymasterData fields for ERC-4337
 */
export function preparePaymasterData(
  paymasterAddress: Address,
  tokenAddress: Address,
  maxTokenAmount: bigint
): {
  paymaster: Address;
  paymasterData: `0x${string}`;
} {
  // Encode paymaster data according to ERC-4337 spec
  // Format: <tokenAddress><maxTokenAmount>
  const paymasterData = `0x${
    tokenAddress.slice(2)}${
    maxTokenAmount.toString(16).padStart(64, '0')
  }` as `0x${string}`;

  return {
    paymaster: paymasterAddress,
    paymasterData,
  };
}

/**
 * Check if user has approved paymaster to spend tokens
 * Actually queries the token contract
 */
export async function checkPaymasterApproval(
  userAddress: Address,
  tokenAddress: Address,
  paymasterAddress: Address,
  amount: bigint
): Promise<boolean> {
  try {
    const { createPublicClient, http, parseAbi } = await import('viem');
    const { jeju } = await import('../config/chains');
    
    const publicClient = createPublicClient({
      chain: jeju,
      transport: http(),
    });

    const erc20Abi = parseAbi([
      'function allowance(address owner, address spender) view returns (uint256)',
    ]);

    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [userAddress, paymasterAddress],
    }) as bigint;

    return allowance >= amount;
  } catch (error) {
    console.error('[Paymaster] Error checking approval:', error);
    return false;
  }
}

/**
 * Get approval transaction data
 */
export function getApprovalTxData(
  tokenAddress: Address,
  paymasterAddress: Address,
  amount: bigint
): {
  to: Address;
  data: `0x${string}`;
} {
  // ERC20 approve function signature
  const approveSelector = '0x095ea7b3';
  
  // Encode parameters: spender (address), amount (uint256)
  const data = `${approveSelector}${
    paymasterAddress.slice(2).padStart(64, '0')}${
    amount.toString(16).padStart(64, '0')
  }` as `0x${string}`;

  return {
    to: tokenAddress,
    data,
  };
}

/**
 * User-friendly paymaster selection for UI
 */
export interface PaymasterOption {
  label: string; // "Pay gas with USDC"
  value: Address; // Paymaster address
  token: {
    address: Address;
    symbol: string;
    name: string;
  };
  estimatedCost: string; // Human-readable "~2.5 USDC"
  stakedEth: string; // "10 ETH staked"
  recommended: boolean;
}

export async function getPaymasterOptions(
  estimatedGas: bigint,
  gasPrice: bigint
): Promise<PaymasterOption[]> {
  const paymasters = await getAvailablePaymasters();
  
  return paymasters.map(pm => {
    const tokenCost = estimateTokenCost(estimatedGas, gasPrice, pm);
    const tokenCostFormatted = Number(tokenCost) / Math.pow(10, 18); // Assume 18 decimals
    
    return {
      label: `Pay gas with ${pm.tokenSymbol}`,
      value: pm.address,
      token: {
        address: pm.token,
        symbol: pm.tokenSymbol,
        name: pm.tokenName,
      },
      estimatedCost: `~${tokenCostFormatted.toFixed(4)} ${pm.tokenSymbol}`,
      stakedEth: `${Number(pm.stakedEth) / 1e18} ETH staked`,
      recommended: pm.tokenSymbol === 'USDC' || pm.tokenSymbol === 'elizaOS',
    };
  });
}

/**
 * Load paymaster config from Gateway deployment or environment
 */
export async function loadPaymasterConfig(): Promise<PaymasterFactoryConfig> {
  try {
    // Try to load from environment first
    const factoryAddress = process.env.NEXT_PUBLIC_PAYMASTER_FACTORY_ADDRESS;
    const minStake = process.env.NEXT_PUBLIC_PAYMASTER_MIN_STAKE;

    if (factoryAddress && factoryAddress !== '0x0000000000000000000000000000000000000000') {
      return {
        factoryAddress: factoryAddress as Address,
        minStakedEth: minStake ? parseEther(minStake) : parseEther('1.0'),
      };
    }

    // Try to load from deployment file
    try {
      const deploymentPath = '../../../contracts/deployments/paymaster-factory-1337.json';
      const deployment = await import(deploymentPath);
      return {
        factoryAddress: deployment.address as Address,
        minStakedEth: parseEther('1.0'),
      };
    } catch {
      // Deployment file not found
    }
    
    console.warn('[Paymaster] No factory configured, using default (will return empty paymasters)');
    return DEFAULT_CONFIG;
  } catch (error) {
    console.warn('[Paymaster] Could not load config:', error);
    return DEFAULT_CONFIG;
  }
}

