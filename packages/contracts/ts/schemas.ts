/**
 * @fileoverview Zod schemas for deployment validation
 * @module @jejunetwork/contracts/schemas
 */

import { AddressSchema as TypesAddressSchema } from '@jejunetwork/types'
import { z } from 'zod'

export const AddressSchema = TypesAddressSchema
export const OptionalAddressSchema = AddressSchema.optional()

export const NetworkNameSchema = z.enum(['localnet', 'testnet', 'mainnet'])
export type NetworkNameFromSchema = z.infer<typeof NetworkNameSchema>

export const TimestampSchema = z.union([
  z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  z.number().int().positive(),
])

export const UniswapV4DeploymentSchema = z.object({
  poolManager: AddressSchema.optional(),
  weth: AddressSchema.optional(),
  swapRouter: AddressSchema.optional(),
  positionManager: AddressSchema.optional(),
  quoterV4: AddressSchema.optional(),
  stateView: AddressSchema.optional(),
  timestamp: TimestampSchema.optional(),
  deployer: AddressSchema.optional(),
  chainId: z.number().int().positive().optional(),
  network: NetworkNameSchema.optional(),
  deployedAt: z.string().optional(),
  version: z.string().optional(),
  features: z
    .object({
      singleton: z.boolean().optional(),
      hooks: z.boolean().optional(),
      flashAccounting: z.boolean().optional(),
      nativeETH: z.boolean().optional(),
    })
    .optional(),
  notes: z.string().optional(),
})
export type UniswapV4Deployment = z.infer<typeof UniswapV4DeploymentSchema>

export const BazaarMarketplaceDeploymentSchema = z.object({
  at: AddressSchema.optional(),
  marketplace: AddressSchema.optional(),
  goldToken: AddressSchema.optional(),
  usdcToken: AddressSchema.optional(),
  Owner: AddressSchema.optional(),
  Recipient: AddressSchema.optional(),
})
export type BazaarMarketplaceDeployment = z.infer<
  typeof BazaarMarketplaceDeploymentSchema
>

export const ERC20FactoryDeploymentSchema = z.object({
  at: AddressSchema.optional(),
  factory: AddressSchema.optional(),
})
export type ERC20FactoryDeployment = z.infer<
  typeof ERC20FactoryDeploymentSchema
>

export const IdentitySystemDeploymentSchema = z.object({
  Deployer: AddressSchema.optional(),
  IdentityRegistry: AddressSchema.optional(),
  identityRegistry: AddressSchema.optional(),
  reputationRegistry: AddressSchema.optional(),
  validationRegistry: AddressSchema.optional(),
  serviceRegistry: AddressSchema.optional(),
  creditManager: AddressSchema.optional(),
  cloudReputationProvider: AddressSchema.optional(),
  usdc: AddressSchema.optional(),
  elizaOS: AddressSchema.optional(),
})
export type IdentitySystemDeployment = z.infer<
  typeof IdentitySystemDeploymentSchema
>

export const PaymasterExampleDeploymentSchema = z.object({
  token: AddressSchema,
  symbol: z.string().min(1).max(10),
  paymaster: AddressSchema,
  vault: AddressSchema,
  distributor: AddressSchema,
})

export const PaymasterSystemDeploymentSchema = z.object({
  tokenRegistry: AddressSchema.optional(),
  priceOracle: AddressSchema.optional(),
  paymasterFactory: AddressSchema.optional(),
  entryPoint: AddressSchema.optional(),
  sponsoredPaymaster: AddressSchema.optional(),
  exampleDeployments: z.array(PaymasterExampleDeploymentSchema).optional(),
})
export type PaymasterSystemDeployment = z.infer<
  typeof PaymasterSystemDeploymentSchema
>

export const MultiTokenSystemDeploymentSchema = z
  .object({
    tokenRegistry: AddressSchema.optional(),
    usdc: AddressSchema.optional(),
    weth: AddressSchema.optional(),
    elizaOS: AddressSchema.optional(),
  })
  .passthrough()
export type MultiTokenSystemDeployment = z.infer<
  typeof MultiTokenSystemDeploymentSchema
>

export const EILDeploymentSchema = z.object({
  identityRegistry: AddressSchema.optional(),
  reputationRegistry: AddressSchema.optional(),
  validationRegistry: AddressSchema.optional(),
  serviceRegistry: AddressSchema.optional(),
  creditManager: AddressSchema.optional(),
  deployer: AddressSchema.optional(),
  timestamp: z.string().datetime().or(z.string()).optional(),
})
export type EILDeployment = z.infer<typeof EILDeploymentSchema>

export const LiquiditySystemDeploymentSchema = z.object({
  liquidityVault: AddressSchema.optional(),
  poolManager: AddressSchema.optional(),
  token0: AddressSchema.optional(),
  token1: AddressSchema.optional(),
})
export type LiquiditySystemDeployment = z.infer<
  typeof LiquiditySystemDeploymentSchema
>

export const XLPDeploymentSchema = z.object({
  v2Factory: AddressSchema.optional(),
  v3Factory: AddressSchema.optional(),
  router: AddressSchema.optional(),
  positionManager: AddressSchema.optional(),
  liquidityAggregator: AddressSchema.optional(),
  routerRegistry: AddressSchema.optional(),
  weth: AddressSchema.optional(),
  deployedAt: z.string().optional(),
  chainId: z.number().int().positive().optional(),
})
export type XLPDeployment = z.infer<typeof XLPDeploymentSchema>

