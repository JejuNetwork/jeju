/**
 * External compute provider types for marketplace integrations.
 */

import type { Address, Hex } from 'viem'
import { GPUType } from './compute'

export const ExternalProviderTypes = {
  AKASH: 'akash',
  NATIVE: 'native',
} as const

export type ExternalProviderType =
  (typeof ExternalProviderTypes)[keyof typeof ExternalProviderTypes]

export const ProviderStatus = {
  COLD: 'cold',
  STARTING: 'starting',
  READY: 'ready',
  ACTIVE: 'active',
  DRAINING: 'draining',
  ERROR: 'error',
  TERMINATED: 'terminated',
} as const

export type ProviderStatusType =
  (typeof ProviderStatus)[keyof typeof ProviderStatus]

export function getGPUTypeName(gpuType: GPUType): string {
  const names: Record<GPUType, string> = {
    [GPUType.NONE]: 'None',
    [GPUType.NVIDIA_RTX_4090]: 'NVIDIA RTX 4090',
    [GPUType.NVIDIA_A100_40GB]: 'NVIDIA A100 40GB',
    [GPUType.NVIDIA_A100_80GB]: 'NVIDIA A100 80GB',
    [GPUType.NVIDIA_H100]: 'NVIDIA H100',
    [GPUType.NVIDIA_H200]: 'NVIDIA H200',
    [GPUType.AMD_MI300X]: 'AMD MI300X',
    [GPUType.APPLE_M1_MAX]: 'Apple M1 Max',
    [GPUType.APPLE_M2_ULTRA]: 'Apple M2 Ultra',
    [GPUType.APPLE_M3_MAX]: 'Apple M3 Max',
  }
  const name = names[gpuType]
  if (name === undefined) {
    throw new Error(`Unknown GPUType: ${gpuType}`)
  }
  return name
}

export interface HardwareRequirements {
  cpuCores: number
  memoryGb: number
  storageGb: number
  gpuType: GPUType
  gpuCount: number
  gpuMemoryGb: number
  bandwidthMbps: number
  teeRequired: boolean
  teeType?: 'intel-tdx' | 'intel-sgx' | 'amd-sev' | 'none'
}

export interface HardwareCapabilities extends HardwareRequirements {
  cpuModel: string
  region: string
  availableSlots: number
  maxConcurrentDeployments: number
}

export interface ExternalProviderPricing {
  pricePerHourWei: bigint
  /** Minimum rental duration in hours */
  minimumHours: number
  /** Maximum rental duration in hours */
  maximumHours: number
  /** network markup in basis points (100 = 1%) */
  markupBps: number
  /** Original provider price before markup (for transparency) */
  originalPricePerHour: bigint
  /** Currency of original price (e.g., 'AKT', 'USD') */
  originalCurrency: string
  /** Timestamp of last price update */
  priceUpdatedAt: number
  /** Price staleness tolerance in seconds */
  priceStalenessToleranceSec: number
}

// Deployment Configuration

export interface ContainerConfig {
  /** Container image (from the network registry CID or external registry URL) */
  image: string
  /** Whether image is from the network decentralized registry */
  isChainRegistry: boolean
  /** CID if from the network registry */
  cid?: string
  /** Command to run */
  command?: string[]
  /** Arguments to command */
  args?: string[]
  /** Environment variables (non-secret) */
  env?: Record<string, string>
  /** Secret references (IDs from SecretVault) */
  secretRefs?: string[]
  /** Exposed ports */
  ports?: Array<{
    containerPort: number
    protocol: 'tcp' | 'udp'
    expose: boolean
  }>
  /** Resource limits */
  resources: HardwareRequirements
}

export interface DeploymentConfig {
  /** Unique deployment ID */
  deploymentId: string
  /** Container configuration */
  container: ContainerConfig
  /** Requested duration in hours */
  durationHours: number
  /** Whether to auto-renew */
  autoRenew: boolean
  /** Maximum auto-renew budget (wei) */
  maxAutoRenewBudget?: bigint
  /** User wallet address */
  userAddress: Address
  /** SSH public key for access */
  sshPublicKey?: string
  /** Health check configuration */
  healthCheck?: {
    path: string
    port: number
    intervalSeconds: number
    timeoutSeconds: number
    initialDelaySeconds: number
  }
}

