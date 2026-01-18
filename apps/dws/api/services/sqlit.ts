/**
 * SQLit Service Provisioner for DWS
 *
 * Deploys decentralized SQLite database infrastructure:
 * - Block producer nodes for consensus
 * - Follower nodes for read scaling
 * - HTTP API for client access
 * - Gossip protocol for node discovery
 * - Raft consensus for replication
 *
 * Features:
 * - Distributed SQLite with strong consistency
 * - Automatic failover and leader election
 * - IPFS-backed backups
 * - On-chain node registration
 *
 * Replaces:
 * - packages/deployment/terraform/modules/sqlit
 */

import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type { HardwareSpec } from '../containers/provisioner'
import {
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

export type SQLitRole = 'blockproducer' | 'follower' | 'reader'

export interface SQLitNodeConfig {
  role: SQLitRole
  replicas: number
}

export interface SQLitConfig {
  name: string
  namespace: string
  nodes: {
    blockProducers: number
    followers: number
  }
  ports: {
    client: number
    http: number
    gossip: number
    raft: number
  }
  storage: {
    sizeMb: number
    tier: 'ssd' | 'nvme'
  }
  contracts: {
    rpcUrl: string
    nodeRegistryAddress: Address | string
  }
  backup: {
    enabled: boolean
    intervalSeconds: number
    ipfsPin: boolean
  }
  hardware?: Partial<HardwareSpec>
}

export const SQLitConfigSchema = z.object({
  name: z.string().default('jeju-sqlit'),
  namespace: z.string().default('default'),
  nodes: z.object({
    blockProducers: z.number().min(1).max(7).default(3),
    followers: z.number().min(0).max(10).default(2),
  }),
  ports: z.object({
    client: z.number().default(4001),
    http: z.number().default(8080),
    gossip: z.number().default(4002),
    raft: z.number().default(4003),
  }),
  storage: z.object({
    sizeMb: z.number().default(102400), // 100GB
    tier: z.enum(['ssd', 'nvme']).default('ssd'),
  }),
  contracts: z.object({
    rpcUrl: z.string().url(),
    nodeRegistryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
  backup: z.object({
    enabled: z.boolean().default(true),
    intervalSeconds: z.number().default(3600),
    ipfsPin: z.boolean().default(true),
  }),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
})

// SQLit Service State
export interface SQLitService {
  id: string
  name: string
  namespace: string
  owner: Address
  components: {
    blockProducers: StatefulService
    followers?: StatefulService
  }
  endpoints: {
    client: string
    http: string
  }
  config: SQLitConfig
  cluster: {
    leader: string | null
    nodes: Array<{
      nodeId: string
      role: SQLitRole
      endpoint: string
      healthy: boolean
    }>
  }
  stats: {
    databaseCount: number
    totalSizeMb: number
    queriesPerSecond: number
    replicationLag: number
  }
  status: 'creating' | 'electing' | 'ready' | 'degraded' | 'failed'
  createdAt: number
}

// ============================================================================
// Service Defaults
// ============================================================================

const SQLIT_IMAGE = 'ghcr.io/jejunetwork/sqlit'
const IMAGE_TAG = 'latest'

const DEFAULT_HARDWARE: HardwareSpec = {
  cpuCores: 2,
  cpuArchitecture: 'amd64',
  memoryMb: 2048,
  storageMb: 102400, // 100GB
  storageType: 'nvme',
  gpuType: 'none',
  gpuCount: 0,
  networkBandwidthMbps: 2500,
  publicIp: false,
  teePlatform: 'none',
}

// ============================================================================
// SQLit Service Registry
// ============================================================================

const sqlitServices = new Map<string, SQLitService>()

// ============================================================================
// SQLit Provisioner
// ============================================================================

/**
 * Deploy SQLit cluster on DWS
 */
export async function deploySQLit(
  owner: Address,
  config: SQLitConfig,
): Promise<SQLitService> {
  const validatedConfig = SQLitConfigSchema.parse(config)

  console.log(
    `[SQLitService] Deploying ${validatedConfig.name} with ${validatedConfig.nodes.blockProducers} block producers`,
  )

  const statefulProvisioner = getStatefulProvisioner()
  const serviceId = `sqlit-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Build hardware spec
  const hardware: HardwareSpec = {
    ...DEFAULT_HARDWARE,
    ...validatedConfig.hardware,
    storageMb: validatedConfig.storage.sizeMb,
    storageType: validatedConfig.storage.tier,
  }

  // Build volume config
  const volumes: VolumeConfig[] = [
    {
      name: 'data',
      sizeMb: validatedConfig.storage.sizeMb,
      tier: validatedConfig.storage.tier,
      mountPath: '/data',
      backup: {
        enabled: validatedConfig.backup.enabled,
        intervalSeconds: validatedConfig.backup.intervalSeconds,
        retentionCount: 24,
        ipfsPin: validatedConfig.backup.ipfsPin,
      },
    },
  ]

  // Common environment
  const commonEnv = {
    SQLIT_CLIENT_PORT: String(validatedConfig.ports.client),
    SQLIT_HTTP_PORT: String(validatedConfig.ports.http),
    SQLIT_GOSSIP_PORT: String(validatedConfig.ports.gossip),
    SQLIT_RAFT_PORT: String(validatedConfig.ports.raft),
    SQLIT_DATA_DIR: '/data',
    JEJU_RPC_URL: validatedConfig.contracts.rpcUrl,
    NODE_REGISTRY_ADDRESS: validatedConfig.contracts.nodeRegistryAddress,
  }

  // Deploy Block Producer nodes
  const bpConfig: StatefulServiceConfig = {
    name: `${validatedConfig.name}-bp`,
    namespace: validatedConfig.namespace,
    replicas: validatedConfig.nodes.blockProducers,
    image: SQLIT_IMAGE,
    tag: IMAGE_TAG,
    env: {
      ...commonEnv,
      SQLIT_ROLE: 'blockproducer',
    },
    ports: [
      {
        name: 'client',
        containerPort: validatedConfig.ports.client,
        protocol: 'tcp',
      },
      {
        name: 'http',
        containerPort: validatedConfig.ports.http,
        protocol: 'tcp',
      },
      {
        name: 'gossip',
        containerPort: validatedConfig.ports.gossip,
        protocol: 'tcp',
      },
      {
        name: 'raft',
        containerPort: validatedConfig.ports.raft,
        protocol: 'tcp',
      },
    ],
    hardware,
    volumes,
    healthCheck: {
      path: '/v1/status',
      port: validatedConfig.ports.http,
      intervalSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
      successThreshold: 1,
    },
    readinessCheck: {
      path: '/v1/status',
      port: validatedConfig.ports.http,
      initialDelaySeconds: 30,
      periodSeconds: 10,
    },
    labels: {
      'dws.service.type': 'sqlit',
      'dws.sqlit.role': 'blockproducer',
    },
    annotations: {
      'prometheus.io/scrape': 'true',
      'prometheus.io/port': String(validatedConfig.ports.http),
      'prometheus.io/path': '/metrics',
    },
    terminationGracePeriodSeconds: 60,
  }

  const bpService = await statefulProvisioner.create(owner, bpConfig)

  const components: SQLitService['components'] = { blockProducers: bpService }
  const endpoints: SQLitService['endpoints'] = {
    client: `${validatedConfig.name}-bp.${validatedConfig.namespace}.svc.jeju:${validatedConfig.ports.client}`,
    http: `http://${validatedConfig.name}-bp.${validatedConfig.namespace}.svc.jeju:${validatedConfig.ports.http}`,
  }

  // Deploy Follower nodes if configured
  if (validatedConfig.nodes.followers > 0) {
    const followerConfig: StatefulServiceConfig = {
      name: `${validatedConfig.name}-follower`,
      namespace: validatedConfig.namespace,
      replicas: validatedConfig.nodes.followers,
      image: SQLIT_IMAGE,
      tag: IMAGE_TAG,
      env: {
        ...commonEnv,
        SQLIT_ROLE: 'follower',
        SQLIT_LEADER_ENDPOINT: `${validatedConfig.name}-bp-0.${validatedConfig.name}-bp.${validatedConfig.namespace}.svc.jeju:${validatedConfig.ports.raft}`,
      },
      ports: [
        {
          name: 'client',
          containerPort: validatedConfig.ports.client,
          protocol: 'tcp',
        },
        {
          name: 'http',
          containerPort: validatedConfig.ports.http,
          protocol: 'tcp',
        },
        {
          name: 'gossip',
          containerPort: validatedConfig.ports.gossip,
          protocol: 'tcp',
        },
      ],
      hardware: {
        ...hardware,
        cpuCores: 1, // Followers need less resources
        memoryMb: 1024,
      },
      volumes,
      healthCheck: {
        path: '/v1/status',
        port: validatedConfig.ports.http,
        intervalSeconds: 10,
        timeoutSeconds: 5,
        failureThreshold: 3,
        successThreshold: 1,
      },
      labels: {
        'dws.service.type': 'sqlit',
        'dws.sqlit.role': 'follower',
      },
      annotations: {},
      terminationGracePeriodSeconds: 30,
    }

    components.followers = await statefulProvisioner.create(
      owner,
      followerConfig,
    )
  }

  // Register with service discovery
  const bpEndpoints: ServiceEndpoint[] = bpService.replicas.map((r) => ({
    ordinal: r.ordinal,
    podName: r.podName,
    ip: extractIp(r.endpoint),
    port: validatedConfig.ports.http,
    nodeId: r.nodeId,
    role: r.role,
    healthy: r.healthStatus === 'healthy',
    weight: 100,
  }))

  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'sqlit',
    owner,
    bpEndpoints,
    {
      'sqlit.blockProducers': String(validatedConfig.nodes.blockProducers),
      'sqlit.followers': String(validatedConfig.nodes.followers),
    },
  )

  // Build service object
  const clusterNodes = bpService.replicas.map((r) => ({
    nodeId: r.nodeId,
    role: 'blockproducer' as SQLitRole,
    endpoint: r.endpoint,
    healthy: r.healthStatus === 'healthy',
  }))

  if (components.followers) {
    for (const r of components.followers.replicas) {
      clusterNodes.push({
        nodeId: r.nodeId,
        role: 'follower' as SQLitRole,
        endpoint: r.endpoint,
        healthy: r.healthStatus === 'healthy',
      })
    }
  }

  const sqlitService: SQLitService = {
    id: serviceId,
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    components,
    endpoints,
    config: validatedConfig,
    cluster: {
      leader: null, // Will be discovered
      nodes: clusterNodes,
    },
    stats: {
      databaseCount: 0,
      totalSizeMb: 0,
      queriesPerSecond: 0,
      replicationLag: 0,
    },
    status: 'electing',
    createdAt: Date.now(),
  }

  sqlitServices.set(serviceId, sqlitService)

  // Discover leader in background
  discoverLeader(sqlitService).catch(console.error)

  console.log(`[SQLitService] Deployed ${validatedConfig.name}`)

  return sqlitService
}

/**
 * Discover cluster leader
 */
async function discoverLeader(service: SQLitService): Promise<void> {
  // Wait for cluster to stabilize
  await new Promise((resolve) => setTimeout(resolve, 10000))

  const replica = service.components.blockProducers.replicas[0]
  if (!replica) return

  const statusUrl = `${replica.endpoint}/v1/status`
  const response = await fetch(statusUrl).catch(() => null)

  if (response?.ok) {
    const status = (await response.json()) as {
      leader: string
      role: string
    }
    service.cluster.leader = status.leader
    service.status = 'ready'
  }
}

/**
 * Get SQLit service by ID
 */
export function getSQLitService(serviceId: string): SQLitService | null {
  return sqlitServices.get(serviceId) ?? null
}

/**
 * List all SQLit services
 */
export function listSQLitServices(owner?: Address): SQLitService[] {
  const services = [...sqlitServices.values()]
  if (owner) {
    return services.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return services
}

/**
 * Scale SQLit service
 */
export async function scaleSQLit(
  serviceId: string,
  owner: Address,
  blockProducers: number,
  followers?: number,
): Promise<void> {
  const service = sqlitServices.get(serviceId)
  if (!service) {
    throw new Error(`SQLit service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to scale this SQLit service')
  }

  const statefulProvisioner = getStatefulProvisioner()

  await statefulProvisioner.scale(
    service.components.blockProducers.id,
    owner,
    blockProducers,
  )

  if (followers !== undefined && service.components.followers) {
    await statefulProvisioner.scale(
      service.components.followers.id,
      owner,
      followers,
    )
  }

  console.log(
    `[SQLitService] Scaled ${service.name} to ${blockProducers} block producers`,
  )
}

/**
 * Terminate SQLit service
 */
export async function terminateSQLit(
  serviceId: string,
  owner: Address,
): Promise<void> {
  const service = sqlitServices.get(serviceId)
  if (!service) {
    throw new Error(`SQLit service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this SQLit service')
  }

  const statefulProvisioner = getStatefulProvisioner()

  await statefulProvisioner.terminate(
    service.components.blockProducers.id,
    owner,
  )
  if (service.components.followers) {
    await statefulProvisioner.terminate(service.components.followers.id, owner)
  }

  deregisterService(serviceId)
  sqlitServices.delete(serviceId)

  console.log(`[SQLitService] Terminated ${service.name}`)
}

/**
 * Get SQLit stats
 */
export async function getSQLitStats(
  serviceId: string,
): Promise<SQLitService['stats'] | null> {
  const service = sqlitServices.get(serviceId)
  if (!service) {
    return null
  }

  const replica = service.components.blockProducers.replicas.find(
    (r) => r.healthStatus === 'healthy',
  )
  if (!replica) {
    return service.stats
  }

  const statsUrl = `${replica.endpoint}/v1/stats`
  const response = await fetch(statsUrl).catch(() => null)

  if (response?.ok) {
    const stats = (await response.json()) as {
      databaseCount: number
      totalSizeMb: number
      queriesPerSecond: number
      replicationLag: number
    }
    service.stats = stats
  }

  return service.stats
}

/**
 * Get cluster status
 */
export async function getSQLitClusterStatus(
  serviceId: string,
): Promise<SQLitService['cluster'] | null> {
  const service = sqlitServices.get(serviceId)
  if (!service) {
    return null
  }

  // Refresh node health status
  for (const node of service.cluster.nodes) {
    const response = await fetch(`${node.endpoint}/v1/status`).catch(() => null)
    node.healthy = response?.ok ?? false
  }

  // Discover current leader
  const replica = service.components.blockProducers.replicas[0]
  if (replica) {
    const response = await fetch(`${replica.endpoint}/v1/status`).catch(
      () => null,
    )
    if (response?.ok) {
      const status = (await response.json()) as { leader: string }
      service.cluster.leader = status.leader
    }
  }

  return service.cluster
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
 * Get default testnet SQLit config
 */
export function getTestnetSQLitConfig(): SQLitConfig {
  return {
    name: 'jeju-sqlit',
    namespace: 'default',
    nodes: {
      blockProducers: 3,
      followers: 2,
    },
    ports: {
      client: 4001,
      http: 8080,
      gossip: 4002,
      raft: 4003,
    },
    storage: {
      sizeMb: 102400, // 100GB
      tier: 'ssd',
    },
    contracts: {
      rpcUrl: 'https://testnet.jejunetwork.org',
      nodeRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
    },
    backup: {
      enabled: true,
      intervalSeconds: 3600,
      ipfsPin: true,
    },
  }
}

/**
 * Get default localnet SQLit config (for local development)
 */
export function getLocalnetSQLitConfig(): SQLitConfig {
  return {
    name: 'jeju-sqlit',
    namespace: 'default',
    nodes: {
      blockProducers: 1,
      followers: 0,
    },
    ports: {
      client: 4001,
      http: 8546,
      gossip: 4002,
      raft: 4003,
    },
    storage: {
      sizeMb: 10240, // 10GB for local dev
      tier: 'ssd',
    },
    contracts: {
      rpcUrl: 'http://localhost:6546',
      nodeRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
    },
    backup: {
      enabled: false,
      intervalSeconds: 3600,
      ipfsPin: false,
    },
  }
}
