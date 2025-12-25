/**
 * Autonomous Agent Runner
 * Manages autonomous agent lifecycle and tick execution with trajectory recording
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import type { Action, EnvironmentState, LLMCall } from '@jejunetwork/training'
import {
  getStaticTrajectoryStorage,
  type StaticTrajectoryStorage,
  type TrajectoryBatchReference,
  TrajectoryRecorder,
} from '@jejunetwork/training'
import { checkDWSHealth, getSharedDWSClient } from '../client/dws'
import {
  type CrucibleAgentRuntime,
  createCrucibleRuntime,
} from '../sdk/eliza-runtime'
import { createLogger } from '../sdk/logger'
import type {
  ActivityEntry,
  AgentTickContext,
  AutonomousAgentConfig,
  AutonomousRunnerConfig,
  AutonomousRunnerStatus,
  AvailableAction,
  NetworkState,
} from './types'

export type {
  AutonomousAgentConfig,
  AutonomousRunnerConfig,
  AutonomousRunnerStatus,
}
export { DEFAULT_AUTONOMOUS_CONFIG } from './types'

const log = createLogger('AutonomousRunner')

/**
 * Extended config with archetype for trajectory recording
 */
export interface ExtendedAgentConfig extends AutonomousAgentConfig {
  /** Agent archetype for training (blue-team, red-team, etc.) */
  archetype?: string
  /** Enable trajectory recording for this agent */
  recordTrajectories?: boolean
}

interface RegisteredAgent {
  config: ExtendedAgentConfig
  runtime: CrucibleAgentRuntime | null
  lastTick: number
  tickCount: number
  errorCount: number
  lastError: string | null
  backoffMs: number
  intervalId: ReturnType<typeof setInterval> | null
  recentActivity: ActivityEntry[]
  /** Active trajectory ID for current tick */
  currentTrajectoryId: string | null
}

interface ExtendedRunnerConfig extends AutonomousRunnerConfig {
  /** Enable trajectory recording for all agents */
  enableTrajectoryRecording?: boolean
  /** Callback when a trajectory batch is flushed */
  onBatchFlushed?: (batch: TrajectoryBatchReference) => Promise<void>
}

const BASE_BACKOFF_MS = 5000
const MAX_BACKOFF_MS = 300000 // 5 minutes max

export class AutonomousAgentRunner {
  private agents: Map<string, RegisteredAgent> = new Map()
  private running = false
  private config: Required<Omit<ExtendedRunnerConfig, 'onBatchFlushed'>> & {
    onBatchFlushed?: (batch: TrajectoryBatchReference) => Promise<void>
  }
  private trajectoryRecorder: TrajectoryRecorder
  private storage: StaticTrajectoryStorage

  constructor(config: ExtendedRunnerConfig = {}) {
    this.config = {
      enableBuiltinCharacters: config.enableBuiltinCharacters ?? true,
      defaultTickIntervalMs: config.defaultTickIntervalMs ?? 60_000,
      maxConcurrentAgents: config.maxConcurrentAgents ?? 10,
      enableTrajectoryRecording: config.enableTrajectoryRecording ?? true,
      onBatchFlushed: config.onBatchFlushed,
    }

    // Initialize static storage for trajectories
    this.storage = getStaticTrajectoryStorage('crucible', {
      maxBufferSize: 50,
      maxBufferAgeMs: 10 * 60 * 1000, // 10 minutes
      usePermanentStorage: false, // Use IPFS (temporary) for raw trajectories
      onBatchFlushed: config.onBatchFlushed,
    })

    // Initialize trajectory recorder with static storage
    this.trajectoryRecorder = new TrajectoryRecorder(this.storage)

    log.info('Trajectory recording initialized', {
      enabled: this.config.enableTrajectoryRecording,
    })
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    log.info('Starting autonomous runner', {
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      trajectoryRecording: this.config.enableTrajectoryRecording,
    })

    // Start tick loops for all registered agents
    for (const [agentId, agent] of this.agents) {
      await this.initializeAgentRuntime(agent)
      this.startAgentTicks(agentId, agent)
    }
  }

