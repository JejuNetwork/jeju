/**
 * @fileoverview Contract types for Jeju smart contracts
 * @module @jejunetwork/contracts/types
 */

import type { Abi, Address } from 'viem';

// ============================================================================
// Network Types
// ============================================================================

export type NetworkName = 'localnet' | 'testnet' | 'mainnet';

export type ChainId = 1337 | 31337 | 420690 | 420691 | 11155111 | 1;

export const CHAIN_IDS = {
  // Local development
  localnet: 1337,
  anvil: 31337,         // Foundry Anvil
  // Jeju networks
  testnet: 420690,      // Jeju Testnet
  testnetL2: 420691,    // Jeju Testnet L2 (legacy)
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
// Deployment Types
// ============================================================================

export interface UniswapV4Deployment {
  poolManager?: Address;
  weth?: Address;
  swapRouter?: Address;
  positionManager?: Address;
  quoterV4?: Address;
  stateView?: Address;
  timestamp?: string | number;
  deployer?: Address;
  chainId?: number;
  network?: string;
  deployedAt?: string;
  version?: string;
  features?: {
    singleton?: boolean;
    hooks?: boolean;
    flashAccounting?: boolean;
    nativeETH?: boolean;
  };
  notes?: string;
}

export interface BazaarMarketplaceDeployment {
  at?: Address;
  marketplace?: Address;
  goldToken?: Address;
  usdcToken?: Address;
  Owner?: Address;
  Recipient?: Address;
}

export interface ERC20FactoryDeployment {
  at?: Address;
  factory?: Address;
}

export interface IdentitySystemDeployment {
  Deployer?: Address;
  IdentityRegistry?: Address;
  identityRegistry?: Address;
  reputationRegistry?: Address;
  validationRegistry?: Address;
  serviceRegistry?: Address;
  creditManager?: Address;
  cloudReputationProvider?: Address;
  usdc?: Address;
  elizaOS?: Address;
}

export interface PaymasterSystemDeployment {
  tokenRegistry?: Address;
  priceOracle?: Address;
  paymasterFactory?: Address;
  entryPoint?: Address;
  sponsoredPaymaster?: Address;
  exampleDeployments?: Array<{
    token: Address;
    symbol: string;
    paymaster: string;
    vault: string;
    distributor: string;
  }>;
}

export interface MultiTokenSystemDeployment {
  tokenRegistry?: Address;
  usdc?: Address;
  weth?: Address;
  elizaOS?: Address;
  [key: string]: Address | undefined;
}

export interface EILDeployment {
  identityRegistry?: Address;
  reputationRegistry?: Address;
  validationRegistry?: Address;
  serviceRegistry?: Address;
  creditManager?: Address;
  deployer?: Address;
  timestamp?: string;
}

export interface LiquiditySystemDeployment {
  liquidityVault?: Address;
  poolManager?: Address;
  token0?: Address;
  token1?: Address;
}

export interface XLPDeployment {
  v2Factory?: Address;
  v3Factory?: Address;
  router?: Address;
  positionManager?: Address;
  liquidityAggregator?: Address;
  routerRegistry?: Address;
  weth?: Address;
  deployedAt?: string;
  chainId?: number;
}

export interface L1Deployment {
  portal?: Address;
  bridge?: Address;
  systemConfig?: Address;
  l1CrossDomainMessenger?: Address;
  l1StandardBridge?: Address;
  optimismPortal?: Address;
  addressManager?: Address;
}

export interface ModerationSystemDeployment {
  banManager?: Address;
  moderationMarketplace?: Address;
  reportingSystem?: Address;
  reputationLabelManager?: Address;
  predimarket?: Address;
  registryGovernance?: Address;
  treasury?: Address;
  deployedAt?: string;
  chainId?: number;
}

// ============================================================================
// Contract Address Types
// ============================================================================

export interface ContractAddresses {
  // Identity & Registry
  identityRegistry?: Address;
  reputationRegistry?: Address;
  validationRegistry?: Address;
  serviceRegistry?: Address;
  
  // Moderation
  banManager?: Address;
  moderationMarketplace?: Address;
  reportingSystem?: Address;
  reputationLabelManager?: Address;
  
  // DeFi
  poolManager?: Address;
  swapRouter?: Address;
  positionManager?: Address;
  quoterV4?: Address;
  stateView?: Address;
  weth?: Address;
  
  // Marketplace
  marketplace?: Address;
  predimarket?: Address;
  
  // Token Factory
  erc20Factory?: Address;
  
  // Paymaster / AA
  entryPoint?: Address;
  paymasterFactory?: Address;
  tokenRegistry?: Address;
  priceOracle?: Address;
  
  // Tokens
  usdc?: Address;
  elizaOS?: Address;
  goldToken?: Address;
  jeju?: Address;
}

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
 * Check if an address is valid (not zero address)
 */
export function isValidAddress(address: Address | string | undefined): address is Address {
  return !!address && address !== ZERO_ADDRESS && address.startsWith('0x');
}