export const L1DeploymentSchema = z.object({
  portal: AddressSchema.optional(),
  bridge: AddressSchema.optional(),
  systemConfig: AddressSchema.optional(),
  l1CrossDomainMessenger: AddressSchema.optional(),
  l1StandardBridge: AddressSchema.optional(),
  optimismPortal: AddressSchema.optional(),
  addressManager: AddressSchema.optional(),
})
export type L1Deployment = z.infer<typeof L1DeploymentSchema>

export const ModerationSystemDeploymentSchema = z.object({
  banManager: AddressSchema.optional(),
  moderationMarketplace: AddressSchema.optional(),
  reportingSystem: AddressSchema.optional(),
  reputationLabelManager: AddressSchema.optional(),
  predimarket: AddressSchema.optional(),
  registryGovernance: AddressSchema.optional(),
  treasury: AddressSchema.optional(),
  deployedAt: z.string().optional(),
  chainId: z.number().int().positive().optional(),
})
export type ModerationSystemDeployment = z.infer<
  typeof ModerationSystemDeploymentSchema
>

export const LaunchpadDeploymentSchema = z.object({
  tokenLaunchpad: AddressSchema.optional(),
  lpLockerTemplate: AddressSchema.optional(),
  defaultCommunityVault: AddressSchema.optional(),
  xlpV2Factory: AddressSchema.optional(),
  weth: AddressSchema.optional(),
  deployedAt: z.string().optional(),
  chainId: z.number().int().positive().optional(),
})
export type LaunchpadDeployment = z.infer<typeof LaunchpadDeploymentSchema>

export const GameSystemDeploymentSchema = z.object({
  goldToken: AddressSchema.optional(),
  itemsNFT: AddressSchema.optional(),
  gameIntegration: AddressSchema.optional(),
  playerTradeEscrow: AddressSchema.optional(),
  gameAgentId: z.string().min(1).optional(),
  gameSigner: AddressSchema.optional(),
  mudWorld: AddressSchema.optional(),
  jejuIntegrationSystem: AddressSchema.optional(),
  appId: z.string().min(1).optional(),
  gameName: z.string().min(1).optional(),
  baseURI: z.string().url().optional(),
  deployedAt: z.string().optional(),
  chainId: z.number().int().positive().optional(),
})
export type GameSystemDeployment = z.infer<typeof GameSystemDeploymentSchema>

export const ContractAddressesSchema = z.object({
  identityRegistry: AddressSchema.optional(),
  reputationRegistry: AddressSchema.optional(),
  validationRegistry: AddressSchema.optional(),
  serviceRegistry: AddressSchema.optional(),
  banManager: AddressSchema.optional(),
  moderationMarketplace: AddressSchema.optional(),
  reportingSystem: AddressSchema.optional(),
  reputationLabelManager: AddressSchema.optional(),
  poolManager: AddressSchema.optional(),
  swapRouter: AddressSchema.optional(),
  positionManager: AddressSchema.optional(),
  quoterV4: AddressSchema.optional(),
  stateView: AddressSchema.optional(),
  weth: AddressSchema.optional(),
  marketplace: AddressSchema.optional(),
  predimarket: AddressSchema.optional(),
  erc20Factory: AddressSchema.optional(),
  entryPoint: AddressSchema.optional(),
  paymasterFactory: AddressSchema.optional(),
  tokenRegistry: AddressSchema.optional(),
  priceOracle: AddressSchema.optional(),
  usdc: AddressSchema.optional(),
  elizaOS: AddressSchema.optional(),
  goldToken: AddressSchema.optional(),
  jeju: AddressSchema.optional(),
  tokenLaunchpad: AddressSchema.optional(),
  lpLockerTemplate: AddressSchema.optional(),
})
export type ContractAddresses = z.infer<typeof ContractAddressesSchema>

export function parseUniswapV4Deployment(data: unknown): UniswapV4Deployment {
  return UniswapV4DeploymentSchema.parse(data)
}

export function parseBazaarMarketplaceDeployment(
  data: unknown,
): BazaarMarketplaceDeployment {
  return BazaarMarketplaceDeploymentSchema.parse(data)
}

export function parseERC20FactoryDeployment(
  data: unknown,
): ERC20FactoryDeployment {
  return ERC20FactoryDeploymentSchema.parse(data)
}

export function parseIdentitySystemDeployment(
  data: unknown,
): IdentitySystemDeployment {
  return IdentitySystemDeploymentSchema.parse(data)
}

export function parsePaymasterSystemDeployment(
  data: unknown,
): PaymasterSystemDeployment {
  return PaymasterSystemDeploymentSchema.parse(data)
}

export function parseXLPDeployment(data: unknown): XLPDeployment {
  return XLPDeploymentSchema.parse(data)
}

export function parseGameSystemDeployment(data: unknown): GameSystemDeployment {
  return GameSystemDeploymentSchema.parse(data)
}

export function parseLaunchpadDeployment(data: unknown): LaunchpadDeployment {
  return LaunchpadDeploymentSchema.parse(data)
}

export function safeParseUniswapV4Deployment(
  data: unknown,
): UniswapV4Deployment | undefined {
  const result = UniswapV4DeploymentSchema.safeParse(data)
  return result.success ? result.data : undefined
}

export function safeParseGameSystemDeployment(
  data: unknown,
): GameSystemDeployment | undefined {
  const result = GameSystemDeploymentSchema.safeParse(data)
  return result.success ? result.data : undefined
}
