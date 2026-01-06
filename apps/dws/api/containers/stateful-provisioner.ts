/**
 * StatefulProvisioner - Manages replicated stateful services on DWS
 *
 * Provides:
 * - Ordered replica creation with stable network identities
 * - Persistent volume management backed by local SSD + IPFS replication
 * - Leader election and consensus coordination
 * - MPC cluster management for threshold signing
 * - Internal JNS-based service discovery
 *
 * Replaces K8s StatefulSets for:
 * - SQLit (block producers + miners)
 * - OAuth3 (MPC-enabled auth)
 * - Postgres (HA with streaming replication)
 * - Farcaster Hubble (P2P sync)
 */

import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import type { HardwareSpec, TEEPlatform } from './provisioner'
import * as scheduler from './scheduler'
import type { ComputeNode } from './types'

// ============================================================================
// Types
// ============================================================================

export type ConsensusProtocol = 'raft' | 'paxos' | 'sqlit' | 'none'
export type VolumeStorageTier = 'ssd' | 'nvme' | 'ipfs-backed'
export type ReplicaRole = 'leader' | 'follower' | 'candidate' | 'mpc-party'

export interface VolumeConfig {
  name: string
  sizeMb: number
  tier: VolumeStorageTier
  mountPath: string
  backup: {
    enabled: boolean
    intervalSeconds: number
    retentionCount: number
    ipfsPin: boolean
  }
}

export interface ConsensusConfig {
  protocol: ConsensusProtocol
  minQuorum: number
  electionTimeoutMs: number
  heartbeatIntervalMs: number
  snapshotThreshold: number
}

export interface MPCConfig {
  enabled: boolean
  threshold: number
  totalParties: number
  teeRequired: boolean
  teePlatform: TEEPlatform
  keyRotationIntervalMs: number
}

export interface StatefulServiceConfig {
  name: string
  namespace: string
  replicas: number
  image: string
  tag: string
  command?: string[]
  args?: string[]
  env: Record<string, string>
  ports: Array<{
    name: string
    containerPort: number
    protocol: 'tcp' | 'udp'
  }>
  hardware: HardwareSpec
  volumes: VolumeConfig[]
  consensus?: ConsensusConfig
  mpc?: MPCConfig
  healthCheck: {
    path: string
    port: number
    intervalSeconds: number
    timeoutSeconds: number
    failureThreshold: number
    successThreshold: number
  }
  readinessCheck?: {
    path: string
    port: number
    initialDelaySeconds: number
    periodSeconds: number
  }
  labels: Record<string, string>
  annotations: Record<string, string>
  terminationGracePeriodSeconds: number
}

export const StatefulServiceConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  namespace: z.string().default('default'),
  replicas: z.number().min(1).max(100),
  image: z.string().min(1),
  tag: z.string().default('latest'),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).default({}),
  ports: z.array(
    z.object({
      name: z.string(),
      containerPort: z.number(),
      protocol: z.enum(['tcp', 'udp']).default('tcp'),
    }),
  ),
  hardware: z.object({
    cpuCores: z.number().min(1),
    cpuArchitecture: z.enum(['amd64', 'arm64']).default('amd64'),
    memoryMb: z.number().min(128),
    storageMb: z.number().min(1024),
    storageType: z.enum(['ssd', 'nvme', 'hdd']).default('ssd'),
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
    gpuCount: z.number().default(0),
    networkBandwidthMbps: z.number().default(1000),
    publicIp: z.boolean().default(false),
    teePlatform: z
      .enum(['intel-sgx', 'intel-tdx', 'amd-sev', 'nvidia-cc', 'none'])
      .default('none'),
    region: z.string().optional(),
  }),
  volumes: z.array(
    z.object({
      name: z.string(),
      sizeMb: z.number().min(100),
      tier: z.enum(['ssd', 'nvme', 'ipfs-backed']),
      mountPath: z.string(),
      backup: z.object({
        enabled: z.boolean(),
        intervalSeconds: z.number(),
        retentionCount: z.number(),
        ipfsPin: z.boolean(),
      }),
    }),
  ),
  consensus: z
    .object({
      protocol: z.enum(['raft', 'paxos', 'sqlit', 'none']),
      minQuorum: z.number().min(1),
      electionTimeoutMs: z.number().default(5000),
      heartbeatIntervalMs: z.number().default(500),
      snapshotThreshold: z.number().default(10000),
    })
    .optional(),
  mpc: z
    .object({
      enabled: z.boolean(),
      threshold: z.number().min(1),
      totalParties: z.number().min(2),
      teeRequired: z.boolean(),
      teePlatform: z.enum([
        'intel-sgx',
        'intel-tdx',
        'amd-sev',
        'nvidia-cc',
        'none',
      ]),
      keyRotationIntervalMs: z.number().default(86400000),
    })
    .optional(),
  healthCheck: z.object({
    path: z.string(),
    port: z.number(),
    intervalSeconds: z.number().default(10),
    timeoutSeconds: z.number().default(5),
    failureThreshold: z.number().default(3),
    successThreshold: z.number().default(1),
  }),
  readinessCheck: z
    .object({
      path: z.string(),
      port: z.number(),
      initialDelaySeconds: z.number().default(5),
      periodSeconds: z.number().default(5),
    })
    .optional(),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
  terminationGracePeriodSeconds: z.number().default(30),
})

