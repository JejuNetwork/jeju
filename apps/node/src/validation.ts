/**
 * Comprehensive Zod schemas and validation for all types
 * Fail-fast validation with expect/throw patterns
 */

import {
  AddressSchema,
  expectValid,
  NonNegativeIntSchema,
  NonNegativeNumberSchema,
  PositiveIntSchema,
  PositiveNumberSchema,
} from '@jejunetwork/types'
import { z } from 'zod'
import type {
  AgentInfo,
  AppConfig,
  BalanceInfo,
  BanStatus,
  BotWithStatus,
  EarningsSummary,
  HardwareInfo,
  NetworkConfig,
  ProjectedEarnings,
  ServiceWithStatus,
  StakingInfo,
  ViewType,
  WalletInfo,
} from './types'

// ============================================================================
// Helper Schemas (domain-specific)
// ============================================================================

/** Wei string schema - validates pure numeric strings representing wei values */
const WeiStringSchema = z
  .string()
  .regex(/^\d+$/, 'Invalid wei string (must be numeric)')

// ============================================================================
// Hardware Schemas
// ============================================================================

const DockerInfoSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  runtime_available: z.boolean(),
  gpu_support: z.boolean(),
  images: z.array(z.string()),
})

const CpuInfoSchema = z.object({
  name: z.string().min(1),
  vendor: z.string().min(1),
  cores_physical: PositiveIntSchema,
  cores_logical: PositiveIntSchema,
  frequency_mhz: NonNegativeNumberSchema,
  usage_percent: z.number().min(0).max(100),
  architecture: z.string().min(1),
})

const MemoryInfoSchema = z
  .object({
    total_mb: NonNegativeNumberSchema,
    used_mb: NonNegativeNumberSchema,
    available_mb: NonNegativeNumberSchema,
    usage_percent: z.number().min(0).max(100),
  })
  .refine(
    (data) =>
      Math.abs(data.total_mb - (data.used_mb + data.available_mb)) < 100,
    {
      message:
        'Memory values inconsistent: total should equal used + available',
    },
  )

const GpuInfoSchema = z
  .object({
    index: NonNegativeIntSchema,
    name: z.string().min(1),
    vendor: z.string().min(1),
    memory_total_mb: NonNegativeNumberSchema,
    memory_used_mb: NonNegativeNumberSchema,
    utilization_percent: z.number().min(0).max(100),
    temperature_celsius: z.number().nullable(),
    driver_version: z.string().nullable(),
    cuda_version: z.string().nullable(),
    compute_capability: z.string().nullable(),
    suitable_for_inference: z.boolean(),
  })
  .refine((data) => data.memory_used_mb <= data.memory_total_mb, {
    message: 'GPU memory used cannot exceed total memory',
  })

const StorageInfoSchema = z
  .object({
    mount_point: z.string().min(1),
    total_gb: NonNegativeNumberSchema,
    used_gb: NonNegativeNumberSchema,
    available_gb: NonNegativeNumberSchema,
    filesystem: z.string().min(1),
    is_ssd: z.boolean(),
  })
  .refine(
    (data) => Math.abs(data.total_gb - (data.used_gb + data.available_gb)) < 1,
    {
      message:
        'Storage values inconsistent: total should equal used + available',
    },
  )

const NetworkInterfaceInfoSchema = z.object({
  name: z.string().min(1),
  mac_address: z
    .string()
    .regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, 'Invalid MAC address'),
  bytes_sent: NonNegativeIntSchema,
  bytes_received: NonNegativeIntSchema,
})

const TeeCapabilitiesSchema = z.object({
  has_intel_tdx: z.boolean(),
  has_intel_sgx: z.boolean(),
  has_amd_sev: z.boolean(),
  has_nvidia_cc: z.boolean(),
  attestation_available: z.boolean(),
  tdx_version: z.string().nullable(),
  sgx_version: z.string().nullable(),
})

