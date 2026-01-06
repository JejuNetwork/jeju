/**
 * Container Provisioner - Heroku-like container deployment to DWS
 *
 * Provides:
 * - Hardware spec-based provisioning
 * - On-demand container spin-up (no pre-warming needed)
 * - Machine allocation from local/testnet provisioners
 * - Kubernetes/Helm deployment to DWS nodes
 *
 * Architecture:
 *
 * User Request → Provisioner → Hardware Matcher → Node Allocation → Container Deploy
 *                    ↓
 *            Contract Payment (x402)
 *                    ↓
 *            TEE Attestation (if required)
 *                    ↓
 *            Container Running
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'
import * as scheduler from './scheduler'
import type {
  ComputeNode,
  ContainerImage,
  ContainerResources,
  ContainerState,
} from './types'

// Hardware Specification Types

export type GPUType =
  | 'nvidia-a100'
  | 'nvidia-a10g'
  | 'nvidia-t4'
  | 'nvidia-v100'
  | 'nvidia-l4'
  | 'amd-mi250x'
  | 'amd-mi300x'
  | 'none'

export type TEEPlatform =
  | 'intel-sgx'
  | 'intel-tdx'
  | 'amd-sev'
  | 'nvidia-cc'
  | 'none'

export interface HardwareSpec {
  // CPU configuration
  cpuCores: number
  cpuArchitecture: 'amd64' | 'arm64'

  // Memory configuration
  memoryMb: number
  memoryType?: 'standard' | 'high-bandwidth'

  // Storage configuration
  storageMb: number
  storageType: 'ssd' | 'nvme' | 'hdd'
  storageIops?: number

  // GPU configuration
  gpuType: GPUType
  gpuCount: number
  gpuMemoryGb?: number

  // Network configuration
  networkBandwidthMbps: number
  publicIp: boolean

  // TEE configuration
  teePlatform: TEEPlatform
  teeMemoryMb?: number

  // Location preferences
  region?: string
  zones?: string[]
  datacenter?: string
}

export const HardwareSpecSchema = z.object({
  cpuCores: z.number().min(1).max(256),
  cpuArchitecture: z.enum(['amd64', 'arm64']).default('amd64'),
  memoryMb: z
    .number()
    .min(128)
    .max(2048 * 1024), // Up to 2TB
  memoryType: z.enum(['standard', 'high-bandwidth']).optional(),
  storageMb: z
    .number()
    .min(1024)
    .max(100 * 1024 * 1024), // Up to 100TB
  storageType: z.enum(['ssd', 'nvme', 'hdd']).default('ssd'),
  storageIops: z.number().optional(),
  gpuType: z
    .enum([
      'nvidia-a100',
      'nvidia-a10g',
      'nvidia-t4',
      'nvidia-v100',
      'nvidia-l4',
      'amd-mi250x',
      'amd-mi300x',
      'none',
    ])
    .default('none'),
  gpuCount: z.number().min(0).max(8).default(0),
  gpuMemoryGb: z.number().optional(),
  networkBandwidthMbps: z.number().min(100).default(1000),
  publicIp: z.boolean().default(false),
  teePlatform: z
    .enum(['intel-sgx', 'intel-tdx', 'amd-sev', 'nvidia-cc', 'none'])
    .default('none'),
  teeMemoryMb: z.number().optional(),
  region: z.string().optional(),
  zones: z.array(z.string()).optional(),
  datacenter: z.string().optional(),
})

// Container Deployment Configuration

export interface ContainerDeployConfig {
  // Image specification
  image: string
  tag: string
  digest?: string
  registry?: string

  // Container configuration
  command?: string[]
  args?: string[]
  env: Record<string, string>
  secrets?: string[] // Secret names to inject

  // Resource requirements
  hardware: HardwareSpec

  // Scaling configuration
  minReplicas: number
  maxReplicas: number
  scaleToZero: boolean
  cooldownSeconds: number

  // Health check
  healthCheck?: {
    type: 'http' | 'tcp' | 'exec'
    path?: string
    port?: number
    command?: string[]
    intervalSeconds: number
    timeoutSeconds: number
    failureThreshold: number
  }

  // Networking
  ports: Array<{
    containerPort: number
    protocol: 'tcp' | 'udp'
    expose: boolean
  }>
  ingressDomain?: string
  ingressPath?: string

  // Lifecycle
  terminationGracePeriodSeconds: number
  restartPolicy: 'always' | 'on-failure' | 'never'

  // Labels and metadata
  labels: Record<string, string>
  annotations: Record<string, string>
}

export const ContainerDeployConfigSchema = z.object({
  image: z.string().min(1),
  tag: z.string().default('latest'),
  digest: z.string().optional(),
  registry: z.string().optional(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).default({}),
  secrets: z.array(z.string()).optional(),
  hardware: HardwareSpecSchema,
  minReplicas: z.number().min(0).default(1),
  maxReplicas: z.number().min(1).default(10),
  scaleToZero: z.boolean().default(false),
  cooldownSeconds: z.number().default(300),
  healthCheck: z
    .object({
      type: z.enum(['http', 'tcp', 'exec']),
      path: z.string().optional(),
      port: z.number().optional(),
      command: z.array(z.string()).optional(),
      intervalSeconds: z.number().default(30),
      timeoutSeconds: z.number().default(5),
      failureThreshold: z.number().default(3),
    })
    .optional(),
  ports: z.array(
    z.object({
      containerPort: z.number(),
      protocol: z.enum(['tcp', 'udp']).default('tcp'),
      expose: z.boolean().default(false),
    }),
  ),
  ingressDomain: z.string().optional(),
  ingressPath: z.string().optional(),
  terminationGracePeriodSeconds: z.number().default(30),
  restartPolicy: z.enum(['always', 'on-failure', 'never']).default('always'),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
})

// Provisioned Container State

export type ProvisionedContainerStatus =
  | 'pending' // Waiting for node allocation
  | 'allocating' // Finding suitable node
  | 'provisioning' // Setting up on node
  | 'pulling' // Pulling container image
  | 'starting' // Container starting
  | 'running' // Container running
  | 'scaling' // Scaling replicas
  | 'draining' // Draining before stop
  | 'stopped' // Container stopped
  | 'failed' // Failed to provision
  | 'terminated' // Permanently terminated

export interface ProvisionedContainer {
  id: string
  owner: Address
  config: ContainerDeployConfig
  status: ProvisionedContainerStatus
  createdAt: number
  startedAt: number | null
  stoppedAt: number | null

  // Node allocation
  nodeAllocations: NodeAllocation[]
  currentReplicas: number

  // Endpoints
  endpoints: string[]
  internalEndpoint: string | null
  externalEndpoint: string | null

  // Metrics
  metrics: {
    requestCount: number
    errorCount: number
    avgResponseTimeMs: number
    cpuUsagePercent: number
    memoryUsageMb: number
  }

  // Payment
  paymentVault: Address | null
  totalCostWei: bigint
  lastBilledAt: number

  // TEE
  teeAttestation: TEEAttestation | null
}

export interface NodeAllocation {
  nodeId: string
  nodeAddress: Address
  instanceId: string
  state: ContainerState
  allocatedAt: number
  endpoint: string | null
  port: number | null
}

export interface TEEAttestation {
  platform: TEEPlatform
  quote: Hex
  report: Hex
  timestamp: number
  verified: boolean
}

// Machine Types (predefined configurations)

export interface MachineType {
  id: string
  name: string
  description: string
  hardware: HardwareSpec
  pricePerHourWei: bigint
  available: boolean
}

const MACHINE_TYPES: MachineType[] = [
  {
    id: 'micro',
    name: 'Micro',
    description: '1 CPU, 512MB RAM - Development/Testing',
    hardware: {
      cpuCores: 1,
      cpuArchitecture: 'amd64',
      memoryMb: 512,
      storageMb: 10240,
      storageType: 'ssd',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 100,
      publicIp: false,
      teePlatform: 'none',
    },
    pricePerHourWei: 100000000000000n, // 0.0001 ETH
    available: true,
  },
  {
    id: 'small',
    name: 'Small',
    description: '2 CPU, 2GB RAM - Light workloads',
    hardware: {
      cpuCores: 2,
      cpuArchitecture: 'amd64',
      memoryMb: 2048,
      storageMb: 20480,
      storageType: 'ssd',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 500,
      publicIp: false,
      teePlatform: 'none',
    },
    pricePerHourWei: 500000000000000n, // 0.0005 ETH
    available: true,
  },
  {
    id: 'medium',
    name: 'Medium',
    description: '4 CPU, 8GB RAM - Standard workloads',
    hardware: {
      cpuCores: 4,
      cpuArchitecture: 'amd64',
      memoryMb: 8192,
      storageMb: 51200,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 1000,
      publicIp: true,
      teePlatform: 'none',
    },
    pricePerHourWei: 2000000000000000n, // 0.002 ETH
    available: true,
  },
  {
    id: 'large',
    name: 'Large',
    description: '8 CPU, 32GB RAM - Heavy workloads',
    hardware: {
      cpuCores: 8,
      cpuArchitecture: 'amd64',
      memoryMb: 32768,
      storageMb: 102400,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 2500,
      publicIp: true,
      teePlatform: 'none',
    },
    pricePerHourWei: 8000000000000000n, // 0.008 ETH
    available: true,
  },
  {
    id: 'xlarge',
    name: 'XLarge',
    description: '16 CPU, 64GB RAM - Compute-intensive',
    hardware: {
      cpuCores: 16,
      cpuArchitecture: 'amd64',
      memoryMb: 65536,
      storageMb: 204800,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 5000,
      publicIp: true,
      teePlatform: 'none',
    },
    pricePerHourWei: 30000000000000000n, // 0.03 ETH
    available: true,
  },
  {
    id: 'gpu-t4',
    name: 'GPU T4',
    description: '4 CPU, 16GB RAM, 1x NVIDIA T4 - ML Inference',
    hardware: {
      cpuCores: 4,
      cpuArchitecture: 'amd64',
      memoryMb: 16384,
      storageMb: 102400,
      storageType: 'nvme',
      gpuType: 'nvidia-t4',
      gpuCount: 1,
      gpuMemoryGb: 16,
      networkBandwidthMbps: 2500,
      publicIp: true,
      teePlatform: 'none',
    },
    pricePerHourWei: 50000000000000000n, // 0.05 ETH
    available: true,
  },
  {
    id: 'gpu-a10g',
    name: 'GPU A10G',
    description: '8 CPU, 32GB RAM, 1x NVIDIA A10G - ML Training',
    hardware: {
      cpuCores: 8,
      cpuArchitecture: 'amd64',
      memoryMb: 32768,
      storageMb: 204800,
      storageType: 'nvme',
      gpuType: 'nvidia-a10g',
      gpuCount: 1,
      gpuMemoryGb: 24,
      networkBandwidthMbps: 5000,
      publicIp: true,
      teePlatform: 'none',
    },
    pricePerHourWei: 100000000000000000n, // 0.1 ETH
    available: true,
  },
  {
    id: 'gpu-a100',
    name: 'GPU A100',
    description: '16 CPU, 128GB RAM, 1x NVIDIA A100 - Large ML',
    hardware: {
      cpuCores: 16,
      cpuArchitecture: 'amd64',
      memoryMb: 131072,
      storageMb: 512000,
      storageType: 'nvme',
      gpuType: 'nvidia-a100',
      gpuCount: 1,
      gpuMemoryGb: 80,
      networkBandwidthMbps: 10000,
      publicIp: true,
      teePlatform: 'none',
    },
    pricePerHourWei: 500000000000000000n, // 0.5 ETH
    available: true,
  },
  {
    id: 'tee-medium',
    name: 'TEE Medium',
    description: '4 CPU, 8GB RAM, Intel TDX - Secure compute',
    hardware: {
      cpuCores: 4,
      cpuArchitecture: 'amd64',
      memoryMb: 8192,
      storageMb: 51200,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 1000,
      publicIp: true,
      teePlatform: 'intel-tdx',
      teeMemoryMb: 8192,
    },
    pricePerHourWei: 5000000000000000n, // 0.005 ETH
    available: true,
  },
  {
    id: 'tee-large',
    name: 'TEE Large',
    description: '8 CPU, 32GB RAM, Intel TDX - Secure compute',
    hardware: {
      cpuCores: 8,
      cpuArchitecture: 'amd64',
      memoryMb: 32768,
      storageMb: 102400,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 2500,
      publicIp: true,
      teePlatform: 'intel-tdx',
      teeMemoryMb: 32768,
    },
    pricePerHourWei: 20000000000000000n, // 0.02 ETH
    available: true,
  },
  {
    id: 'nitro-db-small',
    name: 'Nitro DB Small',
    description: '4 CPU, 8GB RAM, AWS Nitro Enclave - PostgreSQL Database',
    hardware: {
      cpuCores: 4,
      cpuArchitecture: 'amd64',
      memoryMb: 8192,
      storageMb: 102400,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 1000,
      publicIp: true,
      teePlatform: 'aws-nitro',
      teeMemoryMb: 4096,
    },
    pricePerHourWei: 4250000000000000n, // ~$0.17/hr @ $4000/ETH
    available: true,
  },
  {
    id: 'nitro-db-medium',
    name: 'Nitro DB Medium',
    description: '4 CPU, 16GB RAM, AWS Nitro Enclave - PostgreSQL Database',
    hardware: {
      cpuCores: 4,
      cpuArchitecture: 'amd64',
      memoryMb: 16384,
      storageMb: 204800,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 1000,
      publicIp: true,
      teePlatform: 'aws-nitro',
      teeMemoryMb: 8192,
    },
    pricePerHourWei: 4800000000000000n, // ~$0.192/hr @ $4000/ETH
    available: true,
  },
  {
    id: 'nitro-db-large',
    name: 'Nitro DB Large',
    description: '4 CPU, 32GB RAM, AWS Nitro Enclave - PostgreSQL Database (Memory Optimized)',
    hardware: {
      cpuCores: 4,
      cpuArchitecture: 'amd64',
      memoryMb: 32768,
      storageMb: 409600,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 2500,
      publicIp: true,
      teePlatform: 'aws-nitro',
      teeMemoryMb: 16384,
    },
    pricePerHourWei: 6300000000000000n, // ~$0.252/hr @ $4000/ETH
    available: true,
  },
  {
    id: 'nitro-db-xlarge',
    name: 'Nitro DB XLarge',
    description: '8 CPU, 64GB RAM, AWS Nitro Enclave - PostgreSQL Database (High Performance)',
    hardware: {
      cpuCores: 8,
      cpuArchitecture: 'amd64',
      memoryMb: 65536,
      storageMb: 819200,
      storageType: 'nvme',
      gpuType: 'none',
      gpuCount: 0,
      networkBandwidthMbps: 5000,
      publicIp: true,
      teePlatform: 'aws-nitro',
      teeMemoryMb: 32768,
    },
    pricePerHourWei: 12600000000000000n, // ~$0.504/hr @ $4000/ETH
    available: true,
  },
]

// Provisioner State

const provisionedContainers = new Map<string, ProvisionedContainer>()
const containersByOwner = new Map<Address, Set<string>>()

// Main Provisioner Class

export class ContainerProvisioner {
  getMachineTypes(): MachineType[] {
    return MACHINE_TYPES.filter((mt) => mt.available)
  }

  getMachineType(id: string): MachineType | null {
    return MACHINE_TYPES.find((mt) => mt.id === id) ?? null
  }

  /**
   * Provision a new container with specified hardware requirements
   */
  async provision(
    owner: Address,
    config: ContainerDeployConfig,
  ): Promise<ProvisionedContainer> {
    const containerId = `container-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const now = Date.now()

    // Validate configuration
    const validatedConfig = ContainerDeployConfigSchema.parse(config)

    // Create provisioned container record
    const container: ProvisionedContainer = {
      id: containerId,
      owner,
      config: validatedConfig,
      status: 'pending',
      createdAt: now,
      startedAt: null,
      stoppedAt: null,
      nodeAllocations: [],
      currentReplicas: 0,
      endpoints: [],
      internalEndpoint: null,
      externalEndpoint: null,
      metrics: {
        requestCount: 0,
        errorCount: 0,
        avgResponseTimeMs: 0,
        cpuUsagePercent: 0,
        memoryUsageMb: 0,
      },
      paymentVault: null,
      totalCostWei: 0n,
      lastBilledAt: now,
      teeAttestation: null,
    }

    // Store in state
    provisionedContainers.set(containerId, container)
    const ownerContainers = containersByOwner.get(owner) ?? new Set()
    ownerContainers.add(containerId)
    containersByOwner.set(owner, ownerContainers)

    // Start async provisioning
    this.doProvision(container).catch((err) => {
      console.error(`[Provisioner] Failed to provision ${containerId}:`, err)
      container.status = 'failed'
    })

    return container
  }

  /**
   * Provision from a machine type preset
   */
  async provisionFromMachineType(
    owner: Address,
    machineTypeId: string,
    imageConfig: {
      image: string
      tag?: string
      command?: string[]
      env?: Record<string, string>
      ports?: Array<{
        containerPort: number
        protocol?: 'tcp' | 'udp'
        expose?: boolean
      }>
    },
  ): Promise<ProvisionedContainer> {
    const machineType = this.getMachineType(machineTypeId)
    if (!machineType) {
      throw new Error(`Machine type not found: ${machineTypeId}`)
    }

    const config: ContainerDeployConfig = {
      image: imageConfig.image,
      tag: imageConfig.tag ?? 'latest',
      command: imageConfig.command,
      env: imageConfig.env ?? {},
      hardware: machineType.hardware,
      minReplicas: 1,
      maxReplicas: 10,
      scaleToZero: false,
      cooldownSeconds: 300,
      ports:
        imageConfig.ports?.map((p) => ({
          containerPort: p.containerPort,
          protocol: p.protocol ?? 'tcp',
          expose: p.expose ?? false,
        })) ?? [],
      terminationGracePeriodSeconds: 30,
      restartPolicy: 'always',
      labels: { 'dws.machine-type': machineTypeId },
      annotations: {},
    }

    return this.provision(owner, config)
  }

  /**
   * Scale container replicas
   */
  async scale(
    containerId: string,
    owner: Address,
    replicas: number,
  ): Promise<void> {
    const container = provisionedContainers.get(containerId)
    if (!container) {
      throw new Error(`Container not found: ${containerId}`)
    }

    if (container.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to scale this container')
    }

    if (replicas < 0 || replicas > container.config.maxReplicas) {
      throw new Error(
        `Replicas must be between 0 and ${container.config.maxReplicas}`,
      )
    }

    const currentReplicas = container.currentReplicas
    if (replicas === currentReplicas) {
      return // No change needed
    }

    container.status = 'scaling'

    if (replicas > currentReplicas) {
      // Scale up
      await this.allocateReplicas(container, replicas - currentReplicas)
    } else {
      // Scale down
      await this.deallocateReplicas(container, currentReplicas - replicas)
    }

    container.currentReplicas = replicas
    container.status = replicas === 0 ? 'stopped' : 'running'
  }

  /**
   * Stop a container (scale to 0)
   */
  async stop(containerId: string, owner: Address): Promise<void> {
    const container = provisionedContainers.get(containerId)
    if (!container) {
      throw new Error(`Container not found: ${containerId}`)
    }

    if (container.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to stop this container')
    }

    container.status = 'draining'

    // Deallocate all replicas
    await this.deallocateReplicas(container, container.currentReplicas)

    container.status = 'stopped'
    container.stoppedAt = Date.now()
    container.currentReplicas = 0
    container.endpoints = []
    container.internalEndpoint = null
    container.externalEndpoint = null
  }

  /**
   * Start a stopped container
   */
  async start(containerId: string, owner: Address): Promise<void> {
    const container = provisionedContainers.get(containerId)
    if (!container) {
      throw new Error(`Container not found: ${containerId}`)
    }

    if (container.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to start this container')
    }

    if (container.status !== 'stopped') {
      throw new Error(`Container is not stopped: ${container.status}`)
    }

    await this.doProvision(container)
  }

  /**
   * Terminate a container permanently
   */
  async terminate(containerId: string, owner: Address): Promise<void> {
    const container = provisionedContainers.get(containerId)
    if (!container) {
      throw new Error(`Container not found: ${containerId}`)
    }

    if (container.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to terminate this container')
    }

    // Stop first if running
    if (container.status === 'running' || container.currentReplicas > 0) {
      await this.stop(containerId, owner)
    }

    container.status = 'terminated'

    // Remove from owner's set
    const ownerContainers = containersByOwner.get(owner)
    if (ownerContainers) {
      ownerContainers.delete(containerId)
    }
  }

  /**
   * Get container by ID
   */
  getContainer(containerId: string): ProvisionedContainer | null {
    return provisionedContainers.get(containerId) ?? null
  }

  /**
   * Get containers by owner
   */
  getContainersByOwner(owner: Address): ProvisionedContainer[] {
    const containerIds = containersByOwner.get(owner)
    if (!containerIds) return []

    return [...containerIds]
      .map((id) => provisionedContainers.get(id))
      .filter((c): c is ProvisionedContainer => !!c)
  }

  /**
   * List all containers
   */
  listContainers(filter?: {
    status?: ProvisionedContainerStatus
    owner?: Address
  }): ProvisionedContainer[] {
    let containers = [...provisionedContainers.values()]

    if (filter?.status) {
      containers = containers.filter((c) => c.status === filter.status)
    }

    if (filter?.owner) {
      const ownerLower = filter.owner.toLowerCase()
      containers = containers.filter(
        (c) => c.owner.toLowerCase() === ownerLower,
      )
    }

    return containers
  }

  /**
   * Get provisioner statistics
   */
  getStats(): {
    totalContainers: number
    runningContainers: number
    totalReplicas: number
    machineTypeUsage: Record<string, number>
    gpuUsage: Record<GPUType, number>
    teeUsage: Record<TEEPlatform, number>
  } {
    const containers = [...provisionedContainers.values()]
    const machineTypeUsage: Record<string, number> = {}
    const gpuUsage: Record<GPUType, number> = {
      'nvidia-a100': 0,
      'nvidia-a10g': 0,
      'nvidia-t4': 0,
      'nvidia-v100': 0,
      'nvidia-l4': 0,
      'amd-mi250x': 0,
      'amd-mi300x': 0,
      none: 0,
    }
    const teeUsage: Record<TEEPlatform, number> = {
      'intel-sgx': 0,
      'intel-tdx': 0,
      'amd-sev': 0,
      'nvidia-cc': 0,
      none: 0,
    }

    let totalReplicas = 0

    for (const container of containers) {
      totalReplicas += container.currentReplicas

      const machineType = container.config.labels['dws.machine-type']
      if (machineType) {
        machineTypeUsage[machineType] =
          (machineTypeUsage[machineType] ?? 0) + container.currentReplicas
      }

      gpuUsage[container.config.hardware.gpuType] +=
        container.currentReplicas * container.config.hardware.gpuCount
      teeUsage[container.config.hardware.teePlatform] +=
        container.currentReplicas
    }

    return {
      totalContainers: containers.length,
      runningContainers: containers.filter((c) => c.status === 'running')
        .length,
      totalReplicas,
      machineTypeUsage,
      gpuUsage,
      teeUsage,
    }
  }

  // Private methods

  private async doProvision(container: ProvisionedContainer): Promise<void> {
    console.log(`[Provisioner] Starting provision for ${container.id}`)

    container.status = 'allocating'

    // Find suitable nodes
    const nodes = await this.findSuitableNodes(container.config.hardware)
    if (nodes.length === 0) {
      throw new Error('No suitable nodes found for hardware requirements')
    }

    console.log(
      `[Provisioner] Found ${nodes.length} suitable nodes for ${container.id}`,
    )

    // Allocate initial replicas
    container.status = 'provisioning'
    const replicasToAllocate = container.config.minReplicas || 1
    await this.allocateReplicas(container, replicasToAllocate)

    container.status = 'running'
    container.startedAt = Date.now()
    console.log(`[Provisioner] Container ${container.id} is now running`)
  }

  private async findSuitableNodes(
    hardware: HardwareSpec,
  ): Promise<ComputeNode[]> {
    const allNodes = scheduler.getAllNodes()

    return allNodes.filter((node) => {
      // Check CPU
      if (node.resources.availableCpu < hardware.cpuCores) return false

      // Check memory
      if (node.resources.availableMemoryMb < hardware.memoryMb) return false

      // Check storage
      if (node.resources.availableStorageMb < hardware.storageMb) return false

      // Check GPU
      if (hardware.gpuType !== 'none') {
        if (!node.resources.gpuTypes.includes(hardware.gpuType)) return false
      }

      // Check region
      if (hardware.region && node.region !== hardware.region) return false

      // Check node status
      if (node.status !== 'online') return false

      return true
    })
  }

  private async allocateReplicas(
    container: ProvisionedContainer,
    count: number,
  ): Promise<void> {
    const hardware = container.config.hardware
    const resources: ContainerResources = {
      cpuCores: hardware.cpuCores,
      memoryMb: hardware.memoryMb,
      storageMb: hardware.storageMb,
      gpuType: hardware.gpuType !== 'none' ? hardware.gpuType : undefined,
      gpuCount: hardware.gpuCount,
    }

    // Build image reference
    const imageRef = container.config.registry
      ? `${container.config.registry}/${container.config.image}:${container.config.tag}`
      : `${container.config.image}:${container.config.tag}`

    const image: ContainerImage = {
      repoId: '',
      namespace: 'library',
      name: container.config.image,
      tag: container.config.tag,
      digest: container.config.digest ?? '',
      manifestCid: '',
      layerCids: [],
      size: 0,
      architectures: [hardware.cpuArchitecture],
      publishedAt: Date.now(),
    }

    for (let i = 0; i < count; i++) {
      // Schedule to a node
      const scheduleResult = await scheduler.scheduleExecution(
        {
          request: {
            imageRef,
            command: container.config.command,
            env: container.config.env,
            resources,
            mode: 'dedicated',
            timeout: 0, // No timeout for dedicated containers
          },
          image,
          userAddress: container.owner,
          preferredRegion: hardware.region,
          riskLevel: hardware.teePlatform !== 'none' ? 'high' : 'low',
        },
        'best-fit',
      )

      if (!scheduleResult) {
        throw new Error(`Failed to schedule replica ${i + 1}`)
      }

      const node = scheduler.getNode(scheduleResult.nodeId)
      if (!node) {
        throw new Error(`Node not found: ${scheduleResult.nodeId}`)
      }

      // Reserve resources
      const reservation = scheduler.reserveResources(
        scheduleResult.nodeId,
        resources,
        container.owner,
        86400000, // 24 hour reservation
      )

      if (!reservation) {
        throw new Error(
          `Failed to reserve resources on node ${scheduleResult.nodeId}`,
        )
      }

      // Deploy container on node
      const instanceId = crypto.randomUUID()
      const endpoint = await this.deployToNode(container, node, instanceId)

      // Track allocation
      const allocation: NodeAllocation = {
        nodeId: node.nodeId,
        nodeAddress: node.address,
        instanceId,
        state: 'running',
        allocatedAt: Date.now(),
        endpoint,
        port: this.extractPort(endpoint),
      }

      container.nodeAllocations.push(allocation)
      container.currentReplicas++

      // Update endpoints
      if (endpoint) {
        container.endpoints.push(endpoint)
        if (!container.internalEndpoint) {
          container.internalEndpoint = endpoint
        }
        if (
          hardware.publicIp &&
          container.config.ports.some((p) => p.expose) &&
          !container.externalEndpoint
        ) {
          container.externalEndpoint = endpoint
        }
      }
    }
  }

  private async deallocateReplicas(
    container: ProvisionedContainer,
    count: number,
  ): Promise<void> {
    const toRemove = container.nodeAllocations.slice(-count)

    for (const allocation of toRemove) {
      // Stop container on node
      await this.stopOnNode(allocation.nodeId, allocation.instanceId)

      // Release resources
      const node = scheduler.getNode(allocation.nodeId)
      if (node) {
        scheduler.updateNodeResources(allocation.nodeId, {
          cpu: node.resources.availableCpu + container.config.hardware.cpuCores,
          memoryMb:
            node.resources.availableMemoryMb +
            container.config.hardware.memoryMb,
          storageMb:
            node.resources.availableStorageMb +
            container.config.hardware.storageMb,
        })
      }

      // Remove from endpoints
      if (allocation.endpoint) {
        const endpointIndex = container.endpoints.indexOf(allocation.endpoint)
        if (endpointIndex >= 0) {
          container.endpoints.splice(endpointIndex, 1)
        }
      }
    }

    // Remove allocations
    container.nodeAllocations = container.nodeAllocations.slice(0, -count)
  }

  private async deployToNode(
    container: ProvisionedContainer,
    node: ComputeNode,
    instanceId: string,
  ): Promise<string> {
    console.log(
      `[Provisioner] Deploying ${container.id} to node ${node.nodeId} as ${instanceId}`,
    )

    // Build Docker-compatible container config
    const dockerConfig = {
      Image: `${container.config.image}:${container.config.tag}`,
      Cmd: container.config.command ?? [],
      Env: Object.entries(container.config.env).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        Memory: container.config.hardware.memoryMb * 1024 * 1024,
        NanoCpus: container.config.hardware.cpuCores * 1e9,
        PortBindings: {} as Record<string, Array<{ HostPort: string }>>,
      },
      ExposedPorts: {} as Record<string, Record<string, never>>,
      Labels: {
        'dws.container.id': container.id,
        'dws.instance.id': instanceId,
        'dws.owner': container.owner,
        ...container.config.labels,
      },
    }

    // Configure ports
    for (const portConfig of container.config.ports) {
      const portKey = `${portConfig.containerPort}/${portConfig.protocol}`
      dockerConfig.ExposedPorts[portKey] = {}
      dockerConfig.HostConfig.PortBindings[portKey] = [{ HostPort: '0' }]
    }

    // Send deployment request to node
    const deployResponse = await fetch(
      `${node.endpoint}/v1/containers/create`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dockerConfig),
      },
    )

    if (!deployResponse.ok) {
      const error = await deployResponse.text()
      throw new Error(`Failed to deploy to node: ${error}`)
    }

    const deployResult = (await deployResponse.json()) as { endpoint: string }
    return deployResult.endpoint
  }

  private async stopOnNode(nodeId: string, instanceId: string): Promise<void> {
    const node = scheduler.getNode(nodeId)
    if (!node) return

    console.log(
      `[Provisioner] Stopping instance ${instanceId} on node ${nodeId}`,
    )

    const stopResponse = await fetch(
      `${node.endpoint}/v1/containers/${instanceId}/stop`,
      { method: 'POST' },
    )

    if (!stopResponse.ok && stopResponse.status !== 404) {
      console.error(
        `[Provisioner] Failed to stop instance ${instanceId}:`,
        await stopResponse.text(),
      )
    }
  }

  private extractPort(endpoint: string): number | null {
    const match = endpoint.match(/:(\d+)$/)
    return match ? parseInt(match[1], 10) : null
  }
}

// Singleton

let provisioner: ContainerProvisioner | null = null

export function getContainerProvisioner(): ContainerProvisioner {
  if (!provisioner) {
    provisioner = new ContainerProvisioner()
  }
  return provisioner
}