  async stop(): Promise<void> {
    this.running = false
    log.info('Stopping autonomous runner')

    // Stop all agent tick loops
    for (const agent of this.agents.values()) {
      if (agent.intervalId) {
        clearInterval(agent.intervalId)
        agent.intervalId = null
      }

      // Cancel any active trajectories
      if (agent.currentTrajectoryId) {
        this.trajectoryRecorder.cancelTrajectory(agent.currentTrajectoryId)
        agent.currentTrajectoryId = null
      }
    }

    // Flush remaining trajectories
    await this.storage.shutdown()
  }

  async registerAgent(config: ExtendedAgentConfig): Promise<void> {
    if (this.agents.size >= this.config.maxConcurrentAgents) {
      throw new Error(
        `Max concurrent agents (${this.config.maxConcurrentAgents}) reached`,
      )
    }

    const agent: RegisteredAgent = {
      config,
      runtime: null,
      lastTick: 0,
      tickCount: 0,
      errorCount: 0,
      lastError: null,
      backoffMs: 0,
      intervalId: null,
      recentActivity: [],
      currentTrajectoryId: null,
    }

    this.agents.set(config.agentId, agent)
    log.info('Agent registered', {
      agentId: config.agentId,
      character: config.character.name,
      archetype: config.archetype ?? 'default',
      recordTrajectories: config.recordTrajectories ?? true,
    })

    if (this.running) {
      await this.initializeAgentRuntime(agent)
      this.startAgentTicks(config.agentId, agent)
    }
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (agent?.intervalId) {
      clearInterval(agent.intervalId)
    }
    if (agent?.currentTrajectoryId) {
      this.trajectoryRecorder.cancelTrajectory(agent.currentTrajectoryId)
    }
    this.agents.delete(agentId)
    log.info('Agent unregistered', { agentId })
  }

  getStatus(): AutonomousRunnerStatus {
    return {
      running: this.running,
      agentCount: this.agents.size,
      agents: Array.from(this.agents.entries()).map(([id, agent]) => ({
        id,
        character: agent.config.character.name,
        lastTick: agent.lastTick,
        tickCount: agent.tickCount,
      })),
    }
  }

  /**
   * Get trajectory storage stats
   */
  getTrajectoryStats(): {
    bufferCount: number
    bufferAgeMs: number | null
    activeTrajectories: number
  } {
    const bufferStats = this.storage.getBufferStats()
    return {
      bufferCount: bufferStats.count,
      bufferAgeMs: bufferStats.ageMs,
      activeTrajectories: this.trajectoryRecorder.getActiveCount(),
    }
  }

  /**
   * Force flush trajectory buffer
   */
  async flushTrajectories(): Promise<TrajectoryBatchReference | null> {
    return this.storage.flush()
  }

  private async initializeAgentRuntime(agent: RegisteredAgent): Promise<void> {
    if (agent.runtime) return

    agent.runtime = createCrucibleRuntime({
      agentId: agent.config.agentId,
      character: agent.config.character,
    })

    await agent.runtime.initialize()
    log.info('Agent runtime initialized', { agentId: agent.config.agentId })
  }