export const HardwareInfoSchema = z.object({
  os: z.string().min(1),
  os_version: z.string().min(1),
  hostname: z.string().min(1),
  cpu: CpuInfoSchema,
  memory: MemoryInfoSchema,
  gpus: z.array(GpuInfoSchema),
  storage: z.array(StorageInfoSchema),
  network: z.array(NetworkInterfaceInfoSchema),
  tee: TeeCapabilitiesSchema,
  docker: DockerInfoSchema,
})

// ============================================================================
// Wallet & Agent Schemas
// ============================================================================

export const WalletInfoSchema = z.object({
  address: AddressSchema,
  wallet_type: z.enum(['embedded', 'external', 'jeju_wallet']),
  agent_id: z.number().int().positive().nullable(),
  is_registered: z.boolean(),
})

export const BalanceInfoSchema = z.object({
  eth: WeiStringSchema,
  jeju: WeiStringSchema,
  staked: WeiStringSchema,
  pending_rewards: WeiStringSchema,
})

export const AgentInfoSchema = z.object({
  agent_id: PositiveIntSchema,
  owner: AddressSchema,
  token_uri: z.string().url(),
  stake_tier: z.string().min(1),
  stake_amount: WeiStringSchema,
  is_banned: z.boolean(),
  ban_reason: z.string().nullable(),
  appeal_status: z.string().nullable(),
  reputation_score: z.number().int().min(0).max(100),
})

export const BanStatusSchema = z.object({
  is_banned: z.boolean(),
  is_on_notice: z.boolean(),
  is_permanently_banned: z.boolean(),
  reason: z.string().nullable(),
  appeal_deadline: z.number().int().positive().nullable(),
  appeal_status: z.string().nullable(),
})

// ============================================================================
// Service Schemas
// ============================================================================

const ServiceRequirementsSchema = z.object({
  min_cpu_cores: PositiveIntSchema,
  min_memory_mb: PositiveIntSchema,
  min_storage_gb: PositiveIntSchema,
  requires_gpu: z.boolean(),
  min_gpu_memory_mb: z.number().int().positive().nullable(),
  requires_tee: z.boolean(),
  min_bandwidth_mbps: z.number().int().positive().nullable(),
})

export const ServiceMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  min_stake_eth: PositiveNumberSchema,
  estimated_earnings_per_hour_usd: NonNegativeNumberSchema,
  requirements: ServiceRequirementsSchema,
  warnings: z.array(z.string()),
  is_advanced: z.boolean(),
})

export const ServiceStateSchema = z.object({
  running: z.boolean(),
  uptime_seconds: NonNegativeIntSchema,
  requests_served: NonNegativeIntSchema,
  earnings_wei: WeiStringSchema,
  last_error: z.string().nullable(),
  health: z.enum(['healthy', 'degraded', 'unhealthy', 'stopped']),
})

export const ServiceWithStatusSchema = z.object({
  metadata: ServiceMetadataSchema,
  status: ServiceStateSchema,
  meets_requirements: z.boolean(),
  requirement_issues: z.array(z.string()),
})

/** Custom settings value - supports primitives and arrays/objects of primitives */
const CustomSettingValueSchema: z.ZodType<
  string | number | boolean | null | Array<string | number | boolean | null>
> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
])

export const ServiceConfigSchema = z.object({
  enabled: z.boolean(),
  auto_start: z.boolean(),
  stake_amount: WeiStringSchema.nullable(),
  custom_settings: z.record(z.string(), CustomSettingValueSchema),
})

// ============================================================================
// Bot Schemas
// ============================================================================

export const BotMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  min_capital_eth: PositiveNumberSchema,
  treasury_split_percent: z.number().int().min(0).max(100),
  risk_level: z.enum(['Low', 'Medium', 'High']),
  warnings: z.array(z.string()),
})

const OpportunityInfoSchema = z.object({
  timestamp: z.number().int().positive(),
  opportunity_type: z.string().min(1),
  estimated_profit_wei: WeiStringSchema,
  actual_profit_wei: WeiStringSchema.nullable(),
  tx_hash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .nullable(),
  status: z.string().min(1),
})

