/**
 * Jeju Messaging Service Provisioner for DWS
 *
 * Deploys decentralized messaging infrastructure:
 * - Relay nodes for message routing
 * - KMS API for key management
 * - SQLit integration for message storage
 * - Farcaster Hub integration
 *
 * Features:
 * - End-to-end encryption
 * - TEE attestation for relay nodes
 * - On-chain key registry integration
 * - Rate limiting based on stake level
 *
 * Replaces:
 * - packages/deployment/terraform/modules/messaging
 * - packages/deployment/terraform/modules/messaging-gcp
 */

import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type { HardwareSpec } from '../containers/provisioner'
import {
  getStatefulProvisioner,
  type StatefulService,
  type StatefulServiceConfig,
} from '../containers/stateful-provisioner'
import {
  deregisterService,
  registerTypedService,
  type ServiceEndpoint,
} from './discovery'

// ============================================================================
// Types
// ============================================================================

export interface MessagingConfig {
  name: string
  namespace: string
  relay: {
    replicas: number
    port: number
    wsPort: number
  }
  kms: {
    enabled: boolean
    replicas: number
    port: number
  }
  farcaster: {
    hubUrl: string
    syncEnabled: boolean
  }
  sqlit: {
    endpoint: string
  }
  contracts: {
    rpcUrl: string
    keyRegistryAddress: Address | string
    nodeRegistryAddress: Address | string
  }
  hardware?: Partial<HardwareSpec>
}