// Replica state
export interface StatefulReplica {
  ordinal: number
  podName: string
  nodeId: string
  nodeAddress: Address
  instanceId: string
  status:
    | 'pending'
    | 'provisioning'
    | 'running'
    | 'ready'
    | 'failed'
    | 'terminating'
  role: ReplicaRole
  endpoint: string
  internalDns: string
  volumeBindings: Array<{
    name: string
    nodeLocalPath: string
    ipfsCid: string | null
    lastBackup: number | null
  }>
  createdAt: number
  becameReadyAt: number | null
  lastHealthCheck: number
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
  mpcPartyId: number | null
  mpcPublicKey: Hex | null
}

// Full stateful service state
export interface StatefulService {
  id: string
  owner: Address
  config: StatefulServiceConfig
  status:
    | 'creating'
    | 'running'
    | 'updating'
    | 'scaling'
    | 'failed'
    | 'terminated'
  replicas: StatefulReplica[]
  currentLeader: number | null
  createdAt: number
  updatedAt: number
  generation: number
  // Service discovery
  headlessEndpoint: string
  clusterEndpoint: string
  // MPC state
  mpcClusterId: Hex | null
  mpcThresholdPublicKey: Hex | null
  // Consensus state
  consensusEpoch: number
  lastElectionAt: number | null
}

// ============================================================================
// State Storage
// ============================================================================

const statefulServices = new Map<string, StatefulService>()
const servicesByOwner = new Map<Address, Set<string>>()
const servicesByName = new Map<string, string>() // name -> serviceId

// ============================================================================
// StatefulProvisioner Implementation
// ============================================================================

export class StatefulProvisioner {
  private healthCheckIntervals = new Map<
    string,
    ReturnType<typeof setInterval>
  >()
  private backupIntervals = new Map<string, ReturnType<typeof setInterval>>()

  /**
   * Create a new stateful service with ordered replica provisioning
   */
  async create(
    owner: Address,
    config: StatefulServiceConfig,
  ): Promise<StatefulService> {
    const validatedConfig = StatefulServiceConfigSchema.parse(config)

    // Check if service name already exists
    const existingId = servicesByName.get(
      `${validatedConfig.namespace}/${validatedConfig.name}`,
    )
    if (existingId) {
      throw new Error(
        `Service ${validatedConfig.namespace}/${validatedConfig.name} already exists`,
      )
    }

    const serviceId = this.generateServiceId(validatedConfig.name, owner)
    const now = Date.now()

    const service: StatefulService = {
      id: serviceId,
      owner,
      config: validatedConfig,
      status: 'creating',
      replicas: [],
      currentLeader: null,
      createdAt: now,
      updatedAt: now,
      generation: 1,
      headlessEndpoint: `${validatedConfig.name}.${validatedConfig.namespace}.internal.jeju`,
      clusterEndpoint: `${validatedConfig.name}.${validatedConfig.namespace}.svc.jeju`,
      mpcClusterId: null,
      mpcThresholdPublicKey: null,
      consensusEpoch: 0,
      lastElectionAt: null,
    }

    // Store service
    statefulServices.set(serviceId, service)
    const ownerServices = servicesByOwner.get(owner) ?? new Set()
    ownerServices.add(serviceId)
    servicesByOwner.set(owner, ownerServices)
    servicesByName.set(
      `${validatedConfig.namespace}/${validatedConfig.name}`,
      serviceId,
    )

    // Provision replicas in order (0, 1, 2, ...)
    await this.provisionReplicasInOrder(service, validatedConfig.replicas)

    // Initialize MPC cluster if configured
    if (validatedConfig.mpc?.enabled) {
      await this.initializeMPCCluster(service)
    }

    // Initialize consensus if configured
    if (
      validatedConfig.consensus &&
      validatedConfig.consensus.protocol !== 'none'
    ) {
      await this.initializeConsensus(service)
    }

    // Start health checking
    this.startHealthCheck(service)

    // Start backup scheduling
    this.startBackupScheduler(service)

    service.status = 'running'
    service.updatedAt = Date.now()

    console.log(
      `[StatefulProvisioner] Created service ${validatedConfig.name} with ${validatedConfig.replicas} replicas`,
    )

    return service
  }

