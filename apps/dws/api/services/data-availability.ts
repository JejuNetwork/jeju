/**
 * Jeju Data Availability Service Provisioner for DWS
 *
 * Implements the OP Stack Alt-DA interface for Jeju Network:
 * - op-batcher sends batch data to Jeju DA server
 * - Creates KZG/Keccak commitment and stores data in IPFS
 * - Commitment posted to L1 (minimal footprint)
 * - op-node retrieves data using commitment
 *
 * Features:
 * - IPFS-backed storage with replication
 * - PeerDAS integration for enhanced sampling
 * - WebTorrent fallback for high-performance retrieval
 * - Cost-effective: only pay for IPFS storage
 *
 * Replaces: packages/deployment/kubernetes/helm/jeju-da
 */

import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type { HardwareSpec } from '../containers/provisioner'
import {
  type ConsensusConfig,
  getStatefulProvisioner,
  type StatefulService,
  type StatefulServiceConfig,
  type VolumeConfig,
} from '../containers/stateful-provisioner'
import {
  deregisterService,
  registerTypedService,
  type ServiceEndpoint,
} from './discovery'

// ============================================================================
// Types
// ============================================================================

export type CommitmentScheme = 'keccak256' | 'kzg'
export type ArchiveBackend = 'ipfs' | 's3' | 'arweave' | 'filecoin'

export interface DAConfig {
  name: string
  namespace: string
  replicas: number
  ipfs: {
    apiUrl: string
    gatewayUrl: string
    pinEnabled: boolean
    replicationFactor: number
  }
  commitment: {
    scheme: CommitmentScheme
  }
  retention: {
    daysToKeep: number
    archiveEnabled: boolean
    archiveBackend: ArchiveBackend
  }
  challenge: {
    enabled: boolean
    windowBlocks: number
  }
  fallback: {
    enabled: boolean
    useEthereumBlobs: boolean
    l1RpcUrl?: string
  }
  metrics: {
    enabled: boolean
    port: number
  }
  hardware?: Partial<HardwareSpec>
  volumeSizeGb?: number
}

export const DAConfigSchema = z.object({
  name: z.string().default('jeju-da'),
  namespace: z.string().default('default'),
  replicas: z.number().min(1).max(9).default(3),
  ipfs: z.object({
    apiUrl: z.string().url(),
    gatewayUrl: z.string().url(),
    pinEnabled: z.boolean().default(true),
    replicationFactor: z.number().min(1).max(10).default(3),
  }),
  commitment: z.object({
    scheme: z.enum(['keccak256', 'kzg']).default('keccak256'),
  }),
  retention: z.object({
    daysToKeep: z.number().min(1).default(30),
    archiveEnabled: z.boolean().default(true),
    archiveBackend: z
      .enum(['ipfs', 's3', 'arweave', 'filecoin'])
      .default('ipfs'),
  }),
  challenge: z.object({
    enabled: z.boolean().default(true),
    windowBlocks: z.number().default(7200), // ~1 day at 12s blocks
  }),
  fallback: z.object({
    enabled: z.boolean().default(true),
    useEthereumBlobs: z.boolean().default(true),
    l1RpcUrl: z.string().url().optional(),
  }),
  metrics: z.object({
    enabled: z.boolean().default(true),
    port: z.number().default(9100),
  }),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
  volumeSizeGb: z.number().default(100),
})

// DA Service State
export interface DAService {
  id: string
  name: string
  namespace: string
  owner: Address
  statefulService: StatefulService
  config: DAConfig
  endpoints: {
    da: string
    metrics: string
  }
  stats: {
    totalBlobs: number
    totalBytes: bigint
    averageCommitmentTimeMs: number
  }
  status: 'creating' | 'ready' | 'degraded' | 'failed'
  createdAt: number
}

// ============================================================================
// Service Defaults
// ============================================================================

const DA_IMAGE = 'ghcr.io/jejunetwork/jeju-da'
const DA_TAG = 'latest'
const DA_PORT = 3100

const DEFAULT_HARDWARE: HardwareSpec = {
  cpuCores: 2,
  cpuArchitecture: 'amd64',
  memoryMb: 4096,
  storageMb: 102400, // 100GB
  storageType: 'nvme',
  gpuType: 'none',
  gpuCount: 0,
  networkBandwidthMbps: 2500,
  publicIp: true,
  teePlatform: 'none',
}

// ============================================================================
// DA Service Registry
// ============================================================================

const daServices = new Map<string, DAService>()

// ============================================================================
// DA Provisioner
// ============================================================================

/**
 * Deploy Jeju DA service on DWS
 */
