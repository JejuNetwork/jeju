/**
 * Decentralized Worker Router
 * Routes worker invocations across distributed nodes
 */

import { getDWSUrl } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import type { WorkerdExecutor } from './executor'
import type { WorkerNode, WorkerRegistration, WorkerRegistry } from './registry'
import {
  WorkerdInvocationResultSchema,
  type WorkerdRequest,
  type WorkerdResponse,
} from './types'

// Types

export interface RouterConfig {
  /** Local node endpoint */
  localEndpoint: string
  /** Enable geographic routing */
  geoRouting: boolean
  /** Preferred region for this node */
  region: string
  /** Max retries for failed requests */
  maxRetries: number
  /** Request timeout in ms */
  timeoutMs: number
  /** Health check interval in ms */
  healthCheckIntervalMs: number
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  localEndpoint: getDWSUrl(),
  geoRouting: true,
  region: 'global',
  maxRetries: 2,
  timeoutMs: 30000,
  healthCheckIntervalMs: 30000,
}

interface NodeHealth {
  node: WorkerNode
  healthy: boolean
  latencyMs: number
  lastChecked: number
  errorCount: number
}

// Worker Router

export class WorkerRouter {
  private registry: WorkerRegistry
  private config: RouterConfig
  private nodeHealth = new Map<string, NodeHealth>()
  private workerLocations = new Map<string, Set<string>>() // workerId -> nodeAgentIds
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private localExecutor: WorkerdExecutor | null = null

