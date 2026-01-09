/**
 * DWS Workers Service Provisioner
 *
 * Deploys lightweight stateless services as DWS Workers:
 * - x402 Facilitator (payment protocol)
 * - RPC Gateway (load balancer with rate limiting)
 * - SQLit Adapter (HTTP API for SQLite)
 *
 * These services are deployed using the container provisioner
 * rather than stateful provisioner since they don't need:
 * - Persistent volumes
 * - Ordered deployment
 * - Consensus/MPC
 *
 * Replaces:
 * - packages/deployment/kubernetes/helm/x402-facilitator
 * - packages/deployment/kubernetes/helm/rpc-gateway
 * - packages/deployment/kubernetes/helm/sqlit-adapter
 */

import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import {
  type ContainerDeployConfig,
  getContainerProvisioner,
  type HardwareSpec,
  type ProvisionedContainer,
} from '../containers/provisioner'
import { deregisterService, registerTypedService } from './discovery'

// ============================================================================
// Types
// ============================================================================

export type WorkerType = 'x402-facilitator' | 'rpc-gateway' | 'sqlit-adapter'

export interface WorkerConfig {
  type: WorkerType
  name: string
  namespace: string
  replicas: number
  env: Record<string, string>
  secrets?: Record<string, string>
  hardware?: Partial<HardwareSpec>
}

// x402 Facilitator Config
export interface X402FacilitatorConfig extends Omit<WorkerConfig, 'type'> {
  primaryNetwork: string
  facilitatorAddress: Address
}

// RPC Gateway Config
export interface RPCGatewayConfig extends Omit<WorkerConfig, 'type'> {
  backend: {
    rpcService: string
    rpcPort: number
    wsPort: number
  }
  rateLimit: {
    enabled: boolean
    requestsPerSecond: number
    requestsPerMinute: number
    burstSize: number
    maxConnectionsPerIp: number
  }
}

// SQLit Adapter Config
export interface SQLitAdapterConfig extends Omit<WorkerConfig, 'type'> {
  dataDir: string
  volumeSizeGb: number
}

// Worker Service State
export interface WorkerService {
  id: string
  type: WorkerType
  name: string
  namespace: string
  owner: Address
  container: ProvisionedContainer
  endpoints: string[]
  status: 'creating' | 'running' | 'scaling' | 'failed' | 'terminated'
  createdAt: number
}

// ============================================================================
// Validation Schemas
// ============================================================================

export const X402FacilitatorConfigSchema = z.object({
  name: z.string().default('x402-facilitator'),
  namespace: z.string().default('default'),
  replicas: z.number().min(1).max(10).default(2),
  primaryNetwork: z.string().default('jeju'),
  facilitatorAddress: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  secrets: z.record(z.string(), z.string()).optional(),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
})

export const RPCGatewayConfigSchema = z.object({
  name: z.string().default('rpc-gateway'),
  namespace: z.string().default('default'),
  replicas: z.number().min(1).max(20).default(3),
  backend: z.object({
    rpcService: z.string().default('reth-rpc'),
    rpcPort: z.number().default(8545),
    wsPort: z.number().default(8546),
  }),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    requestsPerSecond: z.number().default(100),
    requestsPerMinute: z.number().default(5000),
    burstSize: z.number().default(200),
    maxConnectionsPerIp: z.number().default(10),
  }),
  env: z.record(z.string(), z.string()).default({}),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
})

export const SQLitAdapterConfigSchema = z.object({
  name: z.string().default('sqlit-adapter'),
  namespace: z.string().default('default'),
  replicas: z.number().min(1).max(5).default(1),
  dataDir: z.string().default('/data/sqlit/databases'),
  volumeSizeGb: z.number().default(50),
  env: z.record(z.string(), z.string()).default({}),
  hardware: z
    .object({
      cpuCores: z.number().optional(),
      memoryMb: z.number().optional(),
    })
    .optional(),
})

// ============================================================================
// Service Defaults
// ============================================================================

const X402_IMAGE = 'ghcr.io/jejunetwork/x402-facilitator'
const X402_TAG = 'latest'
const X402_PORT = 3402

const RPC_GATEWAY_IMAGE = 'ghcr.io/jejunetwork/rpc-gateway'
const RPC_GATEWAY_TAG = 'latest'
const RPC_HTTP_PORT = 8080
const RPC_WS_PORT = 8546
const RPC_METRICS_PORT = 9113

const SQLIT_ADAPTER_IMAGE = 'ghcr.io/jejunetwork/sqlit-adapter'
const SQLIT_ADAPTER_TAG = 'latest'
const SQLIT_PORT = 8546

