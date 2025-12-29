/**
 * Machine Provisioner - Physical/Virtual machine allocation for DWS
 *
 * Handles:
 * - Machine promise registry (available machines that can be allocated)
 * - On-demand machine allocation
 * - Resource tracking and billing
 * - Support for local, testnet, and mainnet environments
 *
 * Architecture:
 *
 * Promise Registry ← Machine Operators register available resources
 *        ↓
 * Allocation Engine ← User requests allocation
 *        ↓
 * Machine Activation ← Machine is configured and activated
 *        ↓
 * Container Runtime ← DWS container/worker deployment
 */

import { getLocalhostHost, getRpcUrl } from '@jejunetwork/config'
import type { Address, Hex } from 'viem'
import { parseEther } from 'viem'
import { z } from 'zod'
import * as scheduler from '../containers/scheduler'
import type { ComputeNode } from '../containers/types'

// Machine Specification Types

export interface MachineCapabilities {
  compute: boolean
  storage: boolean
  cdn: boolean
  tee: boolean
  gpu: boolean
}

export interface MachineSpecs {
  // CPU
  cpuCores: number
  cpuModel: string
  cpuArchitecture: 'amd64' | 'arm64'
  cpuFrequencyMhz: number

  // Memory
  memoryMb: number
  memoryType: 'ddr4' | 'ddr5'
  memoryFrequencyMhz: number

  // Storage
  storageMb: number
  storageType: 'ssd' | 'nvme' | 'hdd'
  storageIops: number

  // Network
  networkBandwidthMbps: number
  networkPublicIps: number

  // GPU
  gpuType: string | null
  gpuCount: number
  gpuMemoryMb: number

  // TEE
  teePlatform: 'intel-sgx' | 'intel-tdx' | 'amd-sev' | 'nvidia-cc' | null
  teeMemoryMb: number

  // Location
  region: string
  zone: string
  datacenter: string
}

export const MachineSpecsSchema = z.object({
  cpuCores: z.number().min(1).max(512),
  cpuModel: z.string(),
  cpuArchitecture: z.enum(['amd64', 'arm64']),
  cpuFrequencyMhz: z.number().min(1000).max(10000),
  memoryMb: z
    .number()
    .min(512)
    .max(4 * 1024 * 1024), // Up to 4TB
  memoryType: z.enum(['ddr4', 'ddr5']),
  memoryFrequencyMhz: z.number().min(1600).max(8000),
  storageMb: z
    .number()
    .min(10240)
    .max(1024 * 1024 * 1024), // Up to 1PB
  storageType: z.enum(['ssd', 'nvme', 'hdd']),
  storageIops: z.number().min(100),
  networkBandwidthMbps: z.number().min(100),
  networkPublicIps: z.number().min(0).max(256),
  gpuType: z.string().nullable(),
  gpuCount: z.number().min(0).max(8),
  gpuMemoryMb: z.number().min(0),
  teePlatform: z
    .enum(['intel-sgx', 'intel-tdx', 'amd-sev', 'nvidia-cc'])
    .nullable(),
  teeMemoryMb: z.number().min(0),
  region: z.string(),
  zone: z.string(),
  datacenter: z.string(),
})

// Machine Promise (available but not yet allocated)

export type MachinePromiseStatus =
  | 'available' // Ready to be allocated
  | 'reserved' // Temporarily reserved for a user
  | 'allocated' // Fully allocated to a user
  | 'draining' // Being drained before release
  | 'offline' // Not available

export interface MachinePromise {
  id: string
  operator: Address
  agentId: bigint | null
  specs: MachineSpecs
  capabilities: MachineCapabilities
  status: MachinePromiseStatus

  // Endpoint for machine activation
  activationEndpoint: string
  sshEndpoint: string | null

  // Pricing
  pricePerHourWei: bigint
  pricePerGbWei: bigint
  minimumHours: number

  // Stake
  stakedWei: bigint

  // Registration
  registeredAt: number
  lastHeartbeatAt: number

  // Current allocation
  allocatedTo: Address | null
  allocationId: string | null
  allocatedAt: number | null
}

// Machine Allocation

export interface MachineAllocation {
  id: string
  promiseId: string
  user: Address
  specs: MachineSpecs
  capabilities: MachineCapabilities