  constructor(registry: WorkerRegistry, config: Partial<RouterConfig> = {}) {
    this.registry = registry
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config }
  }

  /**
   * Set the local executor for direct invocation of locally deployed workers
   */
  setLocalExecutor(executor: WorkerdExecutor): void {
    this.localExecutor = executor
    console.log(
      '[WorkerRouter] Local executor configured for direct invocation',
    )
  }

  async start(): Promise<void> {
    // Try to refresh nodes from on-chain registry, but don't fail if it's unavailable
    try {
      await this.refreshNodes()
    } catch (error) {
      console.log(
        `[WorkerRouter] Failed to refresh nodes from registry: ${error instanceof Error ? error.message : String(error)}`,
      )
      console.log(
        '[WorkerRouter] Continuing in local-only mode (no distributed routing)',
      )
    }

    this.healthCheckInterval = setInterval(
      () =>
        this.healthCheck().catch((e) =>
          console.log(
            `[WorkerRouter] Health check failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        ),
      this.config.healthCheckIntervalMs,
    )

    console.log('[WorkerRouter] Started')
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  // Routing

  /**
   * Route a worker invocation to the best available node
   */
  async route(
    workerId: string,
    request: WorkerdRequest,
  ): Promise<WorkerdResponse> {
    // Check if worker is deployed in local executor first (fastest path)
    if (this.localExecutor) {
      const localWorker = this.localExecutor.getWorker(workerId)
      if (localWorker && localWorker.status === 'active') {
        return this.localExecutor.invoke(workerId, request)
      }
    }

    // Fall back to HTTP check for local deployment (other runtimes)
    if (await this.isDeployedLocally(workerId)) {
      return this.invokeLocal(workerId, request)
    }

    // Find nodes that have this worker
    const nodes = await this.findNodesForWorker(workerId)
    if (nodes.length === 0) {
      throw new Error(`No nodes found for worker ${workerId}`)
    }

    // Sort by health and latency
    const sortedNodes = this.sortNodesByHealth(nodes)

    // Try each node until success
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const node = sortedNodes[attempt % sortedNodes.length]
      if (!node) break

      try {
        return await this.invokeRemote(node, workerId, request)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.recordNodeError(node.agentId.toString())
      }
    }

    throw lastError || new Error('All nodes failed')
  }

  /**
   * Route with geographic preference
   */
  async routeWithRegion(
    workerId: string,
    request: WorkerdRequest,
    preferredRegion: string,
  ): Promise<WorkerdResponse> {
    const nodes = await this.findNodesForWorker(workerId)

    // Prefer nodes in the same region
    const regionalNodes = nodes.filter((n) => n.region === preferredRegion)
    if (regionalNodes.length > 0) {
      const sortedNodes = this.sortNodesByHealth(regionalNodes)
      const result = await this.invokeRemote(
        sortedNodes[0],
        workerId,
        request,
      ).catch(() => null)
      if (result) return result
    }

    return this.route(workerId, request)
  }

  // Node Management

  private async refreshNodes(): Promise<void> {
    try {
      const nodes = await this.registry.getNodes()

      for (const node of nodes) {
        const nodeId = node.agentId.toString()

        if (!this.nodeHealth.has(nodeId)) {
          this.nodeHealth.set(nodeId, {
            node,
            healthy: true,
            latencyMs: 0,
            lastChecked: 0,
            errorCount: 0,
          })
        } else {
          const health = this.nodeHealth.get(nodeId)
          if (health) {
            health.node = node
          }
        }
      }
    } catch (e) {
      console.warn(
        '[WorkerRouter] Failed to refresh nodes from registry:',
        e instanceof Error ? e.message : String(e),
      )
      throw e
    }
  }

  private async healthCheck(): Promise<void> {
    const now = Date.now()

    for (const [_nodeId, health] of this.nodeHealth) {
      const start = Date.now()

      const response = await fetch(`${health.node.endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      })

      health.latencyMs = Date.now() - start
      health.lastChecked = now
      health.healthy = response.ok ?? false

      if (health.healthy) {
        health.errorCount = 0
      }
    }
  }

  private async findNodesForWorker(workerId: string): Promise<WorkerNode[]> {
    // Check cache first
    const cachedNodes = this.workerLocations.get(workerId)
    if (cachedNodes && cachedNodes.size > 0) {
      const nodes: WorkerNode[] = []
      for (const nodeId of cachedNodes) {
        const health = this.nodeHealth.get(nodeId)
        if (health?.healthy) {
          nodes.push(health.node)
        }
      }
      if (nodes.length > 0) return nodes
    }

    // Query all healthy nodes for this worker
    const nodes: WorkerNode[] = []
    const nodeSet = new Set<string>()

    for (const [nodeId, health] of this.nodeHealth) {
      if (!health.healthy) continue

      const hasWorker = await this.checkNodeHasWorker(health.node, workerId)
      if (hasWorker) {
        nodes.push(health.node)
        nodeSet.add(nodeId)
      }
    }

    this.workerLocations.set(workerId, nodeSet)
    return nodes
  }

  private async checkNodeHasWorker(
    node: WorkerNode,
    workerId: string,
  ): Promise<boolean> {
    const response = await fetch(`${node.endpoint}/workers/${workerId}`, {
      signal: AbortSignal.timeout(5000),
    })

    return response.ok
  }

  private sortNodesByHealth(nodes: WorkerNode[]): WorkerNode[] {
    return [...nodes].sort((a, b) => {
      const healthA = this.nodeHealth.get(a.agentId.toString())
      const healthB = this.nodeHealth.get(b.agentId.toString())

      if (!healthA || !healthB) return 0

      // Prefer healthy nodes
      if (healthA.healthy && !healthB.healthy) return -1
      if (!healthA.healthy && healthB.healthy) return 1

      // Prefer lower latency
      if (healthA.latencyMs !== healthB.latencyMs) {
        return healthA.latencyMs - healthB.latencyMs
      }

      // Prefer fewer errors
      return healthA.errorCount - healthB.errorCount
    })
  }

  private recordNodeError(nodeId: string): void {
    const health = this.nodeHealth.get(nodeId)
    if (health) {
      health.errorCount++
      if (health.errorCount >= 3) {
        health.healthy = false
      }
    }
  }

  // Invocation

  private async isDeployedLocally(workerId: string): Promise<boolean> {
    const response = await fetch(
      `${this.config.localEndpoint}/workers/${workerId}`,
      {
        signal: AbortSignal.timeout(1000),
      },
    )

    return response.ok
  }

  private async invokeLocal(
    workerId: string,
    request: WorkerdRequest,
  ): Promise<WorkerdResponse> {
    const url = `${this.config.localEndpoint}/workers/${workerId}/invoke`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`Local invocation failed: ${response.status}`)
    }

    const result = expectValid(
      WorkerdInvocationResultSchema,
      await response.json(),
      'workerd invocation result',
    )
    return result.response
  }

  private async invokeRemote(
    node: WorkerNode,
    workerId: string,
    request: WorkerdRequest,
  ): Promise<WorkerdResponse> {
    const url = `${node.endpoint}/workers/${workerId}/invoke`

    const start = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    // Update latency
    const health = this.nodeHealth.get(node.agentId.toString())
    if (health) {
      health.latencyMs = Date.now() - start
    }

    if (!response.ok) {
      throw new Error(`Remote invocation failed: ${response.status}`)
    }

    const result = expectValid(
      WorkerdInvocationResultSchema,
      await response.json(),
      'workerd invocation result',
    )
    return result.response
  }

  // Worker Replication

  /**
   * Replicate a worker to multiple nodes for redundancy
   */
  async replicateWorker(
    worker: WorkerRegistration,
    targetCount: number = 3,
  ): Promise<string[]> {
    const nodes = await this.registry.getNodes()
    if (nodes.length === 0) {
      throw new Error('No nodes available for replication')
    }

    // Find nodes that don't have this worker yet
    const currentNodes = this.workerLocations.get(worker.workerId) || new Set()
    const availableNodes = nodes.filter(
      (n) => !currentNodes.has(n.agentId.toString()),
    )

    // Select nodes for replication (prefer diverse regions)
    const selectedNodes = this.selectNodesForReplication(
      availableNodes,
      targetCount - currentNodes.size,
    )

    const replicatedTo: string[] = []
    for (const node of selectedNodes) {
      const success = await this.deployToNode(node, worker)
      if (success) {
        replicatedTo.push(node.agentId.toString())
        currentNodes.add(node.agentId.toString())
      }
    }

    this.workerLocations.set(worker.workerId, currentNodes)
    return replicatedTo
  }

  private selectNodesForReplication(
    nodes: WorkerNode[],
    count: number,
  ): WorkerNode[] {
    if (nodes.length <= count) return nodes

    // Group by region
    const byRegion = new Map<string, WorkerNode[]>()
    for (const node of nodes) {
      const regionNodes = byRegion.get(node.region) ?? []
      regionNodes.push(node)
      byRegion.set(node.region, regionNodes)
    }

    // Select one from each region, then fill remaining
    const selected: WorkerNode[] = []
    const regions = Array.from(byRegion.keys())

    for (const region of regions) {
      if (selected.length >= count) break
      const regionNodes = byRegion.get(region) ?? []
      if (regionNodes.length > 0) {
        selected.push(regionNodes[0])
      }
    }

    // Fill remaining with highest stake nodes
    const remaining = nodes
      .filter((n) => !selected.includes(n))
      .sort((a, b) => Number(b.stake - a.stake))

    while (selected.length < count && remaining.length > 0) {
      const node = remaining.shift()
      if (node) selected.push(node)
    }

    return selected
  }

  private async deployToNode(
    node: WorkerNode,
    worker: WorkerRegistration,
  ): Promise<boolean> {
    const response = await fetch(`${node.endpoint}/workers/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workerId: worker.workerId,
        codeCid: worker.codeCid,
        memoryMb: worker.memoryMb,
        timeoutMs: worker.timeoutMs,
      }),
      signal: AbortSignal.timeout(60000),
    })

    return response.ok
  }

  // Stats

  getStats() {
    const healthyNodes = Array.from(this.nodeHealth.values()).filter(
      (h) => h.healthy,
    ).length
    const totalNodes = this.nodeHealth.size
    const avgLatency =
      Array.from(this.nodeHealth.values())
        .filter((h) => h.healthy)
        .reduce((sum, h) => sum + h.latencyMs, 0) / (healthyNodes || 1)

    return {
      totalNodes,
      healthyNodes,
      avgLatencyMs: Math.round(avgLatency),
      workersTracked: this.workerLocations.size,
    }
  }
}
