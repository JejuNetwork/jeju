/**
 * Zod Schemas for Plugin Types
 *
 * Comprehensive validation schemas for all wallet plugin types.
 */

import {
  AddressSchema,
  BigIntSchema,
  ChainIdSchema,
  HexSchema,
  TimestampSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

// ============================================================================
// Wallet Account Schemas
// ============================================================================

export const WalletAccountTypeSchema = z.enum([
  'hd',
  'private-key',
  'smart-account',
  'hardware',
  'watch',
])

export const WalletAccountSchema = z.object({
  address: AddressSchema,
  type: WalletAccountTypeSchema,
  name: z.string().min(1),
  hdPath: z.string().optional(),
  createdAt: TimestampSchema,
  isActive: z.boolean().optional(),
})

export const GasPreferencesSchema = z.object({
  autoGasAbstraction: z.boolean(),
  preferredGasToken: AddressSchema.optional(),
  priorityFeeMultiplier: z.number().positive(),
})

export const SecuritySettingsSchema = z.object({
  requireConfirmation: z.boolean(),
  simulateBeforeSign: z.boolean(),
  whitelistedAddresses: z.array(AddressSchema),
  blockedAddresses: z.array(AddressSchema),
})

export const WalletStateSchema = z.object({
  isLocked: z.boolean(),
  isInitialized: z.boolean(),
  accounts: z.array(WalletAccountSchema),
  currentAccount: WalletAccountSchema.optional(),
  activeChainId: ChainIdSchema,
  preferredChains: z.array(ChainIdSchema),
  autoLockTimeout: z.number().int().nonnegative(),
  gasPreferences: GasPreferencesSchema,
  securitySettings: SecuritySettingsSchema,
  viewMode: z.enum(['simple', 'advanced']),
})

export const WalletServiceConfigSchema = z.object({
  defaultChainId: ChainIdSchema,
  useNetworkInfrastructure: z.boolean(),
  jejuRpcUrl: z.string().url().optional(),
})

// ============================================================================
// Token & Balance Schemas
// ============================================================================

export const PluginTokenSchema = z.object({
  chainId: ChainIdSchema,
  address: AddressSchema,
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
  isNative: z.boolean().optional(),
  logoUri: z.string().url().optional(),
  priceUsd: z.number().nonnegative().optional(),
})

export const PluginTokenBalanceSchema = z.object({
  token: PluginTokenSchema,
  balance: BigIntSchema,
  balanceFormatted: z.string(),
  valueUsd: z.number().nonnegative().optional(),
})

export const NFTSchema = z.object({
  chainId: ChainIdSchema,
  contractAddress: AddressSchema,
  tokenId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  collectionName: z.string().optional(),
  standard: z.enum(['ERC721', 'ERC1155']),
})

export const PortfolioSummarySchema = z.object({
  totalValueUsd: z.number().nonnegative(),
  balancesByChain: z.map(ChainIdSchema, z.array(PluginTokenBalanceSchema)),
  topTokens: z.array(PluginTokenBalanceSchema),
})

// ============================================================================
// Transaction Schemas
// ============================================================================

export const PluginTransactionStatusSchema = z.enum([
  'pending',
  'confirmed',
  'failed',
])

export const PluginTransactionSchema = z.object({
  hash: HexSchema,
  chainId: ChainIdSchema,
  from: AddressSchema,
  to: AddressSchema,
  value: BigIntSchema,
  data: HexSchema.optional(),
  nonce: z.number().int().nonnegative(),
  gasPrice: BigIntSchema.optional(),
  gasLimit: BigIntSchema,
  status: PluginTransactionStatusSchema,
  timestamp: TimestampSchema.optional(),
  blockNumber: z.number().int().nonnegative().optional(),
})

export const SimulationResultSchema = z.object({
  success: z.boolean(),
  gasUsed: BigIntSchema,
  returnData: HexSchema.optional(),
  error: z.string().optional(),
  balanceChanges: z.array(
    z.object({
      token: AddressSchema,
      amount: BigIntSchema,
      direction: z.enum(['in', 'out']),
    }),
  ),
  approvalChanges: z.array(
    z.object({
      token: AddressSchema,
      spender: AddressSchema,
      amount: BigIntSchema,
    }),
  ),
  nftTransfers: z.array(
    z.object({
      contract: AddressSchema,
      tokenId: z.string().min(1),
      from: AddressSchema,
      to: AddressSchema,
    }),
  ),
  logs: z.array(
    z.object({
      address: AddressSchema,
      topics: z.array(HexSchema),
      data: HexSchema,
    }),
  ),
})

// ============================================================================
// Account Abstraction Schemas
// ============================================================================

export const PluginUserOperationSchema = z.object({
  sender: AddressSchema,
  nonce: BigIntSchema,
  initCode: HexSchema,
  callData: HexSchema,
  callGasLimit: BigIntSchema,
  verificationGasLimit: BigIntSchema,
  preVerificationGas: BigIntSchema,
  maxFeePerGas: BigIntSchema,
  maxPriorityFeePerGas: BigIntSchema,
  paymasterAndData: HexSchema,
  signature: HexSchema,
})

export const SmartAccountInfoSchema = z.object({
  address: AddressSchema,
  owner: AddressSchema,
  isDeployed: z.boolean(),
  implementation: AddressSchema,
  nonce: BigIntSchema,
  entryPoint: AddressSchema,
})

export const SessionKeyPermissionSchema = z.object({
  target: AddressSchema,
  selector: HexSchema.optional(),
  maxValue: BigIntSchema.optional(),
})

export const SessionKeySchema = z.object({
  publicKey: AddressSchema,
  validUntil: TimestampSchema,
  validAfter: TimestampSchema,
  permissions: z.array(SessionKeyPermissionSchema),
})

export const AAServiceConfigSchema = z.object({
  entryPointAddress: AddressSchema,
  accountFactoryAddress: AddressSchema,
  bundlerUrl: z.string().url(),
  supportedChains: z.array(ChainIdSchema),
})

// ============================================================================
// EIL Schemas
// ============================================================================

export const PluginVoucherStatusSchema = z.enum([
  'pending',
  'voucher-issued',
  'fulfilled',
  'expired',
  'cancelled',
])

export const PluginVoucherRequestSchema = z.object({
  id: HexSchema,
  user: AddressSchema,
  sourceChainId: ChainIdSchema,
  destinationChainId: ChainIdSchema,
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  sourceAmount: BigIntSchema,
  minDestinationAmount: BigIntSchema,
  deadline: TimestampSchema,
  nonce: BigIntSchema,
  status: PluginVoucherStatusSchema,
})

export const PluginVoucherSchema = z.object({
  id: HexSchema,
  requestId: HexSchema,
  xlp: AddressSchema,
  destinationAmount: BigIntSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  fulfilled: z.boolean(),
})

export const EILServiceConfigSchema = z.object({
  crossChainPaymasterAddress: AddressSchema,
  supportedChains: z.array(ChainIdSchema),
})

// ============================================================================
// OIF Schemas
// ============================================================================

export const PluginIntentStatusSchema = z.enum([
  'pending',
  'open',
  'filled',
  'settled',
  'cancelled',
  'expired',
])

export const PluginIntentSchema = z.object({
  id: HexSchema,
  user: AddressSchema,
  sourceChainId: ChainIdSchema,
  destinationChainId: ChainIdSchema,
  inputToken: AddressSchema,
  inputAmount: BigIntSchema,
  outputToken: AddressSchema,
  minOutputAmount: BigIntSchema,
  resolver: AddressSchema,
  deadline: TimestampSchema,
  status: PluginIntentStatusSchema,
  createdAt: TimestampSchema,
  filledAt: TimestampSchema.optional(),
  settledAt: TimestampSchema.optional(),
})

export const IntentOrderSchema = z.object({
  user: AddressSchema,
  nonce: BigIntSchema,
  sourceChainId: ChainIdSchema,
  openDeadline: TimestampSchema,
  fillDeadline: TimestampSchema,
  orderDataType: HexSchema,
  orderData: HexSchema,
})

export const OIFServiceConfigSchema = z.object({
  inputSettlerAddress: AddressSchema,
  outputSettlerAddresses: z.map(ChainIdSchema, AddressSchema),
  supportedChains: z.array(ChainIdSchema),
})

// ============================================================================
// Gas Schemas
// ============================================================================

export const GasSpeedSchema = z.enum(['slow', 'standard', 'fast'])

export const PluginGasEstimateSchema = z.object({
  gasPrice: BigIntSchema,
  maxFeePerGas: BigIntSchema,
  maxPriorityFeePerGas: BigIntSchema,
  baseFee: BigIntSchema,
  estimatedCost: z.object({
    wei: BigIntSchema,
    eth: z.number().nonnegative(),
  }),
  speed: GasSpeedSchema,
  chainId: ChainIdSchema,
})

export const PluginGasOptionSchema = z.object({
  type: z.enum(['native', 'token']),
  token: PluginTokenSchema,
  amount: BigIntSchema,
  amountFormatted: z.string(),
  gasPrice: BigIntSchema,
  speed: GasSpeedSchema,
  estimatedTime: z.number().int().nonnegative(),
})

export const GasServiceConfigSchema = z.object({
  defaultGasMultiplier: z.number().positive(),
  maxGasPrice: BigIntSchema,
  supportedGasTokens: z.array(
    z.object({
      address: AddressSchema,
      symbol: z.string().min(1),
      decimals: z.number().int().min(0).max(255),
    }),
  ),
})

// ============================================================================
// Security Schemas
// ============================================================================

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])

