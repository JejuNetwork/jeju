/**
 * OAuth3 Service Provisioner for DWS
 *
 * Deploys OAuth3 authentication agents as stateful services with:
 * - MPC threshold signing (2-of-3 for testnet)
 * - TEE-backed key storage when available
 * - Integration with DWS KMS for sealed secrets
 * - OAuth provider credential management
 *
 * Replaces: packages/deployment/kubernetes/helm/oauth3
 */

import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type { HardwareSpec, TEEPlatform } from '../containers/provisioner'
import {
  getStatefulProvisioner,
  type MPCConfig,
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

export interface OAuth3Config {
  name: string
  namespace: string
  replicas: number
  chainId: string
  rpcUrl: string
  dwsUrl: string
  jnsGateway: string
  teeMode: 'simulated' | 'dstack' | 'phala'
  mpc: {
    threshold: number
    totalParties: number
  }
  providers: OAuth3Provider[]
  hardware?: Partial<HardwareSpec>
  volumeSizeGb?: number
}

export interface OAuth3Provider {
  type: 'google' | 'github' | 'twitter' | 'discord' | 'farcaster'
  clientId: string
  clientSecret: string
}

export const OAuth3ConfigSchema = z.object({
  name: z.string().min(1).max(63).default('oauth3'),
  namespace: z.string().default('default'),
  replicas: z.number().min(2).max(9).default(3),
  chainId: z.string(),
  rpcUrl: z.string().url(),
  dwsUrl: z.string().url(),
  jnsGateway: z.string().url(),
  teeMode: z.enum(['simulated', 'dstack', 'phala']).default('simulated'),
  mpc: z.object({
    threshold: z.number().min(1),
    totalParties: z.number().min(2),
  }),
  providers: z.array(
    z.object({
      type: z.enum(['google', 'github', 'twitter', 'discord', 'farcaster']),
      clientId: z.string(),
      clientSecret: z.string(),
    }),
  ),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
      teePlatform: z
        .enum(['intel-sgx', 'intel-tdx', 'amd-sev', 'nvidia-cc', 'none'])
        .optional(),
    })
    .optional(),
  volumeSizeGb: z.number().default(10),
})

// OAuth3 Service State
export interface OAuth3Service {
  id: string
  name: string
  namespace: string
  owner: Address
  statefulService: StatefulService
  mpcClusterId: Hex
  thresholdPublicKey: Hex | null
  providers: OAuth3Provider['type'][]
  endpoints: {
    api: string
    mpc: string
  }
  status: 'creating' | 'initializing' | 'ready' | 'failed'
  createdAt: number
}

// ============================================================================
// Service Defaults
// ============================================================================

const OAUTH3_IMAGE = 'ghcr.io/jeju-network/oauth3-agent'
const OAUTH3_TAG = 'latest'
const OAUTH3_API_PORT = 4200
const OAUTH3_MPC_PORT = 4100

const DEFAULT_HARDWARE: HardwareSpec = {
  cpuCores: 1,
  cpuArchitecture: 'amd64',
  memoryMb: 2048,
  storageMb: 10240,
  storageType: 'ssd',
  gpuType: 'none',
  gpuCount: 0,
  networkBandwidthMbps: 1000,
  publicIp: false,
  teePlatform: 'none',
}

// ============================================================================
// OAuth3 Service Registry
// ============================================================================

const oauth3Services = new Map<string, OAuth3Service>()

// ============================================================================
// OAuth3 Provisioner
// ============================================================================

/**
 * Deploy OAuth3 service on DWS
 */