export const BotStatusSchema = z
  .object({
    id: z.string().min(1),
    running: z.boolean(),
    uptime_seconds: NonNegativeIntSchema,
    opportunities_detected: NonNegativeIntSchema,
    opportunities_executed: NonNegativeIntSchema,
    opportunities_failed: NonNegativeIntSchema,
    gross_profit_wei: WeiStringSchema,
    treasury_share_wei: WeiStringSchema,
    net_profit_wei: WeiStringSchema,
    last_opportunity: OpportunityInfoSchema.nullable(),
    health: z.string().min(1),
  })
  .refine(
    (data) =>
      data.opportunities_executed + data.opportunities_failed <=
      data.opportunities_detected,
    { message: 'Bot opportunities: executed + failed cannot exceed detected' },
  )

export const BotConfigSchema = z.object({
  enabled: z.boolean(),
  auto_start: z.boolean(),
  min_profit_bps: z.number().int().min(0).max(10000), // 0-100%
  max_gas_gwei: z.number().int().positive(),
  max_slippage_bps: z.number().int().min(0).max(10000), // 0-100%
  capital_allocation_wei: WeiStringSchema,
})

export const BotWithStatusSchema = z.object({
  metadata: BotMetadataSchema,
  status: BotStatusSchema,
  config: BotConfigSchema,
})

// ============================================================================
// Earnings Schemas
// ============================================================================

const ServiceEarningsSchema = z.object({
  service_id: z.string().min(1),
  service_name: z.string().min(1),
  total_wei: WeiStringSchema,
  total_usd: NonNegativeNumberSchema,
  today_wei: WeiStringSchema,
  today_usd: NonNegativeNumberSchema,
  requests_served: NonNegativeIntSchema,
  uptime_percent: z.number().min(0).max(100),
})

const BotEarningsSchema = z.object({
  bot_id: z.string().min(1),
  bot_name: z.string().min(1),
  gross_profit_wei: WeiStringSchema,
  treasury_share_wei: WeiStringSchema,
  net_profit_wei: WeiStringSchema,
  net_profit_usd: NonNegativeNumberSchema,
  opportunities_executed: NonNegativeIntSchema,
  success_rate_percent: z.number().min(0).max(100),
})

export const EarningsSummarySchema = z.object({
  total_earnings_wei: WeiStringSchema,
  total_earnings_usd: NonNegativeNumberSchema,
  earnings_today_wei: WeiStringSchema,
  earnings_today_usd: NonNegativeNumberSchema,
  earnings_this_week_wei: WeiStringSchema,
  earnings_this_week_usd: NonNegativeNumberSchema,
  earnings_this_month_wei: WeiStringSchema,
  earnings_this_month_usd: NonNegativeNumberSchema,
  earnings_by_service: z.array(ServiceEarningsSchema),
  earnings_by_bot: z.array(BotEarningsSchema),
  avg_hourly_rate_usd: NonNegativeNumberSchema,
  projected_monthly_usd: NonNegativeNumberSchema,
})

const ServiceProjectionSchema = z.object({
  service_id: z.string().min(1),
  service_name: z.string().min(1),
  enabled: z.boolean(),
  hourly_usd: NonNegativeNumberSchema,
  monthly_usd: NonNegativeNumberSchema,
  factors: z.array(z.string()),
})

export const ProjectedEarningsSchema = z.object({
  hourly_usd: NonNegativeNumberSchema,
  daily_usd: NonNegativeNumberSchema,
  weekly_usd: NonNegativeNumberSchema,
  monthly_usd: NonNegativeNumberSchema,
  yearly_usd: NonNegativeNumberSchema,
  breakdown: z.array(ServiceProjectionSchema),
  assumptions: z.array(z.string()),
})

// ============================================================================
// Staking Schemas
// ============================================================================

const ServiceStakeInfoSchema = z.object({
  service_id: z.string().min(1),
  service_name: z.string().min(1),
  staked_wei: WeiStringSchema,
  staked_usd: NonNegativeNumberSchema,
  pending_rewards_wei: WeiStringSchema,
  stake_token: AddressSchema,
  min_stake_wei: WeiStringSchema,
})

