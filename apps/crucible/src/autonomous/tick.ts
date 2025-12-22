/**
 * Autonomous Tick Execution
 *
 * Implements multi-step decision loop where the LLM decides what actions to take.
 * Each tick can execute multiple actions up to maxActionsPerTick.
 *
 * Strategy:
 * 1. Gather context (available actions, pending tasks, network state)
 * 2. Build decision prompt for LLM
 * 3. LLM decides action or FINISH
 * 4. Execute action via jeju plugin
 * 5. Repeat until FINISH or max iterations
 */

import {
  type CrucibleAgentRuntime,
  checkDWSHealth,
  checkDWSInferenceAvailable,
  type RuntimeMessage,
} from '../sdk/eliza-runtime'
import { createLogger } from '../sdk/logger'
import type {
  AgentGoal,
  AgentTickContext,
  AutonomousAgentConfig,
  AvailableAction,
  PendingMessage,
} from './types'

const log = createLogger('AutonomousTick')

/**
 * Result of an autonomous tick
 */
export interface AutonomousTickResult {
  success: boolean
  actionsExecuted: AutonomousAction[]
  iterations: number
  duration: number
  error?: string
}

/**
 * Action executed during a tick
 */
export interface AutonomousAction {
  name: string
  parameters: Record<string, unknown>
  success: boolean
  result?: unknown
  error?: string
  timestamp: number
}

/**
 * Decision from the LLM
 */
interface TickDecision {
  isFinish: boolean
  action?: string
  parameters?: Record<string, unknown>
  thought: string
}

/**
 * Autonomous Tick Handler
 *
 * Executes a single autonomous tick for an agent.
 */
export class AutonomousTick {
  private config: AutonomousAgentConfig
  private runtime: CrucibleAgentRuntime
  private availableActions: AvailableAction[] = []

  constructor(config: AutonomousAgentConfig, runtime: CrucibleAgentRuntime) {
    this.config = config
    this.runtime = runtime
  }

