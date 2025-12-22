/**
 * Regional TEE Coordinator
 *
 * Routes workloads and configs to regional TEE worker nodes.
 * Handles:
 * - Node discovery via ERC-8004 registry
 * - Regional routing based on preferences and latency
 * - Workload deployment across regions
 * - Health monitoring and failover
 * - Secret distribution to TEE enclaves
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import {
  estimateLatency,
  getRegion,
  getRegionConfig,
  haversineDistance,
} from './regions'
import type {
  NetworkEnvironment,
  RegionId,
  TEEAttestation,
  TEEPlatform,
  TEEWorkerEvent,
  TEEWorkerEventHandler,
  TEEWorkerNode,
  WorkloadConfig,
  WorkloadDeployment,
  WorkloadInstance,
} from './types'

// ============================================================================
// ERC-8004 ABI for node discovery
// ============================================================================

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isBanned', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getA2AEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'getMetadata',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: 'value', type: 'bytes' }],
    stateMutability: 'view',
  },
] as const

// Tags for TEE worker nodes
const TEE_WORKER_TAG = 'dws-tee-worker'

// Metadata keys
const REGION_KEY = 'teeRegion'
const TEE_PLATFORM_KEY = 'teePlatform'
const CAPABILITIES_KEY = 'teeCapabilities'

// ============================================================================
// Coordinator Configuration
// ============================================================================

export interface CoordinatorConfig {
  environment: NetworkEnvironment
  rpcUrl: string
  registryAddress: Address
  privateKey?: `0x${string}`
  /** How often to refresh node list (ms) */
  nodeRefreshInterval: number
  /** How often to check node health (ms) */
  healthCheckInterval: number
  /** Timeout for node health checks (ms) */
  healthCheckTimeout: number
  /** Minimum reputation for routing */
  minReputation: number
  /** Minimum stake for routing */
  minStake: bigint
}

const DEFAULT_CONFIG: Partial<CoordinatorConfig> = {
  nodeRefreshInterval: 60000, // 1 minute
  healthCheckInterval: 30000, // 30 seconds
  healthCheckTimeout: 5000,
  minReputation: 50,
  minStake: 0n,
}

// ============================================================================
// Regional TEE Coordinator
// ============================================================================

export class RegionalTEECoordinator {
  private config: CoordinatorConfig
  private publicClient: PublicClient
  private account: PrivateKeyAccount | null = null

  // Node tracking
  private nodes = new Map<string, TEEWorkerNode>() // agentId -> node
  private nodesByRegion = new Map<RegionId, Set<string>>() // region -> agentIds
  private nodeScores = new Map<string, number>() // agentId -> score

  // Deployment tracking
  private deployments = new Map<string, WorkloadDeployment>()

  // Event handlers
  private eventHandlers: TEEWorkerEventHandler[] = []

  // Background tasks
  private refreshInterval: ReturnType<typeof setInterval> | null = null
  private healthInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: CoordinatorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as CoordinatorConfig

