/**
 * @fileoverview Contract types for network smart contracts
 * @module @jejunetwork/contracts/types
 */

import type { Abi, Address } from 'viem';

// Re-export schemas and types
export {
  AddressSchema,
  UniswapV4DeploymentSchema,
  BazaarMarketplaceDeploymentSchema,
  ERC20FactoryDeploymentSchema,
  IdentitySystemDeploymentSchema,
  PaymasterSystemDeploymentSchema,
  MultiTokenSystemDeploymentSchema,
  EILDeploymentSchema,
  LiquiditySystemDeploymentSchema,
  XLPDeploymentSchema,
  L1DeploymentSchema,
  ModerationSystemDeploymentSchema,
  LaunchpadDeploymentSchema,
  GameSystemDeploymentSchema,
  ContractAddressesSchema,
  type UniswapV4Deployment,
  type BazaarMarketplaceDeployment,
  type ERC20FactoryDeployment,
  type IdentitySystemDeployment,
  type PaymasterSystemDeployment,
  type MultiTokenSystemDeployment,
  type EILDeployment,
  type LiquiditySystemDeployment,
  type XLPDeployment,
  type L1Deployment,
  type ModerationSystemDeployment,
  type LaunchpadDeployment,
  type GameSystemDeployment,
  type ContractAddresses,
  parseUniswapV4Deployment,
  parseBazaarMarketplaceDeployment,
  parseERC20FactoryDeployment,
  parseIdentitySystemDeployment,
  parsePaymasterSystemDeployment,
  parseXLPDeployment,
  parseGameSystemDeployment,
  parseLaunchpadDeployment,
  safeParseUniswapV4Deployment,
  safeParseGameSystemDeployment,
} from './schemas';

// ============================================================================
// Network Types
// ============================================================================

export type NetworkName = 'localnet' | 'testnet' | 'mainnet';

export type ChainId = 1337 | 31337 | 420690 | 420691 | 11155111 | 1;

export const CHAIN_IDS = {
  // Local development
  localnet: 1337,
  anvil: 31337,         // Foundry Anvil
  // networks
  testnet: 420690,      // Network Testnet
  testnetL2: 420691,    // Network Testnet L2 (legacy)
  // Ethereum networks
  sepolia: 11155111,    // Sepolia Testnet
  mainnetL1: 1,         // Ethereum Mainnet
} as const;

export const NETWORK_BY_CHAIN_ID: Record<ChainId, NetworkName> = {
  1337: 'localnet',
  31337: 'localnet',
  420690: 'testnet',
  420691: 'testnet',
  11155111: 'testnet',
  1: 'mainnet',
};

// ============================================================================
// ABI Types
// ============================================================================

export interface ContractABI {
  address?: Address;
  abi: Abi;
}

// ============================================================================
// Helper Types
// ============================================================================

export type DeploymentFile = 
  | 'uniswap-v4-1337'
  | 'uniswap-v4-420691'
  | 'bazaar-marketplace-1337'
  | 'erc20-factory-1337'
  | 'identity-system-1337'
  | 'localnet-addresses'
  | 'paymaster-system-localnet'
  | 'multi-token-system-1337'
  | 'eil-localnet'
  | 'eil-testnet'
  | 'eliza-token-1337'
  | 'predimarket-1337'
  | 'rpg-tokens-1337';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/**
 * Check if an address is valid (not zero address, null, or undefined)
 */
export function isValidAddress(address: Address | string | undefined | null): address is Address {
  return !!address && address !== ZERO_ADDRESS && address.startsWith('0x');
}