  // Activation state
  status:
    | 'pending'
    | 'activating'
    | 'active'
    | 'failed'
    | 'terminating'
    | 'terminated'
  nodeId: string | null
  endpoint: string | null

  // Billing
  startedAt: number | null
  endedAt: number | null
  totalCostWei: bigint
  lastBilledAt: number

  // Resources in use
  usedCpu: number
  usedMemoryMb: number
  usedStorageMb: number

  // Container count
  containerCount: number
}

// Environment Configuration

export type ProvisionerEnvironment = 'local' | 'testnet' | 'mainnet'

export interface ProvisionerConfig {
  environment: ProvisionerEnvironment
  rpcUrl: string
  registryContract: Address | null
  privateKey: Hex | null
  minStakeWei: bigint
  maxMachinesPerOperator: number
  heartbeatIntervalMs: number
  allocationTimeoutMs: number
}

const getDefaultConfigs = (): Record<
  ProvisionerEnvironment,
  ProvisionerConfig
> => {
  const host = getLocalhostHost()
  return {
    local: {
      environment: 'local',
      rpcUrl: `http://${host}:8545`,
      registryContract: null,
      privateKey: null,
      minStakeWei: 0n,
      maxMachinesPerOperator: 100,
      heartbeatIntervalMs: 30000,
      allocationTimeoutMs: 300000, // 5 minutes
    },
    testnet: {
      environment: 'testnet',
      rpcUrl: getRpcUrl(),
      registryContract: null,
      privateKey: null,
      minStakeWei: parseEther('0.1'),
      maxMachinesPerOperator: 50,
      heartbeatIntervalMs: 60000,
      allocationTimeoutMs: 600000, // 10 minutes
    },
    mainnet: {
      environment: 'mainnet',
      rpcUrl: getRpcUrl(),
      registryContract: null,
      privateKey: null,
      minStakeWei: parseEther('10'),
      maxMachinesPerOperator: 100,
      heartbeatIntervalMs: 60000,
      allocationTimeoutMs: 900000, // 15 minutes
    },
  }
}

const DEFAULT_CONFIGS = getDefaultConfigs()

// Machine Provisioner Class

export class MachineProvisioner {
  private config: ProvisionerConfig

  // State
  private promises = new Map<string, MachinePromise>()
  private allocations = new Map<string, MachineAllocation>()
  private operatorPromises = new Map<Address, Set<string>>()
  private userAllocations = new Map<Address, Set<string>>()

  // Background tasks
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(environment: ProvisionerEnvironment = 'local') {
    this.config = DEFAULT_CONFIGS[environment]
    console.log(`[MachineProvisioner] Initialized for ${environment}`)
  }

  /**
   * Initialize the provisioner
   */
  async initialize(_privateKey?: Hex): Promise<void> {
    // Start background tasks
    this.startBackgroundTasks()

    console.log('[MachineProvisioner] Started background tasks')
  }