export const MessagingConfigSchema = z.object({
  name: z.string().default('jeju-messaging'),
  namespace: z.string().default('default'),
  relay: z.object({
    replicas: z.number().min(1).max(20).default(3),
    port: z.number().default(3200),
    wsPort: z.number().default(3201),
  }),
  kms: z.object({
    enabled: z.boolean().default(true),
    replicas: z.number().min(1).max(10).default(3),
    port: z.number().default(3300),
  }),
  farcaster: z.object({
    hubUrl: z.string().default('nemes.farcaster.xyz:2283'),
    syncEnabled: z.boolean().default(true),
  }),
  sqlit: z.object({
    endpoint: z.string().url(),
  }),
  contracts: z.object({
    rpcUrl: z.string().url(),
    keyRegistryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    nodeRegistryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
})

// Messaging Service State
export interface MessagingService {
  id: string
  name: string
  namespace: string
  owner: Address
  components: {
    relay: StatefulService
    kms?: StatefulService
  }
  endpoints: {
    relay: string
    relayWs: string
    kms?: string
  }
  config: MessagingConfig
  stats: {
    messagesRelayed: number
    activeConnections: number
    keysManaged: number
  }
  status: 'creating' | 'ready' | 'degraded' | 'failed'
  createdAt: number
}

// ============================================================================
// Service Defaults
// ============================================================================

const RELAY_IMAGE = 'ghcr.io/jejunetwork/jeju-messaging-relay'
const KMS_IMAGE = 'ghcr.io/jejunetwork/jeju-kms'
const IMAGE_TAG = 'latest'

const DEFAULT_HARDWARE: HardwareSpec = {
  cpuCores: 2,
  cpuArchitecture: 'amd64',
  memoryMb: 1024,
  storageMb: 10240,
  storageType: 'ssd',
  gpuType: 'none',
  gpuCount: 0,
  networkBandwidthMbps: 1000,
  publicIp: false,
  teePlatform: 'none',
}

// ============================================================================
// Messaging Service Registry
// ============================================================================

const messagingServices = new Map<string, MessagingService>()

// ============================================================================
// Messaging Provisioner
// ============================================================================

/**
 * Deploy Jeju Messaging service on DWS
 */
export async function deployMessaging(
  owner: Address,
  config: MessagingConfig,
): Promise<MessagingService> {
  const validatedConfig = MessagingConfigSchema.parse(config)

  console.log(
    `[MessagingService] Deploying ${validatedConfig.name} with ${validatedConfig.relay.replicas} relay nodes`,
  )

  const statefulProvisioner = getStatefulProvisioner()
  const serviceId = `messaging-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Build hardware spec
  const hardware: HardwareSpec = {
    ...DEFAULT_HARDWARE,
    ...validatedConfig.hardware,
  }

  // Common environment
  const commonEnv = {
    JEJU_RPC_URL: validatedConfig.contracts.rpcUrl,
    KEY_REGISTRY_ADDRESS: validatedConfig.contracts.keyRegistryAddress,
    NODE_REGISTRY_ADDRESS: validatedConfig.contracts.nodeRegistryAddress,
    SQLIT_ENDPOINT: validatedConfig.sqlit.endpoint,
    FARCASTER_HUB_URL: validatedConfig.farcaster.hubUrl,
    FARCASTER_SYNC_ENABLED: String(validatedConfig.farcaster.syncEnabled),
  }

  // Deploy Relay service
  const relayConfig: StatefulServiceConfig = {
    name: `${validatedConfig.name}-relay`,
    namespace: validatedConfig.namespace,
    replicas: validatedConfig.relay.replicas,
    image: RELAY_IMAGE,
    tag: IMAGE_TAG,
    env: {
      ...commonEnv,
      RELAY_PORT: String(validatedConfig.relay.port),
      RELAY_WS_PORT: String(validatedConfig.relay.wsPort),
    },
    ports: [
      {
        name: 'http',
        containerPort: validatedConfig.relay.port,
        protocol: 'tcp',
      },
      {
        name: 'ws',
        containerPort: validatedConfig.relay.wsPort,
        protocol: 'tcp',
      },
    ],
    hardware,
    volumes: [],
    healthCheck: {
      path: '/health',
      port: validatedConfig.relay.port,
      intervalSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
      successThreshold: 1,
    },
    labels: {
      'dws.service.type': 'messaging',
      'dws.messaging.component': 'relay',
    },
    annotations: {
      'prometheus.io/scrape': 'true',
      'prometheus.io/port': String(validatedConfig.relay.port),
    },
    terminationGracePeriodSeconds: 30,
  }

  const relayService = await statefulProvisioner.create(owner, relayConfig)

  const components: MessagingService['components'] = { relay: relayService }
  const endpoints: MessagingService['endpoints'] = {
    relay: `http://${validatedConfig.name}-relay.${validatedConfig.namespace}.svc.jeju:${validatedConfig.relay.port}`,
    relayWs: `ws://${validatedConfig.name}-relay.${validatedConfig.namespace}.svc.jeju:${validatedConfig.relay.wsPort}`,
  }

  // Deploy KMS service if enabled
  if (validatedConfig.kms.enabled) {
    const kmsConfig: StatefulServiceConfig = {
      name: `${validatedConfig.name}-kms`,
      namespace: validatedConfig.namespace,
      replicas: validatedConfig.kms.replicas,
      image: KMS_IMAGE,
      tag: IMAGE_TAG,
      env: {
        ...commonEnv,
        KMS_PORT: String(validatedConfig.kms.port),
        TEE_MODE: 'simulated', // Will be 'dstack' or 'phala' in production
      },
      ports: [
        {
          name: 'kms',
          containerPort: validatedConfig.kms.port,
          protocol: 'tcp',
        },
      ],
      hardware: {
        ...hardware,
        teePlatform: 'intel-tdx', // KMS requires TEE
      },
      volumes: [
        {
          name: 'keys',
          sizeMb: 1024,
          tier: 'ssd',
          mountPath: '/keys',
          backup: {
            enabled: true,
            intervalSeconds: 3600,
            retentionCount: 24,
            ipfsPin: true,
          },
        },
      ],
      healthCheck: {
        path: '/health',
        port: validatedConfig.kms.port,
        intervalSeconds: 10,
        timeoutSeconds: 5,
        failureThreshold: 3,
        successThreshold: 1,
      },
      labels: {
        'dws.service.type': 'messaging',
        'dws.messaging.component': 'kms',
      },
      annotations: {},
      terminationGracePeriodSeconds: 60,
    }

    components.kms = await statefulProvisioner.create(owner, kmsConfig)
    endpoints.kms = `http://${validatedConfig.name}-kms.${validatedConfig.namespace}.svc.jeju:${validatedConfig.kms.port}`
  }

  // Register relay with service discovery
  const relayEndpoints: ServiceEndpoint[] = relayService.replicas.map((r) => ({
    ordinal: r.ordinal,
    podName: r.podName,
    ip: extractIp(r.endpoint),
    port: validatedConfig.relay.port,
    nodeId: r.nodeId,
    role: r.role,
    healthy: r.healthStatus === 'healthy',
    weight: 100,
  }))

  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'messaging',
    owner,
    relayEndpoints,
    {
      'messaging.relay.replicas': String(validatedConfig.relay.replicas),
      'messaging.kms.enabled': String(validatedConfig.kms.enabled),
      'messaging.farcaster.syncEnabled': String(
        validatedConfig.farcaster.syncEnabled,
      ),
    },
  )

  // Build messaging service object
  const messagingService: MessagingService = {
    id: serviceId,
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    components,
    endpoints,
    config: validatedConfig,
    stats: {
      messagesRelayed: 0,
      activeConnections: 0,
      keysManaged: 0,
    },
    status: 'ready',
    createdAt: Date.now(),
  }

  messagingServices.set(serviceId, messagingService)

  console.log(`[MessagingService] Deployed ${validatedConfig.name}`)

  return messagingService
}