export const StakingInfoSchema = z.object({
  total_staked_wei: WeiStringSchema,
  total_staked_usd: NonNegativeNumberSchema,
  staked_by_service: z.array(ServiceStakeInfoSchema),
  pending_rewards_wei: WeiStringSchema,
  pending_rewards_usd: NonNegativeNumberSchema,
  can_unstake: z.boolean(),
  unstake_cooldown_seconds: NonNegativeIntSchema,
  auto_claim_enabled: z.boolean(),
  next_auto_claim_timestamp: z.number().int().positive().nullable(),
})

// ============================================================================
// Config Schemas
// ============================================================================

export const NetworkConfigSchema = z.object({
  network: z.string().min(1),
  chain_id: z.number().int().positive(),
  rpc_url: z.string().url(),
  ws_url: z.string().url().nullable(),
  explorer_url: z.string().url(),
})

export const AppConfigSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Version must be semver format'),
  network: NetworkConfigSchema,
  wallet: z.object({
    wallet_type: z.string().min(1),
    address: AddressSchema.nullable(),
    agent_id: z.number().int().positive().nullable(),
  }),
  earnings: z.object({
    auto_claim: z.boolean(),
    auto_claim_threshold_wei: WeiStringSchema,
    auto_claim_interval_hours: z.number().int().positive(),
    auto_compound: z.boolean(),
    auto_stake_earnings: z.boolean(),
  }),
  services: z.record(z.string(), ServiceConfigSchema),
  bots: z.record(z.string(), BotConfigSchema),
  start_minimized: z.boolean(),
  start_on_boot: z.boolean(),
  notifications_enabled: z.boolean(),
})

export const ViewTypeSchema = z.enum([
  'dashboard',
  'services',
  'bots',
  'earnings',
  'staking',
  'settings',
  'wallet',
])

// ============================================================================
// Validation Functions (Fail-Fast)
// ============================================================================

export function validateHardwareInfo(data: unknown): HardwareInfo {
  return expectValid(HardwareInfoSchema, data, 'HardwareInfo')
}

export function validateWalletInfo(data: unknown): WalletInfo {
  return expectValid(WalletInfoSchema, data, 'WalletInfo')
}

export function validateBalanceInfo(data: unknown): BalanceInfo {
  return expectValid(BalanceInfoSchema, data, 'BalanceInfo')
}

export function validateAgentInfo(data: unknown): AgentInfo {
  return expectValid(AgentInfoSchema, data, 'AgentInfo')
}

export function validateBanStatus(data: unknown): BanStatus {
  return expectValid(BanStatusSchema, data, 'BanStatus')
}

export function validateServiceWithStatus(data: unknown): ServiceWithStatus {
  return expectValid(ServiceWithStatusSchema, data, 'ServiceWithStatus')
}

export function validateServiceWithStatusArray(
  data: unknown,
): ServiceWithStatus[] {
  return expectValid(
    z.array(ServiceWithStatusSchema),
    data,
    'ServiceWithStatus[]',
  )
}

export function validateBotWithStatus(data: unknown): BotWithStatus {
  return expectValid(BotWithStatusSchema, data, 'BotWithStatus')
}

export function validateBotWithStatusArray(data: unknown): BotWithStatus[] {
  return expectValid(z.array(BotWithStatusSchema), data, 'BotWithStatus[]')
}

export function validateEarningsSummary(data: unknown): EarningsSummary {
  return expectValid(EarningsSummarySchema, data, 'EarningsSummary')
}

export function validateProjectedEarnings(data: unknown): ProjectedEarnings {
  return expectValid(ProjectedEarningsSchema, data, 'ProjectedEarnings')
}

export function validateStakingInfo(data: unknown): StakingInfo {
  return expectValid(StakingInfoSchema, data, 'StakingInfo')
}

export function validateAppConfig(data: unknown): AppConfig {
  return expectValid(AppConfigSchema, data, 'AppConfig')
}

