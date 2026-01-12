/**
 * Token deployment validation schemas.
 */

import {
  AddressSchema,
  HashSchema,
  HexSchema,
  PercentageSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

export const addressSchema = AddressSchema
export const hexSchema = HexSchema
export const bytes32Schema = HashSchema

export const solanaPublicKeySchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana public key')

export const crossChainAddressSchema = z.union([
  addressSchema,
  solanaPublicKeySchema,
])

export const positiveBigintSchema = z.bigint().positive()
export const nonNegativeBigintSchema = z.bigint().nonnegative()
export const percentageSchema = PercentageSchema
export const bpsSchema = z.number().int().min(0).max(10000)
export const evmChainIdSchema = z.number().int().positive()
export const solanaNetworkSchema = z.enum(['solana-mainnet', 'solana-devnet'])
export const chainIdSchema = z.union([evmChainIdSchema, solanaNetworkSchema])

export const nativeCurrencySchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().min(0).max(18),
})

export const chainConfigSchema = z
  .object({
    chainId: chainIdSchema,
    chainType: z.enum(['evm', 'solana']),
    name: z.string().min(1).max(100),
    rpcUrl: z.string().min(1, 'Missing RPC URL'),
    blockExplorerUrl: z.string(),
    nativeCurrency: nativeCurrencySchema,
    hyperlaneMailbox: z.string().min(1, 'Missing Hyperlane mailbox'),
    hyperlaneIgp: z.string().min(1),
    isHomeChain: z.boolean(),
    avgBlockTime: z.number().positive().max(600),
    uniswapV4PoolManager: addressSchema.optional(),
    dexRouter: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    // Validate EVM mailbox address format
    if (
      data.chainType === 'evm' &&
      data.hyperlaneMailbox &&
      !data.hyperlaneMailbox.startsWith('0x')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid EVM mailbox address',
        path: ['hyperlaneMailbox'],
      })
    }
  })

// TOKEN ECONOMICS SCHEMAS

export const tokenAllocationSchema = z
  .object({
    publicSale: percentageSchema,
    presale: percentageSchema,
    team: percentageSchema,
    advisors: percentageSchema,
    ecosystem: percentageSchema,
    liquidity: percentageSchema,
    stakingRewards: percentageSchema,
  })
  .refine(
    (data) => {
      const total = Object.values(data).reduce((sum, val) => sum + val, 0)
      return total === 100
    },
    { message: 'Allocation percentages must sum to 100' },
  )

export const vestingScheduleSchema = z.object({
  cliffDuration: z.number().int().nonnegative(),
  vestingDuration: z.number().int().nonnegative(),
  tgeUnlockPercent: percentageSchema,
  vestingType: z.enum(['linear', 'discrete']),
  discretePeriods: z.number().int().positive().optional(),
})

export const vestingConfigSchema = z.object({
  team: vestingScheduleSchema,
  advisors: vestingScheduleSchema,
  presale: vestingScheduleSchema,
  ecosystem: vestingScheduleSchema,
  publicSale: vestingScheduleSchema.optional(),
})

export const feeDistributionSchema = z
  .object({
    holders: percentageSchema,
    creators: percentageSchema,
    treasury: percentageSchema,
    liquidityProviders: percentageSchema,
    burn: percentageSchema,
  })
  .refine(
    (data) => {
      const total = Object.values(data).reduce((sum, val) => sum + val, 0)
      return total === 100
    },
    { message: 'Fee distribution percentages must sum to 100' },
  )

export const feeConfigSchema = z.object({
  transferFeeBps: bpsSchema,
  bridgeFeeBps: bpsSchema,
  swapFeeBps: bpsSchema,
  distribution: feeDistributionSchema,
  feeExemptAddresses: z.array(addressSchema),
})

export const tokenEconomicsSchema = z.object({
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().min(0).max(18),
  totalSupply: positiveBigintSchema,
  allocation: tokenAllocationSchema,
  vesting: vestingConfigSchema,
  fees: feeConfigSchema,
  maxWalletPercent: percentageSchema,
  maxTxPercent: percentageSchema,
})

// LIQUIDITY SCHEMAS

/**
 * Liquidity DEX protocols for token deployment
 * Includes EVM DEXes (Uniswap) and Solana DEXes (Raydium, Orca, Jupiter)
 * Different from @jejunetwork/types DexProtocol which covers general DeFi protocols
 * Type: LiquidityDex is exported from types.ts
 */
export const liquidityDexSchema = z.enum([
  'uniswap-v4',
  'uniswap-v3',
  'sushiswap',
  'raydium',
  'orca',
  'jupiter',
])

