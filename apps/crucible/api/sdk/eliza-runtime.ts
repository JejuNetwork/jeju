/**
 * Crucible Agent Runtime
 *
 * Fully decentralized agent runtime using DWS for inference.
 * Integrates jeju plugin actions for network capabilities.
 *
 * All inference goes through DWS compute network - no centralized fallbacks.
 * For local development, run the DWS inference node:
 *   cd apps/dws && bun run inference
 */

import type { Action, Plugin } from '@elizaos/core'
import type { AgentCharacter } from '../../lib/types'
import {
  checkDWSHealth,
  checkDWSInferenceAvailable,
  getDWSEndpoint,
  getSharedDWSClient,
} from '../client/dws'
import { createLogger, type Logger } from './logger'

// Jeju plugin action interface
interface JejuAction {
  name: string
  description: string
  similes?: string[]
  handler?: (
    runtime: CrucibleAgentRuntime,
    params: Record<string, string | number | boolean | null>,
  ) => Promise<string | number | boolean | null | object>
}

// Loaded jeju plugin
let jejuPlugin: Plugin | null = null
let jejuActions: JejuAction[] = []
let jejuPluginLoaded = false

export interface RuntimeConfig {
  agentId: string
  character: AgentCharacter
  logger?: Logger
}

export interface RuntimeMessage {
  id: string
  userId: string
  roomId: string
  content: { text: string; source?: string }
  createdAt: number
}

export interface RuntimeResponse {
  text: string
  action?: string
  actions?: Array<{ name: string; params: Record<string, string> }>
}

/**
 * Call DWS compute network for chat completions
 * Fully decentralized - routes to registered inference nodes
 */
async function generateResponse(
  systemPrompt: string,
  userMessage: string,
  options: { model?: string; temperature?: number } = {},
): Promise<string> {
  const client = getSharedDWSClient()
  const response = await client.chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    {
      model: options.model ?? 'llama-3.1-8b-instant',
      temperature: options.temperature ?? 0.7,
      maxTokens: 1024,
    },
  )
  const choice = response.choices[0]
  return choice?.message?.content ?? ''
}

/**
 * Crucible Agent Runtime
 *
 * Character-based agent using DWS for inference.
 * Includes jeju plugin actions for full network access.
 */
export class CrucibleAgentRuntime {
  private config: RuntimeConfig
  private log: Logger
  private initialized = false

  constructor(config: RuntimeConfig) {
    this.config = config
    this.log = config.logger ?? createLogger(`Runtime:${config.agentId}`)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    this.log.info('Initializing agent runtime', {
      agentId: this.config.agentId,
    })

    // Check DWS availability (fully decentralized - no centralized fallbacks)
    const dwsOk = await checkDWSHealth()
    if (!dwsOk) {
      throw new Error(
        `DWS not available at ${getDWSEndpoint()}. Start DWS: cd apps/dws && bun run dev`,
      )
    }

    // Check if inference nodes are available
    const inference = await checkDWSInferenceAvailable()
    if (!inference.available) {
      this.log.warn('No inference nodes available', { error: inference.error })
      // Don't fail initialization - nodes may come online later
    } else {
      this.log.info('DWS inference available', { nodes: inference.nodes })
    }

    // Load jeju plugin actions if not already loaded
    if (!jejuPluginLoaded) {
      await this.loadJejuPlugin()
    }

    this.log.info('Agent runtime initialized', {
      agentId: this.config.agentId,
      characterName: this.config.character.name,
      actions: jejuActions.length,
    })

    this.initialized = true
  }

