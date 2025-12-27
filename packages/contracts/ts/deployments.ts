/**
 * @fileoverview Deployment address exports for network contracts
 * @module @jejunetwork/contracts/deployments
 */

import type { Address } from 'viem'
import {
  type BazaarMarketplaceDeployment,
  BazaarMarketplaceDeploymentSchema,
  type ContractAddresses,
  type ERC20FactoryDeployment,
  ERC20FactoryDeploymentSchema,
  type IdentitySystemDeployment,
  IdentitySystemDeploymentSchema,
  type LaunchpadDeployment,
  LaunchpadDeploymentSchema,
  type PaymasterSystemDeployment,
  PaymasterSystemDeploymentSchema,
  type SimpleCollectibleDeployment,
  SimpleCollectibleDeploymentSchema,
  type UniswapV4Deployment,
  UniswapV4DeploymentSchema,
  type XLPDeployment,
  XLPDeploymentSchema,
} from './schemas'
import type { ChainId, NetworkName } from './types'
import { CHAIN_IDS, isValidAddress } from './types'

function toAddress(address: string | undefined): Address | undefined {
  return isValidAddress(address) ? address : undefined
}

import bazaarMarketplace1337_raw from '../deployments/bazaar-marketplace-31337.json' with {
  type: 'json',
}
import eilLocalnet_raw from '../deployments/eil-localnet.json' with {
  type: 'json',
}
import eilTestnet_raw from '../deployments/eil-testnet.json' with {
  type: 'json',
}
import erc20Factory1337_raw from '../deployments/erc20-factory-31337.json' with {
  type: 'json',
}
import identitySystem1337_raw from '../deployments/identity-system-31337.json' with {
  type: 'json',
}
import launchpadLocalnet_raw from '../deployments/launchpad-localnet.json' with {
  type: 'json',
}
import localnetAddresses_raw from '../deployments/localnet-addresses.json' with {
  type: 'json',
}
import paymasterSystemLocalnet_raw from '../deployments/paymaster-system-localnet.json' with {
  type: 'json',
}
import predictionMarket1337_raw from '../deployments/prediction-market-31337.json' with {
  type: 'json',
}
import simpleCollectible1337_raw from '../deployments/simple-collectible-31337.json' with {
  type: 'json',
}
import uniswapV4_1337_raw from '../deployments/uniswap-v4-31337.json' with {
  type: 'json',
}
import uniswapV4_420691_raw from '../deployments/uniswap-v4-420691.json' with {
  type: 'json',
}
import xlpAmmLocalnet_raw from '../deployments/xlp-amm-localnet.json' with {
  type: 'json',
}

const uniswapV4_1337 = UniswapV4DeploymentSchema.parse(uniswapV4_1337_raw)
const uniswapV4_420691 = UniswapV4DeploymentSchema.parse(uniswapV4_420691_raw)
const bazaarMarketplace1337 = BazaarMarketplaceDeploymentSchema.parse(
  bazaarMarketplace1337_raw,
)
const simpleCollectible1337 = SimpleCollectibleDeploymentSchema.parse(
  simpleCollectible1337_raw,
)
const erc20Factory1337 =
  ERC20FactoryDeploymentSchema.parse(erc20Factory1337_raw)
const identitySystem1337 = IdentitySystemDeploymentSchema.parse(
  identitySystem1337_raw,
)
const localnetAddresses = IdentitySystemDeploymentSchema.partial().parse(
  localnetAddresses_raw,
)
const paymasterSystemLocalnet = PaymasterSystemDeploymentSchema.parse(
  paymasterSystemLocalnet_raw,
)
const xlpAmmLocalnet = XLPDeploymentSchema.parse(xlpAmmLocalnet_raw)
const launchpadLocalnet = LaunchpadDeploymentSchema.parse(launchpadLocalnet_raw)

export const uniswapV4Deployments: Partial<
  Record<ChainId, UniswapV4Deployment>
> = {
  31337: uniswapV4_1337,
  420691: uniswapV4_420691,
}

export const bazaarMarketplaceDeployments: Partial<
  Record<ChainId, BazaarMarketplaceDeployment>
> = {
  31337: bazaarMarketplace1337,
  420691: bazaarMarketplace1337,
}

export const simpleCollectibleDeployments: Partial<
  Record<ChainId, SimpleCollectibleDeployment>
> = {
  31337: simpleCollectible1337,
}

export const erc20FactoryDeployments: Partial<
  Record<ChainId, ERC20FactoryDeployment>
> = {
  31337: erc20Factory1337,
  420691: erc20Factory1337,
}

export const identitySystemDeployments: Partial<
  Record<ChainId, IdentitySystemDeployment>
> = {
  31337: { ...identitySystem1337, ...localnetAddresses },
  420691: { ...identitySystem1337, ...localnetAddresses },
}

export const paymasterDeployments: Partial<
  Record<ChainId, PaymasterSystemDeployment>
> = {
  31337: paymasterSystemLocalnet,
  420691: paymasterSystemLocalnet,
}

export const xlpDeployments: Partial<Record<ChainId, XLPDeployment>> = {
  31337: xlpAmmLocalnet,
  420691: xlpAmmLocalnet,
}