export function validateNetworkConfig(data: unknown): NetworkConfig {
  return expectValid(NetworkConfigSchema, data, 'NetworkConfig')
}

export function validateViewType(data: unknown): ViewType {
  return expectValid(ViewTypeSchema, data, 'ViewType')
}

// ============================================================================
// Request/Response Schemas for Tauri Commands
// ============================================================================

export const StartServiceRequestSchema = z.object({
  service_id: z.string().min(1),
  auto_stake: z.boolean(),
  stake_amount: WeiStringSchema.nullable(),
  custom_settings: z.record(z.string(), CustomSettingValueSchema).nullable(),
})

export const StartBotRequestSchema = z.object({
  bot_id: z.string().min(1),
  capital_allocation_wei: WeiStringSchema,
})

export const StakeRequestSchema = z.object({
  service_id: z.string().min(1),
  amount_wei: WeiStringSchema,
  token_address: AddressSchema.nullable(),
})

export const UnstakeRequestSchema = z.object({
  service_id: z.string().min(1),
  amount_wei: WeiStringSchema,
})

export const RegisterAgentRequestSchema = z.object({
  token_uri: z.string().url(),
  stake_tier: z.enum(['none', 'small', 'medium', 'high']),
})

export const AppealBanRequestSchema = z.object({
  reason: z.string().min(1).max(1000),
  evidence_uri: z.string().url().nullable(),
})

// Type exports for use in code
export type StartServiceRequest = z.infer<typeof StartServiceRequestSchema>
export type StartBotRequest = z.infer<typeof StartBotRequestSchema>
export type StakeRequest = z.infer<typeof StakeRequestSchema>
export type UnstakeRequest = z.infer<typeof UnstakeRequestSchema>
export type RegisterAgentRequest = z.infer<typeof RegisterAgentRequestSchema>
export type AppealBanRequest = z.infer<typeof AppealBanRequestSchema>

// ============================================================================
// Runtime Types Schemas
// ============================================================================

export const RuntimeConfigSchema = z.object({
  network: z.enum(['mainnet', 'testnet', 'localnet']),
  rpcUrl: z.string().url(),
  chainId: z.number().int().positive(),
  privateKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  autoClaim: z.boolean(),
  autoStake: z.boolean(),
  startMinimized: z.boolean(),
  startOnBoot: z.boolean(),
  notifications: z.boolean(),
})

export const WalletConnectionSchema = z.object({
  address: AddressSchema,
  chainId: z.number().int().positive(),
  isConnected: z.boolean(),
})

export const BalanceResultSchema = z.object({
  eth: z.bigint(),
  jeju: z.bigint(),
  staked: z.bigint(),
  pendingRewards: z.bigint(),
})

export const ChainStatusSchema = z.object({
  connected: z.boolean(),
  chainId: z.number().int().positive(),
  blockNumber: z.bigint(),
  syncing: z.boolean(),
})

export const ServiceInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  minStakeEth: PositiveNumberSchema,
  estimatedEarningsPerHourUsd: NonNegativeNumberSchema,
  isRunning: z.boolean(),
  meetsRequirements: z.boolean(),
  requirementIssues: z.array(z.string()),
})

export const ServiceStartConfigSchema = z.object({
  autoStake: z.boolean(),
  stakeAmount: WeiStringSchema.optional(),
})

export const RuntimeServiceStateSchema = z.object({
  running: z.boolean(),
  uptimeSeconds: NonNegativeIntSchema,
  requestsServed: NonNegativeIntSchema,
  earningsWei: z.bigint(),
  health: z.enum(['healthy', 'degraded', 'unhealthy', 'stopped']),
})

export const BotInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  minCapitalEth: PositiveNumberSchema,
  treasurySplitPercent: z.number().int().min(0).max(100),
  riskLevel: z.enum(['low', 'medium', 'high']),
  isRunning: z.boolean(),
})