  /**
   * Load jeju plugin and extract actions
   */
  private async loadJejuPlugin(): Promise<void> {
    try {
      // Conditional dynamic import: jeju plugin may not be available in all environments
      const pluginModule = await import('@jejunetwork/eliza-plugin')
      jejuPlugin = pluginModule.jejuPlugin

      if (jejuPlugin?.actions) {
        jejuActions = (jejuPlugin.actions as Action[]).map((action) => ({
          name: action.name,
          description:
            typeof action.description === 'string' ? action.description : '',
          similes: Array.isArray(action.similes) ? action.similes : undefined,
        }))
        this.log.info('Jeju plugin loaded', {
          actions: jejuActions.length,
          actionNames: jejuActions.slice(0, 10).map((a) => a.name),
        })
      }
      jejuPluginLoaded = true
    } catch (e) {
      this.log.warn('Jeju plugin not available', { error: String(e) })
      jejuPluginLoaded = true // Mark as attempted
    }
  }

  /**
   * Build system prompt from character with available actions
   */
  private buildSystemPrompt(): string {
    const char = this.config.character
    const parts: string[] = []

    // Character identity
    parts.push(`You are ${char.name}.`)

    if (char.system) {
      parts.push(char.system)
    }

    // Bio
    if (char.bio) {
      const bio = Array.isArray(char.bio) ? char.bio.join(' ') : char.bio
      parts.push(bio)
    }

    // Topics
    if (char.topics?.length) {
      parts.push(`You are knowledgeable about: ${char.topics.join(', ')}.`)
    }

    // Adjectives
    if (char.adjectives?.length) {
      parts.push(`Your personality traits: ${char.adjectives.join(', ')}.`)
    }

    // Style
    if (char.style?.all?.length) {
      parts.push(`Communication style: ${char.style.all.join(' ')}`)
    }

    // Available actions (from jeju plugin)
    if (jejuActions.length > 0) {
      parts.push('\n## Available Network Actions')
      parts.push(
        'You have access to the Jeju Network SDK with the following actions:',
      )

      // Group by category
      const computeActions = jejuActions.filter(
        (a) =>
          a.name.includes('GPU') ||
          a.name.includes('INFERENCE') ||
          a.name.includes('TRIGGER'),
      )
      const storageActions = jejuActions.filter(
        (a) =>
          a.name.includes('UPLOAD') ||
          a.name.includes('PIN') ||
          a.name.includes('STORAGE'),
      )
      const defiActions = jejuActions.filter(
        (a) =>
          a.name.includes('SWAP') ||
          a.name.includes('LIQUIDITY') ||
          a.name.includes('POOL'),
      )
      const modActions = jejuActions.filter(
        (a) =>
          a.name.includes('REPORT') ||
          a.name.includes('CASE') ||
          a.name.includes('EVIDENCE') ||
          a.name.includes('LABEL'),
      )
      const a2aActions = jejuActions.filter(
        (a) => a.name.includes('AGENT') || a.name.includes('DISCOVER'),
      )

      if (computeActions.length > 0) {
        parts.push('\n### Compute')
        for (const action of computeActions.slice(0, 5)) {
          parts.push(`- ${action.name}: ${action.description}`)
        }
      }

      if (storageActions.length > 0) {
        parts.push('\n### Storage')
        for (const action of storageActions.slice(0, 5)) {
          parts.push(`- ${action.name}: ${action.description}`)
        }
      }

      if (defiActions.length > 0) {
        parts.push('\n### DeFi')
        for (const action of defiActions.slice(0, 5)) {
          parts.push(`- ${action.name}: ${action.description}`)
        }
      }

      if (modActions.length > 0) {
        parts.push('\n### Moderation')
        for (const action of modActions.slice(0, 5)) {
          parts.push(`- ${action.name}: ${action.description}`)
        }
      }

      if (a2aActions.length > 0) {
        parts.push('\n### Agent-to-Agent')
        for (const action of a2aActions.slice(0, 5)) {
          parts.push(`- ${action.name}: ${action.description}`)
        }
      }

      parts.push(
        '\nTo execute an action, include [ACTION:ACTION_NAME | param1=value1 | param2=value2] in your response.',
      )
    }

    return parts.join('\n\n')
  }