  private startAgentTicks(agentId: string, agent: RegisteredAgent): void {
    if (agent.intervalId) return

    const tick = async () => {
      if (!this.running || !agent.config.enabled) return

      // Apply exponential backoff if there have been errors
      if (agent.backoffMs > 0) {
        const timeSinceLastTick = Date.now() - agent.lastTick
        if (timeSinceLastTick < agent.backoffMs) {
          return
        }
      }

      agent.lastTick = Date.now()
      agent.tickCount++

      // Start trajectory recording for this tick
      const shouldRecord =
        this.config.enableTrajectoryRecording &&
        (agent.config.recordTrajectories ?? true)

      if (shouldRecord) {
        const trajectoryId = await this.trajectoryRecorder.startTrajectory({
          agentId: agent.config.agentId,
          archetype: agent.config.archetype,
          scenarioId: `tick-${agent.tickCount}`,
          metadata: {
            tickNumber: agent.tickCount,
            characterName: agent.config.character.name,
          },
        })
        agent.currentTrajectoryId = trajectoryId
      }

      const _tickStartTime = Date.now()
      let tickSuccess = false
      let tickError: string | null = null
      let totalReward = 0

      try {
        const result = await this.executeAgentTick(agent)
        tickSuccess = true
        totalReward = result.reward
        // Reset backoff on success
        agent.errorCount = 0
        agent.backoffMs = 0
        agent.lastError = null
      } catch (err) {
        agent.errorCount++
        tickError = err instanceof Error ? err.message : String(err)
        agent.lastError = tickError
        // Exponential backoff with cap
        agent.backoffMs = Math.min(
          BASE_BACKOFF_MS * 2 ** agent.errorCount,
          MAX_BACKOFF_MS,
        )
        log.error('Tick failed', {
          agentId,
          error: agent.lastError,
          backoffMs: agent.backoffMs,
        })
      }

      // End trajectory recording
      if (agent.currentTrajectoryId) {
        await this.trajectoryRecorder.endTrajectory(agent.currentTrajectoryId, {
          finalBalance: undefined, // Could add wallet balance tracking
          finalPnL: totalReward,
          gameKnowledge: {
            actualOutcomes: {
              tickSuccess,
              ...(tickError && { error: tickError }),
            },
          },
        })
        agent.currentTrajectoryId = null
      }
    }

    // Run first tick immediately
    tick().catch((err) =>
      log.error('Initial tick failed', { error: String(err) }),
    )

    // Schedule recurring ticks
    agent.intervalId = setInterval(() => {
      tick().catch((err) => log.error('Tick failed', { error: String(err) }))
    }, agent.config.tickIntervalMs)
  }

  private async executeAgentTick(
    agent: RegisteredAgent,
  ): Promise<{ reward: number }> {
    const config = agent.config
    const trajectoryId = agent.currentTrajectoryId

    log.debug('Executing tick', {
      agentId: config.agentId,
      tickCount: agent.tickCount,
      trajectoryId,
    })

    // Build tick context
    const context = await this.buildTickContext(agent)

    // Check if DWS is available for inference
    if (!context.networkState.dwsAvailable) {
      log.warn('DWS not available, skipping tick', { agentId: config.agentId })
      return { reward: 0 }
    }

    // Start trajectory step with environment state
    if (trajectoryId) {
      const envState: EnvironmentState = {
        timestamp: Date.now(),
        agentBalance: 0, // Could track wallet balance
        agentPoints: 0,
        agentPnL: 0,
        openPositions: 0,
      }
      this.trajectoryRecorder.startStep(trajectoryId, envState)
    }

    // Build the tick prompt based on context
    const tickPrompt = this.buildTickPrompt(config, context)

    // Get response from agent runtime
    if (!agent.runtime) {
      throw new Error('Agent runtime not initialized')
    }

    const llmCallStart = Date.now()
    const response = await agent.runtime.processMessage({
      id: crypto.randomUUID(),
      userId: 'autonomous-runner',
      roomId: `autonomous-${config.agentId}`,
      content: { text: tickPrompt, source: 'autonomous' },
      createdAt: Date.now(),
    })
    const llmCallLatency = Date.now() - llmCallStart

    // Log LLM call to trajectory
    if (trajectoryId) {
      const llmCall: LLMCall = {
        timestamp: llmCallStart,
        model: 'dws-inference',
        systemPrompt: this.buildSystemPrompt(config),
        userPrompt: tickPrompt,
        response: response.text,
        temperature: 0.7,
        maxTokens: 1024,
        latencyMs: llmCallLatency,
        purpose: 'action',
        actionType: response.action ?? 'respond',
      }
      this.trajectoryRecorder.logLLMCall(trajectoryId, llmCall)
    }

    log.info('Tick completed', {
      agentId: config.agentId,
      responseLength: response.text.length,
      action: response.action ?? null,
      latencyMs: llmCallLatency,
    })

    // Record activity
    agent.recentActivity.push({
      action: response.action ?? 'respond',
      timestamp: Date.now(),
      success: true,
      result: { text: response.text.slice(0, 200) },
    })

    // Keep only last 50 activities
    if (agent.recentActivity.length > 50) {
      agent.recentActivity = agent.recentActivity.slice(-50)
    }

    // Calculate reward for this tick
    let tickReward = 0
    const actionsExecuted: string[] = []

    // Execute any parsed actions
    if (response.actions && response.actions.length > 0) {
      for (const action of response.actions.slice(
        0,
        config.maxActionsPerTick,
      )) {
        const actionResult = await this.executeAction(
          agent,
          action.name,
          action.params,
          trajectoryId,
        )
        actionsExecuted.push(action.name)
        // Reward for successful actions
        if (actionResult.success) {
          tickReward += this.calculateActionReward(action.name)
        }
      }
    }

    // Complete the trajectory step
    if (trajectoryId) {
      const action: Action = {
        timestamp: Date.now(),
        actionType: response.action ?? 'RESPOND',
        actionName: response.action ?? 'respond',
        parameters: {},
        reasoning: response.text.slice(0, 500),
        success: true,
        result: {
          actionsExecuted,
          responseLength: response.text.length,
        },
      }
      this.trajectoryRecorder.completeStep(trajectoryId, action, tickReward)
    }

    return { reward: tickReward }
  }