export async function deployOAuth3(
  owner: Address,
  config: OAuth3Config,
): Promise<OAuth3Service> {
  const validatedConfig = OAuth3ConfigSchema.parse(config)

  console.log(
    `[OAuth3Service] Deploying ${validatedConfig.name} with ${validatedConfig.replicas} replicas (MPC ${validatedConfig.mpc.threshold}-of-${validatedConfig.mpc.totalParties})`,
  )

  // Validate MPC config
  if (validatedConfig.mpc.threshold > validatedConfig.mpc.totalParties) {
    throw new Error('MPC threshold cannot exceed total parties')
  }
  if (validatedConfig.mpc.totalParties > validatedConfig.replicas) {
    throw new Error('MPC total parties cannot exceed replica count')
  }

  // Determine TEE platform
  let teePlatform: TEEPlatform = 'none'
  if (validatedConfig.teeMode === 'dstack') {
    teePlatform = 'intel-tdx'
  } else if (validatedConfig.teeMode === 'phala') {
    teePlatform = 'intel-sgx'
  }

  // Build hardware spec
  const hardware: HardwareSpec = {
    ...DEFAULT_HARDWARE,
    teePlatform,
    ...validatedConfig.hardware,
  }

  // Build volume config
  const volumes: VolumeConfig[] = [
    {
      name: 'data',
      sizeMb: validatedConfig.volumeSizeGb * 1024,
      tier: 'ssd',
      mountPath: '/data',
      backup: {
        enabled: true,
        intervalSeconds: 3600, // Hourly backups
        retentionCount: 24,
        ipfsPin: true,
      },
    },
  ]

  // Build MPC config
  const mpcConfig: MPCConfig = {
    enabled: true,
    threshold: validatedConfig.mpc.threshold,
    totalParties: validatedConfig.mpc.totalParties,
    teeRequired: teePlatform !== 'none',
    teePlatform,
    keyRotationIntervalMs: 86400000 * 7, // Weekly key rotation
  }

  // Build environment variables
  const env: Record<string, string> = {
    // Chain configuration
    CHAIN_ID: validatedConfig.chainId,
    JEJU_RPC_URL: validatedConfig.rpcUrl,
    // TEE configuration
    TEE_MODE: validatedConfig.teeMode,
    // Storage configuration
    DWS_URL: validatedConfig.dwsUrl,
    IPFS_API_ENDPOINT: `${validatedConfig.dwsUrl}/storage/api/v0`,
    IPFS_GATEWAY_ENDPOINT: `${validatedConfig.dwsUrl}/storage/ipfs`,
    JNS_GATEWAY: validatedConfig.jnsGateway,
    // Ports
    OAUTH3_PORT: String(OAUTH3_API_PORT),
    MPC_PORT: String(OAUTH3_MPC_PORT),
    // Logging
    LOG_LEVEL: 'info',
  }

  // Add OAuth provider credentials (these should come from KMS in production)
  for (const provider of validatedConfig.providers) {
    const prefix = `OAUTH_${provider.type.toUpperCase()}`
    env[`${prefix}_CLIENT_ID`] = provider.clientId
    env[`${prefix}_CLIENT_SECRET`] = provider.clientSecret
  }

  // Build stateful service config
  const statefulConfig: StatefulServiceConfig = {
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    replicas: validatedConfig.replicas,
    image: OAUTH3_IMAGE,
    tag: OAUTH3_TAG,
    env,
    ports: [
      { name: 'http', containerPort: OAUTH3_API_PORT, protocol: 'tcp' },
      { name: 'mpc', containerPort: OAUTH3_MPC_PORT, protocol: 'tcp' },
    ],
    hardware,
    volumes,
    mpc: mpcConfig,
    healthCheck: {
      path: '/health',
      port: OAUTH3_API_PORT,
      intervalSeconds: 30,
      timeoutSeconds: 10,
      failureThreshold: 3,
      successThreshold: 1,
    },
    readinessCheck: {
      path: '/health',
      port: OAUTH3_API_PORT,
      initialDelaySeconds: 10,
      periodSeconds: 10,
    },
    labels: {
      'dws.service.type': 'oauth3',
      'dws.mpc.enabled': 'true',
      'dws.mpc.threshold': String(mpcConfig.threshold),
    },
    annotations: {},
    terminationGracePeriodSeconds: 30,
  }

  // Create stateful service
  const statefulProvisioner = getStatefulProvisioner()
  const statefulService = await statefulProvisioner.create(
    owner,
    statefulConfig,
  )

  // Generate service ID
  const serviceId = `oauth3-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Register with service discovery
  const endpoints: ServiceEndpoint[] = statefulService.replicas.map((r) => ({
    ordinal: r.ordinal,
    podName: r.podName,
    ip: extractIp(r.endpoint),
    port: OAUTH3_API_PORT,
    nodeId: r.nodeId,
    role: r.role,
    healthy: r.healthStatus === 'healthy',
    weight: 100,
  }))

  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'oauth3',
    owner,
    endpoints,
    {
      'mpc.threshold': String(mpcConfig.threshold),
      'mpc.totalParties': String(mpcConfig.totalParties),
      'tee.mode': validatedConfig.teeMode,
    },
  )

  // Build OAuth3 service object
  const oauth3Service: OAuth3Service = {
    id: serviceId,
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    statefulService,
    mpcClusterId: statefulService.mpcClusterId ?? ('0x' as Hex),
    thresholdPublicKey: statefulService.mpcThresholdPublicKey,
    providers: validatedConfig.providers.map((p) => p.type),
    endpoints: {
      api: `https://${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju`,
      mpc: `http://${validatedConfig.name}.${validatedConfig.namespace}.internal.jeju:${OAUTH3_MPC_PORT}`,
    },
    status: 'ready',
    createdAt: Date.now(),
  }

  oauth3Services.set(serviceId, oauth3Service)

  console.log(
    `[OAuth3Service] Deployed ${validatedConfig.name} with MPC cluster ${statefulService.mpcClusterId?.slice(0, 18)}...`,
  )

  return oauth3Service
}

