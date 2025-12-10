/**
 * Gateway contract ABIs and addresses
 * 
 * Provides minimal ABI definitions needed for frontend interactions with:
 * - Token Registry
 * - Paymaster Factory
 * - Liquidity Vaults
 * - ERC20 tokens
 * 
 * @module gateway/lib/contracts
 */

import { Address } from 'viem';

/**
 * Token Registry contract ABI
 * Handles token registration and configuration
 */
export const TOKEN_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerToken',
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'oracleAddress', type: 'address' },
      { name: 'minFeeMargin', type: 'uint256' },
      { name: 'maxFeeMargin', type: 'uint256' }
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'getAllTokens',
    inputs: [],
    outputs: [{ name: 'addresses', type: 'address[]' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getTokenConfig',
    inputs: [{ name: 'tokenAddress', type: 'address' }],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'tokenAddress', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'decimals', type: 'uint8' },
          { name: 'oracleAddress', type: 'address' },
          { name: 'minFeeMargin', type: 'uint256' },
          { name: 'maxFeeMargin', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'registrant', type: 'address' },
          { name: 'registrationTime', type: 'uint256' },
          { name: 'totalVolume', type: 'uint256' },
          { name: 'totalTransactions', type: 'uint256' },
          { name: 'metadataHash', type: 'bytes32' }
        ]
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'registrationFee',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  }
] as const;

/**
 * Paymaster Factory contract ABI
 * Deploys and manages paymaster infrastructure
 */
export const PAYMASTER_FACTORY_ABI = [
  {
    type: 'function',
    name: 'deployPaymaster',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'feeMargin', type: 'uint256' },
      { name: 'operator', type: 'address' }
    ],
    outputs: [
      { name: 'paymaster', type: 'address' },
      { name: 'vault', type: 'address' },
      { name: 'distributor', type: 'address' }
    ],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getDeployment',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: 'deployment',
        type: 'tuple',
        components: [
          { name: 'paymaster', type: 'address' },
          { name: 'vault', type: 'address' },
          { name: 'distributor', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'operator', type: 'address' },
          { name: 'deployedAt', type: 'uint256' },
          { name: 'feeMargin', type: 'uint256' }
        ]
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getAllDeployments',
    inputs: [],
    outputs: [{ name: 'tokens', type: 'address[]' }],
    stateMutability: 'view'
  }
] as const;

/**
 * Liquidity Vault contract ABI
 * Manages ETH and token liquidity for paymasters
 */
export const LIQUIDITY_VAULT_ABI = [
  {
    type: 'function',
    name: 'addETHLiquidity',
    inputs: [],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'removeETHLiquidity',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'claimFees',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getLPPosition',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'ethShareBalance', type: 'uint256' },
      { name: 'ethValue', type: 'uint256' },
      { name: 'tokenShareBalance', type: 'uint256' },
      { name: 'tokenValue', type: 'uint256' },
      { name: 'pendingFeeAmount', type: 'uint256' }
    ],
    stateMutability: 'view'
  }
] as const;

/**
 * JEJU Token ABI (with ban enforcement check)
 * The native Jeju Network token
 */
export const JEJU_TOKEN_ABI = [
  {
    type: 'function',
    name: 'isBanned',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'banEnforcementEnabled',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'faucet',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'faucetCooldownRemaining',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'faucetEnabled',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  },
] as const;

/**
 * Standard ERC20 token ABI
 */
export const IERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable'
  }
] as const;

/**
 * Get deployed contract addresses from environment
 * 
 * @returns Contract addresses for core Jeju contracts
 */
export const getContractAddresses = (): {
  tokenRegistry: Address;
  paymasterFactory: Address;
  priceOracle: Address;
  jejuToken: Address;
  banManager: Address;
} => ({
  tokenRegistry: (import.meta.env.VITE_TOKEN_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
  paymasterFactory: (import.meta.env.VITE_PAYMASTER_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
  priceOracle: (import.meta.env.VITE_PRICE_ORACLE_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
  jejuToken: (import.meta.env.VITE_JEJU_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
  banManager: (import.meta.env.VITE_BAN_MANAGER_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
});