export const BotStateSchema = z
  .object({
    running: z.boolean(),
    uptimeSeconds: NonNegativeIntSchema,
    opportunitiesDetected: NonNegativeIntSchema,
    opportunitiesExecuted: NonNegativeIntSchema,
    opportunitiesFailed: NonNegativeIntSchema,
    grossProfitWei: z.bigint(),
    treasuryShareWei: z.bigint(),
    netProfitWei: z.bigint(),
    health: z.string().min(1),
  })
  .refine(
    (data) =>
      data.opportunitiesExecuted + data.opportunitiesFailed <=
      data.opportunitiesDetected,
    { message: 'Bot opportunities: executed + failed cannot exceed detected' },
  )

// Type exports
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>
export type WalletConnection = z.infer<typeof WalletConnectionSchema>
export type BalanceResult = z.infer<typeof BalanceResultSchema>
export type ChainStatus = z.infer<typeof ChainStatusSchema>
export type ServiceInfo = z.infer<typeof ServiceInfoSchema>
export type ServiceStartConfig = z.infer<typeof ServiceStartConfigSchema>
export type RuntimeServiceState = z.infer<typeof RuntimeServiceStateSchema>
export type BotInfo = z.infer<typeof BotInfoSchema>
export type BotState = z.infer<typeof BotStateSchema>

// Validation functions
export function validateRuntimeConfig(data: unknown): RuntimeConfig {
  return expectValid(RuntimeConfigSchema, data, 'RuntimeConfig')
}

export function validateWalletConnection(data: unknown): WalletConnection {
  return expectValid(WalletConnectionSchema, data, 'WalletConnection')
}

export function validateBalanceResult(data: unknown): BalanceResult {
  return expectValid(BalanceResultSchema, data, 'BalanceResult')
}

export function validateChainStatus(data: unknown): ChainStatus {
  return expectValid(ChainStatusSchema, data, 'ChainStatus')
}

export function validateServiceInfo(data: unknown): ServiceInfo {
  return expectValid(ServiceInfoSchema, data, 'ServiceInfo')
}

export function validateServiceStartConfig(data: unknown): ServiceStartConfig {
  return expectValid(ServiceStartConfigSchema, data, 'ServiceStartConfig')
}

export function validateRuntimeServiceState(
  data: unknown,
): RuntimeServiceState {
  return expectValid(RuntimeServiceStateSchema, data, 'RuntimeServiceState')
}

export function validateBotInfo(data: unknown): BotInfo {
  return expectValid(BotInfoSchema, data, 'BotInfo')
}

export function validateBotState(data: unknown): BotState {
  return expectValid(BotStateSchema, data, 'BotState')
}

// ============================================================================
// Bridge Service Schemas
// ============================================================================

export const BridgeServiceConfigSchema = z.object({
  evmRpcUrls: z.record(z.number().int().positive(), z.string().url()),
  solanaRpcUrl: z.string().url().optional(),
  contracts: z.object({
    zkBridge: AddressSchema.optional(),
    eilPaymaster: AddressSchema.optional(),
    oifInputSettler: AddressSchema.optional(),
    oifOutputSettler: AddressSchema.optional(),
    solverRegistry: AddressSchema.optional(),
    federatedLiquidity: AddressSchema.optional(),
  }),
  operatorAddress: AddressSchema,
  privateKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  enableRelayer: z.boolean(),
  enableXLP: z.boolean(),
  enableSolver: z.boolean(),
  enableMEV: z.boolean(),
  enableArbitrage: z.boolean(),
  xlpChains: z.array(z.number().int().positive()).optional(),
  minLiquidity: z.bigint().optional(),
  minArbProfitBps: z.number().int().min(0).max(10000).optional(),
  maxArbPositionUsd: z.number().positive().optional(),
  arbTokens: z.array(z.string()).optional(),
  jitoTipLamports: z.bigint().optional(),
  maxTransferSize: z.bigint().optional(),
  maxPendingTransfers: z.number().int().positive().optional(),
})

