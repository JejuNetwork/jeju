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
 * 4. Execute action via jeju SDK
 * 5. Repeat until FINISH or max iterations
 */

import { z } from 'zod'
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

/** Schema for raw LLM decision parsing - accepts various field names LLMs might use */
const RawLLMDecisionSchema = z.object({
  isFinish: z.boolean().optional(),
  is_finish: z.boolean().optional(),
  action: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  thought: z.string().optional(),
  reasoning: z.string().optional(),
})

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

// SDK action registry - maps action names to their execution handlers
type ActionHandler = (
  params: Record<string, unknown>,
  context: { runtime: CrucibleAgentRuntime; config: AutonomousAgentConfig },
) => Promise<unknown>

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  // Compute actions
  RUN_INFERENCE: async (params, { runtime }) => {
    const prompt = (params.prompt as string) ?? 'Hello'
    const message: RuntimeMessage = {
      id: crypto.randomUUID(),
      userId: 'autonomous-action',
      roomId: 'action-inference',
      content: { text: prompt, source: 'autonomous-action' },
      createdAt: Date.now(),
    }
    const response = await runtime.processMessage(message)
    return { response: response.text, action: response.action }
  },

  // Moderation actions (for blue team)
  REPORT_AGENT: async (params) => {
    const agentId = params.agentId ?? params.target
    const reason = params.reason ?? params.violation ?? 'suspicious behavior'
    log.info('Moderation report submitted', { agentId, reason })
    return { reported: agentId, reason, status: 'submitted' }
  },

  FLAG_CONTENT: async (params) => {
    const contentId = params.contentId ?? params.content_id
    const severity = params.severity ?? 'medium'
    const reason = params.reason ?? 'policy violation'
    log.info('Content flagged', { contentId, severity, reason })
    return { contentId, severity, reason, status: 'flagged' }
  },

  WARN_USERS: async (params) => {
    const threat = params.threat ?? 'unknown threat'
    const scope = params.scope ?? 'all'
    log.info('User warning issued', { threat, scope })
    return { threat, scope, status: 'warning_sent' }
  },

  CHECK_TRUST: async (params) => {
    const entity = params.entity ?? params.address
    // In production, this would query the trust registry
    log.info('Trust check performed', { entity })
    return { entity, trustScore: 0.5, labels: [], status: 'checked' }
  },

  CREATE_CASE: async (params) => {
    const type = params.type ?? 'general'
    const target = params.target
    const priority = params.priority ?? 'medium'
    log.info('Moderation case created', { type, target, priority })
    return {
      caseId: `case-${Date.now()}`,
      type,
      target,
      priority,
      status: 'created',
    }
  },

  SUBMIT_EVIDENCE: async (params) => {
    const caseId = params.caseId ?? params.case_id
    const evidenceType = params.type ?? 'text'
    log.info('Evidence submitted', { caseId, evidenceType })
    return { caseId, evidenceType, status: 'submitted' }
  },

  // Security testing actions (for red team)
  PROBE: async (params) => {
    const target = params.target ?? params.endpoint
    const test = params.test ?? params.vector ?? 'general'
    log.info('Security probe executed', { target, test })
    return { target, test, status: 'probed', findings: [] }
  },

  FUZZ: async (params) => {
    const target = params.target ?? params.contract
    const strategy = params.strategy ?? 'random'
    const iterations = Number(params.iterations ?? 100)
    log.info('Fuzzing started', { target, strategy, iterations })
    return { target, strategy, iterations, crashes: 0, status: 'completed' }
  },

  ANALYZE_CONTRACT: async (params) => {
    const address = params.address ?? params.contract
    const focus = params.focus ?? 'full'
    log.info('Contract analysis started', { address, focus })
    return { address, focus, findings: [], status: 'analyzed' }
  },

  SIMULATE_ATTACK: async (params) => {
    const attackType = params.type ?? 'unknown'
    const target = params.target
    log.info('Attack simulation', { attackType, target })
    return { type: attackType, target, simulated: true, status: 'simulated' }
  },

  REPORT_VULN: async (params) => {
    const severity = params.severity ?? 'medium'
    const vulnType = params.type ?? 'unknown'
    const description = params.description ?? ''
    log.info('Vulnerability reported', { severity, vulnType })
    return {
      vulnId: `vuln-${Date.now()}`,
      severity,
      type: vulnType,
      description,
      status: 'reported',
    }
  },

  // A2A actions
  DISCOVER_AGENTS: async () => {
    log.info('Agent discovery initiated')
    return { agents: [], total: 0, status: 'discovered' }
  },

  CALL_AGENT: async (params) => {
    const targetAgent = params.agentId ?? params.target
    const message = String(params.message ?? '')
    log.info('A2A call initiated', { targetAgent, messageLength: message.length })
    return { targetAgent, status: 'pending' }
  },

  // Infrastructure monitoring
  CHECK_NODE_STATS: async (params) => {
    const nodeType = params.type ?? 'all'
    log.info('Checking node stats', { nodeType })
    const inferenceStatus = await checkDWSInferenceAvailable()
    return {
      nodeType,
      inference: inferenceStatus,
      status: 'checked',
    }
  },

  LIST_NODES: async (params) => {
    const filter = params.filter ?? params.status ?? 'all'
    log.info('Listing nodes', { filter })
    return { filter, nodes: [], total: 0, status: 'listed' }
  },

  ALERT: async (params) => {
    const severity = params.severity ?? 'info'
    const alertType = params.type ?? 'general'
    const details = params.details ?? ''
    log.info('Alert sent', { severity, alertType, details })
    return { severity, type: alertType, details, status: 'sent' }
  },
}

