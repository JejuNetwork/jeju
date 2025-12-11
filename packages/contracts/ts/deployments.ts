/**
 * @fileoverview Deployment address exports for Jeju contracts
 * @module @jejunetwork/contracts/deployments
 */

import type { Address } from 'viem';
import type {
  NetworkName,
  ChainId,
  UniswapV4Deployment,
  BazaarMarketplaceDeployment,
  ERC20FactoryDeployment,
  IdentitySystemDeployment,
  PaymasterSystemDeployment,
  XLPDeployment,
  GameSystemDeployment,
  ContractAddresses,
} from './types';
import { CHAIN_IDS, ZERO_ADDRESS, isValidAddress } from './types';

// Import deployment JSONs
import uniswapV4_1337 from '../deployments/uniswap-v4-1337.json';
import uniswapV4_420691 from '../deployments/uniswap-v4-420691.json';
import bazaarMarketplace1337 from '../deployments/bazaar-marketplace-1337.json';
import erc20Factory1337 from '../deployments/erc20-factory-1337.json';
import paymasterSystemLocalnet from '../deployments/paymaster-system-localnet.json';
import localnetDeployment from '../deployments/localnet/deployment.json';
import localnetMultiToken from '../deployments/localnet/multi-token-system.json';
import eilLocalnet from '../deployments/eil-localnet.json';
import eilTestnet from '../deployments/eil-testnet.json';
import predimarket1337 from '../deployments/predimarket-1337.json';
import rpgTokens1337 from '../deployments/rpg-tokens-1337.json';
import elizaToken1337 from '../deployments/eliza-token-1337.json';
import xlpAmmLocalnet from '../deployments/xlp-amm-localnet.json';
import gameSystem1337 from '../deployments/game-system-1337.json';

// Combine localnet deployments for identity system
const identitySystem1337 = localnetDeployment;
const localnetAddresses = localnetDeployment;
const multiTokenSystem1337 = localnetMultiToken;

// ============================================================================
// Typed Deployment Exports
// ============================================================================

export const uniswapV4Deployments: Partial<Record<ChainId, UniswapV4Deployment>> = {
  1337: uniswapV4_1337 as UniswapV4Deployment,
  420691: uniswapV4_420691 as UniswapV4Deployment,
};

export const bazaarMarketplaceDeployments: Partial<Record<ChainId, BazaarMarketplaceDeployment>> = {
  1337: bazaarMarketplace1337 as BazaarMarketplaceDeployment,
  420691: bazaarMarketplace1337 as BazaarMarketplaceDeployment,
};

export const erc20FactoryDeployments: Partial<Record<ChainId, ERC20FactoryDeployment>> = {
  1337: erc20Factory1337 as ERC20FactoryDeployment,
  420691: erc20Factory1337 as ERC20FactoryDeployment,
};

export const identitySystemDeployments: Partial<Record<ChainId, IdentitySystemDeployment>> = {
  1337: { ...identitySystem1337, ...localnetAddresses } as IdentitySystemDeployment,
  420691: { ...identitySystem1337, ...localnetAddresses } as IdentitySystemDeployment,
};

export const paymasterDeployments: Partial<Record<ChainId, PaymasterSystemDeployment>> = {
  1337: paymasterSystemLocalnet as PaymasterSystemDeployment,
  420691: paymasterSystemLocalnet as PaymasterSystemDeployment,
};

export const xlpDeployments: Partial<Record<ChainId, XLPDeployment>> = {
  1337: xlpAmmLocalnet as XLPDeployment,
  420691: xlpAmmLocalnet as XLPDeployment,
};

// Filter out null values from JSON (JSON doesn't support undefined)
function filterNulls<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null)
  ) as Partial<T>;
}

