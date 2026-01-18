/**
 * Farcaster Hubble Service Provisioner for DWS
 *
 * Deploys permissionless Farcaster hub nodes:
 * - Self-hosted hub for Farcaster protocol
 * - No API keys required
 * - P2P gossip sync with Farcaster network
 * - gRPC API for data queries
 *
 * Features:
 * - Identity generation and management
 * - RocksDB persistence with IPFS backup
 * - Multi-hub replication for high availability
 * - Jeju indexer integration
 *
 * Replaces: packages/deployment/kubernetes/helm/farcaster-hubble
 */

import type { Address, Hex } from 'viem'
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

export interface HubbleConfig {
  name: string
  namespace: string
  replicas: number
  ethereum: {
    rpcUrl: string
  }
  network: {
    bootstrapPeers: string[]
    grpcPort: number
    gossipPort: number
    httpPort: number
    httpApiEnabled: boolean
  }
  database: {
    pruneMessages: boolean
    pruneMessagesDays: number
  }
  sync: {
    fullSync: boolean
    fids?: number[]
  }
  jeju: {
    indexerEnabled: boolean
    indexerUrl?: string
    syncIdentities: boolean
    graphqlEnabled: boolean
  }
  hardware?: Partial<HardwareSpec>
  volumeSizeGb?: number
}

export const HubbleConfigSchema = z.object({
  name: z.string().default('farcaster-hubble'),
  namespace: z.string().default('default'),
  replicas: z.number().min(1).max(5).default(1),
  ethereum: z.object({
    rpcUrl: z.string().url().default('https://mainnet.optimism.io'),
  }),
  network: z.object({
    bootstrapPeers: z
      .array(z.string())
      .default([
        '/dns/nemes.farcaster.xyz/tcp/2282',
        '/dns/hoyt.farcaster.xyz/tcp/2282',
      ]),
    grpcPort: z.number().default(2283),
    gossipPort: z.number().default(2282),
    httpPort: z.number().default(2281),
    httpApiEnabled: z.boolean().default(true),
  }),
  database: z.object({
    pruneMessages: z.boolean().default(true),
    pruneMessagesDays: z.number().default(365),
  }),
  sync: z.object({
    fullSync: z.boolean().default(true),
    fids: z.array(z.number()).optional(),
  }),
  jeju: z.object({
    indexerEnabled: z.boolean().default(true),
    indexerUrl: z.string().url().optional(),
    syncIdentities: z.boolean().default(true),
    graphqlEnabled: z.boolean().default(true),
  }),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
  volumeSizeGb: z.number().default(500),
})

// Hubble Service State
export interface HubbleService {
  id: string
  name: string
  namespace: string
  owner: Address
  statefulService: StatefulService
  config: HubbleConfig
  identity: {
    peerId: string | null
    publicKey: Hex | null
  }
  endpoints: {
    grpc: string
    http: string
    gossip: string
  }
  stats: {
    messageCount: number
    fidCount: number
    peersConnected: number
    syncProgress: number
  }
  status: 'creating' | 'syncing' | 'ready' | 'degraded' | 'failed'
  createdAt: number
}

// ============================================================================
// Service Defaults
// ============================================================================

const HUBBLE_IMAGE = 'farcasterxyz/hubble'
const HUBBLE_TAG = '1.14.0'

const DEFAULT_HARDWARE: HardwareSpec = {
  cpuCores: 4,
  cpuArchitecture: 'amd64',
  memoryMb: 8192,
  storageMb: 512000, // 500GB
  storageType: 'nvme',
  gpuType: 'none',
  gpuCount: 0,
  networkBandwidthMbps: 2500,
  publicIp: true, // Needs public IP for gossip
  teePlatform: 'none',
}

// ============================================================================
// Hubble Service Registry
// ============================================================================

const hubbleServices = new Map<string, HubbleService>()

// ============================================================================
// Hubble Provisioner
// ============================================================================

/**
 * Deploy Farcaster Hubble service on DWS
 */
