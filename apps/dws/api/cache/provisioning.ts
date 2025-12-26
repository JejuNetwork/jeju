/**
 * Cache Instance Provisioning
 *
 * Serverless cache instance lifecycle management:
 * - Instance creation/deletion
 * - Resource allocation
 * - Node assignment
 * - Health monitoring
 * - x402 billing integration (see billing.ts)
 */

import { getCQL } from '@jejunetwork/db'
import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import { CacheEngine } from './engine'
import { createTEECacheProvider, type TEECacheProvider } from './tee-provider'
import {
  CacheError,
  CacheErrorCode,
  type CacheEvent,
  type CacheEventListener,
  CacheEventType,
  type CacheInstance,
  CacheInstanceStatus,
  type CacheNode,
  type CacheRentalPlan,
  type CacheStats,
  type CacheTEEAttestation,
  CacheTEEProvider,
  CacheTier,
} from './types'

const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'dws-cache'

// Rental Plans

const DEFAULT_PLANS: CacheRentalPlan[] = [
  {
    id: 'standard-64',
    name: 'Standard 64MB',
    tier: CacheTier.STANDARD,
    maxMemoryMb: 64,
    maxKeys: 100000,
    maxTtlSeconds: 86400,
    pricePerHour: 0n,
    pricePerMonth: 0n,
    teeRequired: false,
    features: ['namespace-isolation', 'basic-eviction'],
  },
  {
    id: 'standard-256',
    name: 'Standard 256MB',
    tier: CacheTier.STANDARD,
    maxMemoryMb: 256,
    maxKeys: 500000,
    maxTtlSeconds: 86400 * 7,
    pricePerHour: 100000000000000n, // 0.0001 ETH
    pricePerMonth: 50000000000000000n, // 0.05 ETH
    teeRequired: false,
    features: ['namespace-isolation', 'lru-eviction', 'extended-ttl'],
  },
  {
    id: 'premium-1024',
    name: 'Premium 1GB',
    tier: CacheTier.PREMIUM,
    maxMemoryMb: 1024,
    maxKeys: 2000000,
    maxTtlSeconds: 86400 * 30,
    pricePerHour: 500000000000000n, // 0.0005 ETH
    pricePerMonth: 250000000000000000n, // 0.25 ETH
    teeRequired: false,
    features: [
      'dedicated-resources',
      'lru-eviction',
      'extended-ttl',
      'higher-memory',
    ],
  },
  {
    id: 'tee-256',
    name: 'TEE Secure 256MB',
    tier: CacheTier.TEE,
    maxMemoryMb: 256,
    maxKeys: 500000,
    maxTtlSeconds: 86400 * 7,
    pricePerHour: 1000000000000000n, // 0.001 ETH
    pricePerMonth: 500000000000000000n, // 0.5 ETH
    teeRequired: true,
    features: [
      'tee-attestation',
      'memory-encryption',
      'audit-logging',
      'key-escrow',
    ],
  },
  {
    id: 'tee-1024',
    name: 'TEE Secure 1GB',
    tier: CacheTier.TEE,
    maxMemoryMb: 1024,
    maxKeys: 2000000,
    maxTtlSeconds: 86400 * 30,
    pricePerHour: 3000000000000000n, // 0.003 ETH
    pricePerMonth: 1500000000000000000n, // 1.5 ETH
    teeRequired: true,
    features: [
      'tee-attestation',
      'memory-encryption',
      'audit-logging',
      'key-escrow',
      'dedicated-cvm',
    ],
  },
]

// CQL Row types

interface CacheInstanceRow {
  id: string
  owner: string
  namespace: string
  tier: string
  max_memory_mb: number
  used_memory_mb: number
  key_count: number
  created_at: number
  expires_at: number
  status: string
  tee_provider: string | null
  node_id: string | null
  endpoint: string | null
}

interface CacheNodeRow {
  node_id: string
  address: string
  endpoint: string
  region: string
  tier: string
  tee_provider: string | null
  max_memory_mb: number
  used_memory_mb: number
  instance_count: number
  status: string
  last_heartbeat: number
}

/**
 * Cache Provisioning Manager
 *
 * Manages serverless cache instance lifecycle.
 */
