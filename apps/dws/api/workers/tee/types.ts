/**
 * TEE Worker Types
 *
 * Flexible region system supporting multiple cloud providers:
 * - AWS regions (us-east-1, eu-west-1, ap-northeast-1, etc.)
 * - GCP regions (us-central1, europe-west1, asia-east1, etc.)
 * - Azure regions (eastus, westeurope, japaneast, etc.)
 * - OVH regions (gra, sbg, bhs, etc.)
 * - DigitalOcean regions (nyc1, ams3, sgp1, etc.)
 * - Custom/self-hosted regions
 */

import type { Address, Hex } from 'viem'

// Region Types - Flexible for any cloud provider

/**
 * Cloud provider identifiers
 */
export type CloudProvider =
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'ovh'
  | 'digitalocean'
  | 'hetzner'
  | 'vultr'
  | 'linode'
  | 'akash'
  | 'phala'
  | 'custom'

/**
 * Region identifier - flexible string format
 * Examples:
 * - "aws:us-east-1"
 * - "gcp:us-central1"
 * - "azure:eastus"
 * - "ovh:gra"
 * - "custom:my-datacenter"
 * - "local" (for development)
 */
export type RegionId = string

/**
 * Geographic zone for grouping regions
 */
export type GeoZone =
  | 'north-america'
  | 'south-america'
  | 'europe'
  | 'asia-pacific'
  | 'middle-east'
  | 'africa'
  | 'oceania'
  | 'global'

/**
 * Region definition with coordinates for geo-routing
 */
export interface Region {
  id: RegionId
  provider: CloudProvider
  name: string
  geoZone: GeoZone
  coordinates: { lat: number; lon: number }
  /** Whether this region supports TEE */
  teeCapable: boolean
  /** Available TEE platforms in this region */
  teePlatforms: TEEPlatform[]
}

/**
 * Network environment
 */
export type NetworkEnvironment = 'localnet' | 'testnet' | 'mainnet'

/**
 * Environment-specific region configuration
 */
export interface RegionConfig {
  environment: NetworkEnvironment
  /** Regions available in this environment */
  regions: Region[]
  /** Default region for new deployments */
  defaultRegion: RegionId
}

// TEE Types

export type TEEPlatform =
  | 'intel-sgx'
  | 'intel-tdx'
  | 'amd-sev'
  | 'arm-cca'
  | 'nvidia-cc' // Confidential Computing for GPUs
  | 'simulator'

export interface TEECapabilities {
  platform: TEEPlatform
  /** Maximum memory available in TEE (MB) */
  maxMemoryMb: number
  /** Whether GPU is available in TEE */
  gpuAvailable: boolean
  /** Attestation service endpoint */
  attestationEndpoint?: string
}

export interface TEEAttestation {
  /** Raw attestation quote */
  quote: Hex
  /** Enclave measurement (MRENCLAVE for SGX, MRTD for TDX) */
  measurement: Hex
  /** Signer measurement */
  signerMeasurement?: Hex
  /** Report data (user-provided nonce) */
  reportData: Hex
  /** Attestation timestamp */
  timestamp: number
  /** TEE platform */
  platform: TEEPlatform
  /** Whether this is a simulated attestation */
  simulated: boolean
}

// Worker Node Types

export type NodeStatus = 'online' | 'offline' | 'draining' | 'maintenance'

export interface TEEWorkerNode {
  /** On-chain agent ID from ERC-8004 registry */
  agentId: bigint
  /** Node operator address */
  operator: Address
  /** HTTP endpoint for worker API */
  endpoint: string
  /** Region this node is in */
  region: RegionId
  /** TEE capabilities */
  tee: TEECapabilities
  /** Node status */
  status: NodeStatus
  /** Staked amount */
  stake: bigint
  /** Reputation score (0-100) */
  reputation: number
  /** Last attestation */
  lastAttestation?: TEEAttestation
  /** Last seen timestamp */
  lastSeen: number
  /** Resource availability */
  resources: {
    availableCpuMillis: number
    availableMemoryMb: number
    availableStorageMb: number
    gpuAvailable: boolean
    gpuType?: string
  }
  /** Supported capabilities */
  capabilities: string[]
}

// Workload Types

export type WorkloadRuntime = 'workerd' | 'bun' | 'docker' | 'wasm'

