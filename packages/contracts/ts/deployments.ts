/**
 * @fileoverview Deployment address exports for network contracts
 * @module @jejunetwork/contracts/deployments
 */

import type { Address } from 'viem';
import type { NetworkName, ChainId } from './types';
import {
  type UniswapV4Deployment,
  type BazaarMarketplaceDeployment,
  type ERC20FactoryDeployment,
  type IdentitySystemDeployment,
  type PaymasterSystemDeployment,
  type XLPDeployment,
  type ContractAddresses,
  type LaunchpadDeployment,
  type GameSystemDeployment,
  UniswapV4DeploymentSchema,
  BazaarMarketplaceDeploymentSchema,
  ERC20FactoryDeploymentSchema,
  IdentitySystemDeploymentSchema,
  PaymasterSystemDeploymentSchema,
  XLPDeploymentSchema,
  GameSystemDeploymentSchema,
  LaunchpadDeploymentSchema,
} from './schemas';
import { CHAIN_IDS, ZERO_ADDRESS, isValidAddress } from './types';

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

/**
 * Convert a validated address string to Address type, or undefined if invalid
 */
function toAddress(address: string | null | undefined): Address | undefined {
  return isValidAddress(address) ? address : undefined;
}

// Import deployment JSONs
import uniswapV4_1337_raw from '../deployments/uniswap-v4-1337.json';
import uniswapV4_420691_raw from '../deployments/uniswap-v4-420691.json';
import bazaarMarketplace1337_raw from '../deployments/bazaar-marketplace-1337.json';
import erc20Factory1337_raw from '../deployments/erc20-factory-1337.json';
import identitySystem1337_raw from '../deployments/identity-system-1337.json';
import localnetAddresses_raw from '../deployments/localnet-addresses.json';
import paymasterSystemLocalnet_raw from '../deployments/paymaster-system-localnet.json';
import multiTokenSystem1337_raw from '../deployments/multi-token-system-1337.json';
import eilLocalnet_raw from '../deployments/eil-localnet.json';
import eilTestnet_raw from '../deployments/eil-testnet.json';
import gameSystem1337_raw from '../deployments/game-system-1337.json';
import predimarket1337_raw from '../deployments/predimarket-1337.json';
import rpgTokens1337_raw from '../deployments/rpg-tokens-1337.json';
import elizaToken1337_raw from '../deployments/eliza-token-1337.json';
import xlpAmmLocalnet_raw from '../deployments/xlp-amm-localnet.json';
import launchpadLocalnet_raw from '../deployments/launchpad-localnet.json';

// ============================================================================
// Validated Deployment Data
// ============================================================================

// Parse deployment JSONs with validation at import time
const uniswapV4_1337 = UniswapV4DeploymentSchema.parse(uniswapV4_1337_raw);
const uniswapV4_420691 = UniswapV4DeploymentSchema.parse(uniswapV4_420691_raw);
const bazaarMarketplace1337 = BazaarMarketplaceDeploymentSchema.parse(bazaarMarketplace1337_raw);
const erc20Factory1337 = ERC20FactoryDeploymentSchema.parse(erc20Factory1337_raw);
const identitySystem1337 = IdentitySystemDeploymentSchema.parse(identitySystem1337_raw);
const localnetAddresses = IdentitySystemDeploymentSchema.partial().parse(localnetAddresses_raw);
const paymasterSystemLocalnet = PaymasterSystemDeploymentSchema.parse(paymasterSystemLocalnet_raw);
const gameSystem1337 = GameSystemDeploymentSchema.parse(gameSystem1337_raw);
const xlpAmmLocalnet = XLPDeploymentSchema.parse(xlpAmmLocalnet_raw);
const launchpadLocalnet = LaunchpadDeploymentSchema.parse(launchpadLocalnet_raw);

// ============================================================================
// Typed Deployment Exports
// ============================================================================

export const uniswapV4Deployments: Partial<Record<ChainId, UniswapV4Deployment>> = {
  1337: uniswapV4_1337,
  420691: uniswapV4_420691,
};

export const bazaarMarketplaceDeployments: Partial<Record<ChainId, BazaarMarketplaceDeployment>> = {
  1337: bazaarMarketplace1337,
  420691: bazaarMarketplace1337,
};