/**
 * Get OAuth3 service by ID
 */
export function getOAuth3Service(serviceId: string): OAuth3Service | null {
  return oauth3Services.get(serviceId) ?? null
}

/**
 * Get OAuth3 service by name
 */
export function getOAuth3ServiceByName(
  name: string,
  namespace: string = 'default',
): OAuth3Service | null {
  for (const service of oauth3Services.values()) {
    if (service.name === name && service.namespace === namespace) {
      return service
    }
  }
  return null
}

/**
 * List all OAuth3 services for an owner
 */
export function listOAuth3Services(owner?: Address): OAuth3Service[] {
  const services = [...oauth3Services.values()]
  if (owner) {
    return services.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return services
}

/**
 * Scale OAuth3 service
 */
export async function scaleOAuth3(
  serviceId: string,
  owner: Address,
  replicas: number,
): Promise<void> {
  const service = oauth3Services.get(serviceId)
  if (!service) {
    throw new Error(`OAuth3 service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to scale this OAuth3 service')
  }

  // Check MPC constraints
  const mpcTotal = service.statefulService.config.mpc?.totalParties
  if (mpcTotal && replicas < mpcTotal) {
    throw new Error(`Cannot scale below MPC total parties (${mpcTotal})`)
  }

  const statefulProvisioner = getStatefulProvisioner()
  await statefulProvisioner.scale(service.statefulService.id, owner, replicas)

  console.log(`[OAuth3Service] Scaled ${service.name} to ${replicas} replicas`)
}

/**
 * Terminate OAuth3 service
 */
export async function terminateOAuth3(
  serviceId: string,
  owner: Address,
): Promise<void> {
  const service = oauth3Services.get(serviceId)
  if (!service) {
    throw new Error(`OAuth3 service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this OAuth3 service')
  }

  const statefulProvisioner = getStatefulProvisioner()
  await statefulProvisioner.terminate(service.statefulService.id, owner)

  deregisterService(serviceId)
  oauth3Services.delete(serviceId)

  console.log(`[OAuth3Service] Terminated ${service.name}`)
}

/**
 * Request threshold signature from OAuth3 MPC cluster
 */
export async function requestThresholdSignature(
  serviceId: string,
  message: Hex,
): Promise<Hex> {
  const service = oauth3Services.get(serviceId)
  if (!service) {
    throw new Error(`OAuth3 service not found: ${serviceId}`)
  }
  if (service.status !== 'ready') {
    throw new Error(`OAuth3 service is not ready: ${service.status}`)
  }

  // Get leader replica for coordinating signature
  const statefulProvisioner = getStatefulProvisioner()
  const leader = statefulProvisioner.getLeader(service.statefulService.id)
  if (!leader) {
    throw new Error('No leader available for MPC signing')
  }

  // Request signature from MPC cluster
  const response = await fetch(`${leader.endpoint}/mpc/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clusterId: service.mpcClusterId,
      message,
    }),
  })

  if (!response.ok) {
    throw new Error(`MPC signing failed: ${await response.text()}`)
  }

  const result = (await response.json()) as { signature: Hex }
  return result.signature
}

/**
 * Get MPC cluster status
 */
export async function getOAuth3MPCStatus(serviceId: string): Promise<{
  clusterId: Hex
  threshold: number
  totalParties: number
  activeParties: number
  thresholdPublicKey: Hex | null
  ready: boolean
}> {
  const service = oauth3Services.get(serviceId)
  if (!service) {
    throw new Error(`OAuth3 service not found: ${serviceId}`)
  }

  const mpcConfig = service.statefulService.config.mpc
  if (!mpcConfig?.enabled) {
    throw new Error('MPC is not enabled for this OAuth3 service')
  }

  // Count healthy MPC parties
  const activeParties = service.statefulService.replicas.filter(
    (r) => r.status === 'ready' && r.healthStatus === 'healthy',
  ).length

  return {
    clusterId: service.mpcClusterId,
    threshold: mpcConfig.threshold,
    totalParties: mpcConfig.totalParties,
    activeParties,
    thresholdPublicKey: service.thresholdPublicKey,
    ready: activeParties >= mpcConfig.threshold,
  }
}

/**
 * Rotate MPC keys (triggers distributed key generation)
 */
export async function rotateOAuth3MPCKeys(
  serviceId: string,
  owner: Address,
): Promise<Hex> {
  const service = oauth3Services.get(serviceId)
  if (!service) {
    throw new Error(`OAuth3 service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to rotate MPC keys')
  }

  // Get leader to coordinate key rotation
  const statefulProvisioner = getStatefulProvisioner()
  const leader = statefulProvisioner.getLeader(service.statefulService.id)
  if (!leader) {
    throw new Error('No leader available for MPC key rotation')
  }

  // Trigger DKG on the cluster
  const response = await fetch(`${leader.endpoint}/mpc/rotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clusterId: service.mpcClusterId,
    }),
  })

  if (!response.ok) {
    throw new Error(`MPC key rotation failed: ${await response.text()}`)
  }

  const result = (await response.json()) as { newPublicKey: Hex }

  // Update service state
  service.thresholdPublicKey = result.newPublicKey
  service.statefulService.mpcThresholdPublicKey = result.newPublicKey

  console.log(`[OAuth3Service] Rotated MPC keys for ${service.name}`)

  return result.newPublicKey
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
 * Get default testnet OAuth3 config with 2-of-3 MPC
 */
export function getTestnetOAuth3Config(
  providers: OAuth3Provider[],
): OAuth3Config {
  return {
    name: 'oauth3',
    namespace: 'default',
    replicas: 3,
    chainId: '420690',
    rpcUrl: 'https://testnet.jejunetwork.org',
    dwsUrl: 'https://dws.testnet.jejunetwork.org',
    jnsGateway: 'https://jns.testnet.jejunetwork.org',
    teeMode: 'simulated', // Use simulated TEE for testnet
    mpc: {
      threshold: 2, // 2-of-3 as per user request
      totalParties: 3,
    },
    providers,
    volumeSizeGb: 10,
  }
}