  private buildSystemPrompt(config: ExtendedAgentConfig): string {
    const char = config.character
    const parts: string[] = []

    parts.push(`You are ${char.name}, an autonomous AI agent.`)

    if (char.system) {
      parts.push(char.system)
    }

    if (char.bio) {
      const bio = Array.isArray(char.bio) ? char.bio.join(' ') : char.bio
      parts.push(bio)
    }

    if (config.archetype) {
      parts.push(`Your operational archetype is: ${config.archetype}`)
    }

    return parts.join('\n\n')
  }

  private calculateActionReward(actionName: string): number {
    const upperName = actionName.toUpperCase()

    // Higher rewards for valuable actions
    if (upperName.includes('SWAP') || upperName.includes('TRADE')) {
      return 1.0
    }
    if (upperName.includes('VOTE') || upperName.includes('PROPOSE')) {
      return 0.8
    }
    if (upperName.includes('STAKE')) {
      return 0.7
    }
    if (upperName.includes('A2A') || upperName.includes('MESSAGE')) {
      return 0.5
    }
    if (upperName.includes('COMPUTE')) {
      return 0.6
    }

    // Base reward for any action
    return 0.3
  }

  private async buildTickContext(
    agent: RegisteredAgent,
  ): Promise<AgentTickContext> {
    const networkState = await this.getNetworkState()
    const availableActions = this.getAvailableActions(agent.config.capabilities)

    return {
      availableActions,
      recentActivity: agent.recentActivity.slice(-10),
      pendingGoals: agent.config.goals ?? [],
      pendingMessages: [],
      networkState,
    }
  }

  private async getNetworkState(): Promise<NetworkState> {
    const dwsAvailable = await checkDWSHealth()
    const network = getCurrentNetwork()

    let inferenceAvailable = false
    let inferenceNodes = 0

    if (dwsAvailable) {
      const client = getSharedDWSClient()
      const inference = await client.checkInferenceAvailable()
      inferenceAvailable = inference.available
      inferenceNodes = inference.nodes
    }

    return {
      network,
      dwsAvailable,
      inferenceAvailable,
      inferenceNodes,
    }
  }

