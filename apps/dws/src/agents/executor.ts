/**
 * Agent Executor
 * Manages agent workers via workerd
 */

import { z } from 'zod'
import type {
  IWorkerdExecutor,
  WorkerdBinding,
  WorkerdWorkerDefinition,
} from '../workers/workerd/types'
import * as registry from './registry'
import type {
  AgentConfig,
  AgentEvent,
  AgentEventHandler,
  AgentInstance,
  AgentInvocation,
  AgentMessage,
  AgentResponse,
  WarmPoolConfig,
} from './types'
import { DEFAULT_WARM_POOL_CONFIG } from './types'

// Schema for workerd invoke result
const AgentInvokeResultSchema = z.object({
  success: z.boolean(),
  response: z
    .object({
      id: z.string(),
      agentId: z.string(),
      text: z.string(),
      actions: z
        .array(
          z.object({
            name: z.string(),
            params: z.record(z.string(), z.string()),
          }),
        )
        .optional(),
      metadata: z
        .object({
          model: z.string().optional(),
          tokensUsed: z.number().optional(),
          latencyMs: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  error: z.string().optional(),
})

// ============================================================================
// Executor Configuration
// ============================================================================

export interface ExecutorConfig {
  /** DWS internal URLs */
  inferenceUrl: string
  kmsUrl: string
  cqlUrl: string

  /** Warm pool settings */
  warmPool: WarmPoolConfig

  /** Pre-built ElizaOS worker CID */
  elizaWorkerCid: string
}

// Pre-built ElizaOS worker bundle CID - set via ELIZA_WORKER_CID env or deploy via dws worker publish
const DEFAULT_ELIZA_WORKER_CID = 'eliza-worker-v1'

// ============================================================================
// Agent Executor
// ============================================================================

export class AgentExecutor {
  private config: ExecutorConfig
  private workerd: IWorkerdExecutor

  private instances = new Map<string, AgentInstance[]>()
  private invocations = new Map<string, AgentInvocation>()
  private requestTimes = new Map<string, number[]>()
  private eventHandlers: AgentEventHandler[] = []

  constructor(workerd: IWorkerdExecutor, config: Partial<ExecutorConfig> = {}) {
    this.workerd = workerd
    this.config = {
      inferenceUrl:
        config.inferenceUrl ??
        process.env.DWS_INFERENCE_URL ??
        'http://127.0.0.1:4030/compute',
      kmsUrl:
        config.kmsUrl ?? process.env.DWS_KMS_URL ?? 'http://127.0.0.1:4030/kms',
      cqlUrl:
        config.cqlUrl ?? process.env.DWS_CQL_URL ?? 'http://127.0.0.1:4028',
      warmPool: config.warmPool ?? DEFAULT_WARM_POOL_CONFIG,
      elizaWorkerCid: config.elizaWorkerCid ?? DEFAULT_ELIZA_WORKER_CID,
    }

    // Cleanup interval
    setInterval(() => this.cleanup(), 30000)
  }

  // ============================================================================
  // Agent Deployment
  // ============================================================================

  async deployAgent(agentId: string): Promise<void> {
    const agent = registry.getAgent(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }

    await registry.updateAgentStatus(agentId, 'deploying')

    // Create worker definition for this agent
    const workerDef = this.createWorkerDefinition(agent)

    // Deploy via workerd
    await this.workerd.deployWorker(workerDef)

    // Create initial instance
    const instance = await this.createInstance(agent, workerDef.id)

    const instances = this.instances.get(agentId) ?? []
    instances.push(instance)
    this.instances.set(agentId, instances)

    await registry.updateAgentStatus(agentId, 'active')

    this.emit({ type: 'agent:deployed', agentId })
    console.log(
      `[AgentExecutor] Deployed agent: ${agent.character.name} (${agentId})`,
    )
  }

  async undeployAgent(agentId: string): Promise<void> {
    const instances = this.instances.get(agentId) ?? []

    for (const instance of instances) {
      await this.stopInstance(instance)
    }

    this.instances.delete(agentId)

    // Undeploy worker
    const workerId = `eliza-agent-${agentId}`
    const worker = this.workerd.getWorker(workerId)
    if (worker) {
      await this.workerd.undeployWorker(workerId)
    }
  }

  private createWorkerDefinition(agent: AgentConfig): WorkerdWorkerDefinition {
    const bindings: WorkerdBinding[] = [
      // DWS internal services
      {
        name: 'DWS_INFERENCE_URL',
        type: 'text',
        value: this.config.inferenceUrl,
      },
      { name: 'DWS_KMS_URL', type: 'text', value: this.config.kmsUrl },
      { name: 'DWS_CQL_URL', type: 'text', value: this.config.cqlUrl },

      // Agent-specific
      { name: 'AGENT_ID', type: 'text', value: agent.id },
      {
        name: 'AGENT_CHARACTER',
        type: 'text',
        value: JSON.stringify(agent.character),
      },
    ]

    if (agent.memoriesDbId) {
      bindings.push({
        name: 'MEMORIES_DB_ID',
        type: 'text',
        value: agent.memoriesDbId,
      })
    }
    if (agent.secretsKeyId) {
      bindings.push({
        name: 'SECRETS_KEY_ID',
        type: 'text',
        value: agent.secretsKeyId,
      })
    }
    if (agent.runtime.plugins.length > 0) {
      bindings.push({
        name: 'LOADED_PLUGINS',
        type: 'text',
        value: agent.runtime.plugins.join(','),
      })
    }

    return {
      id: `eliza-agent-${agent.id}`,
      name: `eliza-${agent.character.name.toLowerCase().replace(/\s+/g, '-')}`,
      owner: agent.owner,

      codeCid: this.config.elizaWorkerCid,
      mainModule: 'index.js',
      modules: [],

      bindings,
      compatibilityDate: '2024-01-01',

      memoryMb: agent.runtime.maxMemoryMb,
      cpuTimeMs: agent.runtime.timeoutMs,
      timeoutMs: agent.runtime.timeoutMs,

      status: 'pending',
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  private async createInstance(
    agent: AgentConfig,
    workerId: string,
  ): Promise<AgentInstance> {
    const workerInstance = this.workerd.getInstance(workerId)

    return {
      agentId: agent.id,
      instanceId: crypto.randomUUID(),
      workerId,
      status: workerInstance?.status === 'ready' ? 'ready' : 'starting',
      endpoint: workerInstance?.endpoint ?? '',
      port: workerInstance?.port ?? 0,
      activeInvocations: 0,
      totalInvocations: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      memoryUsedMb: 0,
      loadedPlugins: agent.runtime.plugins,
    }
  }

  private async stopInstance(instance: AgentInstance): Promise<void> {
    instance.status = 'draining'

    // Wait for active invocations
    const deadline = Date.now() + 30000
    while (instance.activeInvocations > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000))
    }

    instance.status = 'stopped'
  }

  // ============================================================================
  // Agent Invocation
  // ============================================================================

  async invokeAgent(
    agentId: string,
    message: AgentMessage,
  ): Promise<AgentResponse> {
    const agent = registry.getAgent(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }
    if (agent.status !== 'active') {
      throw new Error(
        `Agent ${agentId} is not active (status: ${agent.status})`,
      )
    }

    const invocationId = crypto.randomUUID()
    const invocation: AgentInvocation = {
      id: invocationId,
      agentId,
      message,
      status: 'pending',
      startedAt: Date.now(),
    }
    this.invocations.set(invocationId, invocation)
    this.emit({ type: 'agent:invoked', agentId, invocationId })

    try {
      // Get or create instance
      const instance = await this.acquireInstance(agentId)
      if (!instance) {
        throw new Error('No available instance')
      }

      invocation.instanceId = instance.instanceId
      invocation.status = 'processing'
      instance.activeInvocations++
      instance.lastActivityAt = Date.now()

      // Record request time for warm pool logic
      this.recordRequestTime(agentId)

      // Invoke worker
      const workerId = `eliza-agent-${agentId}`
      const result = await this.workerd.invoke(workerId, {
        method: 'POST',
        url: '/invoke',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
          message,
        }),
      })

      if (result.status >= 400) {
        throw new Error(`Worker returned ${result.status}: ${result.body}`)
      }

      const bodyStr =
        typeof result.body === 'string'
          ? result.body
          : result.body.toString('utf-8')
      const parseResult = AgentInvokeResultSchema.safeParse(
        JSON.parse(bodyStr || '{}'),
      )
      if (
        !parseResult.success ||
        !parseResult.data.success ||
        !parseResult.data.response
      ) {
        throw new Error(parseResult.data?.error ?? 'Unknown error')
      }

      const response = parseResult.data.response

      invocation.response = response
      invocation.status = 'completed'
      invocation.completedAt = Date.now()
      invocation.durationMs = invocation.completedAt - invocation.startedAt

      instance.activeInvocations--
      instance.totalInvocations++
      instance.status = instance.activeInvocations > 0 ? 'busy' : 'ready'

      // Record metrics
      registry.recordInvocation(agentId, invocation.durationMs)

      this.emit({
        type: 'agent:completed',
        agentId,
        invocationId,
        durationMs: invocation.durationMs,
      })

      return response
    } catch (error) {
      invocation.status = 'error'
      invocation.error = error instanceof Error ? error.message : String(error)
      invocation.completedAt = Date.now()
      invocation.durationMs = invocation.completedAt - invocation.startedAt

      this.emit({
        type: 'agent:error',
        agentId,
        error: invocation.error,
      })

      throw error
    }
  }

  async invokeCron(
    agentId: string,
    action: string,
    payload?: Record<string, unknown>,
  ): Promise<AgentResponse> {
    const agent = registry.getAgent(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }

    const instance = await this.acquireInstance(agentId)
    if (!instance) {
      throw new Error('No available instance')
    }

    const workerId = `eliza-agent-${agentId}`
    const result = await this.workerd.invoke(workerId, {
      method: 'POST',
      url: '/invoke',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'cron',
        cronAction: action,
        cronPayload: payload,
      }),
    })

    const bodyStr =
      typeof result.body === 'string'
        ? result.body
        : result.body.toString('utf-8')
    const parseResult = AgentInvokeResultSchema.safeParse(
      JSON.parse(bodyStr || '{}'),
    )
    if (
      !parseResult.success ||
      !parseResult.data.success ||
      !parseResult.data.response
    ) {
      throw new Error(parseResult.data?.error ?? 'Cron invocation failed')
    }

    return parseResult.data.response
  }

  // ============================================================================
  // Instance Management
  // ============================================================================

  private async acquireInstance(
    agentId: string,
  ): Promise<AgentInstance | null> {
    let instances = this.instances.get(agentId)

    // Deploy if not deployed
    if (!instances || instances.length === 0) {
      const agent = registry.getAgent(agentId)
      if (!agent) return null

      await this.deployAgent(agentId)
      instances = this.instances.get(agentId)
    }

    if (!instances || instances.length === 0) {
      return null
    }

    // Find ready instance
    const ready = instances.find((i) => i.status === 'ready')
    if (ready) return ready

    // Find busy instance with capacity (max 10 concurrent)
    const available = instances.find(
      (i) => i.status === 'busy' && i.activeInvocations < 10,
    )
    if (available) return available

    // Scale up if needed
    if (instances.length < this.config.warmPool.maxWarmInstances) {
      const agent = registry.getAgent(agentId)
      if (!agent) return null
      const workerId = `eliza-agent-${agentId}`
      const instance = await this.createInstance(agent, workerId)
      instances.push(instance)
      return instance
    }

    return null
  }

  private recordRequestTime(agentId: string): void {
    const times = this.requestTimes.get(agentId) ?? []
    times.push(Date.now())

    // Keep last 100 request times
    if (times.length > 100) {
      times.shift()
    }
    this.requestTimes.set(agentId, times)
  }

  private shouldKeepWarm(agentId: string): boolean {
    const agent = registry.getAgent(agentId)
    if (!agent) return false

    // Always keep warm if configured
    if (agent.runtime.keepWarm) return true

    // Keep warm if has cron trigger
    const triggers = registry.getCronTriggers(agentId)
    if (triggers.length > 0) return true

    // Check request frequency
    const times = this.requestTimes.get(agentId) ?? []
    const windowStart = Date.now() - this.config.warmPool.keepWarmWindowMs
    const recentRequests = times.filter((t) => t > windowStart).length

    if (recentRequests >= this.config.warmPool.keepWarmRequestThreshold) {
      return true
    }

    return false
  }

  private async cleanup(): Promise<void> {
    const now = Date.now()

    for (const [agentId, instances] of this.instances) {
      const keepWarm = this.shouldKeepWarm(agentId)
      const toRemove: AgentInstance[] = []

      for (const instance of instances) {
        // Skip busy instances
        if (instance.activeInvocations > 0) continue

        // Check if idle too long
        const idleTime = now - instance.lastActivityAt
        if (idleTime > this.config.warmPool.idleTimeoutMs) {
          // Keep at least one if should keep warm
          const activeCount = instances.filter(
            (i) => i.status === 'ready' || i.status === 'busy',
          ).length
          if (keepWarm && activeCount <= 1) continue

          toRemove.push(instance)
        }
      }

      for (const instance of toRemove) {
        await this.stopInstance(instance)
        const idx = instances.indexOf(instance)
        if (idx >= 0) instances.splice(idx, 1)

        console.log(`[AgentExecutor] Scaled down agent ${agentId}`)
        this.emit({
          type: 'agent:scaled',
          agentId,
          from: instances.length + 1,
          to: instances.length,
        })
      }

      // Remove empty arrays
      if (instances.length === 0) {
        this.instances.delete(agentId)
      }
    }

    // Cleanup old invocations
    for (const [id, invocation] of this.invocations) {
      if (invocation.status === 'completed' || invocation.status === 'error') {
        if (now - (invocation.completedAt ?? invocation.startedAt) > 3600000) {
          this.invocations.delete(id)
        }
      }
    }
  }

  // ============================================================================
  // Events
  // ============================================================================

  on(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler)
  }

  off(handler: AgentEventHandler): void {
    const idx = this.eventHandlers.indexOf(handler)
    if (idx >= 0) this.eventHandlers.splice(idx, 1)
  }

  private emit(event: AgentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch (e) {
        console.error('[AgentExecutor] Event handler error:', e)
      }
    }
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getAgentInstances(agentId: string): AgentInstance[] {
    return this.instances.get(agentId) ?? []
  }

  getInvocation(invocationId: string): AgentInvocation | null {
    return this.invocations.get(invocationId) ?? null
  }

  getStats() {
    let totalInstances = 0
    let activeInstances = 0

    for (const instances of this.instances.values()) {
      totalInstances += instances.length
      activeInstances += instances.filter(
        (i) => i.status === 'ready' || i.status === 'busy',
      ).length
    }

    return {
      deployedAgents: this.instances.size,
      totalInstances,
      activeInstances,
      pendingInvocations: Array.from(this.invocations.values()).filter(
        (i) => i.status === 'pending' || i.status === 'processing',
      ).length,
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let executor: AgentExecutor | null = null

export function initExecutor(
  workerd: IWorkerdExecutor,
  config?: Partial<ExecutorConfig>,
): AgentExecutor {
  executor = new AgentExecutor(workerd, config)
  return executor
}

export function getExecutor(): AgentExecutor {
  if (!executor) {
    throw new Error('Agent executor not initialized')
  }
  return executor
}