export interface WorkloadConfig {
  /** Unique workload ID */
  id: string
  /** Display name */
  name: string
  /** Owner address */
  owner: Address
  /** Code bundle CID on IPFS */
  codeCid: string
  /** Code hash for verification */
  codeHash: Hex
  /** Runtime to use */
  runtime: WorkloadRuntime
  /** Entrypoint (e.g., "index.handler") */
  entrypoint: string
  /** Environment variables (non-secret) */
  env: Record<string, string>
  /** Secret names to inject (fetched securely) */
  secretNames: string[]
  /** Resource requirements */
  resources: WorkloadResources
  /** Scaling configuration */
  scaling: WorkloadScaling
  /** TEE requirements */
  teeRequirements: TEERequirements
  /** Regional deployment preferences */
  regionPreferences: RegionPreferences
}

export interface WorkloadResources {
  cpuMillis: number
  memoryMb: number
  storageMb: number
  timeoutMs: number
  maxConcurrency: number
  gpuRequired: boolean
  gpuType?: string
}

export interface WorkloadScaling {
  minInstances: number
  maxInstances: number
  targetConcurrency: number
  scaleToZero: boolean
  cooldownMs: number
}

export interface TEERequirements {
  required: boolean
  platforms: TEEPlatform[]
  attestationRequired: boolean
  /** Expected measurement (for verified deployments) */
  expectedMeasurement?: Hex
  /** Minimum TEE memory */
  minTeeMemoryMb?: number
}

export interface RegionPreferences {
  /** Preferred regions (in order of preference) */
  preferred: RegionId[]
  /** Regions to exclude */
  excluded: RegionId[]
  /** Geo zones to prefer */
  preferredZones: GeoZone[]
  /** Require specific cloud provider */
  requiredProvider?: CloudProvider
  /** Allow fallback to any available region */
  allowFallback: boolean
}

// Secret Types

export interface EncryptedSecret {
  /** Secret name */
  name: string
  /** Encrypted value (encrypted to TEE enclave key) */
  encryptedValue: Hex
  /** Public key used for encryption */
  encryptionKey: Hex
  /** Encryption algorithm */
  algorithm: 'x25519-xsalsa20-poly1305' | 'aes-256-gcm'
  /** Nonce used for encryption */
  nonce: Hex
}

export interface SecretReference {
  /** Secret name */
  name: string
  /** Secret vault ID (for multi-tenant vaults) */
  vaultId?: string
  /** Version (latest if not specified) */
  version?: number
}

// Deployment Types

export type DeploymentStatus =
  | 'pending'
  | 'deploying'
  | 'active'
  | 'draining'
  | 'stopped'
  | 'failed'

export interface WorkloadDeployment {
  /** Deployment ID */
  id: string
  /** Workload config */
  workload: WorkloadConfig
  /** Current status */
  status: DeploymentStatus
  /** Active instances */
  instances: WorkloadInstance[]
  /** Deployment timestamp */
  deployedAt: number
  /** Last update timestamp */
  updatedAt: number
  /** Error message if failed */
  error?: string
  /** Metrics */
  metrics: DeploymentMetrics
}

export interface WorkloadInstance {
  /** Instance ID */
  id: string
  /** Node running this instance */
  nodeAgentId: bigint
  /** Node endpoint */
  nodeEndpoint: string
  /** Region */
  region: RegionId
  /** Instance status */
  status: 'starting' | 'warm' | 'busy' | 'draining' | 'stopped' | 'error'
  /** Started at */
  startedAt: number
  /** Last request at */
  lastRequestAt: number
  /** Active requests */
  activeRequests: number
  /** Total requests served */
  totalRequests: number
  /** Error count */
  errors: number
  /** TEE attestation for this instance */
  attestation?: TEEAttestation
}

export interface DeploymentMetrics {
  totalInvocations: number
  totalErrors: number
  avgLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  coldStarts: number
  warmStarts: number
}

// Events

export type TEEWorkerEvent =
  | { type: 'node:registered'; agentId: bigint; region: RegionId }
  | { type: 'node:offline'; agentId: bigint }
  | { type: 'node:attestation'; agentId: bigint; attestation: TEEAttestation }
  | { type: 'workload:deployed'; deploymentId: string; workloadId: string }
  | { type: 'workload:scaled'; deploymentId: string; instances: number }
  | { type: 'workload:stopped'; deploymentId: string }
  | {
      type: 'instance:started'
      deploymentId: string
      instanceId: string
      region: RegionId
    }
  | { type: 'instance:stopped'; deploymentId: string; instanceId: string }
  | {
      type: 'invocation:completed'
      deploymentId: string
      instanceId: string
      durationMs: number
    }
  | {
      type: 'invocation:error'
      deploymentId: string
      instanceId: string
      error: string
    }

export type TEEWorkerEventHandler = (event: TEEWorkerEvent) => void
