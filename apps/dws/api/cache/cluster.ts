/**
 * Cache Cluster Module
 *
 * Provides production-grade distributed caching features:
 * - Consistent hashing for key distribution
 * - Primary/replica replication with automatic failover
 * - Regional routing with latency-based selection
 * - Cluster health monitoring
 */

import type { CacheEngine } from './engine'
import type { CacheNode, CacheTier } from './types'

// ============================================
// Consistent Hashing
// ============================================

/**
 * Virtual node for consistent hash ring
 */
interface VirtualNode {
  hash: number
  nodeId: string
  replica: number
}

/**
 * Consistent hash ring for distributing keys across nodes
 */
export class ConsistentHashRing {
  private ring: VirtualNode[] = []
  private nodeMap: Map<string, CacheNode> = new Map()
  private virtualNodesPerNode: number

  constructor(virtualNodesPerNode = 150) {
    this.virtualNodesPerNode = virtualNodesPerNode
  }

  /**
   * Add a node to the ring
   */
  addNode(node: CacheNode): void {
    if (this.nodeMap.has(node.nodeId)) {
      this.removeNode(node.nodeId)
    }

    this.nodeMap.set(node.nodeId, node)

    for (let i = 0; i < this.virtualNodesPerNode; i++) {
      const hash = this.hash(`${node.nodeId}:${i}`)
      this.ring.push({
        hash,
        nodeId: node.nodeId,
        replica: i,
      })
    }

    this.ring.sort((a, b) => a.hash - b.hash)
  }

  /**
   * Remove a node from the ring
   */
  removeNode(nodeId: string): void {
    this.nodeMap.delete(nodeId)
    this.ring = this.ring.filter((vn) => vn.nodeId !== nodeId)
  }

  /**
   * Get the primary node for a key
   */
  getNode(key: string): CacheNode | null {
    if (this.ring.length === 0) return null

    const hash = this.hash(key)
    let idx = this.binarySearch(hash)

    // Wrap around if needed
    if (idx >= this.ring.length) idx = 0

    const nodeId = this.ring[idx].nodeId
    return this.nodeMap.get(nodeId) ?? null
  }

  /**
   * Get N nodes for a key (for replication)
   */
  getNodes(key: string, count: number): CacheNode[] {
    if (this.ring.length === 0) return []

    const hash = this.hash(key)
    let idx = this.binarySearch(hash)
    if (idx >= this.ring.length) idx = 0

    const nodes: CacheNode[] = []
    const seenNodes = new Set<string>()
    let scanned = 0

    while (nodes.length < count && scanned < this.ring.length) {
      const vn = this.ring[(idx + scanned) % this.ring.length]
      if (!seenNodes.has(vn.nodeId)) {
        const node = this.nodeMap.get(vn.nodeId)
        if (node && node.status === 'online') {
          nodes.push(node)
          seenNodes.add(vn.nodeId)
        }
      }
      scanned++
    }

    return nodes
  }

  /**
   * Get all nodes in the ring
   */
  getAllNodes(): CacheNode[] {
    return Array.from(this.nodeMap.values())
  }

  /**
   * Get node count
   */
  getNodeCount(): number {
    return this.nodeMap.size
  }

  /**
   * DJB2 hash function
   */
  private hash(key: string): number {
    let hash = 5381
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) ^ key.charCodeAt(i)
    }
    return hash >>> 0 // Convert to unsigned 32-bit
  }

  /**
   * Binary search for the first node with hash >= target
   */
  private binarySearch(hash: number): number {
    let lo = 0
    let hi = this.ring.length

    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ring[mid].hash < hash) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }

    return lo
  }
}

// ============================================
// Replication Manager
// ============================================

/**
 * Replication mode
 */
export const ReplicationMode = {
  NONE: 'none',
  ASYNC: 'async',
  SYNC: 'sync',
} as const
export type ReplicationMode =
  (typeof ReplicationMode)[keyof typeof ReplicationMode]

/**
 * Replication configuration
 */