export const TransactionRiskTypeSchema = z.enum([
  'approval',
  'value',
  'simulation',
  'contract',
  'phishing',
])

export const TransactionRiskSchema = z.object({
  type: TransactionRiskTypeSchema,
  severity: RiskLevelSchema,
  description: z.string().min(1),
  recommendation: z.string().optional(),
})

export const SecurityAnalysisSchema = z.object({
  riskLevel: RiskLevelSchema,
  risks: z.array(TransactionRiskSchema),
  simulation: z.object({
    success: z.boolean(),
    gasUsed: BigIntSchema.optional(),
    error: z.string().optional(),
    returnData: HexSchema.optional(),
  }),
  isKnownContract: z.boolean(),
  summary: z.string().min(1),
})

export const SignatureRiskTypeSchema = z.enum([
  'permit',
  'unlimited',
  'suspicious',
  'phishing',
])

export const SignatureRiskDetailsSchema = z.object({
  spender: AddressSchema.optional(),
  amount: BigIntSchema.optional(),
  deadline: TimestampSchema.optional(),
  permitType: z.enum(['ERC20Permit', 'Permit2', 'DAIPermit']).optional(),
  domain: z.string().optional(),
  targetContract: AddressSchema.optional(),
})

export const SignatureRiskSchema = z.object({
  type: SignatureRiskTypeSchema,
  severity: RiskLevelSchema,
  description: z.string().min(1),
  details: SignatureRiskDetailsSchema.optional(),
})

