/**
 * @fileoverview Zod schemas for deployment validation
 * @module @jejunetwork/contracts/schemas
 */

import { z } from 'zod'

// Address validation (0x followed by 40 hex characters)
export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format')
// Note: Use `Address` from 'viem' for type-safe addresses. This schema validates the format.

// Optional address that can be null/undefined/empty
export const OptionalAddressSchema = AddressSchema.optional().nullable()

// ============================================================================
// Uniswap V4 Deployment Schema
// ============================================================================

export const UniswapV4DeploymentSchema = z.object({
  poolManager: AddressSchema.optional(),
  weth: AddressSchema.optional(),
  swapRouter: AddressSchema.optional(),
  positionManager: AddressSchema.optional(),
  quoterV4: AddressSchema.optional(),
  stateView: AddressSchema.optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  deployer: AddressSchema.optional(),
  chainId: z.number().optional(),
  network: z.string().optional(),
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

// ============================================================================
// Bazaar Marketplace Deployment Schema
// ============================================================================

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

// ============================================================================
// ERC20 Factory Deployment Schema
// ============================================================================

export const ERC20FactoryDeploymentSchema = z.object({
  at: AddressSchema.optional(),
  factory: AddressSchema.optional(),
})
export type ERC20FactoryDeployment = z.infer<
  typeof ERC20FactoryDeploymentSchema
>

// ============================================================================
// Identity System Deployment Schema
// ============================================================================

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

// ============================================================================
// Paymaster System Deployment Schema
// ============================================================================

export const PaymasterExampleDeploymentSchema = z.object({
  token: AddressSchema,
  symbol: z.string(),
  paymaster: z.string(),
  vault: z.string(),
  distributor: z.string(),
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

// ============================================================================
// Multi-Token System Deployment Schema
// ============================================================================

export const MultiTokenSystemDeploymentSchema = z
  .object({
    tokenRegistry: AddressSchema.optional(),
    usdc: AddressSchema.optional(),
    weth: AddressSchema.optional(),
    elizaOS: AddressSchema.optional(),
  })
  .passthrough() // Allow additional token addresses
export type MultiTokenSystemDeployment = z.infer<
  typeof MultiTokenSystemDeploymentSchema
>

// ============================================================================
// EIL Deployment Schema
// ============================================================================

export const EILDeploymentSchema = z.object({
  identityRegistry: AddressSchema.optional(),
  reputationRegistry: AddressSchema.optional(),
  validationRegistry: AddressSchema.optional(),
  serviceRegistry: AddressSchema.optional(),
  creditManager: AddressSchema.optional(),
  deployer: AddressSchema.optional(),
  timestamp: z.string().optional(),
})
export type EILDeployment = z.infer<typeof EILDeploymentSchema>

// ============================================================================
// Liquidity System Deployment Schema
// ============================================================================

export const LiquiditySystemDeploymentSchema = z.object({
  liquidityVault: AddressSchema.optional(),
  poolManager: AddressSchema.optional(),
  token0: AddressSchema.optional(),
  token1: AddressSchema.optional(),
})
export type LiquiditySystemDeployment = z.infer<
  typeof LiquiditySystemDeploymentSchema
>

// ============================================================================
// XLP Deployment Schema
// ============================================================================

export const XLPDeploymentSchema = z.object({
  v2Factory: AddressSchema.optional(),
  v3Factory: AddressSchema.optional(),
  router: AddressSchema.optional(),
  positionManager: AddressSchema.optional(),
  liquidityAggregator: AddressSchema.optional(),
  routerRegistry: AddressSchema.optional(),
  weth: AddressSchema.optional(),
  deployedAt: z.string().optional(),
  chainId: z.number().optional(),
})
export type XLPDeployment = z.infer<typeof XLPDeploymentSchema>

// ============================================================================
// L1 Deployment Schema
// ============================================================================

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

// ============================================================================
// Moderation System Deployment Schema
// ============================================================================

export const ModerationSystemDeploymentSchema = z.object({
  banManager: AddressSchema.optional(),
  moderationMarketplace: AddressSchema.optional(),
  reportingSystem: AddressSchema.optional(),
  reputationLabelManager: AddressSchema.optional(),
  predimarket: AddressSchema.optional(),
  registryGovernance: AddressSchema.optional(),
  treasury: AddressSchema.optional(),
  deployedAt: z.string().optional(),
  chainId: z.number().optional(),
})
export type ModerationSystemDeployment = z.infer<
  typeof ModerationSystemDeploymentSchema
>

// ============================================================================
// Launchpad Deployment Schema
// ============================================================================

export const LaunchpadDeploymentSchema = z.object({
  tokenLaunchpad: AddressSchema.optional(),
  lpLockerTemplate: AddressSchema.optional(),
  defaultCommunityVault: AddressSchema.optional(),
  xlpV2Factory: AddressSchema.optional(),
  weth: AddressSchema.optional(),
  deployedAt: z.string().optional(),
  chainId: z.number().optional(),
})
export type LaunchpadDeployment = z.infer<typeof LaunchpadDeploymentSchema>

// ============================================================================
// Game System Deployment Schema
// ============================================================================

export const GameSystemDeploymentSchema = z.object({
  goldToken: AddressSchema.nullable().optional(),
  itemsNFT: AddressSchema.nullable().optional(),
  gameIntegration: AddressSchema.nullable().optional(),
  playerTradeEscrow: AddressSchema.nullable().optional(),
  gameAgentId: z.string().nullable().optional(),
  gameSigner: AddressSchema.nullable().optional(),
  mudWorld: AddressSchema.nullable().optional(),
  jejuIntegrationSystem: AddressSchema.nullable().optional(),
  appId: z.string().nullable().optional(),
  gameName: z.string().nullable().optional(),
  baseURI: z.string().nullable().optional(),
  deployedAt: z.string().nullable().optional(),
  chainId: z.number().optional(),
})
export type GameSystemDeployment = z.infer<typeof GameSystemDeploymentSchema>

// ============================================================================
// Contract Addresses Schema
// ============================================================================

export const ContractAddressesSchema = z.object({
  // Identity & Registry
  identityRegistry: AddressSchema.optional(),
  reputationRegistry: AddressSchema.optional(),
  validationRegistry: AddressSchema.optional(),
  serviceRegistry: AddressSchema.optional(),

  // Moderation
  banManager: AddressSchema.optional(),
  moderationMarketplace: AddressSchema.optional(),
  reportingSystem: AddressSchema.optional(),
  reputationLabelManager: AddressSchema.optional(),

  // DeFi
  poolManager: AddressSchema.optional(),
  swapRouter: AddressSchema.optional(),
  positionManager: AddressSchema.optional(),
  quoterV4: AddressSchema.optional(),
  stateView: AddressSchema.optional(),
  weth: AddressSchema.optional(),

  // Marketplace
  marketplace: AddressSchema.optional(),
  predimarket: AddressSchema.optional(),

  // Token Factory
  erc20Factory: AddressSchema.optional(),

  // Paymaster / AA
  entryPoint: AddressSchema.optional(),
  paymasterFactory: AddressSchema.optional(),
  tokenRegistry: AddressSchema.optional(),
  priceOracle: AddressSchema.optional(),

  // Tokens
  usdc: AddressSchema.optional(),
  elizaOS: AddressSchema.optional(),
  goldToken: AddressSchema.optional(),
  jeju: AddressSchema.optional(),

  // Launchpad
  tokenLaunchpad: AddressSchema.optional(),
  lpLockerTemplate: AddressSchema.optional(),
})
export type ContractAddresses = z.infer<typeof ContractAddressesSchema>

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Validate and parse a deployment JSON file
 * @throws ZodError if validation fails
 */
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

/**
 * Safe version that returns undefined instead of throwing
 */
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