// ANSI color codes for pretty logging
const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
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
  private verbose: boolean

  constructor(config: AutonomousAgentConfig, runtime: CrucibleAgentRuntime, verbose = false) {
    this.config = config
    this.runtime = runtime
    this.verbose = verbose
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

    // Load available actions based on capabilities and SDK
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
   * Load available actions from SDK and config
   */
  private async loadAvailableActions(): Promise<void> {
    const actions: AvailableAction[] = []

    // Get actions from SDK
    const sdkActions = this.runtime.getAvailableActions()
    for (const name of sdkActions) {
      actions.push({
        name,
        description: `SDK action: ${name}`,
        category: this.categorizeAction(name),
      })
    }

    // Add handler-based actions for the character type
    const charId = this.config.character.id

    // Red team characters get security testing actions
    if (
      charId.includes('red') ||
      charId === 'scammer' ||
      charId === 'security-researcher' ||
      charId === 'contracts-expert' ||
      charId === 'fuzz-tester'
    ) {
      actions.push(
        { name: 'PROBE', description: 'Probe for vulnerabilities', category: 'security' },
        { name: 'FUZZ', description: 'Fuzz test inputs', category: 'security' },
        { name: 'ANALYZE_CONTRACT', description: 'Analyze contract security', category: 'security' },
        { name: 'SIMULATE_ATTACK', description: 'Simulate an attack vector', category: 'security' },
        { name: 'REPORT_VULN', description: 'Report a vulnerability finding', category: 'security' },
      )
    }

    // Blue team characters get moderation actions
    if (
      charId.includes('blue') ||
      charId === 'moderator' ||
      charId === 'network-guardian' ||
      charId === 'contracts-auditor'
    ) {
      actions.push(
        { name: 'FLAG_CONTENT', description: 'Flag content for moderation', category: 'moderation' },
        { name: 'REPORT_AGENT', description: 'Report an agent for violation', category: 'moderation' },
        { name: 'WARN_USERS', description: 'Issue a warning to users', category: 'moderation' },
        { name: 'CHECK_TRUST', description: 'Check trust score of an entity', category: 'moderation' },
        { name: 'CREATE_CASE', description: 'Create a moderation case', category: 'moderation' },
        { name: 'SUBMIT_EVIDENCE', description: 'Submit evidence to a case', category: 'moderation' },
        { name: 'CHECK_NODE_STATS', description: 'Check infrastructure health', category: 'monitoring' },
        { name: 'LIST_NODES', description: 'List network nodes', category: 'monitoring' },
        { name: 'ALERT', description: 'Send an alert', category: 'monitoring' },
      )
    }

    // Add common actions based on capabilities
    if (this.config.capabilities.a2a) {
      actions.push(
        { name: 'DISCOVER_AGENTS', description: 'Discover available agents', category: 'a2a' },
        { name: 'CALL_AGENT', description: 'Call another agent', category: 'a2a' },
      )
    }

    if (this.config.capabilities.compute) {
      actions.push(
        { name: 'RUN_INFERENCE', description: 'Run AI inference', category: 'compute' },
      )
    }

    this.availableActions = actions
  }

  private categorizeAction(name: string): string {
    if (name.includes('GPU') || name.includes('INFERENCE') || name.includes('TRIGGER')) return 'compute'
    if (name.includes('UPLOAD') || name.includes('PIN') || name.includes('STORAGE')) return 'storage'
    if (name.includes('SWAP') || name.includes('LIQUIDITY') || name.includes('POOL')) return 'defi'
    if (name.includes('REPORT') || name.includes('CASE') || name.includes('EVIDENCE')) return 'moderation'
    if (name.includes('AGENT') || name.includes('DISCOVER')) return 'a2a'
    return 'general'
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

    // Get goals from agent configuration
    const pendingGoals: AgentGoal[] =
      this.config.goals?.filter((g) => g.status === 'active') ?? []

    return {
      availableActions: this.availableActions,
      recentActivity: [],
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
    const decision = this.parseDecision(response.text)

    // Verbose logging of agent thinking
    if (this.verbose && decision) {
      console.log(`${COLORS.dim}┌─ Agent Thought ─────────────────────────────────────${COLORS.reset}`)
      if (decision.thought) {
        // Word wrap the thought for readability
        const wrapped = decision.thought.match(/.{1,70}/g) ?? [decision.thought]
        for (const line of wrapped.slice(0, 3)) {
          console.log(`${COLORS.dim}│ ${line}${COLORS.reset}`)
        }
        if (wrapped.length > 3) {
          console.log(`${COLORS.dim}│ ...${COLORS.reset}`)
        }
      }
      if (decision.action) {
        console.log(`${COLORS.dim}│${COLORS.reset}`)
        console.log(`${COLORS.dim}│ ${COLORS.yellow}Decision: ${COLORS.bold}${decision.action}${COLORS.reset}`)
        if (decision.parameters && Object.keys(decision.parameters).length > 0) {
          console.log(`${COLORS.dim}│ Params: ${JSON.stringify(decision.parameters).substring(0, 50)}${COLORS.reset}`)
        }
      } else if (decision.isFinish) {
        console.log(`${COLORS.dim}│${COLORS.reset}`)
        console.log(`${COLORS.dim}│ ${COLORS.green}Decision: FINISH (nothing to do)${COLORS.reset}`)
      }
      console.log(`${COLORS.dim}└──────────────────────────────────────────────────────${COLORS.reset}`)
    }

    return decision
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
    const actionsByCategory = new Map<string, AvailableAction[]>()
    for (const action of context.availableActions) {
      const existing = actionsByCategory.get(action.category) ?? []
      existing.push(action)
      actionsByCategory.set(action.category, existing)
    }

    for (const [category, actions] of actionsByCategory) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`)
      for (const action of actions.slice(0, 10)) {
        lines.push(`- ${action.name}: ${action.description}`)
      }
    }
    lines.push('')

    if (previousActions.length > 0) {
      lines.push('## Actions Taken This Tick')
      for (const action of previousActions) {
        const status = action.success ? 'SUCCESS' : 'FAILED'
        lines.push(`- ${action.name}: ${status}`)
        if (action.error) {
          lines.push(`  Error: ${action.error}`)
        }
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

    let raw: unknown
    try {
      raw = JSON.parse(jsonMatch[0])
    } catch (e) {
      log.warn('Failed to parse decision JSON', {
        error: String(e),
        json: jsonMatch[0].substring(0, 200),
      })
      return null
    }

    // Validate with schema - LLM output can be unpredictable
    const parseResult = RawLLMDecisionSchema.safeParse(raw)
    if (!parseResult.success) {
      log.warn('Invalid decision JSON structure', {
        errors: parseResult.error.issues.map((i) => i.message).join(', '),
      })
      return null
    }

    const parsed = parseResult.data
    return {
      isFinish: Boolean(parsed.isFinish ?? parsed.is_finish ?? false),
      action: parsed.action,
      parameters: parsed.parameters ?? parsed.params,
      thought: (parsed.thought ?? parsed.reasoning ?? '') as string,
    }
  }

  /**
   * Execute an action using SDK handlers
   */
  private async executeAction(
    actionName: string,
    parameters: Record<string, unknown>,
  ): Promise<AutonomousAction> {
    const timestamp = Date.now()
    const normalizedAction = actionName.toUpperCase().replace(/\s+/g, '_')

    if (this.verbose) {
      console.log(`${COLORS.cyan}⚡ Executing: ${normalizedAction}${COLORS.reset}`)
    }

    log.info('Executing autonomous action', {
      action: normalizedAction,
      parameters: Object.keys(parameters),
    })

    const result: AutonomousAction = {
      name: normalizedAction,
      parameters,
      success: false,
      timestamp,
    }

    try {
      // Check if we have a handler for this action
      const handler = ACTION_HANDLERS[normalizedAction]

      if (handler) {
        result.result = await handler(parameters, {
          runtime: this.runtime,
          config: this.config,
        })
        result.success = true

        if (this.verbose) {
          console.log(`${COLORS.green}   ✓ Success${COLORS.reset}`)
          if (result.result) {
            const resultStr = JSON.stringify(result.result)
            console.log(`${COLORS.dim}   → ${resultStr.substring(0, 80)}${resultStr.length > 80 ? '...' : ''}${COLORS.reset}`)
          }
        }
      } else {
        // Check if this is a jeju plugin action
        const availableActions = this.runtime.getAvailableActions()
        const isPluginAction = availableActions.some(
          (name) => name.toUpperCase() === normalizedAction
        )

        if (isPluginAction) {
          log.info('Routing to jeju plugin action', { action: normalizedAction })
          
          // Create a message that triggers the action through normal processing
          const actionMessage: RuntimeMessage = {
            id: crypto.randomUUID(),
            userId: 'autonomous-action',
            roomId: 'plugin-action',
            content: {
              text: `Execute ${normalizedAction} with parameters: ${JSON.stringify(parameters)}`,
              source: 'autonomous-action',
            },
            createdAt: Date.now(),
          }

          const response = await this.runtime.processMessage(actionMessage)
          result.result = { response: response.text, action: response.action }
          result.success = true

          if (this.verbose) {
            console.log(`${COLORS.green}   ✓ Plugin action executed${COLORS.reset}`)
          }
        } else {
          log.warn(`No handler or plugin action for ${normalizedAction}`, { parameters })
          result.error = `Action ${normalizedAction} not available`
          result.success = false

          if (this.verbose) {
            console.log(`${COLORS.yellow}   ⚠ No handler for ${normalizedAction}${COLORS.reset}`)
          }
        }
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e)
      log.error('Action execution failed', {
        action: normalizedAction,
        error: result.error,
      })

      if (this.verbose) {
        console.log(`${COLORS.red}   ✗ Failed: ${result.error}${COLORS.reset}`)
      }
    }

    return result
  }
}