export const launchpadDeployments: Partial<
  Record<ChainId, LaunchpadDeployment>
> = {
  31337: launchpadLocalnet,
  420691: launchpadLocalnet,
}

export function getUniswapV4(chainId: ChainId): UniswapV4Deployment {
  const deployment = uniswapV4Deployments[chainId]
  if (!deployment) {
    throw new Error(`Uniswap V4 not deployed on chain ${chainId}`)
  }
  return deployment
}

/**
 * Get Bazaar marketplace address for a chain
 */
export function getBazaarMarketplace(chainId: ChainId): Address | undefined {
  const deployment = bazaarMarketplaceDeployments[chainId]
  const address = deployment?.marketplace ?? deployment?.at
  return isValidAddress(address) ? address : undefined
}

/**
 * Get SimpleCollectible address for a chain
 */
export function getSimpleCollectible(chainId: ChainId): Address | undefined {
  const deployment = simpleCollectibleDeployments[chainId]
  const address = deployment?.simpleCollectible ?? deployment?.at
  return isValidAddress(address) ? address : undefined
}

/**
 * Get ERC20 factory address for a chain
 */
export function getERC20Factory(chainId: ChainId): Address | undefined {
  const deployment = erc20FactoryDeployments[chainId]
  const address = deployment?.factory ?? deployment?.at
  return isValidAddress(address) ? address : undefined
}

/**
 * Get Identity Registry address for a chain
 */
export function getIdentityRegistry(chainId: ChainId): Address | undefined {
  const deployment = identitySystemDeployments[chainId]
  const address = deployment?.IdentityRegistry ?? deployment?.identityRegistry
  return isValidAddress(address) ? address : undefined
}

/**
 * Get XLP AMM deployment for a chain
 * @throws Error if chain is not supported
 */
export function getXLPDeployment(chainId: ChainId): XLPDeployment {
  const deployment = xlpDeployments[chainId]
  if (!deployment) {
    throw new Error(`XLP not deployed on chain ${chainId}`)
  }
  return deployment
}

/**
 * Get Launchpad deployment for a chain
 * @throws Error if chain is not supported
 */
export function getLaunchpadDeployment(chainId: ChainId): LaunchpadDeployment {
  const deployment = launchpadDeployments[chainId]
  if (!deployment) {
    throw new Error(`Launchpad not deployed on chain ${chainId}`)
  }
  return deployment
}

/**
 * Get TokenLaunchpad address for a chain
 */
export function getTokenLaunchpad(chainId: ChainId): Address | undefined {
  const deployment = launchpadDeployments[chainId]
  const address = deployment?.tokenLaunchpad
  return isValidAddress(address) ? address : undefined
}

/**
 * Get Paymaster System deployment
 * @throws Error if chain is not supported
 */
export function getPaymasterSystem(
  chainId: ChainId,
): PaymasterSystemDeployment {
  const deployment = paymasterDeployments[chainId]
  if (!deployment) {
    throw new Error(`Paymaster system not deployed on chain ${chainId}`)
  }
  return deployment
}

/**
 * Get Sponsored Paymaster address
 */
export function getSponsoredPaymaster(chainId: ChainId): Address | undefined {
  const deployment = paymasterDeployments[chainId]
  return toAddress(deployment?.sponsoredPaymaster)
}

/**
 * Get all contract addresses for a chain
 */
export function getContractAddresses(chainId: ChainId): ContractAddresses {
  const v4 = getUniswapV4(chainId)
  const identity = identitySystemDeployments[chainId]
  const paymaster = paymasterDeployments[chainId]
  const marketplace = bazaarMarketplaceDeployments[chainId]
  const launchpad = launchpadDeployments[chainId]

  return {
    // Identity & Registry
    identityRegistry: getIdentityRegistry(chainId),
    reputationRegistry: toAddress(identity?.reputationRegistry),
    validationRegistry: toAddress(identity?.validationRegistry),
    serviceRegistry: toAddress(identity?.serviceRegistry),

    // DeFi
    poolManager: toAddress(v4.poolManager),
    swapRouter: toAddress(v4.swapRouter),
    positionManager: toAddress(v4.positionManager),
    quoterV4: toAddress(v4.quoterV4),
    stateView: toAddress(v4.stateView),
    weth: toAddress(v4.weth),

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
    jeju: toAddress(identity?.jeju),
    goldToken: toAddress(marketplace?.goldToken),

    // Launchpad
    tokenLaunchpad: getTokenLaunchpad(chainId),
    lpLockerTemplate: toAddress(launchpad?.lpLockerTemplate),
  }
}

/**
 * Get contract addresses by network name
 */
export function getContractAddressesByNetwork(
  network: NetworkName,
): ContractAddresses {
  let chainId: ChainId
  switch (network) {
    case 'localnet':
      chainId = CHAIN_IDS.localnet
      break
    case 'testnet':
      chainId = CHAIN_IDS.testnet
      break
    case 'mainnet':
      chainId = CHAIN_IDS.mainnetL1
      break
  }
  return getContractAddresses(chainId)
}

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
  predictionMarket1337: predictionMarket1337_raw,
  xlpAmmLocalnet: xlpAmmLocalnet_raw,
  launchpadLocalnet: launchpadLocalnet_raw,
} as const