export async function deployHubble(
  owner: Address,
  config: HubbleConfig,
): Promise<HubbleService> {
  const validatedConfig = HubbleConfigSchema.parse(config)

  console.log(
    `[HubbleService] Deploying ${validatedConfig.name} with ${validatedConfig.replicas} hub(s)`,
  )

  // Build hardware spec
  const hardware: HardwareSpec = {
    ...DEFAULT_HARDWARE,
    ...validatedConfig.hardware,
  }

  // Build volume config - Hubble needs lots of storage for RocksDB
  const volumes: VolumeConfig[] = [
    {
      name: 'data',
      sizeMb: validatedConfig.volumeSizeGb * 1024,
      tier: 'nvme',
      mountPath: '/data',
      backup: {
        enabled: true,
        intervalSeconds: 86400, // Daily backups (data grows ~1GB/day)
        retentionCount: 7,
        ipfsPin: true,
      },
    },
  ]

  // Build environment variables
  const env: Record<string, string> = {
    // Ethereum RPC
    ETH_RPC_URL: validatedConfig.ethereum.rpcUrl,
    // Network
    FC_NETWORK: 'mainnet',
    BOOTSTRAP_PEERS: validatedConfig.network.bootstrapPeers.join(','),
    GRPC_PORT: String(validatedConfig.network.grpcPort),
    GOSSIP_PORT: String(validatedConfig.network.gossipPort),
    HTTP_PORT: String(validatedConfig.network.httpPort),
    HTTP_API_ENABLED: String(validatedConfig.network.httpApiEnabled),
    // Database
    ROCKS_DB_PATH: '/data/rocks',
    PRUNE_MESSAGES: String(validatedConfig.database.pruneMessages),
    PRUNE_MESSAGES_DAYS: String(validatedConfig.database.pruneMessagesDays),
    // Sync
    FULL_SYNC: String(validatedConfig.sync.fullSync),
  }

  if (validatedConfig.sync.fids && validatedConfig.sync.fids.length > 0) {
    env.SYNC_FIDS = validatedConfig.sync.fids.join(',')
  }

  // Jeju integration
  if (validatedConfig.jeju.indexerEnabled && validatedConfig.jeju.indexerUrl) {
    env.JEJU_INDEXER_URL = validatedConfig.jeju.indexerUrl
    env.JEJU_SYNC_IDENTITIES = String(validatedConfig.jeju.syncIdentities)
    env.JEJU_GRAPHQL_ENABLED = String(validatedConfig.jeju.graphqlEnabled)
  }

  // Build stateful service config
  const statefulConfig: StatefulServiceConfig = {
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    replicas: validatedConfig.replicas,
    image: HUBBLE_IMAGE,
    tag: HUBBLE_TAG,
    env,
    ports: [
      {
        name: 'grpc',
        containerPort: validatedConfig.network.grpcPort,
        protocol: 'tcp',
      },
      {
        name: 'gossip',
        containerPort: validatedConfig.network.gossipPort,
        protocol: 'tcp',
      },
      {
        name: 'http',
        containerPort: validatedConfig.network.httpPort,
        protocol: 'tcp',
      },
    ],
    hardware,
    volumes,
    healthCheck: {
      path: '/v1/info',
      port: validatedConfig.network.httpPort,
      intervalSeconds: 30,
      timeoutSeconds: 10,
      failureThreshold: 5,
      successThreshold: 1,
    },
    readinessCheck: {
      path: '/v1/info',
      port: validatedConfig.network.httpPort,
      initialDelaySeconds: 60, // Hubble takes time to start
      periodSeconds: 10,
    },
    labels: {
      'dws.service.type': 'hubble',
      'dws.farcaster.network': 'mainnet',
    },
    annotations: {
      'prometheus.io/scrape': 'true',
      'prometheus.io/port': String(validatedConfig.network.httpPort),
      'prometheus.io/path': '/metrics',
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
  const serviceId = `hubble-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Register with service discovery
  const endpoints: ServiceEndpoint[] = statefulService.replicas.map((r) => ({
    ordinal: r.ordinal,
    podName: r.podName,
    ip: extractIp(r.endpoint),
    port: validatedConfig.network.grpcPort,
    nodeId: r.nodeId,
    role: r.role,
    healthy: r.healthStatus === 'healthy',
    weight: 100,
  }))

  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'hubble',
    owner,
    endpoints,
    {
      'farcaster.network': 'mainnet',
      'sync.fullSync': String(validatedConfig.sync.fullSync),
    },
  )

  // Build hubble service object
  const hubbleService: HubbleService = {
    id: serviceId,
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    statefulService,
    config: validatedConfig,
    identity: {
      peerId: null,
      publicKey: null,
    },
    endpoints: {
      grpc: `grpc://${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju:${validatedConfig.network.grpcPort}`,
      http: `http://${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju:${validatedConfig.network.httpPort}`,
      gossip: `tcp://${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju:${validatedConfig.network.gossipPort}`,
    },
    stats: {
      messageCount: 0,
      fidCount: 0,
      peersConnected: 0,
      syncProgress: 0,
    },
    status: 'syncing',
    createdAt: Date.now(),
  }

  hubbleServices.set(serviceId, hubbleService)

  // Start identity discovery in background
  discoverHubbleIdentity(hubbleService).catch(console.error)

  console.log(`[HubbleService] Deployed ${validatedConfig.name}`)

  return hubbleService
}

/**
 * Discover hub identity from running instance
 */
async function discoverHubbleIdentity(service: HubbleService): Promise<void> {
  const replica = service.statefulService.replicas[0]
  if (!replica) return

  // Wait for hub to start
  await new Promise((resolve) => setTimeout(resolve, 30000))

  const infoUrl = `${replica.endpoint}/v1/info`
  const response = await fetch(infoUrl).catch(() => null)

  if (response?.ok) {
    const info = (await response.json()) as {
      peerId: string
      publicKey: string
    }
    service.identity.peerId = info.peerId
    service.identity.publicKey = info.publicKey as Hex
    service.status = 'ready'
  }
}