// ============================================================================
// Worker Service Registry
// ============================================================================

const workerServices = new Map<string, WorkerService>()

// ============================================================================
// x402 Facilitator
// ============================================================================

/**
 * Deploy x402 Facilitator on DWS
 */
export async function deployX402Facilitator(
  owner: Address,
  config: X402FacilitatorConfig,
): Promise<WorkerService> {
  const validatedConfig = X402FacilitatorConfigSchema.parse(config)

  console.log(
    `[WorkerService] Deploying x402-facilitator ${validatedConfig.name} with ${validatedConfig.replicas} replicas`,
  )

  const hardware: HardwareSpec = {
    cpuCores: 1,
    cpuArchitecture: 'amd64',
    memoryMb: 512,
    storageMb: 1024,
    storageType: 'ssd',
    gpuType: 'none',
    gpuCount: 0,
    networkBandwidthMbps: 1000,
    publicIp: false,
    teePlatform: 'none',
    ...validatedConfig.hardware,
  }

  const env: Record<string, string> = {
    X402_PRIMARY_NETWORK: validatedConfig.primaryNetwork,
    X402_FACILITATOR_ADDRESS: validatedConfig.facilitatorAddress,
    NODE_ENV: 'production',
    PORT: String(X402_PORT),
    ...validatedConfig.env,
  }

  const containerConfig: ContainerDeployConfig = {
    image: X402_IMAGE,
    tag: X402_TAG,
    env,
    hardware,
    minReplicas: validatedConfig.replicas,
    maxReplicas: validatedConfig.replicas * 2,
    scaleToZero: false,
    cooldownSeconds: 300,
    healthCheck: {
      type: 'http',
      path: '/health',
      port: X402_PORT,
      intervalSeconds: 30,
      timeoutSeconds: 10,
      failureThreshold: 3,
    },
    ports: [{ containerPort: X402_PORT, protocol: 'tcp', expose: true }],
    terminationGracePeriodSeconds: 30,
    restartPolicy: 'always',
    labels: {
      'dws.service.type': 'x402-facilitator',
      'dws.worker.type': 'stateless',
    },
    annotations: {},
  }

  const provisioner = getContainerProvisioner()
  const container = await provisioner.provision(owner, containerConfig)

  const serviceId = `x402-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Register with service discovery
  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'oracle', // x402 is a payment oracle
    owner,
    container.nodeAllocations.map((a, i) => ({
      ordinal: i,
      podName: `${validatedConfig.name}-${i}`,
      ip: extractIp(a.endpoint ?? ''),
      port: X402_PORT,
      nodeId: a.nodeId,
      role: 'worker' as const,
      healthy: a.state === 'running',
      weight: 100,
    })),
    { 'x402.network': validatedConfig.primaryNetwork },
  )

  const workerService: WorkerService = {
    id: serviceId,
    type: 'x402-facilitator',
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    container,
    endpoints: container.endpoints,
    status: 'running',
    createdAt: Date.now(),
  }

  workerServices.set(serviceId, workerService)

  console.log(
    `[WorkerService] Deployed x402-facilitator ${validatedConfig.name}`,
  )

  return workerService
}

// ============================================================================
// RPC Gateway
// ============================================================================

/**
 * Deploy RPC Gateway on DWS
 */
export async function deployRPCGateway(
  owner: Address,
  config: RPCGatewayConfig,
): Promise<WorkerService> {
  const validatedConfig = RPCGatewayConfigSchema.parse(config)

  console.log(
    `[WorkerService] Deploying rpc-gateway ${validatedConfig.name} with ${validatedConfig.replicas} replicas`,
  )

  const hardware: HardwareSpec = {
    cpuCores: 2,
    cpuArchitecture: 'amd64',
    memoryMb: 2048,
    storageMb: 1024,
    storageType: 'ssd',
    gpuType: 'none',
    gpuCount: 0,
    networkBandwidthMbps: 2500,
    publicIp: true,
    teePlatform: 'none',
    ...validatedConfig.hardware,
  }

  const env: Record<string, string> = {
    // Backend configuration
    BACKEND_RPC_SERVICE: validatedConfig.backend.rpcService,
    BACKEND_RPC_PORT: String(validatedConfig.backend.rpcPort),
    BACKEND_WS_PORT: String(validatedConfig.backend.wsPort),
    // Rate limiting
    RATE_LIMIT_ENABLED: String(validatedConfig.rateLimit.enabled),
    RATE_LIMIT_RPS: String(validatedConfig.rateLimit.requestsPerSecond),
    RATE_LIMIT_RPM: String(validatedConfig.rateLimit.requestsPerMinute),
    RATE_LIMIT_BURST: String(validatedConfig.rateLimit.burstSize),
    RATE_LIMIT_MAX_CONN: String(validatedConfig.rateLimit.maxConnectionsPerIp),
    // Ports
    HTTP_PORT: String(RPC_HTTP_PORT),
    WS_PORT: String(RPC_WS_PORT),
    METRICS_PORT: String(RPC_METRICS_PORT),
    ...validatedConfig.env,
  }

  const containerConfig: ContainerDeployConfig = {
    image: RPC_GATEWAY_IMAGE,
    tag: RPC_GATEWAY_TAG,
    env,
    hardware,
    minReplicas: validatedConfig.replicas,
    maxReplicas: 20,
    scaleToZero: false,
    cooldownSeconds: 60,
    healthCheck: {
      type: 'http',
      path: '/health',
      port: RPC_HTTP_PORT,
      intervalSeconds: 15,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    ports: [
      { containerPort: RPC_HTTP_PORT, protocol: 'tcp', expose: true },
      { containerPort: RPC_WS_PORT, protocol: 'tcp', expose: true },
      { containerPort: RPC_METRICS_PORT, protocol: 'tcp', expose: false },
    ],
    terminationGracePeriodSeconds: 30,
    restartPolicy: 'always',
    labels: {
      'dws.service.type': 'rpc-gateway',
      'dws.worker.type': 'stateless',
    },
    annotations: {
      'prometheus.io/scrape': 'true',
      'prometheus.io/port': String(RPC_METRICS_PORT),
    },
  }

  const provisioner = getContainerProvisioner()
  const container = await provisioner.provision(owner, containerConfig)

  const serviceId = `rpc-gw-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Register with service discovery
  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'rpc-gateway',
    owner,
    container.nodeAllocations.map((a, i) => ({
      ordinal: i,
      podName: `${validatedConfig.name}-${i}`,
      ip: extractIp(a.endpoint ?? ''),
      port: RPC_HTTP_PORT,
      nodeId: a.nodeId,
      role: 'worker' as const,
      healthy: a.state === 'running',
      weight: 100,
    })),
    { 'rpc.backend': validatedConfig.backend.rpcService },
  )

  const workerService: WorkerService = {
    id: serviceId,
    type: 'rpc-gateway',
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    container,
    endpoints: container.endpoints,
    status: 'running',
    createdAt: Date.now(),
  }

  workerServices.set(serviceId, workerService)

  console.log(`[WorkerService] Deployed rpc-gateway ${validatedConfig.name}`)

  return workerService
}