  private getAvailableActions(
    capabilities: AutonomousAgentConfig['capabilities'],
  ): AvailableAction[] {
    const actions: AvailableAction[] = []

    if (capabilities.canChat) {
      actions.push({
        name: 'RESPOND',
        description: 'Generate a response or message',
        category: 'communication',
      })
    }

    if (capabilities.canTrade) {
      actions.push(
        {
          name: 'SWAP',
          description: 'Execute a token swap',
          category: 'defi',
          parameters: [
            {
              name: 'tokenIn',
              type: 'address',
              description: 'Token to sell',
              required: true,
            },
            {
              name: 'tokenOut',
              type: 'address',
              description: 'Token to buy',
              required: true,
            },
            {
              name: 'amount',
              type: 'bigint',
              description: 'Amount to swap',
              required: true,
            },
          ],
          requiresApproval: true,
        },
        {
          name: 'PROVIDE_LIQUIDITY',
          description: 'Add liquidity to a pool',
          category: 'defi',
          requiresApproval: true,
        },
      )
    }

    if (capabilities.canPropose) {
      actions.push({
        name: 'PROPOSE',
        description: 'Create a governance proposal',
        category: 'governance',
        requiresApproval: true,
      })
    }

    if (capabilities.canVote) {
      actions.push({
        name: 'VOTE',
        description: 'Vote on a proposal',
        category: 'governance',
        parameters: [
          {
            name: 'proposalId',
            type: 'string',
            description: 'ID of the proposal',
            required: true,
          },
          {
            name: 'support',
            type: 'boolean',
            description: 'Whether to vote for or against',
            required: true,
          },
        ],
      })
    }

    if (capabilities.canStake) {
      actions.push({
        name: 'STAKE',
        description: 'Stake tokens',
        category: 'defi',
        requiresApproval: true,
      })
    }

    if (capabilities.a2a) {
      actions.push({
        name: 'A2A_MESSAGE',
        description: 'Send a message to another agent',
        category: 'communication',
      })
    }

    if (capabilities.compute) {
      actions.push({
        name: 'RUN_COMPUTE',
        description: 'Execute a compute job on DWS',
        category: 'compute',
      })
    }

    return actions
  }

  private buildTickPrompt(
    config: ExtendedAgentConfig,
    context: AgentTickContext,
  ): string {
    const parts: string[] = []

    parts.push(
      'You are operating autonomously. Evaluate your current state and decide what actions to take.',
    )
    parts.push('')

    // Archetype-specific instructions
    if (config.archetype === 'blue-team') {
      parts.push('## Objective: Blue Team Defense')
      parts.push(
        'Your mission is to protect the network, identify vulnerabilities, and propose security improvements.',
      )
      parts.push(
        'Focus on: monitoring suspicious activity, voting for security proposals, delegating to trusted validators.',
      )
      parts.push('')
    } else if (config.archetype === 'red-team') {
      parts.push('## Objective: Red Team Testing')
      parts.push(
        'Your mission is to test network resilience by identifying weaknesses and proposing stress tests.',
      )
      parts.push(
        'Focus on: exploring edge cases, testing governance limits, identifying potential attack vectors (for reporting).',
      )
      parts.push('')
    }

    // Goals
    if (context.pendingGoals.length > 0) {
      parts.push('## Current Goals')
      for (const goal of context.pendingGoals) {
        parts.push(`- [${goal.priority}] ${goal.description} (${goal.status})`)
      }
      parts.push('')
    }

    // Recent activity
    if (context.recentActivity.length > 0) {
      parts.push('## Recent Activity')
      for (const activity of context.recentActivity.slice(-5)) {
        const time = new Date(activity.timestamp).toISOString()
        parts.push(
          `- ${time}: ${activity.action} (${activity.success ? 'success' : 'failed'})`,
        )
      }
      parts.push('')
    }

    // Available actions
    parts.push('## Available Actions')
    for (const action of context.availableActions) {
      parts.push(`- ${action.name}: ${action.description}`)
    }
    parts.push('')

    // Network state
    parts.push('## Network State')
    parts.push(`Network: ${context.networkState.network}`)
    parts.push(
      `Inference: ${context.networkState.inferenceAvailable ? 'available' : 'unavailable'} (${context.networkState.inferenceNodes} nodes)`,
    )
    parts.push('')

    parts.push(
      `You may execute up to ${config.maxActionsPerTick} actions this tick.`,
    )
    parts.push('Use [ACTION: NAME | param1=value1] syntax to execute actions.')

    return parts.join('\n')
  }