/**
 * Get hubble service by ID
 */
export function getHubbleService(serviceId: string): HubbleService | null {
  return hubbleServices.get(serviceId) ?? null
}

/**
 * Get hubble service by name
 */
export function getHubbleServiceByName(
  name: string,
  namespace: string = 'default',
): HubbleService | null {
  for (const service of hubbleServices.values()) {
    if (service.name === name && service.namespace === namespace) {
      return service
    }
  }
  return null
}

/**
 * List all hubble services
 */
export function listHubbleServices(owner?: Address): HubbleService[] {
  const services = [...hubbleServices.values()]
  if (owner) {
    return services.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return services
}

/**
 * Scale hubble service
 */
export async function scaleHubble(
  serviceId: string,
  owner: Address,
  replicas: number,
): Promise<void> {
  const service = hubbleServices.get(serviceId)
  if (!service) {
    throw new Error(`Hubble service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to scale this hubble service')
  }

  const statefulProvisioner = getStatefulProvisioner()
  await statefulProvisioner.scale(service.statefulService.id, owner, replicas)

  console.log(`[HubbleService] Scaled ${service.name} to ${replicas} hubs`)
}

/**
 * Terminate hubble service
 */
export async function terminateHubble(
  serviceId: string,
  owner: Address,
): Promise<void> {
  const service = hubbleServices.get(serviceId)
  if (!service) {
    throw new Error(`Hubble service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this hubble service')
  }

  const statefulProvisioner = getStatefulProvisioner()
  await statefulProvisioner.terminate(service.statefulService.id, owner)

  deregisterService(serviceId)
  hubbleServices.delete(serviceId)

  console.log(`[HubbleService] Terminated ${service.name}`)
}

/**
 * Get hubble stats
 */
export async function getHubbleStats(
  serviceId: string,
): Promise<HubbleService['stats']> {
  const service = hubbleServices.get(serviceId)
  if (!service) {
    throw new Error(`Hubble service not found: ${serviceId}`)
  }

  // Get stats from running hub
  const replica = service.statefulService.replicas.find(
    (r) => r.healthStatus === 'healthy',
  )
  if (!replica) {
    return service.stats
  }

  const infoUrl = `${replica.endpoint}/v1/info`
  const response = await fetch(infoUrl).catch(() => null)

  if (response?.ok) {
    const info = (await response.json()) as {
      dbStats: { numMessages: number; numFids: number }
      peersConnected: number
      syncProgress: number
    }
    service.stats = {
      messageCount: info.dbStats?.numMessages ?? 0,
      fidCount: info.dbStats?.numFids ?? 0,
      peersConnected: info.peersConnected ?? 0,
      syncProgress: info.syncProgress ?? 0,
    }
  }

  return service.stats
}

/**
 * Query casts for a FID
 */
export async function queryCastsByFid(
  serviceId: string,
  fid: number,
  limit: number = 100,
): Promise<Array<{ hash: Hex; text: string; timestamp: number }>> {
  const service = hubbleServices.get(serviceId)
  if (!service) {
    throw new Error(`Hubble service not found: ${serviceId}`)
  }

  const replica = service.statefulService.replicas.find(
    (r) => r.healthStatus === 'healthy',
  )
  if (!replica) {
    throw new Error('No healthy hubble replicas')
  }

  const response = await fetch(
    `${replica.endpoint}/v1/castsByFid?fid=${fid}&pageSize=${limit}`,
  )

  if (!response.ok) {
    throw new Error(`Failed to query casts: ${await response.text()}`)
  }

  const result = (await response.json()) as {
    messages: Array<{
      data: { castAddBody?: { text: string } }
      hash: string
      data_timestamp: number
    }>
  }

  return result.messages.map((m) => ({
    hash: m.hash as Hex,
    text: m.data.castAddBody?.text ?? '',
    timestamp: m.data_timestamp,
  }))
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
 * Get default testnet hubble config
 */
export function getTestnetHubbleConfig(): HubbleConfig {
  return {
    name: 'farcaster-hubble',
    namespace: 'default',
    replicas: 1,
    ethereum: {
      rpcUrl: 'https://mainnet.optimism.io',
    },
    network: {
      bootstrapPeers: [
        '/dns/nemes.farcaster.xyz/tcp/2282',
        '/dns/hoyt.farcaster.xyz/tcp/2282',
      ],
      grpcPort: 2283,
      gossipPort: 2282,
      httpPort: 2281,
      httpApiEnabled: true,
    },
    database: {
      pruneMessages: true,
      pruneMessagesDays: 365,
    },
    sync: {
      fullSync: true,
    },
    jeju: {
      indexerEnabled: true,
      indexerUrl: 'http://indexer.jeju.svc.cluster.local:4350/graphql',
      syncIdentities: true,
      graphqlEnabled: true,
    },
    volumeSizeGb: 500,
  }
}