export async function deployDA(
  owner: Address,
  config: DAConfig,
): Promise<DAService> {
  const validatedConfig = DAConfigSchema.parse(config)

  console.log(
    `[DAService] Deploying ${validatedConfig.name} with ${validatedConfig.replicas} replicas (${validatedConfig.commitment.scheme} commitment)`,
  )

  // Build hardware spec
  const hardware: HardwareSpec = {
    ...DEFAULT_HARDWARE,
    ...validatedConfig.hardware,
  }

  // Build volume config
  const volumes: VolumeConfig[] = [
    {
      name: 'data',
      sizeMb: validatedConfig.volumeSizeGb * 1024,
      tier: 'nvme',
      mountPath: '/data',
      backup: {
        enabled: true,
        intervalSeconds: 3600,
        retentionCount: 48, // 2 days of hourly backups
        ipfsPin: true,
      },
    },
  ]

  // Build consensus config for leader election
  const consensusConfig: ConsensusConfig = {
    protocol: 'raft',
    minQuorum: Math.floor(validatedConfig.replicas / 2) + 1,
    electionTimeoutMs: 5000,
    heartbeatIntervalMs: 500,
    snapshotThreshold: 10000,
  }

  // Build environment variables
  const env: Record<string, string> = {
    // Server config
    DA_SERVER_ADDR: '0.0.0.0',
    DA_SERVER_PORT: String(DA_PORT),
    // IPFS config
    IPFS_API_URL: validatedConfig.ipfs.apiUrl,
    IPFS_GATEWAY_URL: validatedConfig.ipfs.gatewayUrl,
    IPFS_PIN_ENABLED: String(validatedConfig.ipfs.pinEnabled),
    IPFS_REPLICATION_FACTOR: String(validatedConfig.ipfs.replicationFactor),
    // Commitment scheme
    COMMITMENT_SCHEME: validatedConfig.commitment.scheme,
    // Retention
    RETENTION_DAYS: String(validatedConfig.retention.daysToKeep),
    RETENTION_ARCHIVE_ENABLED: String(validatedConfig.retention.archiveEnabled),
    RETENTION_ARCHIVE_BACKEND: validatedConfig.retention.archiveBackend,
    // Challenge config
    CHALLENGE_ENABLED: String(validatedConfig.challenge.enabled),
    CHALLENGE_WINDOW_BLOCKS: String(validatedConfig.challenge.windowBlocks),
    // Fallback config
    FALLBACK_ENABLED: String(validatedConfig.fallback.enabled),
    FALLBACK_USE_ETH_BLOBS: String(validatedConfig.fallback.useEthereumBlobs),
    // Metrics
    METRICS_ENABLED: String(validatedConfig.metrics.enabled),
    METRICS_PORT: String(validatedConfig.metrics.port),
    // Storage path
    DATA_DIR: '/data',
  }

  if (validatedConfig.fallback.l1RpcUrl) {
    env.L1_RPC_URL = validatedConfig.fallback.l1RpcUrl
  }

  // Build stateful service config
  const statefulConfig: StatefulServiceConfig = {
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    replicas: validatedConfig.replicas,
    image: DA_IMAGE,
    tag: DA_TAG,
    env,
    ports: [
      { name: 'da', containerPort: DA_PORT, protocol: 'tcp' },
      {
        name: 'metrics',
        containerPort: validatedConfig.metrics.port,
        protocol: 'tcp',
      },
    ],
    hardware,
    volumes,
    consensus: consensusConfig,
    healthCheck: {
      path: '/health',
      port: DA_PORT,
      intervalSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
      successThreshold: 1,
    },
    readinessCheck: {
      path: '/ready',
      port: DA_PORT,
      initialDelaySeconds: 5,
      periodSeconds: 5,
    },
    labels: {
      'dws.service.type': 'da',
      'dws.da.commitment': validatedConfig.commitment.scheme,
    },
    annotations: {
      'prometheus.io/scrape': 'true',
      'prometheus.io/port': String(validatedConfig.metrics.port),
    },
    terminationGracePeriodSeconds: 60,
  }

  // Create stateful service
  const statefulProvisioner = getStatefulProvisioner()
  const statefulService = await statefulProvisioner.create(
    owner,
    statefulConfig,
  )

  // Generate service ID
  const serviceId = `da-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Register with service discovery
  const endpoints: ServiceEndpoint[] = statefulService.replicas.map((r) => ({
    ordinal: r.ordinal,
    podName: r.podName,
    ip: extractIp(r.endpoint),
    port: DA_PORT,
    nodeId: r.nodeId,
    role: r.role,
    healthy: r.healthStatus === 'healthy',
    weight: r.role === 'leader' ? 100 : 50,
  }))

  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'da',
    owner,
    endpoints,
    {
      'commitment.scheme': validatedConfig.commitment.scheme,
      'ipfs.replicationFactor': String(validatedConfig.ipfs.replicationFactor),
    },
  )

  // Build DA service object
  const daService: DAService = {
    id: serviceId,
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    statefulService,
    config: validatedConfig,
    endpoints: {
      da: `http://${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju:${DA_PORT}`,
      metrics: `http://${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju:${validatedConfig.metrics.port}`,
    },
    stats: {
      totalBlobs: 0,
      totalBytes: 0n,
      averageCommitmentTimeMs: 0,
    },
    status: 'ready',
    createdAt: Date.now(),
  }

  daServices.set(serviceId, daService)

  console.log(`[DAService] Deployed ${validatedConfig.name}`)

  return daService
}

/**
 * Get DA service by ID
 */
export function getDAService(serviceId: string): DAService | null {
  return daServices.get(serviceId) ?? null
}