export const gameSystemDeployments: Partial<Record<ChainId, GameSystemDeployment>> = {
  1337: filterNulls(gameSystem1337) as GameSystemDeployment,
  420691: filterNulls(gameSystem1337) as GameSystemDeployment,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get Uniswap V4 contract addresses for a chain
 */
export function getUniswapV4(chainId: ChainId): UniswapV4Deployment {
  return uniswapV4Deployments[chainId] ?? {};
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
 */
export function getXLPDeployment(chainId: ChainId): XLPDeployment {
  return xlpDeployments[chainId] ?? {};
}

/**
 * Get game system deployment for a chain
 */
export function getGameSystem(chainId: ChainId): GameSystemDeployment {
  return gameSystemDeployments[chainId] ?? {};
}

/**
 * Get game Gold token address for a chain
 */
export function getGameGold(chainId: ChainId): Address | undefined {
  const game = gameSystemDeployments[chainId];
  const marketplace = bazaarMarketplaceDeployments[chainId];
  const address = game?.goldToken ?? marketplace?.goldToken;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get game Items NFT address for a chain
 */
export function getGameItems(chainId: ChainId): Address | undefined {
  const deployment = gameSystemDeployments[chainId];
  const address = deployment?.itemsNFT;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get GameIntegration hub address for a chain
 */
export function getGameIntegration(chainId: ChainId): Address | undefined {
  const deployment = gameSystemDeployments[chainId];
  const address = deployment?.gameIntegration;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get paymaster system deployment for a chain
 */
export function getPaymasterSystem(chainId: ChainId): PaymasterSystemDeployment {
  return paymasterDeployments[chainId] ?? {};
}

/**
 * Get SponsoredPaymaster address for a chain
 */
export function getSponsoredPaymaster(chainId: ChainId): Address | undefined {
  const deployment = paymasterDeployments[chainId];
  const address = deployment?.sponsoredPaymaster;
  return isValidAddress(address) ? address : undefined;
}

/**
 * Get all contract addresses for a chain
 */
export function getContractAddresses(chainId: ChainId): ContractAddresses {
  const v4 = getUniswapV4(chainId);
  const identity = identitySystemDeployments[chainId];
  const paymaster = paymasterDeployments[chainId];
  const marketplace = bazaarMarketplaceDeployments[chainId];
  const game = gameSystemDeployments[chainId];

  return {
    // Identity & Registry
    identityRegistry: getIdentityRegistry(chainId),
    reputationRegistry: identity?.reputationRegistry as Address | undefined,
    validationRegistry: identity?.validationRegistry as Address | undefined,
    serviceRegistry: identity?.serviceRegistry as Address | undefined,

    // DeFi
    poolManager: v4?.poolManager as Address | undefined,
    swapRouter: v4?.swapRouter as Address | undefined,
    positionManager: v4?.positionManager as Address | undefined,
    quoterV4: v4?.quoterV4 as Address | undefined,
    stateView: v4?.stateView as Address | undefined,
    weth: v4?.weth as Address | undefined,

    // Marketplace
    marketplace: getBazaarMarketplace(chainId),

    // Token Factory
    erc20Factory: getERC20Factory(chainId),

    // Paymaster / AA (Account Abstraction - ERC-4337)
    entryPoint: paymaster?.entryPoint as Address | undefined,
    paymasterFactory: paymaster?.paymasterFactory as Address | undefined,
    tokenRegistry: paymaster?.tokenRegistry as Address | undefined,
    priceOracle: paymaster?.priceOracle as Address | undefined,
    sponsoredPaymaster: paymaster?.sponsoredPaymaster as Address | undefined,
    liquidityPaymaster: paymaster?.liquidityPaymaster as Address | undefined,
    multiTokenPaymaster: paymaster?.multiTokenPaymaster as Address | undefined,
    simpleAccountFactory: paymaster?.simpleAccountFactory as Address | undefined,

    // Tokens
    usdc: identity?.usdc as Address | undefined,
    elizaOS: identity?.elizaOS as Address | undefined,
    goldToken: getGameGold(chainId),
    
    // Game System (Hyperscape-compatible)
    itemsNFT: getGameItems(chainId),
    playerTradeEscrow: game?.playerTradeEscrow as Address | undefined,
    gameIntegration: getGameIntegration(chainId),
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
  uniswapV4_1337,
  uniswapV4_420691,
  bazaarMarketplace1337,
  erc20Factory1337,
  identitySystem1337,
  localnetAddresses,
  paymasterSystemLocalnet,
  multiTokenSystem1337,
  eilLocalnet,
  eilTestnet,
  predimarket1337,
  rpgTokens1337,
  elizaToken1337,
  xlpAmmLocalnet,
  gameSystem1337,
} as const;

// Re-export types
export type {
  UniswapV4Deployment,
  BazaarMarketplaceDeployment,
  ERC20FactoryDeployment,
  IdentitySystemDeployment,
  PaymasterSystemDeployment,
  XLPDeployment,
  GameSystemDeployment,
  ContractAddresses,
} from './types';