  /**
   * Stop the provisioner
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    console.log('[MachineProvisioner] Stopped')
  }

  // ========================================
  // Machine Operator APIs
  // ========================================

  /**
   * Register a machine promise (operator offering resources)
   */
  async registerMachine(
    operator: Address,
    specs: MachineSpecs,
    capabilities: MachineCapabilities,
    pricing: {
      pricePerHourWei: bigint
      pricePerGbWei: bigint
      minimumHours: number
    },
    endpoints: {
      activationEndpoint: string
      sshEndpoint?: string
    },
    stake?: bigint,
  ): Promise<MachinePromise> {
    // Validate specs
    const validatedSpecs = MachineSpecsSchema.parse(specs)

    // Check operator limits
    const operatorMachines = this.operatorPromises.get(operator)
    if (
      operatorMachines &&
      operatorMachines.size >= this.config.maxMachinesPerOperator
    ) {
      throw new Error(
        `Operator has reached maximum machine limit (${this.config.maxMachinesPerOperator})`,
      )
    }

    // Check minimum stake
    const stakeAmount = stake ?? 0n
    if (stakeAmount < this.config.minStakeWei) {
      throw new Error(
        `Minimum stake required: ${this.config.minStakeWei} wei, provided: ${stakeAmount} wei`,
      )
    }

    const promiseId = `machine-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const now = Date.now()

    const promise: MachinePromise = {
      id: promiseId,
      operator,
      agentId: null,
      specs: validatedSpecs,
      capabilities,
      status: 'available',
      activationEndpoint: endpoints.activationEndpoint,
      sshEndpoint: endpoints.sshEndpoint ?? null,
      pricePerHourWei: pricing.pricePerHourWei,
      pricePerGbWei: pricing.pricePerGbWei,
      minimumHours: pricing.minimumHours,
      stakedWei: stakeAmount,
      registeredAt: now,
      lastHeartbeatAt: now,
      allocatedTo: null,
      allocationId: null,
      allocatedAt: null,
    }

    // Store
    this.promises.set(promiseId, promise)
    const machines = this.operatorPromises.get(operator) ?? new Set()
    machines.add(promiseId)
    this.operatorPromises.set(operator, machines)

    // Register with scheduler
    this.registerWithScheduler(promise)

    console.log(
      `[MachineProvisioner] Registered machine ${promiseId} from operator ${operator}`,
    )

    return promise
  }

  /**
   * Update machine heartbeat (operator keeps machine alive)
   */
  async heartbeat(promiseId: string, operator: Address): Promise<boolean> {
    const promise = this.promises.get(promiseId)
    if (!promise) return false

    if (promise.operator.toLowerCase() !== operator.toLowerCase()) {
      throw new Error('Not authorized to heartbeat this machine')
    }

    promise.lastHeartbeatAt = Date.now()
    if (promise.status === 'offline') {
      promise.status = 'available'
    }

    return true
  }

  /**
   * Unregister a machine (operator removing resources)
   */
  async unregisterMachine(promiseId: string, operator: Address): Promise<void> {
    const promise = this.promises.get(promiseId)
    if (!promise) {
      throw new Error(`Machine not found: ${promiseId}`)
    }

    if (promise.operator.toLowerCase() !== operator.toLowerCase()) {
      throw new Error('Not authorized to unregister this machine')
    }

    if (promise.status === 'allocated') {
      throw new Error('Cannot unregister allocated machine')
    }

    // Remove from scheduler
    scheduler.removeNode(promiseId)

    // Remove from state
    const machines = this.operatorPromises.get(operator)
    if (machines) {
      machines.delete(promiseId)
    }
    this.promises.delete(promiseId)

    console.log(`[MachineProvisioner] Unregistered machine ${promiseId}`)
  }

  // ========================================
  // User Allocation APIs
  // ========================================

  /**
   * Allocate a machine for a user
   */
  async allocate(
    user: Address,
    requirements: {
      minCpu: number
      minMemoryMb: number
      minStorageMb: number
      gpuRequired?: boolean
      gpuType?: string
      teeRequired?: boolean
      region?: string
      maxPricePerHourWei?: bigint
    },
  ): Promise<MachineAllocation> {
    // Find suitable machine
    const promise = this.findSuitableMachine(requirements)
    if (!promise) {
      throw new Error('No suitable machine available')
    }

    // Reserve the machine
    if (promise.status !== 'available') {
      throw new Error(
        `Machine ${promise.id} is not available: ${promise.status}`,
      )
    }

    promise.status = 'reserved'

    const allocationId = `alloc-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const now = Date.now()

    const allocation: MachineAllocation = {
      id: allocationId,
      promiseId: promise.id,
      user,
      specs: promise.specs,
      capabilities: promise.capabilities,
      status: 'pending',
      nodeId: null,
      endpoint: null,
      startedAt: null,
      endedAt: null,
      totalCostWei: 0n,
      lastBilledAt: now,
      usedCpu: 0,
      usedMemoryMb: 0,
      usedStorageMb: 0,
      containerCount: 0,
    }

    // Store allocation
    this.allocations.set(allocationId, allocation)
    const userAllocs = this.userAllocations.get(user) ?? new Set()
    userAllocs.add(allocationId)
    this.userAllocations.set(user, userAllocs)

    // Update promise
    promise.allocatedTo = user
    promise.allocationId = allocationId
    promise.allocatedAt = now

    // Start async activation
    this.activateMachine(allocation, promise).catch((err) => {
      console.error(
        `[MachineProvisioner] Activation failed for ${allocationId}:`,
        err,
      )
      allocation.status = 'failed'
      promise.status = 'available'
      promise.allocatedTo = null
      promise.allocationId = null
      promise.allocatedAt = null
    })

    return allocation
  }

