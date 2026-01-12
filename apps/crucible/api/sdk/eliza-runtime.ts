import type { Action, Plugin, Service } from '@elizaos/core'
import { getCurrentNetwork } from '@jejunetwork/config'
import {
  initJejuService,
  JEJU_SERVICE_NAME,
  type StandaloneJejuService,
} from '@jejunetwork/eliza-plugin'
import type { JejuClient } from '@jejunetwork/sdk'
import type { JsonValue, NetworkType } from '@jejunetwork/types'
import type { Hex } from 'viem'
import type { AgentCharacter } from '../../lib/types'
import {
  checkDWSHealth,
  checkDWSInferenceAvailable,
  getDWSEndpoint,
  getSharedDWSClient,
} from '../client/dws'
import { createLogger, type Logger } from './logger'

// Store the original Eliza action handlers
type ElizaActionHandler = Action['handler']

// Jeju plugin action interface with actual handler
interface JejuAction {
  name: string
  description: string
  similes?: string[]
  /** Original Eliza handler from plugin */
  elizaHandler?: ElizaActionHandler
  /** Whether this action has a real executable handler */
  hasHandler: boolean
}

// Loaded jeju plugin
let jejuPlugin: Plugin | null = null
let jejuActions: JejuAction[] = []
let jejuPluginLoaded = false

export interface RuntimeConfig {
  agentId: string
  character: AgentCharacter
  logger?: Logger
  /** Private key for signing transactions (required for on-chain actions) */
  privateKey?: Hex
  /** Network to connect to */
  network?: NetworkType
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
  actions?: Array<{
    type: string
    params: Record<string, string>
    success: boolean
    result?: { response?: string; txHash?: string; error?: string }
  }>
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
  if (!choice) {
    throw new Error('DWS inference returned no choices')
  }
  return choice.message.content ?? ''
}

/**
 * Mock service wrapper for Eliza compatibility
 * Wraps StandaloneJejuService to match Eliza's Service interface
 */
class JejuServiceWrapper {
  static serviceType = JEJU_SERVICE_NAME
  capabilityDescription =
    'Jeju Network access - compute, storage, DeFi, governance'

  private service: StandaloneJejuService

  constructor(service: StandaloneJejuService) {
    this.service = service
  }

  getClient(): JejuClient {
    return this.service.sdk
  }

  async stop(): Promise<void> {
    // Cleanup if needed
  }
}

/**
 * Crucible Agent Runtime
 *
 * Character-based agent using DWS for inference.
 * Includes jeju plugin actions for full network access.
 * Implements enough of Eliza's IAgentRuntime interface for action handlers.
 */
export class CrucibleAgentRuntime {
  private config: RuntimeConfig
  private log: Logger
  private initialized = false

  // Service management for Eliza compatibility
  private services: Map<string, Service | JejuServiceWrapper> = new Map()
  private settings: Map<string, string> = new Map()
  private cache: Map<string, JsonValue> = new Map()

  // Jeju service instance
  private jejuService: StandaloneJejuService | null = null

