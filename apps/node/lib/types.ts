export interface HardwareInfo {
  os: string
  os_version: string
  hostname: string
  cpu: CpuInfo
  memory: MemoryInfo
  gpus: GpuInfo[]
  storage: StorageInfo[]
  network: NetworkInterfaceInfo[]
  tee: TeeCapabilities
  docker: DockerInfo
}

export interface DockerInfo {
  available: boolean
  version: string | null
  runtime_available: boolean
  gpu_support: boolean
  images: string[]
}

export interface CpuInfo {
  name: string
  vendor: string
  cores_physical: number
  cores_logical: number
  frequency_mhz: number
  usage_percent: number
  architecture: string
}

export interface MemoryInfo {
  total_mb: number
  used_mb: number
  available_mb: number
  usage_percent: number
}

export interface GpuInfo {
  index: number
  name: string
  vendor: string
  memory_total_mb: number
  memory_used_mb: number
  utilization_percent: number
  temperature_celsius: number | null
  driver_version: string | null
  cuda_version: string | null
  compute_capability: string | null
  suitable_for_inference: boolean
}

export interface StorageInfo {
  mount_point: string
  total_gb: number
  used_gb: number
  available_gb: number
  filesystem: string
  is_ssd: boolean
}

export interface NetworkInterfaceInfo {
  name: string
  mac_address: string
  bytes_sent: number
  bytes_received: number
}

export interface TeeCapabilities {
  has_intel_tdx: boolean
  has_intel_sgx: boolean
  has_amd_sev: boolean
  has_nvidia_cc: boolean
  attestation_available: boolean
  tdx_version: string | null
  sgx_version: string | null
}

export interface WalletInfo {
  address: string
  wallet_type: 'embedded' | 'external' | 'jeju_wallet'
  agent_id: number | null
  is_registered: boolean
}

export interface BalanceInfo {
  eth: string
  jeju: string
  staked: string
  pending_rewards: string
}

export interface AgentInfo {
  agent_id: number
  owner: string
  token_uri: string
  stake_tier: string
  stake_amount: string
  is_banned: boolean
  ban_reason: string | null
  appeal_status: string | null
  reputation_score: number
}

export interface BanStatus {
  is_banned: boolean
  is_on_notice: boolean
  is_permanently_banned: boolean
  reason: string | null
  appeal_deadline: number | null
  appeal_status: string | null
}

export interface ServiceMetadata {
  id: string
  name: string
  description: string
  min_stake_eth: number
  estimated_earnings_per_hour_usd: number
  requirements: ServiceRequirements
  warnings: string[]
  is_advanced: boolean
}

export interface ServiceRequirements {
  min_cpu_cores: number
  min_memory_mb: number
  min_storage_gb: number
  requires_gpu: boolean
  min_gpu_memory_mb: number | null
  requires_tee: boolean
  min_bandwidth_mbps: number | null
}

export interface ServiceState {
  running: boolean
  uptime_seconds: number
  requests_served: number
  earnings_wei: string
  last_error: string | null
  health: 'healthy' | 'degraded' | 'unhealthy' | 'stopped'
}

export interface ServiceWithStatus {
  metadata: ServiceMetadata
  status: ServiceState
  meets_requirements: boolean
  requirement_issues: string[]
}

export interface BotMetadata {
  id: string
  name: string
  description: string
  min_capital_eth: number
  treasury_split_percent: number
  risk_level: 'Low' | 'Medium' | 'High'
  warnings: string[]
}

export interface BotStatus {
  id: string
  running: boolean
  uptime_seconds: number
  opportunities_detected: number
  opportunities_executed: number
  opportunities_failed: number
  gross_profit_wei: string
  treasury_share_wei: string
  net_profit_wei: string
  last_opportunity: OpportunityInfo | null
  health: string
}

export interface OpportunityInfo {
  timestamp: number
  opportunity_type: string
  estimated_profit_wei: string
  actual_profit_wei: string | null
  tx_hash: string | null
  status: string
}

export interface BotWithStatus {
  metadata: BotMetadata
  status: BotStatus
  config: BotConfig
}

export interface BotConfig {
  enabled: boolean
  auto_start: boolean
  min_profit_bps: number
  max_gas_gwei: number
  max_slippage_bps: number
  capital_allocation_wei: string
}

export interface EarningsSummary {
  total_earnings_wei: string
  total_earnings_usd: number
  earnings_today_wei: string
  earnings_today_usd: number
  earnings_this_week_wei: string
  earnings_this_week_usd: number
  earnings_this_month_wei: string
  earnings_this_month_usd: number
  earnings_by_service: ServiceEarnings[]
  earnings_by_bot: BotEarnings[]
  avg_hourly_rate_usd: number
  projected_monthly_usd: number
}

export interface ServiceEarnings {
  service_id: string
  service_name: string
  total_wei: string
  total_usd: number
  today_wei: string
  today_usd: number
  requests_served: number
  uptime_percent: number
}

export interface BotEarnings {
  bot_id: string
  bot_name: string
  gross_profit_wei: string
  treasury_share_wei: string
  net_profit_wei: string
  net_profit_usd: number
  opportunities_executed: number
  success_rate_percent: number
}

export interface ProjectedEarnings {
  hourly_usd: number
  daily_usd: number
  weekly_usd: number
  monthly_usd: number
  yearly_usd: number
  breakdown: ServiceProjection[]
  assumptions: string[]
}

export interface ServiceProjection {
  service_id: string
  service_name: string
  enabled: boolean
  hourly_usd: number
  monthly_usd: number
  factors: string[]
}

export interface StakingInfo {
  total_staked_wei: string
  total_staked_usd: number
  staked_by_service: ServiceStakeInfo[]
  pending_rewards_wei: string
  pending_rewards_usd: number
  can_unstake: boolean
  unstake_cooldown_seconds: number
  auto_claim_enabled: boolean
  next_auto_claim_timestamp: number | null
}

export interface ServiceStakeInfo {
  service_id: string
  service_name: string
  staked_wei: string
  staked_usd: number
  pending_rewards_wei: string
  stake_token: string
  min_stake_wei: string
}

export interface NetworkConfig {
  network: string
  chain_id: number
  rpc_url: string
  ws_url: string | null
  explorer_url: string
}

export interface AppConfig {
  version: string
  network: NetworkConfig
  wallet: {
    wallet_type: string
    address: string | null
    agent_id: number | null
  }
  earnings: {
    auto_claim: boolean
    auto_claim_threshold_wei: string
    auto_claim_interval_hours: number
    auto_compound: boolean
    auto_stake_earnings: boolean
  }
  services: Record<string, ServiceConfig>
  bots: Record<string, BotConfig>
  start_minimized: boolean
  start_on_boot: boolean
  notifications_enabled: boolean
}

/** Custom settings value type - supports primitives and arrays of primitives */
export type CustomSettingValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>

export interface ServiceConfig {
  enabled: boolean
  auto_start: boolean
  stake_amount: string | null
  custom_settings: Record<string, CustomSettingValue>
}

export type ViewType =
  | 'dashboard'
  | 'services'
  | 'bots'
  | 'earnings'
  | 'staking'
  | 'settings'
  | 'wallet'