    const chain = this.inferChain(config.rpcUrl)
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient

    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(config.rpcUrl),
      })
    }
  }

  private inferChain(rpcUrl: string) {
    if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
      return baseSepolia
    }
    if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
      return base
    }
    return localhost
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    console.log(
      `[TEECoordinator] Starting in ${this.config.environment} environment`,
    )

    // Initial node discovery
    await this.refreshNodes()

    // Start background tasks
    this.refreshInterval = setInterval(
      () => this.refreshNodes(),
      this.config.nodeRefreshInterval,
    )
    this.healthInterval = setInterval(
      () => this.checkNodeHealth(),
      this.config.healthCheckInterval,
    )

    const regionConfig = getRegionConfig(this.config.environment)
    console.log(
      `[TEECoordinator] Started with ${this.nodes.size} nodes across ${regionConfig.regions.length} regions`,
    )
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }
    if (this.healthInterval) {
      clearInterval(this.healthInterval)
      this.healthInterval = null
    }
    console.log('[TEECoordinator] Stopped')
  }

  // ============================================================================
  // Node Discovery
  // ============================================================================

  async refreshNodes(): Promise<void> {
    const agentIds = (await this.publicClient.readContract({
      address: this.config.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [TEE_WORKER_TAG],
    })) as bigint[]

    const regionConfig = getRegionConfig(this.config.environment)
    const validRegions = new Set(regionConfig.regions.map((r) => r.id))

    for (const agentId of agentIds) {
      const node = await this.fetchNode(agentId)
      if (!node) continue

      // Skip nodes in regions not available for this environment
      if (!validRegions.has(node.region) && node.region !== 'local') {
        continue
      }

      // Skip banned or low-reputation nodes
      if (node.reputation < this.config.minReputation) continue
      if (node.stake < this.config.minStake) continue

      this.registerNode(node)
    }
  }

  private async fetchNode(agentId: bigint): Promise<TEEWorkerNode | null> {
    const agent = (await this.publicClient.readContract({
      address: this.config.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [agentId],
    })) as {
      owner: Address
      stakedAmount: bigint
      isBanned: boolean
      lastActivityAt: bigint
    }

    if (
      !agent.owner ||
      agent.owner === '0x0000000000000000000000000000000000000000' ||
      agent.isBanned
    ) {
      return null
    }

    const endpoint = (await this.publicClient.readContract({
      address: this.config.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getA2AEndpoint',
      args: [agentId],
    })) as string

    if (!endpoint) return null

    // Get metadata
    const region = await this.getMetadataString(agentId, REGION_KEY)
    const platform = await this.getMetadataString(agentId, TEE_PLATFORM_KEY)
    const capabilities = await this.getMetadataString(agentId, CAPABILITIES_KEY)

    return {
      agentId,
      operator: agent.owner,
      endpoint,
      region: region || 'local',
      tee: {
        platform: (platform as TEEPlatform) || 'simulator',
        maxMemoryMb: 4096,
        gpuAvailable: capabilities?.includes('gpu') ?? false,
      },
      status: 'online',
      stake: agent.stakedAmount,
      reputation: 100, // TODO: fetch from reputation system
      lastSeen: Number(agent.lastActivityAt) * 1000,
      resources: {
        availableCpuMillis: 4000,
        availableMemoryMb: 4096,
        availableStorageMb: 10240,
        gpuAvailable: capabilities?.includes('gpu') ?? false,
      },
      capabilities: capabilities?.split(',') ?? [],
    }
  }

  private async getMetadataString(
    agentId: bigint,
    key: string,
  ): Promise<string> {
    const value = (await this.publicClient.readContract({
      address: this.config.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getMetadata',
      args: [agentId, key],
    })) as `0x${string}`

    if (!value || value === '0x') return ''
    return Buffer.from(value.slice(2), 'hex').toString('utf-8')
  }

  private registerNode(node: TEEWorkerNode): void {
    const key = node.agentId.toString()
    this.nodes.set(key, node)

    // Index by region
    let regionNodes = this.nodesByRegion.get(node.region)
    if (!regionNodes) {
      regionNodes = new Set()
      this.nodesByRegion.set(node.region, regionNodes)
    }
    regionNodes.add(key)

    // Calculate initial score
    this.updateNodeScore(key)

    this.emit({
      type: 'node:registered',
      agentId: node.agentId,
      region: node.region,
    })
  }

  // ============================================================================
  // Node Routing
  // ============================================================================

  /**
   * Find best nodes for a workload
   */
  findNodes(options: {
    count: number
    workload?: WorkloadConfig
    clientLat?: number
    clientLon?: number
    region?: RegionId
    teeRequired?: boolean
    teePlatform?: TEEPlatform
    gpuRequired?: boolean
  }): TEEWorkerNode[] {
    let candidates = Array.from(this.nodes.values()).filter(
      (n) => n.status === 'online',
    )

    // Apply filters
    if (options.teeRequired) {
      candidates = candidates.filter(
        (n) =>
          n.tee.platform !== 'simulator' ||
          this.config.environment === 'localnet',
      )
    }

    if (options.teePlatform) {
      candidates = candidates.filter(
        (n) => n.tee.platform === options.teePlatform,
      )
    }

    if (options.gpuRequired) {
      candidates = candidates.filter((n) => n.resources.gpuAvailable)
    }

    if (options.workload) {
      // Apply workload requirements
      const { teeRequirements, regionPreferences, resources } = options.workload

      if (teeRequirements.required) {
        candidates = candidates.filter(
          (n) =>
            teeRequirements.platforms.length === 0 ||
            teeRequirements.platforms.includes(n.tee.platform),
        )
      }

      if (regionPreferences.excluded.length > 0) {
        candidates = candidates.filter(
          (n) => !regionPreferences.excluded.includes(n.region),
        )
      }

      if (regionPreferences.requiredProvider) {
        const region = getRegion(candidates[0]?.region)
        if (region) {
          candidates = candidates.filter((n) => {
            const r = getRegion(n.region)
            return r?.provider === regionPreferences.requiredProvider
          })
        }
      }

      // Filter by resource availability
      candidates = candidates.filter(
        (n) =>
          n.resources.availableCpuMillis >= resources.cpuMillis &&
          n.resources.availableMemoryMb >= resources.memoryMb,
      )
    }

    // Score and sort
    const scored = candidates.map((node) => {
      let score = this.nodeScores.get(node.agentId.toString()) ?? 50

      // Boost preferred regions
      if (options.workload?.regionPreferences.preferred.includes(node.region)) {
        score += 20
      }

      // Boost by geo proximity if client location known
      if (options.clientLat !== undefined && options.clientLon !== undefined) {
        const region = getRegion(node.region)
        if (region) {
          const distance = haversineDistance(
            options.clientLat,
            options.clientLon,
            region.coordinates.lat,
            region.coordinates.lon,
          )
          // Closer = higher score (max 20 bonus for <500km)
          score += Math.max(0, 20 - distance / 500)
        }
      }

      // Boost specific region if requested
      if (options.region && node.region === options.region) {
        score += 30
      }

      return { node, score }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, options.count).map((s) => s.node)
  }

  /**
   * Find the best single node
   */
  findBestNode(
    options: Parameters<typeof this.findNodes>[0],
  ): TEEWorkerNode | null {
    const nodes = this.findNodes({ ...options, count: 1 })
    return nodes[0] ?? null
  }

  /**
   * Find nodes in a specific region
   */
  getNodesInRegion(region: RegionId): TEEWorkerNode[] {
    const nodeIds = this.nodesByRegion.get(region)
    if (!nodeIds) return []

    return Array.from(nodeIds)
      .map((id) => this.nodes.get(id))
      .filter(
        (n): n is TEEWorkerNode => n !== undefined && n.status === 'online',
      )
  }

  // ============================================================================
  // Workload Deployment
  // ============================================================================

  /**
   * Deploy a workload to TEE nodes
   */
  async deployWorkload(config: WorkloadConfig): Promise<WorkloadDeployment> {
    console.log(`[TEECoordinator] Deploying workload ${config.name}`)

    const deployment: WorkloadDeployment = {
      id: `deploy-${config.id}-${Date.now()}`,
      workload: config,
      status: 'deploying',
      instances: [],
      deployedAt: Date.now(),
      updatedAt: Date.now(),
      metrics: {
        totalInvocations: 0,
        totalErrors: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        coldStarts: 0,
        warmStarts: 0,
      },
    }

    this.deployments.set(deployment.id, deployment)

    // Find nodes to deploy to
    const targetCount = config.scaling.minInstances || 1
    const nodes = this.findNodes({
      count: targetCount,
      workload: config,
    })

    if (nodes.length === 0) {
      deployment.status = 'failed'
      deployment.error = 'No suitable nodes found'
      throw new Error('No suitable TEE nodes found for deployment')
    }

    // Deploy to nodes
    const results = await Promise.allSettled(
      nodes.map((node) => this.deployToNode(deployment, node)),
    )

    const successCount = results.filter((r) => r.status === 'fulfilled').length
    if (successCount === 0) {
      deployment.status = 'failed'
      deployment.error = 'Failed to deploy to any node'
      throw new Error('Deployment failed on all nodes')
    }

    deployment.status = 'active'
    deployment.updatedAt = Date.now()

    this.emit({
      type: 'workload:deployed',
      deploymentId: deployment.id,
      workloadId: config.id,
    })

    console.log(
      `[TEECoordinator] Deployed ${config.name} to ${successCount} nodes`,
    )

    return deployment
  }

  private async deployToNode(
    deployment: WorkloadDeployment,
    node: TEEWorkerNode,
  ): Promise<WorkloadInstance> {
    const { workload } = deployment

    const response = await fetch(`${node.endpoint}/tee/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': workload.owner,
      },
      body: JSON.stringify({
        workloadId: workload.id,
        name: workload.name,
        codeCid: workload.codeCid,
        codeHash: workload.codeHash,
        runtime: workload.runtime,
        entrypoint: workload.entrypoint,
        env: workload.env,
        secretNames: workload.secretNames,
        resources: workload.resources,
        teeRequirements: workload.teeRequirements,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Deploy to ${node.region} failed: ${error}`)
    }

    const result = (await response.json()) as {
      instanceId: string
      attestation?: TEEAttestation
    }

    const instance: WorkloadInstance = {
      id: result.instanceId,
      nodeAgentId: node.agentId,
      nodeEndpoint: node.endpoint,
      region: node.region,
      status: 'warm',
      startedAt: Date.now(),
      lastRequestAt: Date.now(),
      activeRequests: 0,
      totalRequests: 0,
      errors: 0,
      attestation: result.attestation,
    }

    deployment.instances.push(instance)

    this.emit({
      type: 'instance:started',
      deploymentId: deployment.id,
      instanceId: instance.id,
      region: node.region,
    })

    return instance
  }

  /**
   * Scale a deployment up or down
   */
  async scaleDeployment(
    deploymentId: string,
    targetInstances: number,
  ): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`)
    }

    const activeInstances = deployment.instances.filter(
      (i) => i.status === 'warm' || i.status === 'busy',
    )

    if (targetInstances > activeInstances.length) {
      // Scale up
      const needed = targetInstances - activeInstances.length
      const nodes = this.findNodes({
        count: needed,
        workload: deployment.workload,
      })

      for (const node of nodes) {
        await this.deployToNode(deployment, node).catch((err) => {
          console.warn(
            `[TEECoordinator] Scale up to ${node.region} failed:`,
            err,
          )
        })
      }
    } else if (targetInstances < activeInstances.length) {
      // Scale down
      const toStop = activeInstances.length - targetInstances
      const instancesToStop = activeInstances
        .filter((i) => i.status === 'warm' && i.activeRequests === 0)
        .slice(0, toStop)

      for (const instance of instancesToStop) {
        await this.stopInstance(deployment, instance)
      }
    }

    deployment.updatedAt = Date.now()

    this.emit({
      type: 'workload:scaled',
      deploymentId,
      instances: deployment.instances.filter((i) => i.status !== 'stopped')
        .length,
    })
  }

  private async stopInstance(
    deployment: WorkloadDeployment,
    instance: WorkloadInstance,
  ): Promise<void> {
    await fetch(`${instance.nodeEndpoint}/tee/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workloadId: deployment.workload.id,
        instanceId: instance.id,
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {
      // Ignore errors on stop
    })

    instance.status = 'stopped'

    this.emit({
      type: 'instance:stopped',
      deploymentId: deployment.id,
      instanceId: instance.id,
    })
  }

  /**
   * Stop a deployment entirely
   */
  async stopDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) return

    deployment.status = 'draining'

    await Promise.all(
      deployment.instances.map((i) => this.stopInstance(deployment, i)),
    )

    deployment.status = 'stopped'
    deployment.updatedAt = Date.now()

    this.emit({ type: 'workload:stopped', deploymentId })
  }

  // ============================================================================
  // Request Routing
  // ============================================================================

  /**
   * Route a request to the best instance
   */
  async routeRequest(
    deploymentId: string,
    request: Request,
    options?: {
      clientLat?: number
      clientLon?: number
      preferredRegion?: RegionId
    },
  ): Promise<Response> {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) {
      return new Response(JSON.stringify({ error: 'Deployment not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Find healthy instances
    let instances = deployment.instances.filter(
      (i) =>
        (i.status === 'warm' || i.status === 'busy') &&
        i.activeRequests < deployment.workload.resources.maxConcurrency,
    )

    if (instances.length === 0) {
      // Try to scale up
      if (
        deployment.instances.length < deployment.workload.scaling.maxInstances
      ) {
        await this.scaleDeployment(
          deploymentId,
          deployment.instances.length + 1,
        ).catch(() => {})
      }

      return new Response(JSON.stringify({ error: 'No available instances' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Sort by region preference and load
    instances = instances.sort((a, b) => {
      let scoreA = -a.activeRequests
      let scoreB = -b.activeRequests

      if (options?.preferredRegion) {
        if (a.region === options.preferredRegion) scoreA += 10
        if (b.region === options.preferredRegion) scoreB += 10
      }

      if (
        options?.clientLat !== undefined &&
        options?.clientLon !== undefined
      ) {
        const latA = estimateLatency('local', a.region)
        const latB = estimateLatency('local', b.region)
        scoreA -= latA / 10
        scoreB -= latB / 10
      }

      return scoreB - scoreA
    })

    const instance = instances[0]
    instance.activeRequests++
    const startTime = Date.now()

    try {
      const response = await fetch(
        `${instance.nodeEndpoint}/tee/invoke/${deployment.workload.id}`,
        {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: AbortSignal.timeout(deployment.workload.resources.timeoutMs),
        },
      )

      instance.totalRequests++
      instance.lastRequestAt = Date.now()
      deployment.metrics.totalInvocations++

      const durationMs = Date.now() - startTime
      deployment.metrics.avgLatencyMs =
        deployment.metrics.avgLatencyMs * 0.9 + durationMs * 0.1

      this.emit({
        type: 'invocation:completed',
        deploymentId,
        instanceId: instance.id,
        durationMs,
      })

      return response
    } catch (err) {
      instance.errors++
      deployment.metrics.totalErrors++

      this.emit({
        type: 'invocation:error',
        deploymentId,
        instanceId: instance.id,
        error: err instanceof Error ? err.message : String(err),
      })

      return new Response(
        JSON.stringify({
          error: 'Request failed',
          message: err instanceof Error ? err.message : String(err),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    } finally {
      instance.activeRequests--
    }
  }

  // ============================================================================
  // Health Monitoring
  // ============================================================================

  private async checkNodeHealth(): Promise<void> {
    const now = Date.now()

    for (const [key, node] of this.nodes) {
      // Skip recent nodes
      if (now - node.lastSeen < this.config.healthCheckInterval) {
        continue
      }

      const healthy = await this.pingNode(node.endpoint)

      if (healthy) {
        node.lastSeen = now
        node.status = 'online'
        this.updateNodeScore(key)
      } else {
        node.status = 'offline'
        this.emit({ type: 'node:offline', agentId: node.agentId })
      }
    }
  }

  private async pingNode(endpoint: string): Promise<boolean> {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(this.config.healthCheckTimeout),
    }).catch(() => null)
    return response?.ok ?? false
  }

  private updateNodeScore(key: string): void {
    const node = this.nodes.get(key)
    if (!node) return

    // Score based on:
    // - Reputation (0-100): higher is better
    // - Stake: higher is better (logarithmic)
    // - Resource availability: higher is better
    // - Recent uptime: higher is better

    const reputationScore = node.reputation * 0.4
    const stakeScore = Math.min(30, Math.log10(Number(node.stake) + 1) * 5)
    const resourceScore =
      (node.resources.availableCpuMillis / 4000 +
        node.resources.availableMemoryMb / 4096) *
      15
    const uptimeScore =
      node.status === 'online' ? 15 : node.status === 'draining' ? 5 : 0

    this.nodeScores.set(
      key,
      reputationScore + stakeScore + resourceScore + uptimeScore,
    )
  }

  // ============================================================================
  // Events
  // ============================================================================

  onEvent(handler: TEEWorkerEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      const idx = this.eventHandlers.indexOf(handler)
      if (idx >= 0) this.eventHandlers.splice(idx, 1)
    }
  }

  private emit(event: TEEWorkerEvent): void {
    for (const handler of this.eventHandlers) {
      Promise.resolve(handler(event)).catch(console.error)
    }
  }

  // ============================================================================
  // Status
  // ============================================================================

  getNode(agentId: bigint): TEEWorkerNode | undefined {
    return this.nodes.get(agentId.toString())
  }

  getAllNodes(): TEEWorkerNode[] {
    return Array.from(this.nodes.values())
  }

  getDeployment(id: string): WorkloadDeployment | undefined {
    return this.deployments.get(id)
  }

  getAllDeployments(): WorkloadDeployment[] {
    return Array.from(this.deployments.values())
  }

  getStats(): {
    environment: NetworkEnvironment
    totalNodes: number
    onlineNodes: number
    nodesByRegion: Record<string, number>
    totalDeployments: number
    activeDeployments: number
  } {
    const nodesByRegion: Record<string, number> = {}
    let onlineNodes = 0

    for (const node of this.nodes.values()) {
      if (node.status === 'online') onlineNodes++
      nodesByRegion[node.region] = (nodesByRegion[node.region] ?? 0) + 1
    }

    return {
      environment: this.config.environment,
      totalNodes: this.nodes.size,
      onlineNodes,
      nodesByRegion,
      totalDeployments: this.deployments.size,
      activeDeployments: Array.from(this.deployments.values()).filter(
        (d) => d.status === 'active',
      ).length,
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCoordinator(
  environment: NetworkEnvironment,
  options?: {
    rpcUrl?: string
    registryAddress?: Address
    privateKey?: `0x${string}`
  },
): RegionalTEECoordinator {
  const rpcUrl =
    options?.rpcUrl ??
    process.env.RPC_URL ??
    (environment === 'localnet' ? 'http://localhost:9545' : undefined)

  if (!rpcUrl) {
    throw new Error('RPC_URL required')
  }

  const registryAddress =
    options?.registryAddress ??
    (process.env.IDENTITY_REGISTRY_ADDRESS as Address) ??
    '0x0000000000000000000000000000000000000000'

  return new RegionalTEECoordinator({
    environment,
    rpcUrl,
    registryAddress,
    privateKey:
      options?.privateKey ?? (process.env.PRIVATE_KEY as `0x${string}`),
    nodeRefreshInterval: 60000,
    healthCheckInterval: 30000,
    healthCheckTimeout: 5000,
    minReputation: environment === 'mainnet' ? 50 : 0,
    minStake: 0n,
  })
}