// Deployment State

export interface ExternalDeployment {
  /** Network deployment ID */
  deploymentId: string
  /** External provider type */
  providerType: ExternalProviderType
  /** External provider's deployment ID */
  externalDeploymentId: string
  /** Current status */
  status: ProviderStatusType
  /** Access endpoint (for HTTP) */
  httpEndpoint?: string
  /** SSH access details */
  ssh?: {
    host: string
    port: number
    username: string
  }
  /** Start timestamp */
  startedAt: number
  /** Scheduled end timestamp */
  expiresAt: number
  /** Total cost paid (wei) */
  totalCostPaid: bigint
  /** Hardware allocated */
  hardware: HardwareCapabilities
  /** Pricing at time of deployment */
  pricing: ExternalProviderPricing
  /** Bridge node that provisioned this */
  bridgeNodeAddress: Address
  /** TEE attestation if applicable */
  attestation?: {
    hash: Hex
    timestamp: number
    verified: boolean
  }
  /** Error message if status is ERROR */
  error?: string
  /** Logs URL */
  logsUrl?: string
}

// Bridge Node (Operator)

export interface BridgeNodeConfig {
  /** Bridge node wallet address */
  address: Address
  /** ERC-8004 agent ID */
  agentId: bigint
  /** Supported external provider types */
  supportedProviders: ExternalProviderType[]
  /** Stake amount (wei) */
  stake: bigint
  /** Minimum stake required (wei) */
  minStakeRequired: bigint
  /** Markup basis points (on top of network default) */
  markupBps: number
  /** Regions supported */
  regions: string[]
  /** Maximum concurrent deployments */
  maxConcurrentDeployments: number
  /** Current active deployments */
  activeDeployments: number
  /** Total deployments completed */
  totalDeploymentsCompleted: bigint
  /** Total revenue earned (wei) */
  totalRevenueEarned: bigint
  /** Total slashed amount (wei) */
  totalSlashed: bigint
  /** Reputation score (0-100) */
  reputationScore: number
  /** Whether bridge node is active */
  active: boolean
  /** Registered timestamp */
  registeredAt: number
}

export interface BridgeNodeCredential {
  /** Secret ID in SecretVault */
  secretId: string
  /** Provider type this credential is for */
  providerType: ExternalProviderType
  /** Credential owner (must match bridge node address) */
  owner: Address
  /** Description */
  description: string
  /** Whether credential is verified working */
  verified: boolean
  /** Last verification timestamp */
  lastVerifiedAt: number
  /** Expiration timestamp (if applicable) */
  expiresAt?: number
}

// Slashing & Reputation

export const SlashingReasons = {
  DEPLOYMENT_FAILURE: 'deployment_failure',
  DOWNTIME: 'downtime',
  SLA_VIOLATION: 'sla_violation',
  INVALID_ATTESTATION: 'invalid_attestation',
  PRICE_MANIPULATION: 'price_manipulation',
} as const

export type SlashingReason =
  (typeof SlashingReasons)[keyof typeof SlashingReasons]

export interface SlashingConfig {
  /** Slash revenue (not stake) on failure - basis points */
  revenueSlashBps: number
  /** Minimum reputation before stake slashing kicks in */
  minReputationForStakeProtection: number
  /** Stake slash amount for repeated offenders (bps) */
  stakeSlashBps: number
  /** Cooldown between slashing events (seconds) */
  slashingCooldownSec: number
  /** DAO governance address that can modify these */
  governanceAddress: Address
}

export interface SlashingEvent {
  /** Event ID */
  eventId: Hex
  /** Bridge node address */
  bridgeNode: Address
  /** Reason for slashing */
  reason: SlashingReason
  /** Amount slashed (wei) - from revenue, not stake */
  amountSlashed: bigint
  /** Whether stake was slashed (only for repeat offenders) */
  stakeSlashed: boolean
  /** Deployment ID that caused this */
  deploymentId: string
  /** Timestamp */
  timestamp: number
  /** Evidence hash */
  evidenceHash: Hex
  /** Disputed flag */
  disputed: boolean
  /** Resolution if disputed */
  resolution?: 'upheld' | 'reversed'
}