  constructor(config: RuntimeConfig) {
    this.config = config
    this.log = config.logger ?? createLogger(`Runtime:${config.agentId}`)

    // Initialize settings from config and env
    const network = config.network ?? (getCurrentNetwork() as NetworkType)
    this.settings.set('NETWORK_TYPE', network)
    this.settings.set('JEJU_NETWORK', network)

    if (config.privateKey) {
      this.settings.set('NETWORK_PRIVATE_KEY', config.privateKey)
      this.settings.set('JEJU_PRIVATE_KEY', config.privateKey)
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    this.log.info('Initializing agent runtime', {
      agentId: this.config.agentId,
    })

    // Initialize Jeju service if we have credentials
    // NOTE: Private key must be passed through config (from secrets module)
    // DO NOT fall back to process.env - that bypasses secret management
    const privateKey = this.config.privateKey
    if (privateKey) {
      try {
        const network =
          this.config.network ?? (getCurrentNetwork() as NetworkType)
        this.jejuService = await initJejuService({
          privateKey,
          network,
          smartAccount: false, // Use EOA for agents
        })

        // Wrap and register service
        const wrapper = new JejuServiceWrapper(this.jejuService)
        this.services.set(JEJU_SERVICE_NAME, wrapper)

        this.log.info('Jeju service initialized', {
          address: this.jejuService.sdk.address,
          network,
        })
      } catch (err) {
        this.log.warn(
          'Failed to initialize Jeju service - on-chain actions disabled',
          {
            error: err instanceof Error ? err.message : String(err),
          },
        )
      }
    } else {
      this.log.warn('No private key configured - on-chain actions disabled')
    }

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
   * Load jeju plugin and extract actions WITH their handlers
   */
  private async loadJejuPlugin(): Promise<void> {
    try {
      // Conditional dynamic import: jeju plugin may not be available in all environments
      const pluginModule = await import('@jejunetwork/eliza-plugin')
      jejuPlugin = pluginModule.jejuPlugin

      if (jejuPlugin?.actions) {
        const actions = jejuPlugin.actions as Action[]
        jejuActions = actions.map((action) => ({
          name: action.name,
          description:
            typeof action.description === 'string' ? action.description : '',
          similes: Array.isArray(action.similes) ? action.similes : undefined,
          // Store the actual handler function from the plugin
          elizaHandler: action.handler,
          hasHandler: typeof action.handler === 'function',
        }))

        const withHandlers = jejuActions.filter((a) => a.hasHandler).length
        const withoutHandlers = jejuActions.filter((a) => !a.hasHandler).length

        this.log.info('Jeju plugin loaded', {
          totalActions: jejuActions.length,
          withHandlers,
          withoutHandlers,
          actionNames: jejuActions.slice(0, 10).map((a) => a.name),
        })

        if (withoutHandlers > 0) {
          this.log.warn('Some actions have no handlers', {
            count: withoutHandlers,
            actions: jejuActions
              .filter((a) => !a.hasHandler)
              .slice(0, 5)
              .map((a) => a.name),
          })
        }
      }
      jejuPluginLoaded = true
    } catch (e) {
      this.log.error('Failed to load Jeju plugin', { error: String(e) })
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
    if (char.topics.length) {
      parts.push(`You are knowledgeable about: ${char.topics.join(', ')}.`)
    }

    // Adjectives
    if (char.adjectives.length) {
      parts.push(`Your personality traits: ${char.adjectives.join(', ')}.`)
    }

    // Style
    if (char.style.all.length) {
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
    const network = getCurrentNetwork()
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

    // If action was detected, try to execute it
    if (action && this.actionHasHandler(action)) {
      this.log.info('Executing action', { action, params })
      const execResult = await this.executeAction(action, params)

      // Combine LLM response text with action result
      const actionResultText = execResult.success
        ? (execResult.result as { response?: string })?.response ?? ''
        : `Action failed: ${execResult.error}`

      const combinedText = actionResultText
        ? `${cleanText}\n\n${actionResultText}`
        : cleanText

      return {
        text: combinedText,
        action,
        actions: [
          {
            type: action,
            params,
            success: execResult.success,
            result: execResult.success
              ? { response: (execResult.result as { response?: string })?.response }
              : { error: execResult.error },
          },
        ],
      }
    }

    return {
      text: cleanText,
      action,
      actions: action ? [{ type: action, params, success: false, result: { error: 'No handler available' } }] : undefined,
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

  // ============================================
  // Eliza IAgentRuntime compatibility methods
  // Required for action handlers to work
  // ============================================

  /**
   * Get a registered service by name
   * Used by Eliza action handlers to access JejuService
   */
  getService(name: string): Service | JejuServiceWrapper | undefined {
    return this.services.get(name.toLowerCase())
  }

  /**
   * Register a service
   */
  registerService(service: Service): void {
    const serviceType = (service.constructor as { serviceType?: string })
      .serviceType
    if (serviceType) {
      this.services.set(serviceType.toLowerCase(), service)
    }
  }

  /**
   * Get a setting value
   * Used by Eliza handlers to get configuration
   */
  getSetting(key: string): string | undefined {
    // Check runtime settings first
    const value = this.settings.get(key)
    if (value !== undefined) return value

    // Fall back to environment variables
    return process.env[key]
  }

  /**
   * Get cached data
   */
  async getCache<T>(key: string): Promise<T | undefined> {
    return this.cache.get(key) as T | undefined
  }

  /**
   * Set cached data
   */
  async setCache(key: string, value: JsonValue): Promise<void> {
    this.cache.set(key, value)
  }

  /**
   * Check if we have an active signer for on-chain actions
   */
  hasSigner(): boolean {
    return this.jejuService !== null
  }

  /**
   * Generate text using DWS inference
   * Required by Eliza action handlers like AUDIT_CONTRACT for LLM analysis
   */
  async generateText(prompt: string): Promise<string> {
    const client = getSharedDWSClient()
    const network = getCurrentNetwork()
    const modelPrefs = this.config.character.modelPreferences

    // Use larger model for analysis tasks
    const model =
      network === 'testnet' || network === 'mainnet'
        ? (modelPrefs?.large ?? 'llama-3.3-70b-versatile')
        : (modelPrefs?.small ?? 'llama-3.1-8b-instant')

    this.log.info('generateText called', {
      promptLength: prompt.length,
      model,
    })

    const response = await client.chatCompletion(
      [{ role: 'user', content: prompt }],
      {
        model,
        temperature: 0.3, // Lower temperature for structured analysis
        maxTokens: 2048,
      },
    )

    const choice = response.choices[0]
    if (!choice) {
      throw new Error('DWS inference returned no choices')
    }

    const text = choice.message.content ?? ''
    this.log.info('generateText completed', {
      responseLength: text.length,
    })

    return text
  }

  /**
   * Use a specific model tier for generation
   * Required by Eliza action handlers
   * @param modelTier - 'TEXT_SMALL', 'TEXT_LARGE', 'TEXT_ANALYSIS', etc.
   * @param options - { prompt: string }
   */
  async useModel(
    modelTier: string,
    options: { prompt: string },
  ): Promise<string> {
    const client = getSharedDWSClient()

    // Default tier to model mapping
    const tierToModel: Record<string, string> = {
      TEXT_SMALL: 'llama-3.1-8b-instant',
      TEXT_LARGE: 'llama-3.3-70b-versatile',
      TEXT_ANALYSIS: 'llama-3.3-70b-versatile',
    }

    // Character preferences override defaults for each tier
    const modelPrefs = this.config.character.modelPreferences
    let model: string
    if (modelTier === 'TEXT_ANALYSIS') {
      // Analysis tier: use analysis preference, fall back to large, then default
      model = modelPrefs?.analysis ?? modelPrefs?.large ?? tierToModel[modelTier] ?? 'llama-3.3-70b-versatile'
    } else if (modelTier === 'TEXT_LARGE') {
      model = modelPrefs?.large ?? tierToModel[modelTier] ?? 'llama-3.3-70b-versatile'
    } else if (modelTier === 'TEXT_SMALL') {
      model = modelPrefs?.small ?? tierToModel[modelTier] ?? 'llama-3.1-8b-instant'
    } else {
      model = tierToModel[modelTier] ?? 'llama-3.1-8b-instant'
    }

    this.log.info('useModel called', {
      modelTier,
      model,
      promptLength: options.prompt.length,
    })

    const response = await client.chatCompletion(
      [{ role: 'user', content: options.prompt }],
      {
        model,
        temperature: 0.3,
        maxTokens: 2048,
      },
    )

    const choice = response.choices[0]
    if (!choice) {
      throw new Error('DWS inference returned no choices')
    }

    const text = choice.message.content ?? ''
    this.log.info('useModel completed', {
      modelTier,
      responseLength: text.length,
    })

    return text
  }

  /**
   * Get memories from a room (Eliza compatibility)
   */
  async getMemories(params: {
    roomId: string
    count?: number
    tableName?: string
  }): Promise<Array<{
    id: string
    entityId: string
    agentId?: string
    roomId: string
    content: { text: string }
    createdAt?: number
  }>> {
    const { getDatabase } = await import('./database')
    const db = getDatabase()

    const messages = await db.getMessages(params.roomId, {
      limit: params.count ?? 10,
    })

    return messages.map((msg) => ({
      id: String(msg.id),
      entityId: msg.agent_id,
      agentId: msg.agent_id,
      roomId: msg.room_id,
      content: { text: msg.content },
      createdAt: msg.created_at * 1000,
    }))
  }

  /**
   * Get the Jeju SDK client directly
   */
  getJejuClient(): JejuClient | null {
    return this.jejuService?.sdk ?? null
  }

  /**
   * Execute a specific action by name
   * Returns the result of the action execution
   */
  async executeAction(
    actionName: string,
    params: Record<string, string>,
  ): Promise<{ success: boolean; result?: JsonValue; error?: string }> {
    // Find the action in the loaded jeju actions
    const action = jejuActions.find(
      (a) => a.name.toUpperCase() === actionName.toUpperCase(),
    )

    if (!action) {
      this.log.warn('Action not found', {
        actionName,
        availableActions: jejuActions.map((a) => a.name),
      })
      return { success: false, error: `Action not found: ${actionName}` }
    }

    if (!action.hasHandler || !action.elizaHandler) {
      this.log.warn('Action has no handler', { actionName })
      return { success: false, error: `Action has no handler: ${actionName}` }
    }

    this.log.info('Executing action', { actionName, params })

    try {
      // Build a minimal runtime context for Eliza action handlers
      // The Eliza handler expects (runtime, message, state, options, callback)
      // We create mock objects that provide what most handlers need

      // Build message text that handlers can parse
      // Most handlers expect URLs/values directly in text, not as JSON
      const messageText = params.url
        ? params.url
        : Object.entries(params)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')

      const mockMessage = {
        content: { text: messageText },
        userId: this.config.agentId,
        roomId: 'crucible-runtime',
      }

      const mockState = {
        agentId: this.config.agentId,
        roomId: 'crucible-runtime',
      }

      // Eliza handlers return void and call the callback with results
      // Track whether callback was invoked and capture results
      let callbackInvoked = false
      let callbackResult: JsonValue = null

      const callback = async (response: {
        text?: string
        content?: { text?: string }
      }): Promise<void> => {
        callbackInvoked = true
        // Capture the response from the handler
        const text = response.text ?? response.content?.text ?? ''
        callbackResult = { response: text }
      }

      // Execute the Eliza action handler
      // Cast through unknown as the mock objects don't fully implement Eliza types
      await action.elizaHandler(
        this as unknown as Parameters<ElizaActionHandler>[0], // IAgentRuntime - we implement enough of the interface
        mockMessage as unknown as Parameters<ElizaActionHandler>[1],
        mockState as unknown as Parameters<ElizaActionHandler>[2],
        {
          actionParams: params,
        } as unknown as Parameters<ElizaActionHandler>[3],
        callback as unknown as Parameters<ElizaActionHandler>[4],
      )

      this.log.info('Action executed', {
        actionName,
        callbackInvoked,
        callbackResult,
      })

      // Success if callback was invoked (handler communicated a result)
      const success = callbackInvoked
      const resultValue = callbackResult ?? { executed: true }

      return {
        success,
        result: resultValue,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.log.error('Action execution failed', {
        actionName,
        error: errorMessage,
      })
      return { success: false, error: errorMessage }
    }
  }

  /** Check if a specific action has a handler */
  actionHasHandler(actionName: string): boolean {
    const action = jejuActions.find(
      (a) => a.name.toUpperCase() === actionName.toUpperCase(),
    )
    return action?.hasHandler ?? false
  }

  /** Get all actions that have executable handlers */
  getExecutableActions(): string[] {
    return jejuActions.filter((a) => a.hasHandler).map((a) => a.name)
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