  /**
   * Release an allocated machine
   */
  async release(allocationId: string, user: Address): Promise<void> {
    const allocation = this.allocations.get(allocationId)
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`)
    }

    if (allocation.user.toLowerCase() !== user.toLowerCase()) {
      throw new Error('Not authorized to release this allocation')
    }

    if (allocation.status === 'terminated') {
      return // Already released
    }

    allocation.status = 'terminating'

    // Find and release the promise
    const promise = this.promises.get(allocation.promiseId)
    if (promise) {
      promise.status = 'draining'
    }

    // Stop any running containers
    if (allocation.nodeId) {
      // Deactivate on the machine
      await this.deactivateMachine(allocation)
    }

    // Update state
    allocation.status = 'terminated'
    allocation.endedAt = Date.now()

    if (promise) {
      promise.status = 'available'
      promise.allocatedTo = null
      promise.allocationId = null
      promise.allocatedAt = null
    }

    console.log(`[MachineProvisioner] Released allocation ${allocationId}`)
  }

  /**
   * Get allocation by ID
   */
  getAllocation(allocationId: string): MachineAllocation | null {
    return this.allocations.get(allocationId) ?? null
  }

  /**
   * Get allocations for a user
   */
  getUserAllocations(user: Address): MachineAllocation[] {
    const allocationIds = this.userAllocations.get(user)
    if (!allocationIds) return []

    return [...allocationIds]
      .map((id) => this.allocations.get(id))
      .filter((a): a is MachineAllocation => !!a)
  }

  // ========================================
  // Query APIs
  // ========================================

  /**
   * List available machines
   */
  listAvailableMachines(filter?: {
    region?: string
    minCpu?: number
    minMemoryMb?: number
    gpuRequired?: boolean
    teeRequired?: boolean
    maxPricePerHourWei?: bigint
  }): MachinePromise[] {
    let machines = [...this.promises.values()].filter(
      (m) => m.status === 'available',
    )

    if (filter) {
      const {
        region,
        minCpu,
        minMemoryMb,
        gpuRequired,
        teeRequired,
        maxPricePerHourWei,
      } = filter
      if (region) {
        machines = machines.filter((m) => m.specs.region === region)
      }
      if (minCpu) {
        machines = machines.filter((m) => m.specs.cpuCores >= minCpu)
      }
      if (minMemoryMb) {
        machines = machines.filter((m) => m.specs.memoryMb >= minMemoryMb)
      }
      if (gpuRequired) {
        machines = machines.filter(
          (m) => m.capabilities.gpu && m.specs.gpuCount > 0,
        )
      }
      if (teeRequired) {
        machines = machines.filter(
          (m) => m.capabilities.tee && m.specs.teePlatform !== null,
        )
      }
      if (maxPricePerHourWei !== undefined) {
        machines = machines.filter(
          (m) => m.pricePerHourWei <= maxPricePerHourWei,
        )
      }
    }

    return machines
  }

  /**
   * Get machine promise by ID
   */
  getMachine(promiseId: string): MachinePromise | null {
    return this.promises.get(promiseId) ?? null
  }

  /**
   * Get machines by operator
   */
  getOperatorMachines(operator: Address): MachinePromise[] {
    const machineIds = this.operatorPromises.get(operator)
    if (!machineIds) return []

    return [...machineIds]
      .map((id) => this.promises.get(id))
      .filter((m): m is MachinePromise => !!m)
  }

  /**
   * Get provisioner statistics
   */
  getStats(): {
    environment: ProvisionerEnvironment
    totalMachines: number
    availableMachines: number
    allocatedMachines: number
    offlineMachines: number
    totalAllocations: number
    activeAllocations: number
    totalCpuCores: number
    availableCpuCores: number
    totalMemoryMb: number
    availableMemoryMb: number
    totalGpus: number
    availableGpus: number
    regionBreakdown: Record<string, number>
  } {
    const machines = [...this.promises.values()]
    const allocations = [...this.allocations.values()]

    const regionBreakdown: Record<string, number> = {}
    for (const machine of machines) {
      regionBreakdown[machine.specs.region] =
        (regionBreakdown[machine.specs.region] ?? 0) + 1
    }

    const availableMachines = machines.filter((m) => m.status === 'available')

    return {
      environment: this.config.environment,
      totalMachines: machines.length,
      availableMachines: availableMachines.length,
      allocatedMachines: machines.filter((m) => m.status === 'allocated')
        .length,
      offlineMachines: machines.filter((m) => m.status === 'offline').length,
      totalAllocations: allocations.length,
      activeAllocations: allocations.filter((a) => a.status === 'active')
        .length,
      totalCpuCores: machines.reduce((sum, m) => sum + m.specs.cpuCores, 0),
      availableCpuCores: availableMachines.reduce(
        (sum, m) => sum + m.specs.cpuCores,
        0,
      ),
      totalMemoryMb: machines.reduce((sum, m) => sum + m.specs.memoryMb, 0),
      availableMemoryMb: availableMachines.reduce(
        (sum, m) => sum + m.specs.memoryMb,
        0,
      ),
      totalGpus: machines.reduce((sum, m) => sum + m.specs.gpuCount, 0),
      availableGpus: availableMachines.reduce(
        (sum, m) => sum + m.specs.gpuCount,
        0,
      ),
      regionBreakdown,
    }
  }

  // ========================================
  // Private Methods
  // ========================================

  private findSuitableMachine(requirements: {
    minCpu: number
    minMemoryMb: number
    minStorageMb: number
    gpuRequired?: boolean
    gpuType?: string
    teeRequired?: boolean
    region?: string
    maxPricePerHourWei?: bigint
  }): MachinePromise | null {
    const candidates = [...this.promises.values()].filter((promise) => {
      if (promise.status !== 'available') return false

      // Check CPU
      if (promise.specs.cpuCores < requirements.minCpu) return false

      // Check memory
      if (promise.specs.memoryMb < requirements.minMemoryMb) return false

      // Check storage
      if (promise.specs.storageMb < requirements.minStorageMb) return false

      // Check GPU
      if (requirements.gpuRequired) {
        if (!promise.capabilities.gpu || promise.specs.gpuCount === 0)
          return false
        if (
          requirements.gpuType &&
          promise.specs.gpuType !== requirements.gpuType
        ) {
          return false
        }
      }

      // Check TEE
      if (requirements.teeRequired) {
        if (!promise.capabilities.tee || !promise.specs.teePlatform)
          return false
      }

      // Check region
      if (requirements.region && promise.specs.region !== requirements.region) {
        return false
      }

      // Check price
      if (
        requirements.maxPricePerHourWei !== undefined &&
        promise.pricePerHourWei > requirements.maxPricePerHourWei
      ) {
        return false
      }

      return true
    })

    if (candidates.length === 0) return null

    // Sort by best fit (closest to requirements without over-provisioning too much)
    candidates.sort((a, b) => {
      // Prefer exact fit for CPU
      const cpuDiffA = a.specs.cpuCores - requirements.minCpu
      const cpuDiffB = b.specs.cpuCores - requirements.minCpu

      // Lower waste is better
      if (cpuDiffA !== cpuDiffB) return cpuDiffA - cpuDiffB

      // Prefer lower price
      if (a.pricePerHourWei !== b.pricePerHourWei) {
        return Number(a.pricePerHourWei - b.pricePerHourWei)
      }

      // Prefer higher reputation (longer uptime)
      return b.registeredAt - a.registeredAt
    })

    return candidates[0]
  }

  private registerWithScheduler(promise: MachinePromise): void {
    const node: ComputeNode = {
      nodeId: promise.id,
      address: promise.operator,
      endpoint: promise.activationEndpoint,
      region: promise.specs.region,
      zone: promise.specs.zone,
      resources: {
        totalCpu: promise.specs.cpuCores,
        totalMemoryMb: promise.specs.memoryMb,
        totalStorageMb: promise.specs.storageMb,
        availableCpu: promise.specs.cpuCores,
        availableMemoryMb: promise.specs.memoryMb,
        availableStorageMb: promise.specs.storageMb,
        gpuTypes: promise.specs.gpuType ? [promise.specs.gpuType] : [],
      },
      capabilities: Object.entries(promise.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([cap]) => cap),
      containers: new Map(),
      cachedImages: new Set(),
      lastHeartbeat: promise.lastHeartbeatAt,
      status: promise.status === 'available' ? 'online' : 'offline',
      reputation: 50, // Start with neutral reputation
    }

    scheduler.registerNode(node)
  }

  private async activateMachine(
    allocation: MachineAllocation,
    promise: MachinePromise,
  ): Promise<void> {
    console.log(
      `[MachineProvisioner] Activating machine ${promise.id} for allocation ${allocation.id}`,
    )

    allocation.status = 'activating'

    // Call the machine's activation endpoint
    const activationResponse = await fetch(
      `${promise.activationEndpoint}/v1/activate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationId: allocation.id,
          user: allocation.user,
          specs: promise.specs,
        }),
      },
    )

    if (!activationResponse.ok) {
      const error = await activationResponse.text()
      throw new Error(`Activation failed: ${error}`)
    }

    const activationResult = (await activationResponse.json()) as {
      nodeId: string
      endpoint: string
    }

    // Update allocation
    allocation.status = 'active'
    allocation.nodeId = activationResult.nodeId
    allocation.endpoint = activationResult.endpoint
    allocation.startedAt = Date.now()

    // Update promise
    promise.status = 'allocated'

    // Update scheduler
    scheduler.updateNodeStatus(promise.id, 'online')

    console.log(
      `[MachineProvisioner] Machine ${promise.id} activated at ${activationResult.endpoint}`,
    )
  }

  private async deactivateMachine(
    allocation: MachineAllocation,
  ): Promise<void> {
    const promise = this.promises.get(allocation.promiseId)
    if (!promise) return

    console.log(
      `[MachineProvisioner] Deactivating machine ${promise.id} for allocation ${allocation.id}`,
    )

    // Call the machine's deactivation endpoint
    const deactivationResponse = await fetch(
      `${promise.activationEndpoint}/v1/deactivate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationId: allocation.id,
        }),
      },
    )

    if (!deactivationResponse.ok) {
      console.error(
        `[MachineProvisioner] Deactivation failed:`,
        await deactivationResponse.text(),
      )
    }

    // Update scheduler
    scheduler.updateNodeStatus(promise.id, 'draining')
  }

  private startBackgroundTasks(): void {
    // Heartbeat check - mark machines as offline if no heartbeat
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now()
      const timeout = this.config.heartbeatIntervalMs * 3

      for (const promise of this.promises.values()) {
        if (
          promise.status !== 'offline' &&
          now - promise.lastHeartbeatAt > timeout
        ) {
          console.log(
            `[MachineProvisioner] Machine ${promise.id} marked offline (no heartbeat)`,
          )
          promise.status = 'offline'
          scheduler.updateNodeStatus(promise.id, 'offline')
        }
      }
    }, this.config.heartbeatIntervalMs)

    // Allocation cleanup - handle stuck allocations
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()

      for (const allocation of this.allocations.values()) {
        // Clean up stuck pending allocations
        if (
          allocation.status === 'pending' ||
          allocation.status === 'activating'
        ) {
          const promise = this.promises.get(allocation.promiseId)
          if (promise?.allocatedAt) {
            if (now - promise.allocatedAt > this.config.allocationTimeoutMs) {
              console.log(
                `[MachineProvisioner] Allocation ${allocation.id} timed out`,
              )
              allocation.status = 'failed'
              promise.status = 'available'
              promise.allocatedTo = null
              promise.allocationId = null
              promise.allocatedAt = null
            }
          }
        }
      }
    }, 60000) // Check every minute
  }
}

// Singleton per environment

const provisioners = new Map<ProvisionerEnvironment, MachineProvisioner>()

export function getMachineProvisioner(
  environment: ProvisionerEnvironment = 'local',
): MachineProvisioner {
  let provisioner = provisioners.get(environment)
  if (!provisioner) {
    provisioner = new MachineProvisioner(environment)
    provisioners.set(environment, provisioner)
  }
  return provisioner
}

export async function initializeMachineProvisioner(
  environment: ProvisionerEnvironment = 'local',
  privateKey?: Hex,
): Promise<MachineProvisioner> {
  const provisioner = getMachineProvisioner(environment)
  await provisioner.initialize(privateKey)
  return provisioner
}