export interface ReplicationConfig {
  mode: ReplicationMode
  replicaCount: number
  syncTimeoutMs: number
  asyncBatchSize: number
  asyncFlushIntervalMs: number
}

const DEFAULT_REPLICATION_CONFIG: ReplicationConfig = {
  mode: ReplicationMode.ASYNC,
  replicaCount: 2,
  syncTimeoutMs: 100,
  asyncBatchSize: 100,
  asyncFlushIntervalMs: 50,
}

/**
 * Replication operation
 */
interface ReplicationOp {
  type: 'set' | 'del' | 'expire'
  namespace: string
  key: string
  value?: string
  ttl?: number
  timestamp: number
}

/**
 * Manages data replication across cache nodes
 */
export class ReplicationManager {
  private config: ReplicationConfig
  private hashRing: ConsistentHashRing
  private pendingOps: ReplicationOp[] = []
  private flushInterval: ReturnType<typeof setInterval> | null = null
  private nodeEngines: Map<string, CacheEngine> = new Map()

  constructor(
    hashRing: ConsistentHashRing,
    config: Partial<ReplicationConfig> = {},
  ) {
    this.hashRing = hashRing
    this.config = { ...DEFAULT_REPLICATION_CONFIG, ...config }

    if (this.config.mode === ReplicationMode.ASYNC) {
      this.flushInterval = setInterval(
        () => this.flushPending(),
        this.config.asyncFlushIntervalMs,
      )
    }
  }

  /**
   * Stop the replication manager
   */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
  }

  /**
   * Register an engine for a node
   */
  registerEngine(nodeId: string, engine: CacheEngine): void {
    this.nodeEngines.set(nodeId, engine)
  }

  /**
   * Replicate a SET operation
   */
  async replicateSet(
    namespace: string,
    key: string,
    value: string,
    ttl?: number,
  ): Promise<void> {
    const op: ReplicationOp = {
      type: 'set',
      namespace,
      key,
      value,
      ttl,
      timestamp: Date.now(),
    }

    if (this.config.mode === ReplicationMode.SYNC) {
      await this.executeSyncReplication(op)
    } else if (this.config.mode === ReplicationMode.ASYNC) {
      this.pendingOps.push(op)
      if (this.pendingOps.length >= this.config.asyncBatchSize) {
        await this.flushPending()
      }
    }
  }

  /**
   * Replicate a DEL operation
   */
  async replicateDel(namespace: string, key: string): Promise<void> {
    const op: ReplicationOp = {
      type: 'del',
      namespace,
      key,
      timestamp: Date.now(),
    }

    if (this.config.mode === ReplicationMode.SYNC) {
      await this.executeSyncReplication(op)
    } else if (this.config.mode === ReplicationMode.ASYNC) {
      this.pendingOps.push(op)
    }
  }

  /**
   * Get replication status
   */
  getStatus(): {
    mode: ReplicationMode
    pendingOps: number
    replicaCount: number
  } {
    return {
      mode: this.config.mode,
      pendingOps: this.pendingOps.length,
      replicaCount: this.config.replicaCount,
    }
  }

  /**
   * Execute synchronous replication
   */
  private async executeSyncReplication(op: ReplicationOp): Promise<void> {
    const replicas = this.hashRing.getNodes(
      `${op.namespace}:${op.key}`,
      this.config.replicaCount + 1, // +1 for primary
    )

    // Skip primary (first node)
    const replicaNodes = replicas.slice(1)

    const promises = replicaNodes.map(async (node) => {
      const engine = this.nodeEngines.get(node.nodeId)
      if (!engine) return

      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error('Replication timeout')),
          this.config.syncTimeoutMs,
        )
      })

      const execPromise = this.executeOp(engine, op)

      await Promise.race([execPromise, timeoutPromise])
    })

    // Wait for all replicas (best-effort for sync mode)
    await Promise.allSettled(promises)
  }

  /**
   * Flush pending async operations
   */
  private async flushPending(): Promise<void> {
    if (this.pendingOps.length === 0) return

    const ops = this.pendingOps.splice(0, this.config.asyncBatchSize)

    // Group by key to get replica nodes
    const opsByKey = new Map<string, ReplicationOp[]>()
    for (const op of ops) {
      const key = `${op.namespace}:${op.key}`
      const existing = opsByKey.get(key) ?? []
      existing.push(op)
      opsByKey.set(key, existing)
    }

    // Execute replication for each key group
    for (const [key, keyOps] of opsByKey) {
      const replicas = this.hashRing.getNodes(key, this.config.replicaCount + 1)
      const replicaNodes = replicas.slice(1)

      for (const node of replicaNodes) {
        const engine = this.nodeEngines.get(node.nodeId)
        if (!engine) continue

        // Execute latest op for each key
        const latestOp = keyOps[keyOps.length - 1]
        await this.executeOp(engine, latestOp).catch(() => {
          // Log error but don't fail - async replication is best-effort
        })
      }
    }
  }

  /**
   * Execute a replication operation on an engine
   */
  private async executeOp(
    engine: CacheEngine,
    op: ReplicationOp,
  ): Promise<void> {
    switch (op.type) {
      case 'set':
        if (op.value !== undefined) {
          engine.set(op.namespace, op.key, op.value, { ttl: op.ttl })
        }
        break
      case 'del':
        engine.del(op.namespace, op.key)
        break
      case 'expire':
        if (op.ttl !== undefined) {
          engine.expire(op.namespace, op.key, op.ttl)
        }
        break
    }
  }
}