export const BridgeStatsSchema = z.object({
  totalTransfersProcessed: z.number().int().nonnegative(),
  totalVolumeProcessed: z.bigint(),
  totalFeesEarned: z.bigint(),
  pendingTransfers: z.number().int().nonnegative(),
  activeChains: z.array(z.number().int().positive()),
  uptime: z.number().nonnegative(),
  lastTransferAt: z.number().int().positive(),
  arbOpportunitiesDetected: z.number().int().nonnegative(),
  arbTradesExecuted: z.number().int().nonnegative(),
  arbProfitUsd: z.number().nonnegative(),
  jitoBundlesSubmitted: z.number().int().nonnegative(),
  jitoBundlesLanded: z.number().int().nonnegative(),
  mevProfitUsd: z.number().nonnegative(),
})

export const ArbOpportunitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['solana_evm', 'hyperliquid', 'cross_dex']),
  buyChain: z.string().min(1),
  sellChain: z.string().min(1),
  token: z.string().min(1),
  priceDiffBps: z.number().int(),
  netProfitUsd: z.number(),
  expiresAt: z.number().int().positive(),
})

export const TransferEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['initiated', 'completed', 'failed']),
  sourceChain: z.number().int().positive(),
  destChain: z.number().int().positive(),
  token: AddressSchema,
  amount: z.bigint(),
  fee: z.bigint(),
  timestamp: z.number().int().positive(),
})

// ============================================================================
// Arbitrage Executor Schemas
// ============================================================================

export const ExecutorConfigSchema = z.object({
  evmPrivateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  solanaPrivateKey: z.string().min(1).optional(),
  evmRpcUrls: z.record(z.number().int().positive(), z.string().url()),
  solanaRpcUrl: z.string().url().optional(),
  zkBridgeEndpoint: z.string().url().optional(),
  oneInchApiKey: z.string().min(1).optional(),
  maxSlippageBps: z.number().int().min(0).max(10000),
  jitoTipLamports: z.bigint(),
})

// ============================================================================
// Node Update Schemas
// ============================================================================

export const NodeUpdateConfigSchema = z.object({
  enabled: z.boolean(),
  checkInterval: z.number().int().positive(),
  autoDownload: z.boolean(),
  autoInstall: z.boolean(),
  channel: z.enum(['stable', 'beta', 'nightly']),
  dwsEndpoint: z.string().url(),
  pkgRegistryAddress: AddressSchema.optional(),
})

export const NodeUpdateInfoSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Version must be semver format'),
  releaseDate: z.string().min(1),
  channel: z.enum(['stable', 'beta', 'nightly']),
  changelog: z.string(),
  size: z.number().int().positive(),
  signature: z.string().min(1),
  platforms: z.array(
    z.object({
      platform: z.enum(['tauri-macos', 'tauri-windows', 'tauri-linux']),
      url: z.string().url(),
      cid: z.string().min(1),
      hash: z.string().min(1),
      size: z.number().int().positive(),
    }),
  ),
  minVersion: z.string().optional(),
  breaking: z.boolean().optional(),
  migrations: z.array(z.string()).optional(),
})

export const NodeUpdateStateSchema = z.object({
  checking: z.boolean(),
  available: z.boolean(),
  downloading: z.boolean(),
  downloaded: z.boolean(),
  installing: z.boolean(),
  error: z.string().nullable(),
  currentVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, 'Version must be semver format'),
  latestVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, 'Version must be semver format')
    .nullable(),
  updateInfo: NodeUpdateInfoSchema.nullable(),
  downloadProgress: z.number().min(0).max(100),
})

// Type exports
export type BridgeServiceConfig = z.infer<typeof BridgeServiceConfigSchema>
export type BridgeStats = z.infer<typeof BridgeStatsSchema>
export type ArbOpportunity = z.infer<typeof ArbOpportunitySchema>
export type TransferEvent = z.infer<typeof TransferEventSchema>
export type ExecutorConfig = z.infer<typeof ExecutorConfigSchema>
export type NodeUpdateConfig = z.infer<typeof NodeUpdateConfigSchema>
export type NodeUpdateInfo = z.infer<typeof NodeUpdateInfoSchema>
export type NodeUpdateState = z.infer<typeof NodeUpdateStateSchema>

