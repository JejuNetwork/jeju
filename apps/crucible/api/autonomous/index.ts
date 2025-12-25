/**
 * Autonomous Agent Runner
 * Manages autonomous agent lifecycle and tick execution
 */

import { getCurrentNetwork } from '@jejunetwork/config'
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

interface RegisteredAgent {
  config: AutonomousAgentConfig
  runtime: CrucibleAgentRuntime | null
  lastTick: number
  tickCount: number
  errorCount: number
  lastError: string | null
  backoffMs: number
  intervalId: ReturnType<typeof setInterval> | null
  recentActivity: ActivityEntry[]
}

const BASE_BACKOFF_MS = 5000
const MAX_BACKOFF_MS = 300000 // 5 minutes max

export class AutonomousAgentRunner {
  private agents: Map<string, RegisteredAgent> = new Map()
  private running = false
  private config: Required<AutonomousRunnerConfig>

  constructor(config: AutonomousRunnerConfig = {}) {
    this.config = {
      enableBuiltinCharacters: config.enableBuiltinCharacters ?? true,
      defaultTickIntervalMs: config.defaultTickIntervalMs ?? 60_000,
      maxConcurrentAgents: config.maxConcurrentAgents ?? 10,
    }
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    log.info('Starting autonomous runner', {
      maxConcurrentAgents: this.config.maxConcurrentAgents,
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
    }
  }

  async registerAgent(config: AutonomousAgentConfig): Promise<void> {
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
    }

    this.agents.set(config.agentId, agent)
    log.info('Agent registered', {
      agentId: config.agentId,
      character: config.character.name,
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

      try {
        await this.executeAgentTick(agent)
        // Reset backoff on success
        agent.errorCount = 0
        agent.backoffMs = 0
        agent.lastError = null
      } catch (err) {
        agent.errorCount++
        agent.lastError = err instanceof Error ? err.message : String(err)
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

  private async executeAgentTick(agent: RegisteredAgent): Promise<void> {
    const config = agent.config

    log.debug('Executing tick', {
      agentId: config.agentId,
      tickCount: agent.tickCount,
    })

    // Build tick context
    const context = await this.buildTickContext(agent)

    // Check if DWS is available for inference
    if (!context.networkState.dwsAvailable) {
      log.warn('DWS not available, skipping tick', { agentId: config.agentId })
      return
    }

    // Build the tick prompt based on context
    const tickPrompt = this.buildTickPrompt(config, context)

    // Get response from agent runtime
    if (!agent.runtime) {
      throw new Error('Agent runtime not initialized')
    }

    const response = await agent.runtime.processMessage({
      id: crypto.randomUUID(),
      userId: 'autonomous-runner',
      roomId: `autonomous-${config.agentId}`,
      content: { text: tickPrompt, source: 'autonomous' },
      createdAt: Date.now(),
    })

    log.info('Tick completed', {
      agentId: config.agentId,
      responseLength: response.text.length,
      action: response.action ?? null,
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

    // Execute any parsed actions
    if (response.actions && response.actions.length > 0) {
      for (const action of response.actions.slice(
        0,
        config.maxActionsPerTick,
      )) {
        await this.executeAction(agent, action.name, action.params)
      }
    }
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
    config: AutonomousAgentConfig,
    context: AgentTickContext,
  ): string {
    const parts: string[] = []

    parts.push(
      'You are operating autonomously. Evaluate your current state and decide what actions to take.',
    )
    parts.push('')

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
  ): Promise<void> {
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
      return
    }

    // Execute action via runtime
    if (!agent.runtime) {
      log.error('Agent runtime not initialized', {
        agentId: agent.config.agentId,
      })
      activity.result = { error: 'Runtime not initialized' }
      agent.recentActivity.push(activity)
      return
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

    log.info('Action executed', {
      agentId: agent.config.agentId,
      action: actionName,
      success: activity.success,
      ...(result.error && { error: result.error }),
    })
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
  config?: AutonomousRunnerConfig,
): AutonomousAgentRunner {
  return new AutonomousAgentRunner(config)
}
