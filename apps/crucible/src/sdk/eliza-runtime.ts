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

import { getDWSComputeUrl } from '@jejunetwork/config'
import jejuPlugin from '@jejunetwork/eliza-plugin'
import {
  DWSChatResponseSchema,
  DWSNodeStatsSchema,
  parseOrThrow,
  safeParse,
} from '../schemas'
import type { AgentCharacter } from '../types'
import { createLogger, type Logger } from './logger'

// Jeju plugin action definitions
interface JejuAction {
  name: string
  description: string
  parameters?: Record<string, { type: string; description?: string }>
}

// Loaded jeju plugin actions
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

// ============================================================================
// DWS Integration (Decentralized - No Centralized Fallbacks)
// ============================================================================

function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? getDWSComputeUrl()
}

export async function checkDWSHealth(): Promise<boolean> {
  const endpoint = getDWSEndpoint()
  const r = await fetch(`${endpoint}/health`, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  return r?.ok ?? false
}

export async function checkDWSInferenceAvailable(): Promise<{
  available: boolean
  nodes: number
  error?: string
}> {
  const endpoint = getDWSEndpoint()
  const r = await fetch(`${endpoint}/compute/nodes/stats`, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  if (!r?.ok) {
    return { available: false, nodes: 0, error: 'DWS not reachable' }
  }
  const stats = safeParse(DWSNodeStatsSchema, await r.json())
  const activeNodes = stats?.inference?.activeNodes ?? 0
  return {
    available: activeNodes > 0,
    nodes: activeNodes,
    error:
      activeNodes === 0
        ? 'No inference nodes registered. Run: cd apps/dws && bun run inference'
        : undefined,
  }
}

interface DWSChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface DWSChatRequest {
  model: string
  messages: DWSChatMessage[]
  temperature?: number
  max_tokens?: number
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
  const endpoint = getDWSEndpoint()
  const model = options.model ?? 'llama-3.1-8b-instant'

  const request: DWSChatRequest = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: 1024,
  }

  const response = await fetch(`${endpoint}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const rawData = await response.json().catch(() => ({}))
    const data = safeParse(DWSChatResponseSchema, rawData)
    if (data?.error === 'No inference nodes available') {
      throw new Error(
        `DWS has no inference nodes available. ` +
          `For local dev, run: cd apps/dws && bun run inference\n` +
          `For production, ensure inference nodes are registered with the DWS network.`,
      )
    }
    const error = data?.error ?? data?.message ?? (await response.text())
    throw new Error(`DWS inference failed: ${response.status} ${error}`)
  }

  const data = parseOrThrow(
    DWSChatResponseSchema,
    await response.json(),
    'DWS chat response',
  )
  return data.choices[0]?.message?.content ?? ''
}

// ============================================================================
// Crucible Agent Runtime
// ============================================================================

/**
 * Crucible Agent Runtime
 *
 * Character-based agent using DWS for inference.
 * Includes jeju plugin actions in context.
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
      if (jejuPlugin?.actions) {
        jejuActions = (jejuPlugin.actions as JejuAction[]).map((a) => ({
          name: a.name,
          description: a.description ?? '',
          parameters: a.parameters,
        }))
        this.log.info('Jeju plugin loaded', { actions: jejuActions.length })
      }
      jejuPluginLoaded = true
    }

    this.log.info('Agent runtime initialized', {
      agentId: this.config.agentId,
      characterName: this.config.character.name,
      actions: jejuActions.length,
    })

    this.initialized = true
  }

  /**
   * Build system prompt from character
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
      parts.push('\nYou have access to the following actions:')
      for (const action of jejuActions.slice(0, 20)) {
        // Limit to 20 for prompt length
        parts.push(`- ${action.name}: ${action.description}`)
      }
      parts.push(
        '\nWhen you need to take an action, respond with [ACTION:ACTION_NAME] followed by your message.',
      )
    }

    return parts.join('\n\n')
  }

  /**
   * Extract action from response if present
   */
  private extractAction(text: string): { action?: string; cleanText: string } {
    const actionMatch = text.match(/\[ACTION:([A-Z_]+)\]/i)
    if (actionMatch) {
      return {
        action: actionMatch[1].toUpperCase(),
        cleanText: text.replace(actionMatch[0], '').trim(),
      }
    }
    return { cleanText: text }
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

    // Generate response
    const rawResponse = await generateResponse(systemPrompt, userText)

    // Extract action if present
    const { action, cleanText } = this.extractAction(rawResponse)

    this.log.info('Generated response', {
      agentId: this.config.agentId,
      responseLength: cleanText.length,
      action,
    })

    return {
      text: cleanText,
      action,
      actions: action ? [{ name: action, params: {} }] : undefined,
    }
  }

  // ============ Lifecycle ============

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
}

/**
 * Create a new Crucible agent runtime
 */
export function createCrucibleRuntime(
  config: RuntimeConfig,
): CrucibleAgentRuntime {
  return new CrucibleAgentRuntime(config)
}

// ============================================================================
// Runtime Manager
// ============================================================================

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