// ============================================
// Regional Routing
// ============================================

/**
 * Region latency info
 */
interface RegionLatency {
  region: string
  latencyMs: number
  lastUpdated: number
}

/**
 * Regional router for latency-based node selection
 */
export class RegionalRouter {
  private regionLatencies: Map<string, RegionLatency> = new Map()
  private hashRing: ConsistentHashRing
  private localRegion: string
  private latencyProbeIntervalMs: number
  private probeInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    hashRing: ConsistentHashRing,
    localRegion: string,
    latencyProbeIntervalMs = 30000,
  ) {
    this.hashRing = hashRing
    this.localRegion = localRegion
    this.latencyProbeIntervalMs = latencyProbeIntervalMs

    // Start probing
    this.probeInterval = setInterval(
      () => this.probeRegions(),
      this.latencyProbeIntervalMs,
    )
  }

  /**
   * Stop the router
   */
  stop(): void {
    if (this.probeInterval) {
      clearInterval(this.probeInterval)
      this.probeInterval = null
    }
  }

  /**
   * Update latency for a region
   */
  updateLatency(region: string, latencyMs: number): void {
    this.regionLatencies.set(region, {
      region,
      latencyMs,
      lastUpdated: Date.now(),
    })
  }

  /**
   * Get the best node for a key based on latency
   */
  getBestNode(key: string, requiredTier?: CacheTier): CacheNode | null {
    const candidates = this.hashRing.getNodes(key, 5)

    if (candidates.length === 0) return null

    // Filter by tier if required
    const filtered = requiredTier
      ? candidates.filter((n) => n.tier === requiredTier)
      : candidates

    if (filtered.length === 0) return candidates[0]

    // Sort by estimated latency
    filtered.sort((a, b) => {
      const latA = this.getEstimatedLatency(a.region)
      const latB = this.getEstimatedLatency(b.region)
      return latA - latB
    })

    return filtered[0]
  }

  /**
   * Get nodes in a specific region
   */
  getNodesInRegion(region: string): CacheNode[] {
    return this.hashRing.getAllNodes().filter((n) => n.region === region)
  }

  /**
   * Get all regions with their latencies
   */
  getRegionLatencies(): RegionLatency[] {
    return Array.from(this.regionLatencies.values())
  }

  /**
   * Get estimated latency for a region
   */
  private getEstimatedLatency(region: string): number {
    // Same region = lowest latency
    if (region === this.localRegion) return 1

    const info = this.regionLatencies.get(region)
    if (info) return info.latencyMs

    // Default latency estimates for unknown regions
    return 100
  }

  /**
   * Probe all regions for latency
   */
  private async probeRegions(): Promise<void> {
    const nodes = this.hashRing.getAllNodes()
    const regions = new Set(nodes.map((n) => n.region))

    for (const region of regions) {
      if (region === this.localRegion) {
        this.updateLatency(region, 1)
        continue
      }

      // Find a node in the region to probe
      const regionNode = nodes.find((n) => n.region === region)
      if (!regionNode) continue

      // Measure latency with a simple health check
      const start = Date.now()
      await fetch(`${regionNode.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)
      const latency = Date.now() - start

      this.updateLatency(region, latency)
    }
  }
}

// ============================================
// AOF Persistence
// ============================================

/**
 * AOF entry
 */
interface AOFEntry {
  timestamp: number
  op: 'set' | 'del' | 'expire' | 'hset' | 'lpush' | 'rpush' | 'sadd' | 'zadd'
  namespace: string
  key: string
  args: string[]
}

/**
 * AOF configuration
 */
export interface AOFConfig {
  enabled: boolean
  filePath: string
  fsyncMode: 'always' | 'everysec' | 'no'
  rewriteThreshold: number // Bytes before triggering rewrite
}

const DEFAULT_AOF_CONFIG: AOFConfig = {
  enabled: false,
  filePath: '/tmp/cache.aof',
  fsyncMode: 'everysec',
  rewriteThreshold: 64 * 1024 * 1024, // 64MB
}

/**
 * Append-Only File persistence for cache durability
 */
export class AOFPersistence {
  private config: AOFConfig
  private buffer: AOFEntry[] = []
  private fileHandle: {
    write: (data: string) => Promise<void>
    close: () => Promise<void>
  } | null = null
  private bytesWritten = 0
  private flushInterval: ReturnType<typeof setInterval> | null = null
  private engine: CacheEngine | null = null

  constructor(config: Partial<AOFConfig> = {}) {
    this.config = { ...DEFAULT_AOF_CONFIG, ...config }

    if (this.config.enabled && this.config.fsyncMode === 'everysec') {
      this.flushInterval = setInterval(() => this.flush(), 1000)
    }
  }

  /**
   * Initialize AOF with an engine for replay
   */
  async initialize(engine: CacheEngine): Promise<void> {
    this.engine = engine

    if (!this.config.enabled) return

    // Open file for appending
    const file = Bun.file(this.config.filePath)
    const writer = file.writer()
    this.fileHandle = {
      write: async (data: string) => {
        writer.write(data)
        if (this.config.fsyncMode === 'always') {
          await writer.flush()
        }
      },
      close: async () => {
        await writer.end()
      },
    }

    // Replay existing AOF if exists
    if (await file.exists()) {
      await this.replay()
    }
  }

  /**
   * Stop AOF persistence
   */
  async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }

    await this.flush()

    if (this.fileHandle) {
      await this.fileHandle.close()
      this.fileHandle = null
    }
  }

  /**
   * Log a SET operation
   */
  logSet(namespace: string, key: string, value: string, ttl?: number): void {
    if (!this.config.enabled) return

    const args = [value]
    if (ttl !== undefined) args.push(String(ttl))

    this.buffer.push({
      timestamp: Date.now(),
      op: 'set',
      namespace,
      key,
      args,
    })

    if (this.config.fsyncMode === 'always') {
      this.flush()
    }
  }

  /**
   * Log a DEL operation
   */
  logDel(namespace: string, key: string): void {
    if (!this.config.enabled) return

    this.buffer.push({
      timestamp: Date.now(),
      op: 'del',
      namespace,
      key,
      args: [],
    })

    if (this.config.fsyncMode === 'always') {
      this.flush()
    }
  }

  /**
   * Log an EXPIRE operation
   */
  logExpire(namespace: string, key: string, seconds: number): void {
    if (!this.config.enabled) return

    this.buffer.push({
      timestamp: Date.now(),
      op: 'expire',
      namespace,
      key,
      args: [String(seconds)],
    })

    if (this.config.fsyncMode === 'always') {
      this.flush()
    }
  }

  /**
   * Log an HSET operation
   */
  logHSet(namespace: string, key: string, field: string, value: string): void {
    if (!this.config.enabled) return

    this.buffer.push({
      timestamp: Date.now(),
      op: 'hset',
      namespace,
      key,
      args: [field, value],
    })
  }

  /**
   * Log an LPUSH operation
   */
  logLPush(namespace: string, key: string, values: string[]): void {
    if (!this.config.enabled) return

    this.buffer.push({
      timestamp: Date.now(),
      op: 'lpush',
      namespace,
      key,
      args: values,
    })
  }

  /**
   * Log an RPUSH operation
   */
  logRPush(namespace: string, key: string, values: string[]): void {
    if (!this.config.enabled) return

    this.buffer.push({
      timestamp: Date.now(),
      op: 'rpush',
      namespace,
      key,
      args: values,
    })
  }

  /**
   * Log an SADD operation
   */
  logSAdd(namespace: string, key: string, members: string[]): void {
    if (!this.config.enabled) return

    this.buffer.push({
      timestamp: Date.now(),
      op: 'sadd',
      namespace,
      key,
      args: members,
    })
  }

  /**
   * Log a ZADD operation
   */
  logZAdd(
    namespace: string,
    key: string,
    members: Array<{ member: string; score: number }>,
  ): void {
    if (!this.config.enabled) return

    const args = members.flatMap((m) => [String(m.score), m.member])

    this.buffer.push({
      timestamp: Date.now(),
      op: 'zadd',
      namespace,
      key,
      args,
    })
  }

  /**
   * Get AOF stats
   */
  getStats(): {
    enabled: boolean
    bytesWritten: number
    pendingEntries: number
  } {
    return {
      enabled: this.config.enabled,
      bytesWritten: this.bytesWritten,
      pendingEntries: this.buffer.length,
    }
  }

  /**
   * Flush buffer to disk
   */
  private async flush(): Promise<void> {
    if (!this.fileHandle || this.buffer.length === 0) return

    const entries = this.buffer.splice(0, this.buffer.length)
    const lines = entries.map((e) => this.serializeEntry(e))
    const data = `${lines.join('\n')}\n`

    await this.fileHandle.write(data)
    this.bytesWritten += data.length

    // Check if rewrite is needed
    if (this.bytesWritten >= this.config.rewriteThreshold) {
      await this.rewrite()
    }
  }

  /**
   * Serialize an AOF entry to a line
   */
  private serializeEntry(entry: AOFEntry): string {
    // Format: timestamp|op|namespace|key|arg1|arg2|...
    const parts = [
      String(entry.timestamp),
      entry.op,
      entry.namespace,
      entry.key,
      ...entry.args.map((a) => Buffer.from(a).toString('base64')),
    ]
    return parts.join('|')
  }

  /**
   * Parse an AOF line back to an entry
   */
  private parseEntry(line: string): AOFEntry | null {
    const parts = line.split('|')
    if (parts.length < 4) return null

    return {
      timestamp: parseInt(parts[0], 10),
      op: parts[1] as AOFEntry['op'],
      namespace: parts[2],
      key: parts[3],
      args: parts.slice(4).map((a) => Buffer.from(a, 'base64').toString()),
    }
  }

  /**
   * Replay AOF file to restore state
   */
  private async replay(): Promise<void> {
    if (!this.engine) return

    const file = Bun.file(this.config.filePath)
    const text = await file.text()
    const lines = text.split('\n').filter((l) => l.trim())

    let replayed = 0

    for (const line of lines) {
      const entry = this.parseEntry(line)
      if (!entry) continue

      this.replayEntry(entry)
      replayed++
    }

    console.log(`[AOF] Replayed ${replayed} entries`)
  }

  /**
   * Replay a single entry
   */
  private replayEntry(entry: AOFEntry): void {
    if (!this.engine) return

    switch (entry.op) {
      case 'set': {
        const ttl =
          entry.args.length > 1 ? parseInt(entry.args[1], 10) : undefined
        this.engine.set(entry.namespace, entry.key, entry.args[0], { ttl })
        break
      }
      case 'del':
        this.engine.del(entry.namespace, entry.key)
        break
      case 'expire':
        this.engine.expire(
          entry.namespace,
          entry.key,
          parseInt(entry.args[0], 10),
        )
        break
      case 'hset':
        this.engine.hset(
          entry.namespace,
          entry.key,
          entry.args[0],
          entry.args[1],
        )
        break
      case 'lpush':
        this.engine.lpush(entry.namespace, entry.key, ...entry.args)
        break
      case 'rpush':
        this.engine.rpush(entry.namespace, entry.key, ...entry.args)
        break
      case 'sadd':
        this.engine.sadd(entry.namespace, entry.key, ...entry.args)
        break
      case 'zadd': {
        const members: Array<{ member: string; score: number }> = []
        for (let i = 0; i < entry.args.length; i += 2) {
          members.push({
            score: parseFloat(entry.args[i]),
            member: entry.args[i + 1],
          })
        }
        this.engine.zadd(entry.namespace, entry.key, ...members)
        break
      }
    }
  }

  /**
   * Rewrite AOF file with current state (compaction)
   */
  private async rewrite(): Promise<void> {
    if (!this.engine) return

    console.log('[AOF] Starting rewrite...')

    // Create temp file
    const tempPath = `${this.config.filePath}.tmp`
    const tempFile = Bun.file(tempPath)
    const writer = tempFile.writer()

    // Write current state
    const namespaces = this.engine.getAllNamespaceStats()

    for (const ns of namespaces) {
      const keys = this.engine.keys(ns.namespace, '*')
      for (const key of keys) {
        const type = this.engine.type(ns.namespace, key)
        const entry = this.createSnapshotEntry(ns.namespace, key, type)
        if (entry) {
          writer.write(`${this.serializeEntry(entry)}\n`)
        }
      }
    }

    await writer.end()

    // Atomic rename
    const fs = await import('node:fs/promises')
    await fs.rename(tempPath, this.config.filePath)

    this.bytesWritten = await Bun.file(this.config.filePath).size

    console.log(`[AOF] Rewrite complete, new size: ${this.bytesWritten} bytes`)
  }

  /**
   * Create a snapshot entry for a key
   */
  private createSnapshotEntry(
    namespace: string,
    key: string,
    type: string,
  ): AOFEntry | null {
    if (!this.engine) return null

    const now = Date.now()

    switch (type) {
      case 'string': {
        const value = this.engine.get(namespace, key)
        if (value === null) return null
        const ttl = this.engine.ttl(namespace, key)
        return {
          timestamp: now,
          op: 'set',
          namespace,
          key,
          args: ttl > 0 ? [value, String(ttl)] : [value],
        }
      }
      case 'hash': {
        const hash = this.engine.hgetall(namespace, key)
        // Return multiple HSET entries
        const entries = Object.entries(hash)
        if (entries.length === 0) return null
        // For simplicity, just return the first one (full snapshot would need multiple)
        return {
          timestamp: now,
          op: 'hset',
          namespace,
          key,
          args: [entries[0][0], entries[0][1]],
        }
      }
      case 'list': {
        const list = this.engine.lrange(namespace, key, 0, -1)
        if (list.length === 0) return null
        return {
          timestamp: now,
          op: 'rpush',
          namespace,
          key,
          args: list,
        }
      }
      case 'set': {
        const members = this.engine.smembers(namespace, key)
        if (members.length === 0) return null
        return {
          timestamp: now,
          op: 'sadd',
          namespace,
          key,
          args: members,
        }
      }
      case 'zset': {
        const range = this.engine.zrange(namespace, key, 0, -1, true) as Array<{
          member: string
          score: number
        }>
        if (range.length === 0) return null
        return {
          timestamp: now,
          op: 'zadd',
          namespace,
          key,
          args: range.flatMap((m) => [String(m.score), m.member]),
        }
      }
      default:
        return null
    }
  }
}

// ============================================
// Cluster Manager
// ============================================

/**
 * Cluster configuration
 */
export interface ClusterConfig {
  localRegion: string
  replication: Partial<ReplicationConfig>
  aof: Partial<AOFConfig>
  virtualNodesPerNode: number
}

const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  localRegion: 'local',
  replication: {},
  aof: {},
  virtualNodesPerNode: 150,
}

/**
 * Main cluster manager coordinating all distributed features
 */
export class ClusterManager {
  private config: ClusterConfig
  private hashRing: ConsistentHashRing
  private replication: ReplicationManager
  private router: RegionalRouter
  private aof: AOFPersistence
  private localEngine: CacheEngine | null = null

  constructor(config: Partial<ClusterConfig> = {}) {
    this.config = { ...DEFAULT_CLUSTER_CONFIG, ...config }

    this.hashRing = new ConsistentHashRing(this.config.virtualNodesPerNode)
    this.replication = new ReplicationManager(
      this.hashRing,
      this.config.replication,
    )
    this.router = new RegionalRouter(this.hashRing, this.config.localRegion)
    this.aof = new AOFPersistence(this.config.aof)
  }

  /**
   * Initialize the cluster with a local engine
   */
  async initialize(engine: CacheEngine): Promise<void> {
    this.localEngine = engine
    await this.aof.initialize(engine)
  }

  /**
   * Stop the cluster manager
   */
  async stop(): Promise<void> {
    this.replication.stop()
    this.router.stop()
    await this.aof.stop()
  }

  /**
   * Add a node to the cluster
   */
  addNode(node: CacheNode, engine?: CacheEngine): void {
    this.hashRing.addNode(node)
    if (engine) {
      this.replication.registerEngine(node.nodeId, engine)
    }
  }

  /**
   * Remove a node from the cluster
   */
  removeNode(nodeId: string): void {
    this.hashRing.removeNode(nodeId)
  }

  /**
   * Get the best node for a key
   */
  getNode(key: string, tier?: CacheTier): CacheNode | null {
    return this.router.getBestNode(key, tier)
  }

  /**
   * Get replica nodes for a key
   */
  getReplicas(key: string, count: number): CacheNode[] {
    return this.hashRing.getNodes(key, count)
  }

  /**
   * Perform a SET with replication
   */
  async set(
    namespace: string,
    key: string,
    value: string,
    ttl?: number,
  ): Promise<void> {
    // Write to local engine
    if (this.localEngine) {
      this.localEngine.set(namespace, key, value, { ttl })
    }

    // Log to AOF
    this.aof.logSet(namespace, key, value, ttl)

    // Replicate
    await this.replication.replicateSet(namespace, key, value, ttl)
  }

  /**
   * Perform a DEL with replication
   */
  async del(namespace: string, key: string): Promise<void> {
    // Delete from local engine
    if (this.localEngine) {
      this.localEngine.del(namespace, key)
    }

    // Log to AOF
    this.aof.logDel(namespace, key)

    // Replicate
    await this.replication.replicateDel(namespace, key)
  }

  /**
   * Get cluster status
   */
  getStatus(): {
    nodes: number
    regions: RegionLatency[]
    replication: {
      mode: ReplicationMode
      pendingOps: number
      replicaCount: number
    }
    aof: { enabled: boolean; bytesWritten: number; pendingEntries: number }
  } {
    return {
      nodes: this.hashRing.getNodeCount(),
      regions: this.router.getRegionLatencies(),
      replication: this.replication.getStatus(),
      aof: this.aof.getStats(),
    }
  }

  /**
   * Get hash ring for testing
   */
  getHashRing(): ConsistentHashRing {
    return this.hashRing
  }

  /**
   * Get replication manager for testing
   */
  getReplicationManager(): ReplicationManager {
    return this.replication
  }

  /**
   * Get AOF persistence for testing
   */
  getAOF(): AOFPersistence {
    return this.aof
  }
}

// Singleton
let clusterManager: ClusterManager | null = null

export function getClusterManager(): ClusterManager {
  if (!clusterManager) {
    clusterManager = new ClusterManager()
  }
  return clusterManager
}

export function resetClusterManager(): void {
  if (clusterManager) {
    clusterManager.stop()
    clusterManager = null
  }
}