  private async executeAction(
    agent: RegisteredAgent,
    actionName: string,
    params: Record<string, string>,
    trajectoryId: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    log.info('Executing action', {
      agentId: agent.config.agentId,
      action: actionName,
      params,
    })

    // Record action attempt
    const activity: ActivityEntry = {
      action: actionName,
      timestamp: Date.now(),
      success: false,
    }

    // Validate action against agent capabilities
    const capabilities = agent.config.capabilities
    const actionCategory = this.getActionCategory(actionName)

    if (!this.isActionAllowed(actionCategory, capabilities)) {
      log.warn('Action not allowed for agent capabilities', {
        agentId: agent.config.agentId,
        action: actionName,
        category: actionCategory,
      })
      activity.result = { error: 'Action not allowed for agent capabilities' }
      agent.recentActivity.push(activity)
      return { success: false, error: 'Action not allowed' }
    }

    // Execute action via runtime
    if (!agent.runtime) {
      log.error('Agent runtime not initialized', {
        agentId: agent.config.agentId,
      })
      activity.result = { error: 'Runtime not initialized' }
      agent.recentActivity.push(activity)
      return { success: false, error: 'Runtime not initialized' }
    }

    const result = await agent.runtime.executeAction(actionName, params)

    activity.success = result.success
    if (result.success) {
      activity.result = {
        executed: true,
        params: Object.fromEntries(
          Object.entries(params).map(([k, v]) => [k, v] as const),
        ),
        result: result.result ?? null,
      }
    } else {
      activity.result = { error: result.error ?? 'Unknown error' }
    }

    agent.recentActivity.push(activity)

    // Log action to trajectory
    if (trajectoryId) {
      const _actionRecord: Action = {
        timestamp: Date.now(),
        actionType: actionName,
        actionName: actionName,
        parameters: params,
        success: result.success,
        result: result.success ? { executed: true } : undefined,
        error: result.error,
      }

      // Log as provider access (action execution)
      this.trajectoryRecorder.logProviderAccess(trajectoryId, {
        providerName: 'action-executor',
        data: {
          actionName,
          params,
          success: result.success,
          error: result.error ?? null,
        },
        purpose: `Execute ${actionName} action`,
      })
    }

    log.info('Action executed', {
      agentId: agent.config.agentId,
      action: actionName,
      success: activity.success,
      ...(result.error && { error: result.error }),
    })

    return { success: result.success, error: result.error }
  }

  private getActionCategory(actionName: string): string {
    const upperName = actionName.toUpperCase()
    if (
      upperName.includes('SWAP') ||
      upperName.includes('LIQUIDITY') ||
      upperName.includes('POOL')
    ) {
      return 'defi'
    }
    if (upperName.includes('PROPOSE') || upperName.includes('VOTE')) {
      return 'governance'
    }
    if (upperName.includes('STAKE')) {
      return 'staking'
    }
    if (upperName.includes('AGENT') || upperName.includes('A2A')) {
      return 'a2a'
    }
    if (
      upperName.includes('GPU') ||
      upperName.includes('INFERENCE') ||
      upperName.includes('COMPUTE')
    ) {
      return 'compute'
    }
    return 'general'
  }

  private isActionAllowed(
    category: string,
    capabilities: AutonomousAgentConfig['capabilities'],
  ): boolean {
    switch (category) {
      case 'defi':
        return capabilities.canTrade === true
      case 'governance':
        return capabilities.canPropose === true || capabilities.canVote === true
      case 'staking':
        return capabilities.canStake === true
      case 'a2a':
        return capabilities.a2a === true
      case 'compute':
        return capabilities.compute === true
      default:
        return capabilities.canChat === true
    }
  }
}

export function createAgentRunner(
  config?: ExtendedRunnerConfig,
): AutonomousAgentRunner {
  return new AutonomousAgentRunner(config)
}