// Validation functions
export function validateBridgeServiceConfig(
  data: unknown,
): BridgeServiceConfig {
  return expectValid(BridgeServiceConfigSchema, data, 'BridgeServiceConfig')
}

export function validateBridgeStats(data: unknown): BridgeStats {
  return expectValid(BridgeStatsSchema, data, 'BridgeStats')
}

export function validateArbOpportunity(data: unknown): ArbOpportunity {
  return expectValid(ArbOpportunitySchema, data, 'ArbOpportunity')
}

export function validateTransferEvent(data: unknown): TransferEvent {
  return expectValid(TransferEventSchema, data, 'TransferEvent')
}

export function validateExecutorConfig(data: unknown): ExecutorConfig {
  return expectValid(ExecutorConfigSchema, data, 'ExecutorConfig')
}

export function validateNodeUpdateConfig(data: unknown): NodeUpdateConfig {
  return expectValid(NodeUpdateConfigSchema, data, 'NodeUpdateConfig')
}

export function validateNodeUpdateInfo(data: unknown): NodeUpdateInfo {
  return expectValid(NodeUpdateInfoSchema, data, 'NodeUpdateInfo')
}

export function validateNodeUpdateState(data: unknown): NodeUpdateState {
  return expectValid(NodeUpdateStateSchema, data, 'NodeUpdateState')
}

// ============================================================================
// External API Response Schemas
// ============================================================================

/** Jupiter swap response */
export const JupiterSwapResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().int().positive().optional(),
})

/** Jito bundle response */
export const JitoBundleResponseSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})

/** Jito bundle status response */
export const JitoBundleStatusResponseSchema = z.object({
  result: z
    .object({
      value: z.array(
        z.object({
          confirmation_status: z.string(),
        }),
      ),
    })
    .optional(),
})

/** 1inch swap response */
export const OneInchSwapResponseSchema = z.object({
  dstAmount: z.string(),
  tx: z.object({
    to: z.string(),
    data: z.string(),
    value: z.string(),
  }),
})

/** Bridge API transfer response */
export const BridgeTransferResponseSchema = z.object({
  transferId: z.string(),
  status: z.string(),
})

/** Bridge API tx hash response */
export const BridgeTxResponseSchema = z.object({
  txHash: z.string(),
})

/** Hyperliquid prices response */
export const HyperliquidPricesResponseSchema = z.record(z.string(), z.string())

/** Jito tip floor response */
export const JitoTipFloorResponseSchema = z.object({
  result: z
    .object({
      tip_floor_lamports: z.number(),
    })
    .optional(),
})

/** Oracle attestation */
export const OracleAttestationSchema = z.object({
  seeder: z.string(),
  infohash: z.string(),
  bytesUploaded: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  nonce: z.string(),
  signature: z.string(),
})

/** JSON-RPC result response */
export const JsonRpcResultResponseSchema = z.object({
  result: z.string().optional(),
})

/** Jupiter price response */
export const JupiterPriceResponseSchema = z.object({
  data: z.record(z.string(), z.object({ price: z.number() })).optional(),
})

// Type exports
export type JupiterSwapResponse = z.infer<typeof JupiterSwapResponseSchema>
export type JitoBundleResponse = z.infer<typeof JitoBundleResponseSchema>
export type JitoBundleStatusResponse = z.infer<
  typeof JitoBundleStatusResponseSchema
>
export type OneInchSwapResponse = z.infer<typeof OneInchSwapResponseSchema>
export type BridgeTransferResponse = z.infer<typeof BridgeTransferResponseSchema>
export type BridgeTxResponse = z.infer<typeof BridgeTxResponseSchema>
export type HyperliquidPricesResponse = z.infer<
  typeof HyperliquidPricesResponseSchema
>
export type JitoTipFloorResponse = z.infer<typeof JitoTipFloorResponseSchema>
export type OracleAttestation = z.infer<typeof OracleAttestationSchema>
export type JsonRpcResultResponse = z.infer<typeof JsonRpcResultResponseSchema>