export class CacheProvisioningManager {
  private instances: Map<string, CacheInstance> = new Map()
  private nodes: Map<string, CacheNode> = new Map()
  private engines: Map<string, CacheEngine> = new Map()
  private teeProviders: Map<string, TEECacheProvider> = new Map()
  private plans: CacheRentalPlan[] = DEFAULT_PLANS
  private listeners: Set<CacheEventListener> = new Set()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private cqlClient: ReturnType<typeof getCQL> | null = null
  private initialized = false

  /**
   * Initialize the provisioning manager
   */
  async initialize(): Promise<void> {
    console.log('[Cache Provisioning] Initializing...')

    // Initialize CQL client
    this.cqlClient = getCQL()

    // Create tables
    await this.ensureTablesExist()

    // Load existing instances and nodes from CQL
    await this.loadFromCQL()

    // Start cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredInstances(),
      60000,
    )

    this.initialized = true
    console.log('[Cache Provisioning] Initialized')
  }

  /**
   * Stop the provisioning manager
   */
  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Stop all engines
    for (const engine of this.engines.values()) {
      engine.stop()
    }

    // Stop all TEE providers
    for (const provider of this.teeProviders.values()) {
      await provider.stop()
    }

    this.initialized = false
    console.log('[Cache Provisioning] Stopped')
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  getPlans(): CacheRentalPlan[] {
    return this.plans
  }

  getPlan(planId: string): CacheRentalPlan | null {
    return this.plans.find((p) => p.id === planId) ?? null
  }

  async createInstance(
    owner: Address,
    planId: string,
    namespace?: string,
    durationHours = 720, // 30 days default
  ): Promise<CacheInstance> {
    const plan = this.getPlan(planId)
    if (!plan) {
      throw new CacheError(
        CacheErrorCode.INVALID_OPERATION,
        `Plan not found: ${planId}`,
      )
    }

    const instanceId = this.generateInstanceId(owner, namespace)
    const instanceNamespace = namespace ?? instanceId
    const now = Date.now()
    const expiresAt = now + durationHours * 60 * 60 * 1000

    // Find suitable node (may be null in development without registered nodes)
    const node = await this.findNodeForInstance(plan.tier, plan.maxMemoryMb)
    if (!node) {
      console.warn(
        `[Cache Provisioning] No node found for tier ${plan.tier}, instance ${instanceId} will be local-only`,
      )
    }

    // Create engine or TEE provider based on tier
    if (plan.tier === CacheTier.TEE) {
      const teeProvider = createTEECacheProvider({
        provider: CacheTEEProvider.DSTACK,
        maxMemoryMb: plan.maxMemoryMb,
        encryptionEnabled: true,
        nodeId: instanceId,
      })

      const attestation = await teeProvider.initialize()

      const instance: CacheInstance = {
        id: instanceId,
        owner,
        namespace: instanceNamespace,
        tier: plan.tier,
        maxMemoryMb: plan.maxMemoryMb,
        usedMemoryMb: 0,
        keyCount: 0,
        createdAt: now,
        expiresAt,
        status: CacheInstanceStatus.RUNNING,
        teeProvider: CacheTEEProvider.DSTACK,
        teeAttestation: attestation,
        nodeId: node?.nodeId,
        endpoint: node?.endpoint,
      }

      this.instances.set(instanceId, instance)
      this.teeProviders.set(instanceId, teeProvider)
      await this.saveInstanceToCQL(instance)

      this.emit({
        type: CacheEventType.INSTANCE_CREATE,
        timestamp: now,
        instanceId,
        metadata: { owner, tier: plan.tier },
      })

      return instance
    }

    // Standard/Premium instance - use regular engine
    const engine = new CacheEngine({
      maxMemoryMb: plan.maxMemoryMb,
      defaultTtlSeconds: 3600,
      maxTtlSeconds: plan.maxTtlSeconds,
      evictionPolicy: 'lru',
    })

    const instance: CacheInstance = {
      id: instanceId,
      owner,
      namespace: instanceNamespace,
      tier: plan.tier,
      maxMemoryMb: plan.maxMemoryMb,
      usedMemoryMb: 0,
      keyCount: 0,
      createdAt: now,
      expiresAt,
      status: CacheInstanceStatus.RUNNING,
      nodeId: node?.nodeId,
      endpoint: node?.endpoint,
    }

    this.instances.set(instanceId, instance)
    this.engines.set(instanceId, engine)
    await this.saveInstanceToCQL(instance)

    // Update node usage
    if (node) {
      node.usedMemoryMb += plan.maxMemoryMb
      node.instanceCount++
      await this.saveNodeToCQL(node)
    }

    this.emit({
      type: CacheEventType.INSTANCE_CREATE,
      timestamp: now,
      instanceId,
      metadata: { owner, tier: plan.tier },
    })

    return instance
  }

  getInstance(instanceId: string): CacheInstance | null {
    return this.instances.get(instanceId) ?? null
  }

  getInstancesByOwner(owner: Address): CacheInstance[] {
    const ownerLower = owner.toLowerCase()
    return Array.from(this.instances.values()).filter(
      (i) => i.owner.toLowerCase() === ownerLower,
    )
  }

  getAllInstances(): CacheInstance[] {
    return Array.from(this.instances.values())
  }

  async deleteInstance(instanceId: string, owner: Address): Promise<boolean> {
    const instance = this.instances.get(instanceId)
    if (!instance) return false

    if (instance.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new CacheError(CacheErrorCode.UNAUTHORIZED, 'Not instance owner')
    }

    // Stop engine or TEE provider
    const engine = this.engines.get(instanceId)
    if (engine) {
      engine.stop()
      this.engines.delete(instanceId)
    }

    const teeProvider = this.teeProviders.get(instanceId)
    if (teeProvider) {
      await teeProvider.stop()
      this.teeProviders.delete(instanceId)
    }

    // Update node usage
    if (instance.nodeId) {
      const node = this.nodes.get(instance.nodeId)
      if (node) {
        node.usedMemoryMb -= instance.maxMemoryMb
        node.instanceCount--
        await this.saveNodeToCQL(node)
      }
    }

    // Remove from CQL
    await this.deleteInstanceFromCQL(instanceId)

    this.instances.delete(instanceId)

    this.emit({
      type: CacheEventType.INSTANCE_DELETE,
      timestamp: Date.now(),
      instanceId,
      metadata: { owner },
    })

    return true
  }

  async extendInstance(
    instanceId: string,
    owner: Address,
    additionalHours: number,
  ): Promise<CacheInstance> {
    const instance = this.instances.get(instanceId)
    if (!instance) {
      throw new CacheError(
        CacheErrorCode.INSTANCE_NOT_FOUND,
        `Instance not found: ${instanceId}`,
      )
    }

    if (instance.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new CacheError(CacheErrorCode.UNAUTHORIZED, 'Not instance owner')
    }

    instance.expiresAt += additionalHours * 60 * 60 * 1000
    await this.saveInstanceToCQL(instance)

    return instance
  }

  async registerNode(
    nodeId: string,
    address: Address,
    endpoint: string,
    region: string,
    tier: CacheTier,
    maxMemoryMb: number,
    teeProvider?: CacheTEEProvider,
    attestation?: CacheTEEAttestation,
  ): Promise<CacheNode> {
    const node: CacheNode = {
      nodeId,
      address,
      endpoint,
      region,
      tier,
      teeProvider,
      maxMemoryMb,
      usedMemoryMb: 0,
      instanceCount: 0,
      status: 'online',
      lastHeartbeat: Date.now(),
      attestation,
    }

    this.nodes.set(nodeId, node)
    await this.saveNodeToCQL(node)

    this.emit({
      type: CacheEventType.NODE_JOIN,
      timestamp: Date.now(),
      nodeId,
      metadata: { address, tier },
    })

    return node
  }

  async updateNodeHeartbeat(
    nodeId: string,
    attestation?: CacheTEEAttestation,
  ): Promise<boolean> {
    const node = this.nodes.get(nodeId)
    if (!node) return false

    node.lastHeartbeat = Date.now()
    node.status = 'online'

    if (attestation) {
      node.attestation = attestation
      this.emit({
        type: CacheEventType.ATTESTATION_REFRESH,
        timestamp: Date.now(),
        nodeId,
      })
    }

    await this.saveNodeToCQL(node)
    return true
  }

  getNode(nodeId: string): CacheNode | null {
    return this.nodes.get(nodeId) ?? null
  }

  getAllNodes(): CacheNode[] {
    return Array.from(this.nodes.values())
  }

  getNodesByTier(tier: CacheTier): CacheNode[] {
    return Array.from(this.nodes.values()).filter(
      (n) => n.tier === tier && n.status === 'online',
    )
  }

  getEngine(instanceId: string): CacheEngine | null {
    return this.engines.get(instanceId) ?? null
  }

  getTEEProvider(instanceId: string): TEECacheProvider | null {
    return this.teeProviders.get(instanceId) ?? null
  }

  /**
   * Get engine by namespace (finds instance first)
   */
  getEngineByNamespace(namespace: string): CacheEngine | null {
    for (const [instanceId, instance] of this.instances) {
      if (instance.namespace === namespace) {
        return this.engines.get(instanceId) ?? null
      }
    }
    return null
  }

  /**
   * Get TEE provider by namespace
   */
  getTEEProviderByNamespace(namespace: string): TEECacheProvider | null {
    for (const [instanceId, instance] of this.instances) {
      if (instance.namespace === namespace) {
        return this.teeProviders.get(instanceId) ?? null
      }
    }
    return null
  }

  /**
   * Get instance by namespace
   */
  getInstanceByNamespace(namespace: string): CacheInstance | null {
    for (const instance of this.instances.values()) {
      if (instance.namespace === namespace) {
        return instance
      }
    }
    return null
  }

  /**
   * Update instance stats
   */
  async updateInstanceStats(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    const engine = this.engines.get(instanceId)
    const teeProvider = this.teeProviders.get(instanceId)

    let stats: CacheStats | null = null

    if (engine) {
      stats = engine.getStats()
    } else if (teeProvider) {
      stats = teeProvider.getStats()
    }

    if (stats) {
      instance.usedMemoryMb = stats.usedMemoryBytes / (1024 * 1024)
      instance.keyCount = stats.totalKeys
      await this.saveInstanceToCQL(instance)
    }
  }

  getGlobalStats(): {
    totalInstances: number
    totalNodes: number
    totalMemoryMb: number
    usedMemoryMb: number
    totalKeys: number
    tierBreakdown: Record<CacheTier, number>
  } {
    let totalMemoryMb = 0
    let usedMemoryMb = 0
    let totalKeys = 0
    const tierBreakdown: Record<CacheTier, number> = {
      [CacheTier.STANDARD]: 0,
      [CacheTier.PREMIUM]: 0,
      [CacheTier.TEE]: 0,
    }

    for (const instance of this.instances.values()) {
      totalMemoryMb += instance.maxMemoryMb
      usedMemoryMb += instance.usedMemoryMb
      totalKeys += instance.keyCount
      tierBreakdown[instance.tier]++
    }

    return {
      totalInstances: this.instances.size,
      totalNodes: this.nodes.size,
      totalMemoryMb,
      usedMemoryMb,
      totalKeys,
      tierBreakdown,
    }
  }

  on(listener: CacheEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: CacheEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private generateInstanceId(owner: Address, namespace?: string): string {
    const data = `${owner}:${namespace ?? ''}:${Date.now()}:${Math.random()}`
    return keccak256(toBytes(data)).slice(2, 18)
  }

  private async findNodeForInstance(
    tier: CacheTier,
    memoryMb: number,
  ): Promise<CacheNode | null> {
    const candidates = Array.from(this.nodes.values()).filter((node) => {
      if (node.status !== 'online') return false
      if (node.tier !== tier && tier !== CacheTier.STANDARD) return false
      if (node.maxMemoryMb - node.usedMemoryMb < memoryMb) return false
      return true
    })

    if (candidates.length === 0) return null

    // Sort by available memory (ascending) to pack efficiently
    candidates.sort(
      (a, b) =>
        a.maxMemoryMb - a.usedMemoryMb - (b.maxMemoryMb - b.usedMemoryMb),
    )

    return candidates[0]
  }

  private async cleanupExpiredInstances(): Promise<void> {
    const now = Date.now()
    const expiredIds: string[] = []

    for (const [id, instance] of this.instances) {
      if (instance.expiresAt < now) {
        expiredIds.push(id)
      }
    }

    for (const id of expiredIds) {
      const instance = this.instances.get(id)
      if (instance) {
        instance.status = CacheInstanceStatus.EXPIRED
        await this.deleteInstance(id, instance.owner)
      }
    }

    // Mark offline nodes
    const offlineThreshold = 120000 // 2 minutes
    for (const node of this.nodes.values()) {
      if (
        node.status === 'online' &&
        now - node.lastHeartbeat > offlineThreshold
      ) {
        node.status = 'offline'
        await this.saveNodeToCQL(node)
        this.emit({
          type: CacheEventType.NODE_LEAVE,
          timestamp: now,
          nodeId: node.nodeId,
        })
      }
    }
  }

  private async ensureTablesExist(): Promise<void> {
    if (!this.cqlClient) {
      console.warn(
        '[Cache Provisioning] CQL client not initialized, skipping table creation',
      )
      return
    }

    const tables = [
      `CREATE TABLE IF NOT EXISTS cache_instances (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        namespace TEXT NOT NULL,
        tier TEXT NOT NULL,
        max_memory_mb INTEGER NOT NULL,
        used_memory_mb INTEGER DEFAULT 0,
        key_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        tee_provider TEXT,
        node_id TEXT,
        endpoint TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS cache_nodes (
        node_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        region TEXT NOT NULL,
        tier TEXT NOT NULL,
        tee_provider TEXT,
        max_memory_mb INTEGER NOT NULL,
        used_memory_mb INTEGER DEFAULT 0,
        instance_count INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'online',
        last_heartbeat INTEGER NOT NULL
      )`,
    ]

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_cache_instances_owner ON cache_instances(owner)',
      'CREATE INDEX IF NOT EXISTS idx_cache_instances_namespace ON cache_instances(namespace)',
      'CREATE INDEX IF NOT EXISTS idx_cache_nodes_tier ON cache_nodes(tier)',
      'CREATE INDEX IF NOT EXISTS idx_cache_nodes_status ON cache_nodes(status)',
    ]

    for (const ddl of tables) {
      await this.cqlClient.exec(ddl, [], CQL_DATABASE_ID)
    }

    for (const idx of indexes) {
      await this.cqlClient.exec(idx, [], CQL_DATABASE_ID)
    }

    console.log('[Cache Provisioning] CQL tables ensured')
  }

  private async loadFromCQL(): Promise<void> {
    if (!this.cqlClient) {
      console.warn(
        '[Cache Provisioning] CQL client not initialized, skipping data load',
      )
      return
    }

    // Load instances
    const instancesResult = await this.cqlClient.query<CacheInstanceRow>(
      'SELECT * FROM cache_instances WHERE status = ?',
      ['running'],
      CQL_DATABASE_ID,
    )

    for (const row of instancesResult.rows) {
      const instance: CacheInstance = {
        id: row.id,
        owner: row.owner as Address,
        namespace: row.namespace,
        tier: row.tier as CacheTier,
        maxMemoryMb: row.max_memory_mb,
        usedMemoryMb: row.used_memory_mb,
        keyCount: row.key_count,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        status: row.status as CacheInstanceStatus,
        teeProvider: row.tee_provider as CacheTEEProvider | undefined,
        nodeId: row.node_id ?? undefined,
        endpoint: row.endpoint ?? undefined,
      }

      this.instances.set(instance.id, instance)

      // Recreate engine/provider based on tier
      if (instance.tier === CacheTier.TEE) {
        // TEE instances need their provider recreated
        const teeProvider = createTEECacheProvider({
          provider: instance.teeProvider ?? CacheTEEProvider.DSTACK,
          maxMemoryMb: instance.maxMemoryMb,
          encryptionEnabled: true,
          nodeId: instance.id,
        })
        // Initialize in background - don't block loading
        teeProvider
          .initialize()
          .then((attestation) => {
            instance.teeAttestation = attestation
            console.log(
              `[Cache Provisioning] TEE provider reinitialized for ${instance.id}`,
            )
          })
          .catch((err) => {
            console.error(
              `[Cache Provisioning] Failed to reinitialize TEE provider for ${instance.id}:`,
              err,
            )
            instance.status = CacheInstanceStatus.ERROR
          })
        this.teeProviders.set(instance.id, teeProvider)
      } else {
        // Standard/Premium instances use regular engine
        const engine = new CacheEngine({
          maxMemoryMb: instance.maxMemoryMb,
          defaultTtlSeconds: 3600,
          evictionPolicy: 'lru',
        })
        this.engines.set(instance.id, engine)
      }
    }

    // Load nodes
    const nodesResult = await this.cqlClient.query<CacheNodeRow>(
      'SELECT * FROM cache_nodes',
      [],
      CQL_DATABASE_ID,
    )

    for (const row of nodesResult.rows) {
      const node: CacheNode = {
        nodeId: row.node_id,
        address: row.address as Address,
        endpoint: row.endpoint,
        region: row.region,
        tier: row.tier as CacheTier,
        teeProvider: row.tee_provider as CacheTEEProvider | undefined,
        maxMemoryMb: row.max_memory_mb,
        usedMemoryMb: row.used_memory_mb,
        instanceCount: row.instance_count,
        status: row.status as CacheNode['status'],
        lastHeartbeat: row.last_heartbeat,
      }

      this.nodes.set(node.nodeId, node)
    }

    console.log(
      `[Cache Provisioning] Loaded ${this.instances.size} instances, ${this.nodes.size} nodes`,
    )
  }

  private async saveInstanceToCQL(instance: CacheInstance): Promise<void> {
    if (!this.cqlClient) {
      console.warn(
        `[Cache Provisioning] CQL unavailable, instance ${instance.id} not persisted`,
      )
      return
    }

    await this.cqlClient.exec(
      `INSERT INTO cache_instances (id, owner, namespace, tier, max_memory_mb, used_memory_mb, key_count, created_at, expires_at, status, tee_provider, node_id, endpoint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
       used_memory_mb = excluded.used_memory_mb,
       key_count = excluded.key_count,
       status = excluded.status,
       expires_at = excluded.expires_at`,
      [
        instance.id,
        instance.owner.toLowerCase(),
        instance.namespace,
        instance.tier,
        instance.maxMemoryMb,
        Math.round(instance.usedMemoryMb),
        instance.keyCount,
        instance.createdAt,
        instance.expiresAt,
        instance.status,
        instance.teeProvider ?? null,
        instance.nodeId ?? null,
        instance.endpoint ?? null,
      ],
      CQL_DATABASE_ID,
    )
  }

  private async deleteInstanceFromCQL(instanceId: string): Promise<void> {
    if (!this.cqlClient) {
      console.warn(
        `[Cache Provisioning] CQL unavailable, instance ${instanceId} deletion not persisted`,
      )
      return
    }

    await this.cqlClient.exec(
      'DELETE FROM cache_instances WHERE id = ?',
      [instanceId],
      CQL_DATABASE_ID,
    )
  }

  private async saveNodeToCQL(node: CacheNode): Promise<void> {
    if (!this.cqlClient) {
      console.warn(
        `[Cache Provisioning] CQL unavailable, node ${node.nodeId} not persisted`,
      )
      return
    }

    await this.cqlClient.exec(
      `INSERT INTO cache_nodes (node_id, address, endpoint, region, tier, tee_provider, max_memory_mb, used_memory_mb, instance_count, status, last_heartbeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET
       used_memory_mb = excluded.used_memory_mb,
       instance_count = excluded.instance_count,
       status = excluded.status,
       last_heartbeat = excluded.last_heartbeat`,
      [
        node.nodeId,
        node.address.toLowerCase(),
        node.endpoint,
        node.region,
        node.tier,
        node.teeProvider ?? null,
        node.maxMemoryMb,
        Math.round(node.usedMemoryMb),
        node.instanceCount,
        node.status,
        node.lastHeartbeat,
      ],
      CQL_DATABASE_ID,
    )
  }
}

// Singleton

let provisioningManager: CacheProvisioningManager | null = null

export function getCacheProvisioningManager(): CacheProvisioningManager {
  if (!provisioningManager) {
    provisioningManager = new CacheProvisioningManager()
  }
  return provisioningManager
}

export async function initializeCacheProvisioning(): Promise<CacheProvisioningManager> {
  const manager = getCacheProvisioningManager()
  await manager.initialize()
  return manager
}

export function resetCacheProvisioning(): void {
  if (provisioningManager) {
    provisioningManager.stop()
    provisioningManager = null
  }
}