export const liquidityAllocationSchema = z.object({
  chainId: chainIdSchema,
  percentage: percentageSchema,
  initialPriceUsd: z.number().positive(),
  pairedAsset: z.union([addressSchema, z.literal('SOL')]),
  dex: liquidityDexSchema,
})

export const liquidityConfigSchema = z
  .object({
    lockDuration: z.number().int().nonnegative(),
    lpTokenRecipient: addressSchema,
    allocations: z.array(liquidityAllocationSchema).min(1),
  })
  .refine(
    (data) => {
      const total = data.allocations.reduce((sum, a) => sum + a.percentage, 0)
      return total === 100
    },
    { message: 'Liquidity allocation percentages must sum to 100' },
  )

// PRESALE SCHEMAS

export const presaleTierSchema = z.object({
  name: z.string().min(1),
  minContribution: z.number().nonnegative(),
  maxContribution: z.number().positive(),
  discountPercent: percentageSchema,
  vestingOverride: vestingScheduleSchema.optional(),
  whitelistMerkleRoot: hexSchema.optional(),
})

export const presaleConfigSchema = z
  .object({
    enabled: z.boolean(),
    startTime: z.number().int().positive(),
    endTime: z.number().int().positive(),
    softCapUsd: z.number().nonnegative(),
    hardCapUsd: z.number().positive(),
    priceUsd: z.number().positive(),
    tiers: z.array(presaleTierSchema),
    acceptedTokens: z.record(z.string(), z.array(addressSchema)),
    refundIfSoftCapMissed: z.boolean(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: 'endTime must be after startTime',
  })

// CCA (CONTINUOUS CLEARING AUCTION) SCHEMAS

export const ccaDeploymentModeSchema = z.enum([
  'uniswap-platform',
  'self-deployed',
])

export const ccaAuctionFeesSchema = z.object({
  platformFeeBps: bpsSchema,
  referralFeeBps: bpsSchema,
})

export const ccaConfigSchema = z
  .object({
    deploymentMode: ccaDeploymentModeSchema,
    startTime: z.number().int().positive(),
    duration: z
      .number()
      .int()
      .positive()
      .max(30 * 24 * 60 * 60), // Max 30 days
    startPriceUsd: z.number().positive(),
    reservePriceUsd: z.number().positive(),
    supplyReleaseCurve: z.enum(['linear', 'exponential', 'step']),
    maxBidPercent: percentageSchema,
    minBidUsd: z.number().nonnegative(),
    autoMigrateLiquidity: z.boolean(),
    auctionFees: ccaAuctionFeesSchema.optional(),
  })
  .refine((data) => data.reservePriceUsd <= data.startPriceUsd, {
    message: 'reservePriceUsd must be less than or equal to startPriceUsd',
  })

// HYPERLANE SCHEMAS

export const ismTypeSchema = z.enum([
  'multisig',
  'optimistic',
  'aggregation',
  'routing',
  'pausable',
  'trusted-relayer',
])

export const multisigISMConfigSchema = z.object({
  type: z.literal('multisig'),
  validators: z.array(crossChainAddressSchema).min(1),
  threshold: z.number().int().positive(),
})

export const optimisticISMConfigSchema = z.object({
  type: z.literal('optimistic'),
  challengePeriod: z.number().int().positive(),
  watchers: z.array(crossChainAddressSchema).min(1),
})

export const ismConfigSchema = z.union([
  multisigISMConfigSchema,
  optimisticISMConfigSchema,
])

export const warpRouteTokenTypeSchema = z.enum([
  'native',
  'synthetic',
  'collateral',
])

export const warpRouteConfigSchema = z.object({
  chainId: chainIdSchema,
  tokenType: warpRouteTokenTypeSchema,
  collateralAddress: crossChainAddressSchema.optional(),
  ism: ismConfigSchema,
  owner: crossChainAddressSchema,
  rateLimitPerDay: nonNegativeBigintSchema,
})

export const hyperlaneValidatorSchema = z.object({
  address: crossChainAddressSchema,
  chains: z.array(chainIdSchema).min(1),
})

export const hyperlaneGasConfigSchema = z.object({
  defaultGasLimit: nonNegativeBigintSchema,
  gasOverhead: nonNegativeBigintSchema,
})

export const hyperlaneConfigSchema = z.object({
  routes: z.array(warpRouteConfigSchema).min(1),
  validators: z.array(hyperlaneValidatorSchema),
  gasConfig: hyperlaneGasConfigSchema,
})

// DEPLOYMENT CONFIG SCHEMAS

export const deploymentConfigSchema = z.object({
  token: tokenEconomicsSchema,
  liquidity: liquidityConfigSchema,
  presale: presaleConfigSchema,
  cca: ccaConfigSchema,
  hyperlane: hyperlaneConfigSchema,
  chains: z.array(chainConfigSchema).min(1),
  owner: addressSchema,
  timelockDelay: z.number().int().nonnegative(),
  deploymentSalt: bytes32Schema,
})

// BRIDGE REQUEST SCHEMAS

export const bridgeRequestSchema = z
  .object({
    sourceChain: chainIdSchema,
    destinationChain: chainIdSchema,
    sender: crossChainAddressSchema,
    recipient: crossChainAddressSchema,
    amount: positiveBigintSchema,
    callData: hexSchema.optional(),
  })
  .strict()
  .refine((data) => data.sourceChain !== data.destinationChain, {
    message: 'Source and destination chains must be different',
  })

export const bridgeStatusSchema = z.object({
  requestId: hexSchema,
  status: z.enum(['pending', 'dispatched', 'delivered', 'failed']),
  sourceChain: chainIdSchema,
  destinationChain: chainIdSchema,
  amount: positiveBigintSchema,
  sourceTxHash: hexSchema.optional(),
  destTxHash: hexSchema.optional(),
  error: z.string().optional(),
})

// TOKEN DEPLOYMENT CONFIG SCHEMAS

export const tokenCategorySchema = z.enum([
  'defi',
  'gaming',
  'social',
  'utility',
  'meme',
])

export const tokenDeploymentConfigSchema = z
  .object({
    name: z.string().min(1).max(64),
    symbol: z.string().min(1).max(10),
    decimals: z.number().int().min(0).max(18),
    totalSupply: positiveBigintSchema,
    category: tokenCategorySchema,
    tags: z.array(z.string().min(1).max(32)).max(10),
    description: z.string().min(1).max(1000),
    website: z.string().url().optional(),
    twitter: z.string().max(15).optional(),
    discord: z.string().url().optional(),
    homeChainId: chainIdSchema,
    targetChainIds: z.array(chainIdSchema).min(1),
    includeSolana: z.boolean().optional(),
    oracleAddress: addressSchema.optional(),
  })
  .strict()

// SOLANA PRIVATE KEY SCHEMAS

/**
 * Validates a Solana private key as a JSON array of 64 bytes (0-255)
 */
export const solanaPrivateKeyBytesSchema = z
  .array(z.number().int().min(0).max(255))
  .length(64, 'Solana private key must be exactly 64 bytes')

// FOUNDRY ARTIFACT SCHEMA

const foundryLinkReferenceSchema = z.object({
  start: z.number().int().nonnegative(),
  length: z.number().int().positive(),
})

/**
 * ABI parameter type for recursive schema
 */
interface AbiParameter {
  name: string
  type: string
  indexed?: boolean
  components?: AbiParameter[]
  internalType?: string
}

/**
 * ABI input/output parameter schema
 */
const abiParameterSchema: z.ZodType<AbiParameter> = z.object({
  name: z.string(),
  type: z.string(),
  indexed: z.boolean().optional(),
  components: z.lazy(() => z.array(abiParameterSchema)).optional(),
  internalType: z.string().optional(),
})

/**
 * ABI item schema - represents a single ABI entry (function, event, error, etc.)
 */
const abiItemSchema = z.object({
  type: z.enum([
    'function',
    'constructor',
    'receive',
    'fallback',
    'event',
    'error',
  ]),
  name: z.string().optional(),
  inputs: z.array(abiParameterSchema).optional(),
  outputs: z.array(abiParameterSchema).optional(),
  stateMutability: z.enum(['pure', 'view', 'nonpayable', 'payable']).optional(),
  anonymous: z.boolean().optional(),
})

/**
 * Validates a Foundry build artifact (from forge build output)
 */
export const foundryArtifactSchema = z.object({
  abi: z.array(abiItemSchema),
  bytecode: z.object({
    object: hexSchema,
    linkReferences: z.record(
      z.string(),
      z.record(z.string(), z.array(foundryLinkReferenceSchema)),
    ),
  }),
  deployedBytecode: z.object({
    object: hexSchema,
  }),
})

export type FoundryArtifact = z.infer<typeof foundryArtifactSchema>

// TYPE EXPORTS (inferred from schemas)

export type ValidatedAddress = z.infer<typeof addressSchema>
export type ValidatedChainConfig = z.infer<typeof chainConfigSchema>
export type ValidatedTokenEconomics = z.infer<typeof tokenEconomicsSchema>
export type ValidatedDeploymentConfig = z.infer<typeof deploymentConfigSchema>
export type ValidatedBridgeRequest = z.infer<typeof bridgeRequestSchema>
export type ValidatedTokenDeploymentConfig = z.infer<
  typeof tokenDeploymentConfigSchema
>