export const erc20FactoryDeployments: Partial<Record<ChainId, ERC20FactoryDeployment>> = {
  1337: erc20Factory1337,
  420691: erc20Factory1337,
};

export const identitySystemDeployments: Partial<Record<ChainId, IdentitySystemDeployment>> = {
  1337: { ...identitySystem1337, ...localnetAddresses },
  420691: { ...identitySystem1337, ...localnetAddresses },
};

export const paymasterDeployments: Partial<Record<ChainId, PaymasterSystemDeployment>> = {
  1337: paymasterSystemLocalnet,
  420691: paymasterSystemLocalnet,
};

export const xlpDeployments: Partial<Record<ChainId, XLPDeployment>> = {
  1337: xlpAmmLocalnet,
  420691: xlpAmmLocalnet,
};

export const gameSystemDeployments: Partial<Record<ChainId, GameSystemDeployment>> = {
  1337: gameSystem1337,
  420691: gameSystem1337,
};

export const launchpadDeployments: Partial<Record<ChainId, LaunchpadDeployment>> = {
  1337: launchpadLocalnet,
  420691: launchpadLocalnet,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get Uniswap V4 contract addresses for a chain
 * @throws Error if chain is not supported
 */
export function getUniswapV4(chainId: ChainId): UniswapV4Deployment {
  const deployment = uniswapV4Deployments[chainId];
  if (!deployment) {
    throw new Error(`Uniswap V4 not deployed on chain ${chainId}`);
  }
  return deployment;
}

/**
 * Get Bazaar marketplace address for a chain
 */
export function getBazaarMarketplace(chainId: ChainId): Address | undefined {
  const deployment = bazaarMarketplaceDeployments[chainId];
  const address = deployment?.marketplace ?? deployment?.at;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get ERC20 factory address for a chain
 */
export function getERC20Factory(chainId: ChainId): Address | undefined {
  const deployment = erc20FactoryDeployments[chainId];
  const address = deployment?.factory ?? deployment?.at;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get Identity Registry address for a chain
 */
export function getIdentityRegistry(chainId: ChainId): Address | undefined {
  const deployment = identitySystemDeployments[chainId];
  const address = deployment?.IdentityRegistry ?? deployment?.identityRegistry;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get XLP AMM deployment for a chain
 * @throws Error if chain is not supported
 */
export function getXLPDeployment(chainId: ChainId): XLPDeployment {
  const deployment = xlpDeployments[chainId];
  if (!deployment) {
    throw new Error(`XLP not deployed on chain ${chainId}`);
  }
  return deployment;
}

/**
 * Get Launchpad deployment for a chain
 * @throws Error if chain is not supported
 */
export function getLaunchpadDeployment(chainId: ChainId): LaunchpadDeployment {
  const deployment = launchpadDeployments[chainId];
  if (!deployment) {
    throw new Error(`Launchpad not deployed on chain ${chainId}`);
  }
  return deployment;
}

/**
 * Get TokenLaunchpad address for a chain
 */
export function getTokenLaunchpad(chainId: ChainId): Address | undefined {
  const deployment = launchpadDeployments[chainId];
  const address = deployment?.tokenLaunchpad;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get Game System deployment for a chain
 * @throws Error if chain is not supported
 */
export function getGameSystem(chainId: ChainId): GameSystemDeployment {
  const deployment = gameSystemDeployments[chainId];
  if (!deployment) {
    throw new Error(`Game system not deployed on chain ${chainId}`);
  }
  return deployment;
}

/**
 * Get Game Gold token address for a chain
 */
export function getGameGold(chainId: ChainId): Address | undefined {
  const deployment = gameSystemDeployments[chainId];
  return toAddress(deployment?.goldToken);
}

/**
 * Get Game Items NFT address for a chain
 */
export function getGameItems(chainId: ChainId): Address | undefined {
  const deployment = gameSystemDeployments[chainId];
  return toAddress(deployment?.itemsNFT);
}

/**
 * Get Game Integration contract address for a chain
 */
export function getGameIntegration(chainId: ChainId): Address | undefined {
  const deployment = gameSystemDeployments[chainId];
  return toAddress(deployment?.gameIntegration);
}

/**
 * Get Paymaster System deployment
 * @throws Error if chain is not supported
 */
export function getPaymasterSystem(chainId: ChainId): PaymasterSystemDeployment {
  const deployment = paymasterDeployments[chainId];
  if (!deployment) {
    throw new Error(`Paymaster system not deployed on chain ${chainId}`);
  }
  return deployment;
}

/**
 * Get Sponsored Paymaster address
 */
export function getSponsoredPaymaster(chainId: ChainId): Address | undefined {
  const deployment = paymasterDeployments[chainId];
  return toAddress(deployment?.sponsoredPaymaster);
}

/**
 * Get all contract addresses for a chain
 */
export function getContractAddresses(chainId: ChainId): ContractAddresses {
  const v4 = getUniswapV4(chainId);
  const identity = identitySystemDeployments[chainId];
  const paymaster = paymasterDeployments[chainId];
  const marketplace = bazaarMarketplaceDeployments[chainId];
  const launchpad = launchpadDeployments[chainId];

  return {
    // Identity & Registry
    identityRegistry: getIdentityRegistry(chainId),
    reputationRegistry: toAddress(identity?.reputationRegistry),
    validationRegistry: toAddress(identity?.validationRegistry),
    serviceRegistry: toAddress(identity?.serviceRegistry),

    // DeFi
    poolManager: toAddress(v4?.poolManager),
    swapRouter: toAddress(v4?.swapRouter),
    positionManager: toAddress(v4?.positionManager),
    quoterV4: toAddress(v4?.quoterV4),
    stateView: toAddress(v4?.stateView),
    weth: toAddress(v4?.weth),

    // Marketplace
    marketplace: getBazaarMarketplace(chainId),

    // Token Factory
    erc20Factory: getERC20Factory(chainId),

    // Paymaster / AA
    entryPoint: toAddress(paymaster?.entryPoint),
    paymasterFactory: toAddress(paymaster?.paymasterFactory),
    tokenRegistry: toAddress(paymaster?.tokenRegistry),
    priceOracle: toAddress(paymaster?.priceOracle),

    // Tokens
    usdc: toAddress(identity?.usdc),
    elizaOS: toAddress(identity?.elizaOS),
    goldToken: toAddress(marketplace?.goldToken),
    
    // Launchpad
    tokenLaunchpad: getTokenLaunchpad(chainId),
    lpLockerTemplate: toAddress(launchpad?.lpLockerTemplate),
  };
}

/**
 * Get contract addresses by network name
 */
export function getContractAddressesByNetwork(network: NetworkName): ContractAddresses {
  let chainId: ChainId;
  switch (network) {
    case 'localnet':
      chainId = CHAIN_IDS.localnet;
      break;
    case 'testnet':
      chainId = CHAIN_IDS.testnet;
      break;
    case 'mainnet':
      chainId = CHAIN_IDS.mainnetL1;
      break;
  }
  return getContractAddresses(chainId);
}

// ============================================================================
// Raw Deployment Exports (for advanced use cases)
// ============================================================================

export const rawDeployments = {
  uniswapV4_1337: uniswapV4_1337_raw,
  uniswapV4_420691: uniswapV4_420691_raw,
  bazaarMarketplace1337: bazaarMarketplace1337_raw,
  erc20Factory1337: erc20Factory1337_raw,
  identitySystem1337: identitySystem1337_raw,
  localnetAddresses: localnetAddresses_raw,
  paymasterSystemLocalnet: paymasterSystemLocalnet_raw,
  eilLocalnet: eilLocalnet_raw,
  eilTestnet: eilTestnet_raw,
  gameSystem1337: gameSystem1337_raw,
  predimarket1337: predimarket1337_raw,
  rpgTokens1337: rpgTokens1337_raw,
  elizaToken1337: elizaToken1337_raw,
  xlpAmmLocalnet: xlpAmmLocalnet_raw,
  launchpadLocalnet: launchpadLocalnet_raw,
} as const;

// Re-export types
export type {
  UniswapV4Deployment,
  BazaarMarketplaceDeployment,
  ERC20FactoryDeployment,
  IdentitySystemDeployment,
  PaymasterSystemDeployment,
  XLPDeployment,
  ContractAddresses,
  LaunchpadDeployment,
  GameSystemDeployment,
} from './schemas';