/**
 * Get DA service by name
 */
export function getDAServiceByName(
  name: string,
  namespace: string = 'default',
): DAService | null {
  for (const service of daServices.values()) {
    if (service.name === name && service.namespace === namespace) {
      return service
    }
  }
  return null
}

/**
 * List all DA services
 */
export function listDAServices(owner?: Address): DAService[] {
  const services = [...daServices.values()]
  if (owner) {
    return services.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return services
}

/**
 * Scale DA service
 */
export async function scaleDA(
  serviceId: string,
  owner: Address,
  replicas: number,
): Promise<void> {
  const service = daServices.get(serviceId)
  if (!service) {
    throw new Error(`DA service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to scale this DA service')
  }

  const statefulProvisioner = getStatefulProvisioner()
  await statefulProvisioner.scale(service.statefulService.id, owner, replicas)

  console.log(`[DAService] Scaled ${service.name} to ${replicas} replicas`)
}

/**
 * Terminate DA service
 */
export async function terminateDA(
  serviceId: string,
  owner: Address,
): Promise<void> {
  const service = daServices.get(serviceId)
  if (!service) {
    throw new Error(`DA service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this DA service')
  }

  const statefulProvisioner = getStatefulProvisioner()
  await statefulProvisioner.terminate(service.statefulService.id, owner)

  deregisterService(serviceId)
  daServices.delete(serviceId)

  console.log(`[DAService] Terminated ${service.name}`)
}

/**
 * Submit blob to DA layer
 */
export async function submitBlob(
  serviceId: string,
  data: ArrayBuffer,
): Promise<{ commitment: Hex; cid: string }> {
  const service = daServices.get(serviceId)
  if (!service) {
    throw new Error(`DA service not found: ${serviceId}`)
  }
  if (service.status !== 'ready') {
    throw new Error(`DA service is not ready: ${service.status}`)
  }

  // Get leader replica
  const statefulProvisioner = getStatefulProvisioner()
  const leader = statefulProvisioner.getLeader(service.statefulService.id)
  if (!leader) {
    throw new Error('No leader available for DA submission')
  }

  // Submit to DA service
  const response = await fetch(`${leader.endpoint}/v1/put`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data,
  })

  if (!response.ok) {
    throw new Error(`DA submission failed: ${await response.text()}`)
  }

  const result = (await response.json()) as { commitment: Hex; cid: string }

  // Update stats
  service.stats.totalBlobs++
  service.stats.totalBytes += BigInt(data.byteLength)

  return result
}

/**
 * Retrieve blob from DA layer
 */
export async function retrieveBlob(
  serviceId: string,
  commitment: Hex,
): Promise<Uint8Array> {
  const service = daServices.get(serviceId)
  if (!service) {
    throw new Error(`DA service not found: ${serviceId}`)
  }

  // Try any healthy replica
  const healthyReplica = service.statefulService.replicas.find(
    (r) => r.healthStatus === 'healthy',
  )
  if (!healthyReplica) {
    throw new Error('No healthy replicas available')
  }

  const response = await fetch(
    `${healthyReplica.endpoint}/v1/get/${commitment}`,
    { method: 'GET' },
  )

  if (!response.ok) {
    throw new Error(`DA retrieval failed: ${await response.text()}`)
  }

  const blob = await response.arrayBuffer()
  return new Uint8Array(blob)
}

/**
 * Get DA service stats
 */
export async function getDAStats(serviceId: string): Promise<{
  totalBlobs: number
  totalBytes: bigint
  averageCommitmentTimeMs: number
  replicaStatus: Array<{ ordinal: number; healthy: boolean; role: string }>
}> {
  const service = daServices.get(serviceId)
  if (!service) {
    throw new Error(`DA service not found: ${serviceId}`)
  }

  const replicaStatus = service.statefulService.replicas.map((r) => ({
    ordinal: r.ordinal,
    healthy: r.healthStatus === 'healthy',
    role: r.role,
  }))

  return {
    ...service.stats,
    replicaStatus,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractIp(endpoint: string): string {
  const match = endpoint.match(/https?:\/\/([^:]+)/)
  return match ? match[1] : '127.0.0.1'
}

// ============================================================================
// Default Testnet Configuration
// ============================================================================

/**
 * Get default testnet DA config
 */
export function getTestnetDAConfig(): DAConfig {
  return {
    name: 'jeju-da',
    namespace: 'default',
    replicas: 3,
    ipfs: {
      apiUrl: 'https://dws.testnet.jejunetwork.org/storage/api/v0',
      gatewayUrl: 'https://dws.testnet.jejunetwork.org/storage/ipfs',
      pinEnabled: true,
      replicationFactor: 3,
    },
    commitment: {
      scheme: 'keccak256',
    },
    retention: {
      daysToKeep: 30,
      archiveEnabled: true,
      archiveBackend: 'ipfs',
    },
    challenge: {
      enabled: true,
      windowBlocks: 7200,
    },
    fallback: {
      enabled: true,
      useEthereumBlobs: true,
    },
    metrics: {
      enabled: true,
      port: 9100,
    },
    volumeSizeGb: 100,
  }
}
