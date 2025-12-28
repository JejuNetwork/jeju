import { createHash } from 'node:crypto'
import type { Address } from 'viem'

export type ScalingDirection = 'up' | 'down' | 'none'

export type MetricType =
  | 'cpu'
  | 'memory'
  | 'requests'
  | 'queue-depth'
  | 'custom'

export interface ScalingPolicy {
  policyId: string
  targetId: string
  targetType: 'worker' | 'container' | 'node-pool'
  name: string

  // Scaling bounds
  minReplicas: number
  maxReplicas: number
  currentReplicas: number

  // Metrics
  metrics: ScalingMetric[]

  // Behavior
  scaleUpBehavior: ScalingBehavior
  scaleDownBehavior: ScalingBehavior
  cooldownSeconds: number

  // Scale to zero
  scaleToZero: boolean
  scaleToZeroDelaySeconds: number

  // Metadata
  owner: Address
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastScaleTime?: number
}

export interface ScalingMetric {
  type: MetricType
  target: number // Target value (e.g., 70 for 70% CPU)
  averageValue?: number // Alternative: target average value
  customMetric?: string // For custom metric type
  weight: number // Weight in multi-metric scenarios
}

export interface ScalingBehavior {
  stabilizationWindowSeconds: number
  policies: BehaviorPolicy[]
  selectPolicy: 'max' | 'min' | 'disabled'
}

export interface BehaviorPolicy {
  type: 'pods' | 'percent'
  value: number
  periodSeconds: number
}

export interface ScalingDecision {
  policyId: string
  direction: ScalingDirection
  currentReplicas: number
  desiredReplicas: number
  reason: string
  metrics: Array<{ type: MetricType; current: number; target: number }>
  timestamp: number
}

export interface NodePool {
  poolId: string
  name: string
  nodeType: string
  minNodes: number
  maxNodes: number
  currentNodes: number

  // Resource info
  cpuPerNode: number
  memoryPerNode: number

  // Status
  pendingNodes: number
  drainingNodes: number

  // Cost
  costPerHour: number

  createdAt: number
  updatedAt: number
}

export interface NodePoolScalingDecision {
  poolId: string
  direction: ScalingDirection
  currentNodes: number
  desiredNodes: number
  reason: string
  estimatedSavings?: number
  timestamp: number
}

export interface MetricSample {
  metricType: MetricType
  value: number
  timestamp: number
}

// ============================================================================
// Metric Collector
// ============================================================================

class MetricCollector {
  private samples = new Map<string, MetricSample[]>()
  private maxSamples = 300 // 5 minutes at 1s interval

  record(targetId: string, metricType: MetricType, value: number): void {
    const key = `${targetId}:${metricType}`
    const samples = this.samples.get(key) ?? []

    samples.push({
      metricType,
      value,
      timestamp: Date.now(),
    })

    // Keep only recent samples
    while (samples.length > this.maxSamples) {
      samples.shift()
    }

    this.samples.set(key, samples)
  }

  getAverage(
    targetId: string,
    metricType: MetricType,
    windowSeconds: number,
  ): number | null {
    const key = `${targetId}:${metricType}`
    const samples = this.samples.get(key)

    if (!samples || samples.length === 0) return null

    const cutoff = Date.now() - windowSeconds * 1000
    const recentSamples = samples.filter((s) => s.timestamp >= cutoff)

    if (recentSamples.length === 0) return null

    return (
      recentSamples.reduce((sum, s) => sum + s.value, 0) / recentSamples.length
    )
  }

  getP99(
    targetId: string,
    metricType: MetricType,
    windowSeconds: number,
  ): number | null {
    const key = `${targetId}:${metricType}`
    const samples = this.samples.get(key)

    if (!samples || samples.length === 0) return null

    const cutoff = Date.now() - windowSeconds * 1000
    const recentSamples = samples.filter((s) => s.timestamp >= cutoff)

    if (recentSamples.length === 0) return null

    const sorted = recentSamples.map((s) => s.value).sort((a, b) => a - b)
    const index = Math.floor(sorted.length * 0.99)

    return sorted[Math.min(index, sorted.length - 1)]
  }