  /**
   * Scale service to new replica count
   */
  async scale(
    serviceId: string,
    owner: Address,
    replicas: number,
  ): Promise<void> {
    const service = statefulServices.get(serviceId)
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`)
    }
    if (service.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to scale this service')
    }

    const currentReplicas = service.replicas.length
    if (replicas === currentReplicas) {
      return
    }

    service.status = 'scaling'
    service.updatedAt = Date.now()

    if (replicas > currentReplicas) {
      // Scale up - add replicas in order
      await this.provisionReplicasInOrder(service, replicas - currentReplicas)
    } else {
      // Scale down - remove replicas in reverse order
      await this.terminateReplicasInReverseOrder(
        service,
        currentReplicas - replicas,
      )
    }

    // Re-balance if consensus enabled
    if (
      service.config.consensus &&
      service.config.consensus.protocol !== 'none'
    ) {
      await this.rebalanceConsensus(service)
    }

    // Update MPC if enabled
    if (service.config.mpc?.enabled) {
      await this.updateMPCCluster(service)
    }

    service.status = 'running'
    service.updatedAt = Date.now()
    service.generation++
  }

  /**
   * Get the current leader replica
   */
  getLeader(serviceId: string): StatefulReplica | null {
    const service = statefulServices.get(serviceId)
    if (!service || service.currentLeader === null) {
      return null
    }
    return service.replicas[service.currentLeader] ?? null
  }

  /**
   * Force leader election (useful after leader failure)
   */
  async electLeader(serviceId: string): Promise<number> {
    const service = statefulServices.get(serviceId)
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`)
    }

    // Find healthy replicas
    const healthyReplicas = service.replicas.filter(
      (r) => r.healthStatus === 'healthy' && r.status === 'ready',
    )

    if (healthyReplicas.length === 0) {
      throw new Error('No healthy replicas available for leader election')
    }

    // Check quorum
    const quorum =
      service.config.consensus?.minQuorum ??
      Math.floor(service.replicas.length / 2) + 1
    if (healthyReplicas.length < quorum) {
      throw new Error(
        `Not enough healthy replicas for quorum: ${healthyReplicas.length} < ${quorum}`,
      )
    }

    // Select new leader (prefer lowest ordinal among healthy replicas)
    const newLeader = healthyReplicas.reduce((prev, curr) =>
      curr.ordinal < prev.ordinal ? curr : prev,
    )

    // Update roles
    for (const replica of service.replicas) {
      replica.role =
        replica.ordinal === newLeader.ordinal ? 'leader' : 'follower'
    }

    service.currentLeader = newLeader.ordinal
    service.lastElectionAt = Date.now()
    service.consensusEpoch++
    service.updatedAt = Date.now()

    // Notify replicas of new leader
    await this.notifyLeaderChange(service, newLeader.ordinal)

    console.log(
      `[StatefulProvisioner] Elected ${service.config.name}-${newLeader.ordinal} as leader (epoch ${service.consensusEpoch})`,
    )

    return newLeader.ordinal
  }

  /**
   * Trigger failover from a failed replica
   */
  async failover(serviceId: string, fromOrdinal: number): Promise<void> {
    const service = statefulServices.get(serviceId)
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`)
    }

    const failedReplica = service.replicas[fromOrdinal]
    if (!failedReplica) {
      throw new Error(`Replica ${fromOrdinal} not found`)
    }

    console.log(
      `[StatefulProvisioner] Starting failover for ${service.config.name}-${fromOrdinal}`,
    )

    // Mark replica as failed
    failedReplica.status = 'failed'
    failedReplica.healthStatus = 'unhealthy'

    // If this was the leader, elect new one
    if (service.currentLeader === fromOrdinal) {
      await this.electLeader(serviceId)
    }

    // Attempt to recover replica
    await this.recoverReplica(service, fromOrdinal)
  }

  /**
   * Get service by ID
   */
  getService(serviceId: string): StatefulService | null {
    return statefulServices.get(serviceId) ?? null
  }

  /**
   * Get service by name
   */
  getServiceByName(namespace: string, name: string): StatefulService | null {
    const serviceId = servicesByName.get(`${namespace}/${name}`)
    if (!serviceId) return null
    return statefulServices.get(serviceId) ?? null
  }

  /**
   * List services by owner
   */
  listByOwner(owner: Address): StatefulService[] {
    const serviceIds = servicesByOwner.get(owner)
    if (!serviceIds) return []
    return [...serviceIds]
      .map((id) => statefulServices.get(id))
      .filter((s): s is StatefulService => !!s)
  }

  /**
   * Terminate service completely
   */
  async terminate(serviceId: string, owner: Address): Promise<void> {
    const service = statefulServices.get(serviceId)
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`)
    }
    if (service.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to terminate this service')
    }

    console.log(
      `[StatefulProvisioner] Terminating service ${service.config.name}`,
    )

    // Stop health checks and backups
    const healthInterval = this.healthCheckIntervals.get(serviceId)
    if (healthInterval) {
      clearInterval(healthInterval)
      this.healthCheckIntervals.delete(serviceId)
    }
    const backupInterval = this.backupIntervals.get(serviceId)
    if (backupInterval) {
      clearInterval(backupInterval)
      this.backupIntervals.delete(serviceId)
    }

    // Terminate all replicas in reverse order
    await this.terminateReplicasInReverseOrder(service, service.replicas.length)

    service.status = 'terminated'
    service.updatedAt = Date.now()

    // Clean up state
    const ownerServices = servicesByOwner.get(owner)
    if (ownerServices) {
      ownerServices.delete(serviceId)
    }
    servicesByName.delete(`${service.config.namespace}/${service.config.name}`)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateServiceId(name: string, owner: Address): string {
    const hash = keccak256(toBytes(`${name}-${owner}-${Date.now()}`))
    return `svc-${hash.slice(2, 18)}`
  }

  private generatePodName(serviceName: string, ordinal: number): string {
    return `${serviceName}-${ordinal}`
  }

  /**
   * Provision replicas one at a time in order
   */
  private async provisionReplicasInOrder(
    service: StatefulService,
    count: number,
  ): Promise<void> {
    const startOrdinal = service.replicas.length

    for (let i = 0; i < count; i++) {
      const ordinal = startOrdinal + i
      const replica = await this.provisionReplica(service, ordinal)
      service.replicas.push(replica)

      // Wait for replica to become ready before provisioning next
      await this.waitForReplicaReady(service, replica, 120000) // 2 min timeout
    }
  }

  /**
   * Provision a single replica
   */
  private async provisionReplica(
    service: StatefulService,
    ordinal: number,
  ): Promise<StatefulReplica> {
    const config = service.config
    const podName = this.generatePodName(config.name, ordinal)

    console.log(`[StatefulProvisioner] Provisioning replica ${podName}`)

    // Find suitable node
    const node = await this.findNodeForReplica(service, ordinal)
    if (!node) {
      throw new Error(`No suitable node found for replica ${podName}`)
    }

    // Determine initial role
    let role: ReplicaRole = 'follower'
    if (config.mpc?.enabled) {
      role = 'mpc-party'
    } else if (ordinal === 0 && service.replicas.length === 0) {
      role = 'leader'
      service.currentLeader = 0
    }

    const replica: StatefulReplica = {
      ordinal,
      podName,
      nodeId: node.nodeId,
      nodeAddress: node.address,
      instanceId: `${podName}-${Date.now()}`,
      status: 'provisioning',
      role,
      endpoint: '',
      internalDns: `${podName}.${config.name}.${config.namespace}.internal.jeju`,
      volumeBindings: [],
      createdAt: Date.now(),
      becameReadyAt: null,
      lastHealthCheck: 0,
      healthStatus: 'unknown',
      mpcPartyId: config.mpc?.enabled ? ordinal : null,
      mpcPublicKey: null,
    }

    // Provision volumes on node
    for (const volumeConfig of config.volumes) {
      const volumeBinding = await this.provisionVolume(
        node,
        service,
        replica,
        volumeConfig,
      )
      replica.volumeBindings.push(volumeBinding)
    }

    // Build environment with service discovery
    const env: Record<string, string> = {
      ...config.env,
      POD_NAME: podName,
      POD_ORDINAL: String(ordinal),
      SERVICE_NAME: config.name,
      SERVICE_NAMESPACE: config.namespace,
      HEADLESS_SERVICE: service.headlessEndpoint,
      CLUSTER_SERVICE: service.clusterEndpoint,
      REPLICA_COUNT: String(config.replicas),
      NODE_ROLE: role,
    }

    // Add MPC config if enabled
    if (config.mpc?.enabled) {
      env.MPC_ENABLED = 'true'
      env.MPC_THRESHOLD = String(config.mpc.threshold)
      env.MPC_TOTAL_PARTIES = String(config.mpc.totalParties)
      env.MPC_PARTY_ID = String(ordinal)
      env.MPC_CLUSTER_ID = service.mpcClusterId ?? ''
    }

    // Add consensus config if enabled
    if (config.consensus && config.consensus.protocol !== 'none') {
      env.CONSENSUS_PROTOCOL = config.consensus.protocol
      env.CONSENSUS_MIN_QUORUM = String(config.consensus.minQuorum)
      env.CONSENSUS_ELECTION_TIMEOUT_MS = String(
        config.consensus.electionTimeoutMs,
      )
      env.CONSENSUS_HEARTBEAT_INTERVAL_MS = String(
        config.consensus.heartbeatIntervalMs,
      )

      // Build peer list
      const peers: string[] = []
      for (let j = 0; j < config.replicas; j++) {
        if (j !== ordinal) {
          const peerName = this.generatePodName(config.name, j)
          peers.push(
            `${peerName}.${config.name}.${config.namespace}.internal.jeju`,
          )
        }
      }
      env.CONSENSUS_PEERS = peers.join(',')
    }

    // Deploy container to node
    const endpoint = await this.deployToNode(node, service, replica, env)
    replica.endpoint = endpoint
    replica.status = 'running'

    return replica
  }

  /**
   * Find a suitable node for a replica, considering anti-affinity
   */
  private async findNodeForReplica(
    service: StatefulService,
    _ordinal: number,
  ): Promise<ComputeNode | null> {
    const hardware = service.config.hardware
    const allNodes = scheduler.getAllNodes()

    // Get nodes already used by this service for anti-affinity
    const usedNodeIds = new Set(service.replicas.map((r) => r.nodeId))

    // Filter and score nodes
    const candidates: Array<{ node: ComputeNode; score: number }> = []

    for (const node of allNodes) {
      // Skip offline nodes
      if (node.status !== 'online') continue

      // Check resource availability
      if (node.resources.availableCpu < hardware.cpuCores) continue
      if (node.resources.availableMemoryMb < hardware.memoryMb) continue
      if (node.resources.availableStorageMb < hardware.storageMb) continue

      // Check region if specified
      if (hardware.region && node.region !== hardware.region) continue

      // Check TEE if required
      if (
        service.config.mpc?.teeRequired &&
        !node.capabilities.includes(service.config.mpc.teePlatform)
      ) {
        continue
      }

      // Score node
      let score = node.reputation

      // Prefer nodes not already used (anti-affinity)
      if (!usedNodeIds.has(node.nodeId)) {
        score += 100
      }

      // Prefer nodes with cached images
      const imageRef = `${service.config.image}:${service.config.tag}`
      if (node.cachedImages.has(imageRef)) {
        score += 50
      }

      candidates.push({ node, score })
    }

    if (candidates.length === 0) {
      return null
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)
    return candidates[0].node
  }

  /**
   * Provision a volume for a replica
   */
  private async provisionVolume(
    node: ComputeNode,
    service: StatefulService,
    replica: StatefulReplica,
    volumeConfig: VolumeConfig,
  ): Promise<StatefulReplica['volumeBindings'][0]> {
    const volumePath = `/data/dws/volumes/${service.id}/${replica.podName}/${volumeConfig.name}`

    // Request node to create volume
    const response = await fetch(`${node.endpoint}/v1/volumes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: volumePath,
        sizeMb: volumeConfig.sizeMb,
        tier: volumeConfig.tier,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create volume: ${await response.text()}`)
    }

    return {
      name: volumeConfig.name,
      nodeLocalPath: volumePath,
      ipfsCid: null,
      lastBackup: null,
    }
  }

  /**
   * Deploy container to a node
   */
  private async deployToNode(
    node: ComputeNode,
    service: StatefulService,
    replica: StatefulReplica,
    env: Record<string, string>,
  ): Promise<string> {
    const config = service.config

    // Build volume mounts
    const volumeMounts = replica.volumeBindings.map((binding, i) => ({
      hostPath: binding.nodeLocalPath,
      containerPath: config.volumes[i].mountPath,
    }))

    const deployConfig = {
      Image: `${config.image}:${config.tag}`,
      Cmd: config.command ?? [],
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        Memory: config.hardware.memoryMb * 1024 * 1024,
        NanoCpus: config.hardware.cpuCores * 1e9,
        Binds: volumeMounts.map((m) => `${m.hostPath}:${m.containerPath}`),
        PortBindings: {} as Record<string, Array<{ HostPort: string }>>,
      },
      ExposedPorts: {} as Record<string, Record<string, never>>,
      Labels: {
        'dws.service.id': service.id,
        'dws.service.name': config.name,
        'dws.replica.ordinal': String(replica.ordinal),
        'dws.replica.role': replica.role,
        ...config.labels,
      },
      Hostname: replica.podName,
    }

    // Configure ports
    for (const portConfig of config.ports) {
      const portKey = `${portConfig.containerPort}/${portConfig.protocol}`
      deployConfig.ExposedPorts[portKey] = {}
      deployConfig.HostConfig.PortBindings[portKey] = [{ HostPort: '0' }]
    }

    const response = await fetch(`${node.endpoint}/v1/containers/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deployConfig),
    })

    if (!response.ok) {
      throw new Error(`Failed to deploy to node: ${await response.text()}`)
    }

    const result = (await response.json()) as {
      endpoint: string
      ports: Record<string, number>
    }
    return result.endpoint
  }

  /**
   * Wait for a replica to become ready
   */
  private async waitForReplicaReady(
    service: StatefulService,
    replica: StatefulReplica,
    timeoutMs: number,
  ): Promise<void> {
    const readinessCheck = service.config.readinessCheck ?? {
      path: service.config.healthCheck.path,
      port: service.config.healthCheck.port,
      initialDelaySeconds: 5,
      periodSeconds: 2,
    }

    const startTime = Date.now()
    const checkUrl = `${replica.endpoint}${readinessCheck.path}`

    // Initial delay
    await this.sleep(readinessCheck.initialDelaySeconds * 1000)

    while (Date.now() - startTime < timeoutMs) {
      const healthy = await this.checkEndpointHealth(checkUrl, 5000)
      if (healthy) {
        replica.status = 'ready'
        replica.becameReadyAt = Date.now()
        replica.healthStatus = 'healthy'
        console.log(`[StatefulProvisioner] Replica ${replica.podName} is ready`)
        return
      }

      await this.sleep(readinessCheck.periodSeconds * 1000)
    }

    throw new Error(
      `Replica ${replica.podName} did not become ready within ${timeoutMs}ms`,
    )
  }

  /**
   * Check endpoint health
   */
  private async checkEndpointHealth(
    url: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(url, {
      signal: controller.signal,
    }).catch(() => null)

    clearTimeout(timeoutId)

    return response?.ok
  }

  /**
   * Terminate replicas in reverse order (highest ordinal first)
   */
  private async terminateReplicasInReverseOrder(
    service: StatefulService,
    count: number,
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      const replica = service.replicas.pop()
      if (!replica) break

      await this.terminateReplica(service, replica)
    }
  }

  /**
   * Terminate a single replica
   */
  private async terminateReplica(
    service: StatefulService,
    replica: StatefulReplica,
  ): Promise<void> {
    console.log(`[StatefulProvisioner] Terminating replica ${replica.podName}`)
    replica.status = 'terminating'

    // Stop container on node
    const node = scheduler.getNode(replica.nodeId)
    if (node) {
      await fetch(`${node.endpoint}/v1/containers/${replica.instanceId}/stop`, {
        method: 'POST',
      }).catch(() => {})
    }

    // Backup volumes if enabled
    for (const volumeBinding of replica.volumeBindings) {
      const volumeConfig = service.config.volumes.find(
        (v) => v.name === volumeBinding.name,
      )
      if (volumeConfig?.backup.ipfsPin) {
        await this.backupVolumeToIPFS(service, replica, volumeBinding).catch(
          console.error,
        )
      }
    }
  }

  /**
   * Recover a failed replica
   */
  private async recoverReplica(
    service: StatefulService,
    ordinal: number,
  ): Promise<void> {
    const failedReplica = service.replicas[ordinal]
    if (!failedReplica) return

    console.log(
      `[StatefulProvisioner] Recovering replica ${failedReplica.podName}`,
    )

    // Terminate old instance
    await this.terminateReplica(service, failedReplica)

    // Provision new replica with same ordinal
    const newReplica = await this.provisionReplica(service, ordinal)

    // Restore volumes if we have IPFS backups
    for (const volumeBinding of newReplica.volumeBindings) {
      const oldBinding = failedReplica.volumeBindings.find(
        (v) => v.name === volumeBinding.name,
      )
      if (oldBinding?.ipfsCid) {
        await this.restoreVolumeFromIPFS(
          service,
          newReplica,
          volumeBinding,
          oldBinding.ipfsCid,
        )
      }
    }

    // Replace in array
    service.replicas[ordinal] = newReplica

    // Wait for ready
    await this.waitForReplicaReady(service, newReplica, 120000)
  }

  /**
   * Initialize MPC cluster for threshold signing
   */
  private async initializeMPCCluster(service: StatefulService): Promise<void> {
    const mpcConfig = service.config.mpc
    if (!mpcConfig?.enabled) return

    console.log(
      `[StatefulProvisioner] Initializing MPC cluster for ${service.config.name}`,
    )

    // Generate cluster ID
    service.mpcClusterId = keccak256(
      toBytes(`mpc-${service.id}-${Date.now()}`),
    ) as Hex

    // Wait for all replicas to be ready
    const readyCount = service.replicas.filter(
      (r) => r.status === 'ready',
    ).length
    if (readyCount < mpcConfig.totalParties) {
      throw new Error(
        `Not enough ready replicas for MPC: ${readyCount} < ${mpcConfig.totalParties}`,
      )
    }

    // Initiate distributed key generation
    const parties = service.replicas.slice(0, mpcConfig.totalParties)
    const partyEndpoints = parties.map((r) => ({
      partyId: r.ordinal,
      endpoint: r.endpoint,
    }))

    // Call DKG init on each party
    for (const replica of parties) {
      const response = await fetch(`${replica.endpoint}/mpc/dkg/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterId: service.mpcClusterId,
          threshold: mpcConfig.threshold,
          totalParties: mpcConfig.totalParties,
          partyId: replica.ordinal,
          parties: partyEndpoints,
        }),
      })

      if (!response.ok) {
        throw new Error(
          `DKG init failed on ${replica.podName}: ${await response.text()}`,
        )
      }

      const result = (await response.json()) as { publicKey: Hex }
      replica.mpcPublicKey = result.publicKey
    }

    // Wait for DKG completion and get threshold public key
    const leaderResponse = await fetch(
      `${parties[0].endpoint}/mpc/dkg/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterId: service.mpcClusterId }),
      },
    )

    if (!leaderResponse.ok) {
      throw new Error(`DKG finalize failed: ${await leaderResponse.text()}`)
    }

    const dkgResult = (await leaderResponse.json()) as {
      thresholdPublicKey: Hex
    }
    service.mpcThresholdPublicKey = dkgResult.thresholdPublicKey

    console.log(
      `[StatefulProvisioner] MPC cluster initialized: ${service.mpcClusterId?.slice(0, 18)}...`,
    )
  }

  /**
   * Update MPC cluster after scaling
   */
  private async updateMPCCluster(service: StatefulService): Promise<void> {
    // For now, re-run DKG. In production, would use proactive secret sharing
    if (service.config.mpc?.enabled) {
      await this.initializeMPCCluster(service)
    }
  }

  /**
   * Initialize consensus for the cluster
   */
  private async initializeConsensus(service: StatefulService): Promise<void> {
    const consensus = service.config.consensus
    if (!consensus || consensus.protocol === 'none') return

    console.log(
      `[StatefulProvisioner] Initializing ${consensus.protocol} consensus for ${service.config.name}`,
    )

    // Elect initial leader (replica-0)
    service.currentLeader = 0
    service.replicas[0].role = 'leader'
    for (let i = 1; i < service.replicas.length; i++) {
      service.replicas[i].role = 'follower'
    }
    service.consensusEpoch = 1
    service.lastElectionAt = Date.now()

    // Notify all replicas of initial configuration
    await this.notifyLeaderChange(service, 0)
  }

  /**
   * Rebalance consensus after scaling
   */
  private async rebalanceConsensus(service: StatefulService): Promise<void> {
    if (
      !service.config.consensus ||
      service.config.consensus.protocol === 'none'
    ) {
      return
    }

    // If leader is gone, elect new one
    if (
      service.currentLeader !== null &&
      !service.replicas[service.currentLeader]
    ) {
      await this.electLeader(service.id)
    }

    // Notify all replicas of new peer list
    await this.broadcastPeerUpdate(service)
  }

  /**
   * Notify replicas of leader change
   */
  private async notifyLeaderChange(
    service: StatefulService,
    newLeaderOrdinal: number,
  ): Promise<void> {
    const leader = service.replicas[newLeaderOrdinal]
    if (!leader) return

    for (const replica of service.replicas) {
      await fetch(`${replica.endpoint}/consensus/leader-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: service.consensusEpoch,
          leaderId: newLeaderOrdinal,
          leaderEndpoint: leader.endpoint,
        }),
      }).catch(() => {})
    }
  }

  /**
   * Broadcast peer list update
   */
  private async broadcastPeerUpdate(service: StatefulService): Promise<void> {
    const peers = service.replicas.map((r) => ({
      ordinal: r.ordinal,
      endpoint: r.endpoint,
      role: r.role,
    }))

    for (const replica of service.replicas) {
      await fetch(`${replica.endpoint}/consensus/peer-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peers, epoch: service.consensusEpoch }),
      }).catch(() => {})
    }
  }

  /**
   * Start periodic health checking
   */
  private startHealthCheck(service: StatefulService): void {
    const interval = setInterval(async () => {
      for (const replica of service.replicas) {
        if (replica.status !== 'ready' && replica.status !== 'running') {
          continue
        }

        const healthUrl = `${replica.endpoint}${service.config.healthCheck.path}`
        const healthy = await this.checkEndpointHealth(
          healthUrl,
          service.config.healthCheck.timeoutSeconds * 1000,
        )

        replica.lastHealthCheck = Date.now()
        const wasHealthy = replica.healthStatus === 'healthy'

        if (healthy) {
          replica.healthStatus = 'healthy'
        } else {
          replica.healthStatus = 'unhealthy'

          // If was healthy and now unhealthy, maybe trigger failover
          if (wasHealthy) {
            console.warn(
              `[StatefulProvisioner] Replica ${replica.podName} became unhealthy`,
            )

            // If this is the leader, trigger election
            if (
              service.currentLeader === replica.ordinal &&
              service.config.consensus?.protocol !== 'none'
            ) {
              this.electLeader(service.id).catch(console.error)
            }
          }
        }
      }
    }, service.config.healthCheck.intervalSeconds * 1000)

    this.healthCheckIntervals.set(service.id, interval)
  }

  /**
   * Start backup scheduler for volumes
   */
  private startBackupScheduler(service: StatefulService): void {
    // Find volumes with backup enabled
    const volumesWithBackup = service.config.volumes.filter(
      (v) => v.backup.enabled,
    )

    if (volumesWithBackup.length === 0) return

    // Use shortest interval among all volumes
    const intervalSeconds = Math.min(
      ...volumesWithBackup.map((v) => v.backup.intervalSeconds),
    )

    const interval = setInterval(async () => {
      for (const replica of service.replicas) {
        if (replica.status !== 'ready') continue

        for (const volumeBinding of replica.volumeBindings) {
          const volumeConfig = service.config.volumes.find(
            (v) => v.name === volumeBinding.name,
          )
          if (!volumeConfig?.backup.enabled) continue

          await this.backupVolumeToIPFS(service, replica, volumeBinding).catch(
            console.error,
          )
        }
      }
    }, intervalSeconds * 1000)

    this.backupIntervals.set(service.id, interval)
  }

  /**
   * Backup a volume to IPFS
   */
  private async backupVolumeToIPFS(
    service: StatefulService,
    replica: StatefulReplica,
    volumeBinding: StatefulReplica['volumeBindings'][0],
  ): Promise<void> {
    const node = scheduler.getNode(replica.nodeId)
    if (!node) return

    console.log(
      `[StatefulProvisioner] Backing up ${replica.podName}/${volumeBinding.name} to IPFS`,
    )

    const response = await fetch(`${node.endpoint}/v1/volumes/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: volumeBinding.nodeLocalPath,
        serviceId: service.id,
        replicaOrdinal: replica.ordinal,
        volumeName: volumeBinding.name,
      }),
    })

    if (!response.ok) {
      console.error(`Backup failed: ${await response.text()}`)
      return
    }

    const result = (await response.json()) as { cid: string }
    volumeBinding.ipfsCid = result.cid
    volumeBinding.lastBackup = Date.now()
  }

  /**
   * Restore a volume from IPFS
   */
  private async restoreVolumeFromIPFS(
    _service: StatefulService,
    replica: StatefulReplica,
    volumeBinding: StatefulReplica['volumeBindings'][0],
    ipfsCid: string,
  ): Promise<void> {
    const node = scheduler.getNode(replica.nodeId)
    if (!node) return

    console.log(
      `[StatefulProvisioner] Restoring ${replica.podName}/${volumeBinding.name} from IPFS ${ipfsCid}`,
    )

    const response = await fetch(`${node.endpoint}/v1/volumes/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: volumeBinding.nodeLocalPath,
        cid: ipfsCid,
      }),
    })

    if (!response.ok) {
      throw new Error(`Volume restore failed: ${await response.text()}`)
    }

    volumeBinding.ipfsCid = ipfsCid
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Singleton
// ============================================================================

let statefulProvisioner: StatefulProvisioner | null = null

export function getStatefulProvisioner(): StatefulProvisioner {
  if (!statefulProvisioner) {
    statefulProvisioner = new StatefulProvisioner()
  }
  return statefulProvisioner
}