// Provider Interface

export interface ExternalComputeProvider {
  /** Provider type identifier */
  readonly type: ExternalProviderType
  /** Human-readable name */
  readonly name: string

  /** Check if provider is available */
  isAvailable(): Promise<boolean>

  /** Get available hardware options with pricing */
  listOfferings(filter?: Partial<HardwareRequirements>): Promise<
    Array<{
      hardware: HardwareCapabilities
      pricing: ExternalProviderPricing
      availableCount: number
    }>
  >

  /** Get quote for deployment */
  getQuote(config: DeploymentConfig): Promise<{
    totalCost: bigint
    pricePerHour: bigint
    estimatedReadyTime: number
    warnings: string[]
  }>

  /** Create deployment */
  deploy(
    config: DeploymentConfig,
    credentials: BridgeNodeCredential,
  ): Promise<ExternalDeployment>

  /** Get deployment status */
  getDeployment(deploymentId: string): Promise<ExternalDeployment | null>

  /** Terminate deployment */
  terminate(
    deploymentId: string,
    credentials: BridgeNodeCredential,
  ): Promise<void>

  /** Extend deployment */
  extend(
    deploymentId: string,
    additionalHours: number,
    credentials: BridgeNodeCredential,
  ): Promise<ExternalDeployment>

  /** Get logs */
  getLogs(
    deploymentId: string,
    credentials: BridgeNodeCredential,
    tail?: number,
  ): Promise<string>

  /** Health check */
  healthCheck(deploymentId: string): Promise<{
    healthy: boolean
    latencyMs: number
    lastCheck: number
  }>
}

// Payment Integration

export interface ExternalPaymentConfig {
  /** Chain ID for payment source */
  sourceChainId: number
  /** Token address for payment (address(0) = ETH) */
  paymentToken: Address
  /** Amount to pay (wei) */
  amount: bigint
  /** Recipient (bridge node) */
  recipient: Address
  /** Whether to use EIL for cross-chain payment */
  useEIL: boolean
  /** Destination chain ID if using EIL */
  destinationChainId?: number
  /** Destination token (e.g., AKT for Akash) */
  destinationToken?: string
  /** Slippage tolerance (bps) */
  slippageBps?: number
}

export interface PaymentResult {
  /** Success flag */
  success: boolean
  /** Transaction hash on source chain */
  sourceTxHash: Hex
  /** Transaction hash on destination chain (if EIL) */
  destinationTxHash?: Hex
  /** Amount paid in source token */
  amountPaid: bigint
  /** Amount received in destination token */
  amountReceived?: bigint
  /** Fee paid (wei) */
  feePaid: bigint
  /** Timestamp */
  timestamp: number
}

// Events

export interface ExternalComputeEvents {
  DeploymentCreated: {
    deploymentId: string
    providerType: ExternalProviderType
    bridgeNode: Address
    user: Address
    hardware: HardwareRequirements
    durationHours: number
    totalCost: bigint
  }
  DeploymentReady: {
    deploymentId: string
    httpEndpoint?: string
    sshHost?: string
    sshPort?: number
  }
  DeploymentTerminated: {
    deploymentId: string
    reason: 'expired' | 'user_cancelled' | 'bridge_terminated' | 'error'
    refundAmount?: bigint
  }
  BridgeNodeRegistered: {
    address: Address
    agentId: bigint
    stake: bigint
    supportedProviders: ExternalProviderType[]
  }
  BridgeNodeSlashed: {
    address: Address
    reason: SlashingReason
    amount: bigint
    stakeSlashed: boolean
  }
  PricingUpdated: {
    providerType: ExternalProviderType
    bridgeNode: Address
    oldPricePerHour: bigint
    newPricePerHour: bigint
  }
}