  clear(targetId: string): void {
    for (const key of this.samples.keys()) {
      if (key.startsWith(`${targetId}:`)) {
        this.samples.delete(key)
      }
    }
  }
}

// ============================================================================
// Cluster Autoscaler
// ============================================================================

export class ClusterAutoscaler {
  private policies = new Map<string, ScalingPolicy>()
  private policiesByTarget = new Map<string, string>() // targetId -> policyId
  private nodePools = new Map<string, NodePool>()
  private decisions: ScalingDecision[] = []
  private nodePoolDecisions: NodePoolScalingDecision[] = []

  private metricCollector: MetricCollector
  private scaleCallback: (
    targetId: string,
    targetType: string,
    replicas: number,
  ) => Promise<void>
  private nodeCallback: (poolId: string, nodes: number) => Promise<void>

  private scalingInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    scaleCallback: (
      targetId: string,
      targetType: string,
      replicas: number,
    ) => Promise<void>,
    nodeCallback: (poolId: string, nodes: number) => Promise<void>,
  ) {
    this.scaleCallback = scaleCallback
    this.nodeCallback = nodeCallback
    this.metricCollector = new MetricCollector()
  }

  // =========================================================================
  // Policy Management
  // =========================================================================

  createPolicy(
    owner: Address,
    targetId: string,
    targetType: 'worker' | 'container' | 'node-pool',
    name: string,
    config: {
      minReplicas: number
      maxReplicas: number
      metrics: ScalingMetric[]
      scaleToZero?: boolean
      scaleToZeroDelaySeconds?: number
      cooldownSeconds?: number
    },
  ): ScalingPolicy {
    const policyId = createHash('sha256')
      .update(`${targetId}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const policy: ScalingPolicy = {
      policyId,
      targetId,
      targetType,
      name,
      minReplicas: config.minReplicas,
      maxReplicas: config.maxReplicas,
      currentReplicas: config.minReplicas,
      metrics: config.metrics,
      scaleUpBehavior: {
        stabilizationWindowSeconds: 0,
        policies: [{ type: 'pods', value: 4, periodSeconds: 15 }],
        selectPolicy: 'max',
      },
      scaleDownBehavior: {
        stabilizationWindowSeconds: 300,
        policies: [{ type: 'percent', value: 10, periodSeconds: 60 }],
        selectPolicy: 'min',
      },
      cooldownSeconds: config.cooldownSeconds ?? 60,
      scaleToZero: config.scaleToZero ?? false,
      scaleToZeroDelaySeconds: config.scaleToZeroDelaySeconds ?? 300,
      owner,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.policies.set(policyId, policy)
    this.policiesByTarget.set(targetId, policyId)

    console.log(
      `[Autoscaler] Created policy ${name} for ${targetType} ${targetId}`,
    )

    return policy
  }

  updatePolicy(
    policyId: string,
    updates: Partial<ScalingPolicy>,
  ): ScalingPolicy | null {
    const policy = this.policies.get(policyId)
    if (!policy) return null

    Object.assign(policy, updates)
    policy.updatedAt = Date.now()

    return policy
  }

  deletePolicy(policyId: string): void {
    const policy = this.policies.get(policyId)
    if (!policy) return

    this.policiesByTarget.delete(policy.targetId)
    this.policies.delete(policyId)
    this.metricCollector.clear(policy.targetId)

    console.log(`[Autoscaler] Deleted policy ${policy.name}`)
  }

  enablePolicy(policyId: string): void {
    const policy = this.policies.get(policyId)
    if (policy) {
      policy.enabled = true
      policy.updatedAt = Date.now()
    }
  }

  disablePolicy(policyId: string): void {
    const policy = this.policies.get(policyId)
    if (policy) {
      policy.enabled = false
      policy.updatedAt = Date.now()
    }
  }

  // =========================================================================
  // Node Pool Management
  // =========================================================================

  registerNodePool(
    pool: Omit<NodePool, 'poolId' | 'createdAt' | 'updatedAt'>,
  ): NodePool {
    const poolId = createHash('sha256')
      .update(`${pool.name}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const fullPool: NodePool = {
      ...pool,
      poolId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.nodePools.set(poolId, fullPool)

    console.log(
      `[Autoscaler] Registered node pool ${pool.name} (${pool.currentNodes}/${pool.maxNodes} nodes)`,
    )

    return fullPool
  }

  updateNodePool(poolId: string, updates: Partial<NodePool>): void {
    const pool = this.nodePools.get(poolId)
    if (!pool) return

    Object.assign(pool, updates)
    pool.updatedAt = Date.now()
  }

  // =========================================================================
  // Metric Recording
  // =========================================================================

  recordMetric(targetId: string, metricType: MetricType, value: number): void {
    this.metricCollector.record(targetId, metricType, value)
  }

  recordMetrics(targetId: string, metrics: Record<MetricType, number>): void {
    for (const [type, value] of Object.entries(metrics)) {
      this.metricCollector.record(targetId, type as MetricType, value)
    }
  }

  // =========================================================================
  // Scaling Logic
  // =========================================================================

  start(intervalMs = 15000): void {
    if (this.scalingInterval) return

    console.log('[Autoscaler] Started')

    this.scalingInterval = setInterval(() => {
      this.evaluate().catch(console.error)
    }, intervalMs)

    // Initial evaluation
    this.evaluate().catch(console.error)
  }

  stop(): void {
    if (this.scalingInterval) {
      clearInterval(this.scalingInterval)
      this.scalingInterval = null
      console.log('[Autoscaler] Stopped')
    }
  }

  private async evaluate(): Promise<void> {
    // Evaluate worker/container policies
    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue

      const decision = this.evaluatePolicy(policy)

      if (decision.direction !== 'none') {
        await this.applyDecision(policy, decision)
      }
    }

    // Evaluate node pools
    await this.evaluateNodePools()
  }

  private evaluatePolicy(policy: ScalingPolicy): ScalingDecision {
    const now = Date.now()

    // Check cooldown
    if (
      policy.lastScaleTime &&
      now - policy.lastScaleTime < policy.cooldownSeconds * 1000
    ) {
      return {
        policyId: policy.policyId,
        direction: 'none',
        currentReplicas: policy.currentReplicas,
        desiredReplicas: policy.currentReplicas,
        reason: 'Cooldown active',
        metrics: [],
        timestamp: now,
      }
    }

    const metricResults: Array<{
      type: MetricType
      current: number
      target: number
      ratio: number
    }> = []
    let weightedRatio = 0
    let totalWeight = 0

    // Calculate scaling ratio from each metric
    for (const metric of policy.metrics) {
      const current = this.metricCollector.getAverage(
        policy.targetId,
        metric.type,
        60,
      )

      if (current === null) continue

      const target = metric.target
      const ratio = current / target

      metricResults.push({
        type: metric.type,
        current,
        target,
        ratio,
      })

      weightedRatio += ratio * metric.weight
      totalWeight += metric.weight
    }

    if (totalWeight === 0) {
      return {
        policyId: policy.policyId,
        direction: 'none',
        currentReplicas: policy.currentReplicas,
        desiredReplicas: policy.currentReplicas,
        reason: 'No metric data available',
        metrics: [],
        timestamp: now,
      }
    }

    const avgRatio = weightedRatio / totalWeight
    let desiredReplicas = Math.ceil(policy.currentReplicas * avgRatio)

    // Clamp to bounds
    const effectiveMin = policy.scaleToZero ? 0 : policy.minReplicas
    desiredReplicas = Math.max(
      effectiveMin,
      Math.min(policy.maxReplicas, desiredReplicas),
    )

    // Apply behavior policies
    if (desiredReplicas > policy.currentReplicas) {
      desiredReplicas = this.applyScaleUpBehavior(policy, desiredReplicas)
    } else if (desiredReplicas < policy.currentReplicas) {
      desiredReplicas = this.applyScaleDownBehavior(policy, desiredReplicas)
    }

    // Determine direction
    let direction: ScalingDirection = 'none'
    let reason = 'No scaling needed'

    if (desiredReplicas > policy.currentReplicas) {
      direction = 'up'
      reason = `Scaling up: ${metricResults.map((m) => `${m.type}=${m.current.toFixed(1)}/${m.target}`).join(', ')}`
    } else if (desiredReplicas < policy.currentReplicas) {
      direction = 'down'
      reason = `Scaling down: ${metricResults.map((m) => `${m.type}=${m.current.toFixed(1)}/${m.target}`).join(', ')}`
    }

    return {
      policyId: policy.policyId,
      direction,
      currentReplicas: policy.currentReplicas,
      desiredReplicas,
      reason,
      metrics: metricResults.map((m) => ({
        type: m.type,
        current: m.current,
        target: m.target,
      })),
      timestamp: now,
    }
  }

  private applyScaleUpBehavior(policy: ScalingPolicy, desired: number): number {
    if (policy.scaleUpBehavior.selectPolicy === 'disabled') {
      return policy.currentReplicas
    }

    const maxIncrease = policy.scaleUpBehavior.policies.reduce(
      (max, p) => {
        const increase =
          p.type === 'pods'
            ? p.value
            : Math.ceil(policy.currentReplicas * (p.value / 100))
        return policy.scaleUpBehavior.selectPolicy === 'max'
          ? Math.max(max, increase)
          : Math.min(max, increase)
      },
      policy.scaleUpBehavior.selectPolicy === 'max' ? 0 : Infinity,
    )

    return Math.min(desired, policy.currentReplicas + maxIncrease)
  }

  private applyScaleDownBehavior(
    policy: ScalingPolicy,
    desired: number,
  ): number {
    if (policy.scaleDownBehavior.selectPolicy === 'disabled') {
      return policy.currentReplicas
    }

    const maxDecrease = policy.scaleDownBehavior.policies.reduce(
      (max, p) => {
        const decrease =
          p.type === 'pods'
            ? p.value
            : Math.ceil(policy.currentReplicas * (p.value / 100))
        return policy.scaleDownBehavior.selectPolicy === 'min'
          ? Math.min(max, decrease)
          : Math.max(max, decrease)
      },
      policy.scaleDownBehavior.selectPolicy === 'min' ? Infinity : 0,
    )

    return Math.max(desired, policy.currentReplicas - maxDecrease)
  }

  private async applyDecision(
    policy: ScalingPolicy,
    decision: ScalingDecision,
  ): Promise<void> {
    console.log(
      `[Autoscaler] ${policy.name}: ${decision.currentReplicas} -> ${decision.desiredReplicas} (${decision.reason})`,
    )

    try {
      await this.scaleCallback(
        policy.targetId,
        policy.targetType,
        decision.desiredReplicas,
      )

      policy.currentReplicas = decision.desiredReplicas
      policy.lastScaleTime = Date.now()
      policy.updatedAt = Date.now()

      this.decisions.push(decision)

      // Keep only last 100 decisions
      if (this.decisions.length > 100) {
        this.decisions.shift()
      }
    } catch (error) {
      console.error(`[Autoscaler] Failed to scale ${policy.name}:`, error)
    }
  }

  // =========================================================================
  // Node Pool Scaling
  // =========================================================================

  private async evaluateNodePools(): Promise<void> {
    for (const pool of this.nodePools.values()) {
      const decision = this.evaluateNodePool(pool)

      if (decision.direction !== 'none') {
        await this.applyNodePoolDecision(pool, decision)
      }
    }
  }

  private evaluateNodePool(pool: NodePool): NodePoolScalingDecision {
    // Calculate total resource usage across all pods targeting this pool
    let totalCpuRequired = 0
    let totalMemoryRequired = 0

    for (const policy of this.policies.values()) {
      if (policy.targetType !== 'worker' && policy.targetType !== 'container')
        continue

      // Estimate resource per replica
      const cpuPerReplica = 0.5 // Would come from actual resource requests
      const memoryPerReplica = 512 // MB

      totalCpuRequired += policy.currentReplicas * cpuPerReplica
      totalMemoryRequired += policy.currentReplicas * memoryPerReplica
    }

    const cpuCapacity = pool.currentNodes * pool.cpuPerNode
    const memoryCapacity = pool.currentNodes * pool.memoryPerNode

    const cpuUtilization = totalCpuRequired / cpuCapacity
    const memoryUtilization = totalMemoryRequired / memoryCapacity

    let desiredNodes = pool.currentNodes

    // Scale up if utilization > 80%
    if (cpuUtilization > 0.8 || memoryUtilization > 0.8) {
      const cpuNeeded = Math.ceil(totalCpuRequired / (pool.cpuPerNode * 0.8))
      const memoryNeeded = Math.ceil(
        totalMemoryRequired / (pool.memoryPerNode * 0.8),
      )
      desiredNodes = Math.max(cpuNeeded, memoryNeeded)
    }
    // Scale down if utilization < 50%
    else if (cpuUtilization < 0.5 && memoryUtilization < 0.5) {
      const cpuNeeded = Math.ceil(totalCpuRequired / (pool.cpuPerNode * 0.7))
      const memoryNeeded = Math.ceil(
        totalMemoryRequired / (pool.memoryPerNode * 0.7),
      )
      desiredNodes = Math.max(cpuNeeded, memoryNeeded, pool.minNodes)
    }

    // Clamp to bounds
    desiredNodes = Math.max(
      pool.minNodes,
      Math.min(pool.maxNodes, desiredNodes),
    )

    let direction: ScalingDirection = 'none'
    let reason = 'Utilization within target range'

    if (desiredNodes > pool.currentNodes) {
      direction = 'up'
      reason = `Scaling up: CPU=${(cpuUtilization * 100).toFixed(1)}%, Memory=${(memoryUtilization * 100).toFixed(1)}%`
    } else if (desiredNodes < pool.currentNodes) {
      direction = 'down'
      reason = `Scaling down: CPU=${(cpuUtilization * 100).toFixed(1)}%, Memory=${(memoryUtilization * 100).toFixed(1)}%`
    }

    const estimatedSavings =
      direction === 'down'
        ? (pool.currentNodes - desiredNodes) * pool.costPerHour * 24 * 30
        : undefined

    return {
      poolId: pool.poolId,
      direction,
      currentNodes: pool.currentNodes,
      desiredNodes,
      reason,
      estimatedSavings,
      timestamp: Date.now(),
    }
  }

  private async applyNodePoolDecision(
    pool: NodePool,
    decision: NodePoolScalingDecision,
  ): Promise<void> {
    console.log(
      `[Autoscaler] Node pool ${pool.name}: ${decision.currentNodes} -> ${decision.desiredNodes} nodes (${decision.reason})`,
    )

    if (decision.estimatedSavings) {
      console.log(
        `[Autoscaler] Estimated monthly savings: $${decision.estimatedSavings.toFixed(2)}`,
      )
    }

    try {
      await this.nodeCallback(pool.poolId, decision.desiredNodes)

      pool.currentNodes = decision.desiredNodes
      pool.updatedAt = Date.now()

      this.nodePoolDecisions.push(decision)

      if (this.nodePoolDecisions.length > 100) {
        this.nodePoolDecisions.shift()
      }
    } catch (error) {
      console.error(
        `[Autoscaler] Failed to scale node pool ${pool.name}:`,
        error,
      )
    }
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getPolicy(policyId: string): ScalingPolicy | undefined {
    return this.policies.get(policyId)
  }

  getPolicyForTarget(targetId: string): ScalingPolicy | undefined {
    const policyId = this.policiesByTarget.get(targetId)
    return policyId ? this.policies.get(policyId) : undefined
  }

  listPolicies(): ScalingPolicy[] {
    return Array.from(this.policies.values())
  }

  getRecentDecisions(limit = 20): ScalingDecision[] {
    return this.decisions.slice(-limit)
  }

  getNodePool(poolId: string): NodePool | undefined {
    return this.nodePools.get(poolId)
  }

  listNodePools(): NodePool[] {
    return Array.from(this.nodePools.values())
  }

  getRecentNodePoolDecisions(limit = 20): NodePoolScalingDecision[] {
    return this.nodePoolDecisions.slice(-limit)
  }
}

// ============================================================================
// Factory
// ============================================================================

let clusterAutoscaler: ClusterAutoscaler | null = null

export function getClusterAutoscaler(
  scaleCallback: (
    targetId: string,
    targetType: string,
    replicas: number,
  ) => Promise<void>,
  nodeCallback: (poolId: string, nodes: number) => Promise<void>,
): ClusterAutoscaler {
  if (!clusterAutoscaler) {
    clusterAutoscaler = new ClusterAutoscaler(scaleCallback, nodeCallback)
    clusterAutoscaler.start()
  }
  return clusterAutoscaler
}