/**
 * Get messaging service by ID
 */
export function getMessagingService(
  serviceId: string,
): MessagingService | null {
  return messagingServices.get(serviceId) ?? null
}

/**
 * List all messaging services
 */
export function listMessagingServices(owner?: Address): MessagingService[] {
  const services = [...messagingServices.values()]
  if (owner) {
    return services.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return services
}

/**
 * Scale messaging service relay nodes
 */
export async function scaleMessaging(
  serviceId: string,
  owner: Address,
  replicas: number,
): Promise<void> {
  const service = messagingServices.get(serviceId)
  if (!service) {
    throw new Error(`Messaging service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to scale this messaging service')
  }

  const statefulProvisioner = getStatefulProvisioner()
  await statefulProvisioner.scale(service.components.relay.id, owner, replicas)

  console.log(
    `[MessagingService] Scaled ${service.name} to ${replicas} relay nodes`,
  )
}

/**
 * Terminate messaging service
 */
export async function terminateMessaging(
  serviceId: string,
  owner: Address,
): Promise<void> {
  const service = messagingServices.get(serviceId)
  if (!service) {
    throw new Error(`Messaging service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this messaging service')
  }

  const statefulProvisioner = getStatefulProvisioner()

  // Terminate all components
  await statefulProvisioner.terminate(service.components.relay.id, owner)
  if (service.components.kms) {
    await statefulProvisioner.terminate(service.components.kms.id, owner)
  }

  deregisterService(serviceId)
  messagingServices.delete(serviceId)

  console.log(`[MessagingService] Terminated ${service.name}`)
}

/**
 * Get messaging stats
 */
export async function getMessagingStats(
  serviceId: string,
): Promise<MessagingService['stats'] | null> {
  const service = messagingServices.get(serviceId)
  if (!service) {
    return null
  }

  // Get stats from running relay
  const replica = service.components.relay.replicas.find(
    (r) => r.healthStatus === 'healthy',
  )
  if (!replica) {
    return service.stats
  }

  const statsUrl = `${replica.endpoint}/stats`
  const response = await fetch(statsUrl).catch(() => null)

  if (response?.ok) {
    const stats = (await response.json()) as {
      messagesRelayed: number
      activeConnections: number
      keysManaged: number
    }
    service.stats = stats
  }

  return service.stats
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
 * Get default testnet messaging config
 */
export function getTestnetMessagingConfig(): MessagingConfig {
  return {
    name: 'jeju-messaging',
    namespace: 'default',
    relay: {
      replicas: 3,
      port: 3200,
      wsPort: 3201,
    },
    kms: {
      enabled: true,
      replicas: 3,
      port: 3300,
    },
    farcaster: {
      hubUrl: 'nemes.farcaster.xyz:2283',
      syncEnabled: true,
    },
    sqlit: {
      endpoint: 'http://sqlit.default.svc.jeju:8546',
    },
    contracts: {
      rpcUrl: 'https://testnet.jejunetwork.org',
      keyRegistryAddress: '0x0000000000000000000000000000000000000000',
      nodeRegistryAddress: '0x0000000000000000000000000000000000000000',
    },
  }
}