  /**
   * Extract action from response if present
   */
  private extractAction(text: string): {
    action?: string
    params: Record<string, string>
    cleanText: string
  } {
    const actionMatch = text.match(
      /\[ACTION:\s*([A-Z_]+)(?:\s*\|\s*([^\]]*))?\]/i,
    )
    if (actionMatch) {
      const action = actionMatch[1].toUpperCase()
      const paramsStr = actionMatch[2] ?? ''
      const params: Record<string, string> = {}

      // Parse params like "target=0x123 | reason=scam"
      for (const part of paramsStr.split('|')) {
        const [key, ...valueParts] = part.trim().split('=')
        if (key && valueParts.length > 0) {
          params[key.trim()] = valueParts.join('=').trim()
        }
      }

      return {
        action,
        params,
        cleanText: text.replace(actionMatch[0], '').trim(),
      }
    }
    return { params: {}, cleanText: text }
  }

  /**
   * Process a message through the agent
   */
  async processMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!this.initialized) {
      await this.initialize()
    }

    const systemPrompt = this.buildSystemPrompt()
    const userText = message.content.text

    this.log.info('Processing message', {
      agentId: this.config.agentId,
      userId: message.userId,
      textLength: userText.length,
    })

    // Determine model based on network and character preferences
    const network = process.env.NETWORK ?? 'localnet'
    const modelPrefs = this.config.character.modelPreferences
    const model =
      network === 'testnet' || network === 'mainnet'
        ? (modelPrefs?.large ?? 'llama-3.3-70b-versatile')
        : (modelPrefs?.small ?? 'llama-3.1-8b-instant')

    // Generate response
    const rawResponse = await generateResponse(systemPrompt, userText, {
      model,
    })

    // Extract action if present
    const { action, params, cleanText } = this.extractAction(rawResponse)

    this.log.info('Generated response', {
      agentId: this.config.agentId,
      responseLength: cleanText.length,
      action: action ?? null,
      params: Object.keys(params).length > 0 ? params : null,
    })

    return {
      text: cleanText,
      action,
      actions: action ? [{ name: action, params }] : undefined,
    }
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getAgentId(): string {
    return this.config.agentId
  }

  getCharacter(): AgentCharacter {
    return this.config.character
  }

  /** Check if actions are available */
  hasActions(): boolean {
    return jejuActions.length > 0
  }

  /** Get available action names */
  getAvailableActions(): string[] {
    return jejuActions.map((a) => a.name)
  }

  /** Get the loaded jeju plugin */
  getPlugin(): Plugin | null {
    return jejuPlugin
  }
}

/**
 * Create a new Crucible agent runtime
 */
export function createCrucibleRuntime(
  config: RuntimeConfig,
): CrucibleAgentRuntime {
  return new CrucibleAgentRuntime(config)
}

/**
 * Runtime manager for multiple agents
 */
export class CrucibleRuntimeManager {
  private runtimes = new Map<string, CrucibleAgentRuntime>()
  private log = createLogger('RuntimeManager')

  async createRuntime(config: RuntimeConfig): Promise<CrucibleAgentRuntime> {
    const existing = this.runtimes.get(config.agentId)
    if (existing) {
      return existing
    }

    const runtime = new CrucibleAgentRuntime(config)
    await runtime.initialize()
    this.runtimes.set(config.agentId, runtime)

    this.log.info('Runtime created', { agentId: config.agentId })
    return runtime
  }

  getRuntime(agentId: string): CrucibleAgentRuntime | undefined {
    return this.runtimes.get(agentId)
  }

  getAllRuntimes(): CrucibleAgentRuntime[] {
    return Array.from(this.runtimes.values())
  }

  async shutdown(): Promise<void> {
    this.runtimes.clear()
    this.log.info('All runtimes shut down')
  }
}

export const runtimeManager = new CrucibleRuntimeManager()
