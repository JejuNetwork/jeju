/**
 * @fileoverview Deployment address exports for network contracts
 * @module @jejunetwork/contracts/deployments
 *
 * Deployment files are generated when localnet/testnet/mainnet contracts are deployed.
 * Missing files are handled gracefully - they return empty objects which Zod schemas accept.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const DEPLOYMENTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../deployments',
)

/**
 * Union type of all possible deployment data structures.
 * Used for type-safe JSON parsing before Zod validation.
 */
type DeploymentData =
  | UniswapV4Deployment
  | BazaarMarketplaceDeployment
  | SimpleCollectibleDeployment
  | ERC20FactoryDeployment
  | IdentitySystemDeployment
  | PaymasterSystemDeployment
  | XLPDeployment
  | LaunchpadDeployment
  | Record<string, never>

/**
 * Safely load a deployment JSON file. Returns empty object if file doesn't exist.
 * The return type uses DeploymentData union for better type safety, but JSON.parse
 * returns unknown, so we validate with Zod schemas immediately after parsing.
 */
function loadDeployment(filename: string): DeploymentData {
  const filepath = join(DEPLOYMENTS_DIR, filename)
  if (!existsSync(filepath)) {
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(filepath, 'utf-8'))
    return parsed as DeploymentData
  } catch {
    return {}
  }
}

function toAddress(address: string | undefined): Address | undefined {
  return isValidAddress(address) ? address : undefined
}

/**
 * Check if a deployment object has actual content (not just an empty {})
 */
function isDeployed(deployment: DeploymentData | undefined): boolean {
  return !!deployment && Object.keys(deployment).length > 0
}

// Load deployment files (missing files return empty objects)
const uniswapV4_1337_raw = loadDeployment('uniswap-v4-31337.json')
const uniswapV4_420690_raw = loadDeployment('uniswap-v4-420690.json')
const uniswapV4_420691_raw = loadDeployment('uniswap-v4-420691.json')
const bazaarMarketplace1337_raw = loadDeployment(
  'bazaar-marketplace-31337.json',
)
const simpleCollectible1337_raw = loadDeployment(
  'simple-collectible-31337.json',
)
const erc20Factory1337_raw = loadDeployment('erc20-factory-31337.json')
const identitySystem1337_raw = loadDeployment('identity-system-31337.json')
const localnetAddresses_raw = loadDeployment('localnet-addresses.json')
const paymasterSystemLocalnet_raw = loadDeployment(
  'paymaster-system-localnet.json',
)
const predictionMarket1337_raw = loadDeployment('prediction-market-31337.json')
const xlpAmmLocalnet_raw = loadDeployment('xlp-amm-localnet.json')
const launchpadLocalnet_raw = loadDeployment('launchpad-localnet.json')
const eilLocalnet_raw = loadDeployment('eil-localnet.json')
const eilTestnet_raw = loadDeployment('eil-testnet.json')

// Parse with Zod schemas (all fields are optional, so empty objects are valid)
const uniswapV4_1337 = UniswapV4DeploymentSchema.parse(uniswapV4_1337_raw)
const uniswapV4_420690 = UniswapV4DeploymentSchema.parse(uniswapV4_420690_raw)
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
  420690: uniswapV4_420690,
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
  if (!isDeployed(deployment)) {
    throw new Error(
      `Uniswap V4 not deployed on chain ${chainId}. Run 'bun run dev' to deploy contracts to localnet.`,
    )
  }
  return deployment as UniswapV4Deployment
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
  if (!isDeployed(deployment)) {
    throw new Error(
      `XLP not deployed on chain ${chainId}. Run 'bun run dev' to deploy contracts to localnet.`,
    )
  }
  return deployment as XLPDeployment
}

/**
 * Get Launchpad deployment for a chain
 * @throws Error if chain is not supported
 */
export function getLaunchpadDeployment(chainId: ChainId): LaunchpadDeployment {
  const deployment = launchpadDeployments[chainId]
  if (!isDeployed(deployment)) {
    throw new Error(
      `Launchpad not deployed on chain ${chainId}. Run 'bun run dev' to deploy contracts to localnet.`,
    )
  }
  return deployment as LaunchpadDeployment
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
  if (!isDeployed(deployment)) {
    throw new Error(
      `Paymaster system not deployed on chain ${chainId}. Run 'bun run dev' to deploy contracts to localnet.`,
    )
  }
  return deployment as PaymasterSystemDeployment
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
  uniswapV4_420690: uniswapV4_420690_raw,
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