// ============================================================================
// SQLit Adapter
// ============================================================================

/**
 * Deploy SQLit Adapter on DWS
 * Note: This is a lightweight HTTP adapter, not the full SQLit cluster
 */
export async function deploySQLitAdapter(
  owner: Address,
  config: SQLitAdapterConfig,
): Promise<WorkerService> {
  const validatedConfig = SQLitAdapterConfigSchema.parse(config)

  console.log(
    `[WorkerService] Deploying sqlit-adapter ${validatedConfig.name} with ${validatedConfig.replicas} replicas`,
  )

  const hardware: HardwareSpec = {
    cpuCores: 1,
    cpuArchitecture: 'amd64',
    memoryMb: 2048,
    storageMb: validatedConfig.volumeSizeGb * 1024,
    storageType: 'ssd',
    gpuType: 'none',
    gpuCount: 0,
    networkBandwidthMbps: 1000,
    publicIp: false,
    teePlatform: 'none',
    ...validatedConfig.hardware,
  }

  const env: Record<string, string> = {
    PORT: String(SQLIT_PORT),
    DATA_DIR: validatedConfig.dataDir,
    LOG_LEVEL: 'info',
    ...validatedConfig.env,
  }

  const containerConfig: ContainerDeployConfig = {
    image: SQLIT_ADAPTER_IMAGE,
    tag: SQLIT_ADAPTER_TAG,
    env,
    hardware,
    minReplicas: validatedConfig.replicas,
    maxReplicas: validatedConfig.replicas * 2,
    scaleToZero: false,
    cooldownSeconds: 300,
    healthCheck: {
      type: 'http',
      path: '/v1/status',
      port: SQLIT_PORT,
      intervalSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    ports: [{ containerPort: SQLIT_PORT, protocol: 'tcp', expose: true }],
    terminationGracePeriodSeconds: 30,
    restartPolicy: 'always',
    labels: {
      'dws.service.type': 'sqlit-adapter',
      'dws.worker.type': 'stateless',
    },
    annotations: {
      'prometheus.io/scrape': 'true',
      'prometheus.io/port': String(SQLIT_PORT),
      'prometheus.io/path': '/v1/status',
    },
  }

  const provisioner = getContainerProvisioner()
  const container = await provisioner.provision(owner, containerConfig)

  const serviceId = `sqlit-${keccak256(toBytes(`${validatedConfig.name}-${owner}-${Date.now()}`)).slice(2, 18)}`

  // Register with service discovery
  registerTypedService(
    serviceId,
    validatedConfig.name,
    validatedConfig.namespace,
    'sqlit',
    owner,
    container.nodeAllocations.map((a, i) => ({
      ordinal: i,
      podName: `${validatedConfig.name}-${i}`,
      ip: extractIp(a.endpoint ?? ''),
      port: SQLIT_PORT,
      nodeId: a.nodeId,
      role: 'worker' as const,
      healthy: a.state === 'running',
      weight: 100,
    })),
    { 'sqlit.dataDir': validatedConfig.dataDir },
  )

  const workerService: WorkerService = {
    id: serviceId,
    type: 'sqlit-adapter',
    name: validatedConfig.name,
    namespace: validatedConfig.namespace,
    owner,
    container,
    endpoints: container.endpoints,
    status: 'running',
    createdAt: Date.now(),
  }

  workerServices.set(serviceId, workerService)

  console.log(`[WorkerService] Deployed sqlit-adapter ${validatedConfig.name}`)

  return workerService
}

// ============================================================================
// Common Operations
// ============================================================================

/**
 * Get worker service by ID
 */
export function getWorkerService(serviceId: string): WorkerService | null {
  return workerServices.get(serviceId) ?? null
}

/**
 * List all worker services
 */
export function listWorkerServices(
  owner?: Address,
  type?: WorkerType,
): WorkerService[] {
  let services = [...workerServices.values()]

  if (owner) {
    services = services.filter(
      (s) => s.owner.toLowerCase() === owner.toLowerCase(),
    )
  }

  if (type) {
    services = services.filter((s) => s.type === type)
  }

  return services
}

/**
 * Scale worker service
 */
export async function scaleWorker(
  serviceId: string,
  owner: Address,
  replicas: number,
): Promise<void> {
  const service = workerServices.get(serviceId)
  if (!service) {
    throw new Error(`Worker service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to scale this worker service')
  }

  service.status = 'scaling'

  const provisioner = getContainerProvisioner()
  await provisioner.scale(service.container.id, owner, replicas)

  service.status = 'running'

  console.log(`[WorkerService] Scaled ${service.name} to ${replicas} replicas`)
}

/**
 * Terminate worker service
 */
export async function terminateWorker(
  serviceId: string,
  owner: Address,
): Promise<void> {
  const service = workerServices.get(serviceId)
  if (!service) {
    throw new Error(`Worker service not found: ${serviceId}`)
  }
  if (service.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized to terminate this worker service')
  }

  const provisioner = getContainerProvisioner()
  await provisioner.terminate(service.container.id, owner)

  deregisterService(serviceId)
  workerServices.delete(serviceId)

  service.status = 'terminated'

  console.log(`[WorkerService] Terminated ${service.name}`)
}

// ============================================================================
// Helpers
// ============================================================================

function extractIp(endpoint: string): string {
  const match = endpoint.match(/https?:\/\/([^:]+)/)
  return match ? match[1] : '127.0.0.1'
}

// ============================================================================
// Default Testnet Configurations
// ============================================================================

/**
 * Get default testnet x402 facilitator config
 */
export function getTestnetX402Config(): X402FacilitatorConfig {
  return {
    name: 'x402-facilitator',
    namespace: 'default',
    replicas: 2,
    primaryNetwork: 'jeju',
    facilitatorAddress: '0x0000000000000000000000000000000000000000' as Address,
    env: {},
  }
}

/**
 * Get default testnet RPC gateway config
 */
export function getTestnetRPCGatewayConfig(): RPCGatewayConfig {
  return {
    name: 'rpc-gateway',
    namespace: 'default',
    replicas: 3,
    backend: {
      rpcService: 'reth-rpc',
      rpcPort: 8545,
      wsPort: 8546,
    },
    rateLimit: {
      enabled: true,
      requestsPerSecond: 100,
      requestsPerMinute: 5000,
      burstSize: 200,
      maxConnectionsPerIp: 10,
    },
    env: {},
  }
}

/**
 * Get default testnet SQLit adapter config
 */
export function getTestnetSQLitAdapterConfig(): SQLitAdapterConfig {
  return {
    name: 'sqlit-adapter',
    namespace: 'default',
    replicas: 1,
    dataDir: '/data/sqlit/databases',
    volumeSizeGb: 50,
    env: {},
  }
}