// ============================================================================
// Service-Specific Schemas
// ============================================================================

export const ContactSchema = z.object({
  id: z.string().min(1),
  address: AddressSchema,
  name: z.string().min(1),
  label: z.string().optional(),
  chainIds: z.array(ChainIdSchema).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  isFavorite: z.boolean(),
  transactionCount: z.number().int().nonnegative(),
  lastUsed: TimestampSchema.optional(),
})

export const CustomRPCSchema = z.object({
  id: z.string().min(1),
  chainId: ChainIdSchema,
  name: z.string().min(1),
  url: z.string().url(),
  isDefault: z.boolean(),
  isHealthy: z.boolean(),
  latency: z.number().nonnegative().optional(),
  lastChecked: TimestampSchema.optional(),
  addedAt: TimestampSchema,
})

export const CustomChainSchema = z.object({
  id: ChainIdSchema,
  name: z.string().min(1),
  nativeCurrency: z.object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(255),
  }),
  rpcUrls: z.array(z.string().url()),
  blockExplorerUrl: z.string().url().optional(),
  iconUrl: z.string().url().optional(),
  isTestnet: z.boolean(),
  addedAt: TimestampSchema,
})

export const BackupStateSchema = z.object({
  hasBackedUp: z.boolean(),
  backupVerifiedAt: TimestampSchema.nullable(),
  lastReminded: TimestampSchema.nullable(),
  reminderDismissed: z.boolean(),
})

export const LockConfigSchema = z.object({
  type: z.enum(['password', 'pin', 'biometric']),
  autoLockTimeout: z.number().int().nonnegative(),
  maxFailedAttempts: z.number().int().positive(),
  lockoutDuration: z.number().int().positive(),
})

export const LockStateSchema = z.object({
  isLocked: z.boolean(),
  lockType: z.enum(['password', 'pin', 'biometric']),
  lastActivity: TimestampSchema,
  autoLockTimeout: z.number().int().nonnegative(),
  failedAttempts: z.number().int().nonnegative(),
  lockedUntil: TimestampSchema.nullable(),
})

export const EdgeConfigSchema = z.object({
  enabled: z.boolean(),
  maxCacheSizeBytes: z.number().int().nonnegative(),
  maxBandwidthMbps: z.number().int().nonnegative(),
  enableProxy: z.boolean(),
  enableTorrent: z.boolean(),
  enableCDN: z.boolean(),
  enableRPC: z.boolean(),
  enableStorage: z.boolean(),
  autoStart: z.boolean(),
  earnWhileIdle: z.boolean(),
  preferredRegion: z.string(),
})

export const CoordinatorMessageSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough() // Allow other properties for now as they vary by type