  /**
   * Execute a single autonomous tick
   */
  async execute(): Promise<AutonomousTickResult> {
    const startTime = Date.now()
    const actionsExecuted: AutonomousAction[] = []

    log.info('Starting autonomous tick', {
      agentId: this.config.agentId,
      character: this.config.character.name,
    })

    // Ensure runtime is initialized
    if (!this.runtime.isInitialized()) {
      await this.runtime.initialize()
    }

    // Load available actions
    await this.loadAvailableActions()

    // Gather context
    const context = await this.gatherContext()

    // Multi-step execution loop
    for (
      let iteration = 1;
      iteration <= this.config.maxActionsPerTick;
      iteration++
    ) {
      log.debug(
        `Tick iteration ${iteration}/${this.config.maxActionsPerTick}`,
        {
          agentId: this.config.agentId,
          actionsCompleted: actionsExecuted.length,
        },
      )

      // Get decision from LLM
      const decision = await this.getDecision(context, actionsExecuted)

      if (!decision) {
        log.warn('Failed to get decision from LLM', {
          agentId: this.config.agentId,
        })
        break
      }

      log.debug('LLM decision', {
        action: decision.action ?? 'FINISH',
        thought: decision.thought.substring(0, 100),
      })

      // Check if we should finish
      if (decision.isFinish || !decision.action) {
        log.info('Agent decided to finish', {
          agentId: this.config.agentId,
          thought: decision.thought,
        })
        break
      }

      // Execute the action
      const actionResult = await this.executeAction(
        decision.action,
        decision.parameters ?? {},
      )
      actionsExecuted.push(actionResult)

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    const duration = Date.now() - startTime
    const successfulActions = actionsExecuted.filter((a) => a.success).length

    log.info('Autonomous tick completed', {
      agentId: this.config.agentId,
      iterations: actionsExecuted.length,
      successful: successfulActions,
      duration,
    })

    return {
      success: successfulActions > 0 || actionsExecuted.length === 0,
      actionsExecuted,
      iterations: actionsExecuted.length,
      duration,
    }
  }

  /**
   * Load available actions from jeju plugin
   */
  private async loadAvailableActions(): Promise<void> {
    const actions: AvailableAction[] = []

    // Check which capabilities are enabled and add corresponding actions
    if (this.config.capabilities.compute) {
      actions.push(
        {
          name: 'RUN_INFERENCE',
          description: 'Run AI inference on DWS',
          category: 'compute',
        },
        {
          name: 'RENT_GPU',
          description: 'Rent GPU compute from marketplace',
          category: 'compute',
        },
        {
          name: 'CREATE_TRIGGER',
          description: 'Create a scheduled trigger',
          category: 'compute',
        },
      )
    }

    if (this.config.capabilities.storage) {
      actions.push(
        {
          name: 'UPLOAD_FILE',
          description: 'Upload file to IPFS',
          category: 'storage',
        },
        {
          name: 'RETRIEVE_FILE',
          description: 'Download file from IPFS',
          category: 'storage',
        },
        {
          name: 'PIN_CID',
          description: 'Pin content on IPFS',
          category: 'storage',
        },
      )
    }

    if (this.config.capabilities.defi) {
      actions.push(
        {
          name: 'SWAP_TOKENS',
          description: 'Swap tokens on DEX',
          category: 'defi',
        },
        {
          name: 'ADD_LIQUIDITY',
          description: 'Add liquidity to pool',
          category: 'defi',
        },
        {
          name: 'LIST_POOLS',
          description: 'List available liquidity pools',
          category: 'defi',
        },
      )
    }

    if (this.config.capabilities.governance) {
      actions.push(
        {
          name: 'CREATE_PROPOSAL',
          description: 'Create governance proposal',
          category: 'governance',
        },
        {
          name: 'VOTE',
          description: 'Vote on proposal',
          category: 'governance',
        },
      )
    }

    if (this.config.capabilities.a2a) {
      actions.push(
        {
          name: 'CALL_AGENT',
          description: 'Call another agent via A2A',
          category: 'a2a',
        },
        {
          name: 'DISCOVER_AGENTS',
          description: 'Discover available agents',
          category: 'a2a',
        },
      )
    }

    if (this.config.capabilities.crossChain) {
      actions.push(
        {
          name: 'CROSS_CHAIN_TRANSFER',
          description: 'Transfer assets cross-chain',
          category: 'crosschain',
        },
        {
          name: 'CREATE_INTENT',
          description: 'Create cross-chain intent',
          category: 'crosschain',
        },
      )
    }

    this.availableActions = actions
  }

  /**
   * Gather current context for decision making
   */
  private async gatherContext(): Promise<AgentTickContext> {
    // Check DWS status
    const dwsHealthy = await checkDWSHealth()
    const inferenceStatus = await checkDWSInferenceAvailable()

    // TODO: Get pending messages from room/messaging system
    const pendingMessages: PendingMessage[] = []

    // TODO: Get goals from agent configuration or storage
    const pendingGoals: AgentGoal[] =
      this.config.goals?.filter((g) => g.status === 'active') ?? []

    return {
      availableActions: this.availableActions,
      recentActivity: [], // TODO: Get from activity log
      pendingGoals,
      pendingMessages,
      networkState: {
        network:
          (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') ??
          'localnet',
        dwsAvailable: dwsHealthy,
        inferenceNodes: inferenceStatus.nodes,
      },
    }
  }

  /**
   * Get decision from LLM about what action to take
   */
  private async getDecision(
    context: AgentTickContext,
    previousActions: AutonomousAction[],
  ): Promise<TickDecision | null> {
    const prompt = this.buildDecisionPrompt(context, previousActions)

    // Send to runtime for processing
    const message: RuntimeMessage = {
      id: crypto.randomUUID(),
      userId: 'autonomous-system',
      roomId: 'autonomous-tick',
      content: { text: prompt, source: 'autonomous-tick' },
      createdAt: Date.now(),
    }

    const response = await this.runtime.processMessage(message)

    // Parse the response as JSON decision
    return this.parseDecision(response.text)
  }

  /**
   * Build decision prompt for LLM
   */
  private buildDecisionPrompt(
    context: AgentTickContext,
    previousActions: AutonomousAction[],
  ): string {
    const lines: string[] = []

    lines.push(
      'You are running in autonomous mode. Decide what action to take next.',
    )
    lines.push('')
    lines.push('## Current Context')
    lines.push(`Network: ${context.networkState.network}`)
    lines.push(`DWS Available: ${context.networkState.dwsAvailable}`)
    lines.push(`Inference Nodes: ${context.networkState.inferenceNodes}`)
    lines.push('')

    if (context.pendingGoals.length > 0) {
      lines.push('## Active Goals')
      for (const goal of context.pendingGoals) {
        lines.push(`- [${goal.priority}] ${goal.description}`)
      }
      lines.push('')
    }

    if (context.pendingMessages.length > 0) {
      lines.push('## Pending Messages')
      for (const msg of context.pendingMessages.slice(0, 5)) {
        lines.push(`- From ${msg.from}: "${msg.content.substring(0, 100)}..."`)
      }
      lines.push('')
    }

    lines.push('## Available Actions')
    for (const action of context.availableActions) {
      lines.push(`- ${action.name}: ${action.description}`)
    }
    lines.push('')

    if (previousActions.length > 0) {
      lines.push('## Actions Taken This Tick')
      for (const action of previousActions) {
        const status = action.success ? 'SUCCESS' : 'FAILED'
        lines.push(`- ${action.name}: ${status}`)
      }
      lines.push('')
    }

    lines.push('## Instructions')
    lines.push('Respond with a JSON object containing:')
    lines.push('- "isFinish": true if no more actions needed, false otherwise')
    lines.push('- "action": the action name to execute (if not finishing)')
    lines.push('- "parameters": object with action parameters (if needed)')
    lines.push('- "thought": brief reasoning for your decision')
    lines.push('')
    lines.push('If you have nothing important to do, set isFinish: true.')
    lines.push('Only take actions that are relevant and useful.')
    lines.push('')
    lines.push('Output JSON only, no markdown:')

    return lines.join('\n')
  }

  /**
   * Parse LLM response into a decision
   */
  private parseDecision(response: string): TickDecision | null {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn('No JSON found in decision response', {
        response: response.substring(0, 200),
      })
      return null
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

      return {
        isFinish: Boolean(parsed.isFinish ?? parsed.is_finish ?? false),
        action: parsed.action as string | undefined,
        parameters: parsed.parameters as Record<string, unknown> | undefined,
        thought: (parsed.thought ?? parsed.reasoning ?? '') as string,
      }
    } catch (e) {
      log.warn('Failed to parse decision JSON', {
        error: String(e),
        json: jsonMatch[0].substring(0, 200),
      })
      return null
    }
  }

  /**
   * Execute an action
   */
  private async executeAction(
    actionName: string,
    parameters: Record<string, unknown>,
  ): Promise<AutonomousAction> {
    const timestamp = Date.now()
    const normalizedAction = actionName.toUpperCase()

    log.info('Executing autonomous action', {
      action: normalizedAction,
      parameters,
    })

    // For now, we'll simulate action execution
    // In production, this would call the actual jeju plugin actions

    const result: AutonomousAction = {
      name: normalizedAction,
      parameters,
      success: false,
      timestamp,
    }

    try {
      // Route to appropriate action handler
      switch (normalizedAction) {
        case 'RUN_INFERENCE':
          result.result = await this.executeInference(parameters)
          result.success = true
          break

        case 'DISCOVER_AGENTS':
          result.result = await this.discoverAgents()
          result.success = true
          break

        case 'CALL_AGENT':
          result.result = await this.callAgent(parameters)
          result.success = true
          break

        default:
          // For unimplemented actions, log and mark as failed
          log.warn(`Action ${normalizedAction} not yet implemented`)
          result.error = `Action ${normalizedAction} not implemented`
          break
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e)
      log.error('Action execution failed', {
        action: normalizedAction,
        error: result.error,
      })
    }

    return result
  }

  /**
   * Execute inference action
   */
  private async executeInference(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const prompt = (params.prompt as string) ?? 'Hello'

    const message: RuntimeMessage = {
      id: crypto.randomUUID(),
      userId: 'autonomous-action',
      roomId: 'action-inference',
      content: { text: prompt, source: 'autonomous-action' },
      createdAt: Date.now(),
    }

    const response = await this.runtime.processMessage(message)
    return { response: response.text }
  }

  /**
   * Discover available agents
   */
  private async discoverAgents(): Promise<unknown> {
    // TODO: Query agent registry or A2A discovery
    return { agents: [] }
  }

  /**
   * Call another agent
   */
  private async callAgent(params: Record<string, unknown>): Promise<unknown> {
    const targetAgent = params.agentId as string
    const message = params.message as string

    // TODO: Implement A2A call
    log.info('A2A call', { target: targetAgent, message })
    return { called: targetAgent, status: 'pending' }
  }
}
