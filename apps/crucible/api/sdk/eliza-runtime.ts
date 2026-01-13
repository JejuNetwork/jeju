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
    const upperName = actionName.toUpperCase()

    // Handle built-in crucible actions first
    if (upperName === 'POST_TO_ROOM') {
      return this.executePostToRoom(params)
    }
    if (upperName === 'READ_ROOM_ALERTS') {
      return this.executeReadRoomAlerts(params)
    }
    if (upperName === 'SEARCH_DISCUSSIONS') {
      return this.executeSearchDiscussions(params)
    }
    if (upperName === 'POST_GITHUB_DISCUSSION') {
      return this.executePostGithubDiscussion(params)
    }
    if (upperName === 'GET_INFRA_HEALTH') {
      return this.executeGetInfraHealth(params)
    }
    if (upperName === 'GET_INFRA_STATUS') {
      return this.executeGetInfraStatus(params)
    }

    // Find the action in the loaded jeju actions
    const action = jejuActions.find(
      (a) => a.name.toUpperCase() === upperName,
    )

    if (!action) {
      this.log.warn('Action not found', {
        actionName,
        availableActions: [...jejuActions.map((a) => a.name), 'POST_TO_ROOM'],
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
    const upperName = actionName.toUpperCase()
    // Built-in actions
    if (upperName === 'POST_TO_ROOM') return true

    const action = jejuActions.find(
      (a) => a.name.toUpperCase() === upperName,
    )
    return action?.hasHandler ?? false
  }

  /** Get all actions that have executable handlers */
  getExecutableActions(): string[] {
    const builtInActions = [
      'POST_TO_ROOM',
      'READ_ROOM_ALERTS',
      'SEARCH_DISCUSSIONS',
      'POST_GITHUB_DISCUSSION',
      'GET_INFRA_HEALTH',
      'GET_INFRA_STATUS',
    ]
    return [...jejuActions.filter((a) => a.hasHandler).map((a) => a.name), ...builtInActions]
  }

  /**
   * Execute POST_TO_ROOM action - posts a message to a room
   */
  private async executePostToRoom(
    params: Record<string, string>,
  ): Promise<{ success: boolean; result?: JsonValue; error?: string }> {
    const { room, content } = params

    if (!room) {
      return { success: false, error: 'POST_TO_ROOM requires room parameter' }
    }
    if (!content) {
      return { success: false, error: 'POST_TO_ROOM requires content parameter' }
    }

    this.log.info('Executing POST_TO_ROOM', { room, contentLength: content.length })

    try {
      // Import database and post message
      const { getDatabase } = await import('./database')
      const db = getDatabase()

      await db.createMessage({
        roomId: room,
        agentId: this.config.agentId,
        content,
      })

      this.log.info('Posted to room', { room, agentId: this.config.agentId })
      return { success: true, result: { room, posted: true } }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.error('Failed to post to room', { room, error: errorMsg })
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Execute READ_ROOM_ALERTS action - reads messages from a room within time range
   * Supports 'after' parameter for watermark-based duplicate avoidance
   */
  private async executeReadRoomAlerts(
    params: Record<string, string>,
  ): Promise<{ success: boolean; result?: JsonValue; error?: string }> {
    const { room, hours, after } = params
    const hoursNum = Number(hours) || 24
    const afterTimestamp = after ? Number(after) : undefined

    if (!room) {
      return { success: false, error: 'READ_ROOM_ALERTS requires room parameter' }
    }

    this.log.info('Executing READ_ROOM_ALERTS', { room, hours: hoursNum, after: afterTimestamp ?? null })

    try {
      const { getDatabase } = await import('./database')
      const db = getDatabase()

      // Use 'after' watermark if provided, otherwise use hours-based calculation
      let sinceTimestamp: number
      if (afterTimestamp && afterTimestamp > 0) {
        // Add 1 second to avoid re-processing the exact same message
        sinceTimestamp = Math.floor(afterTimestamp / 1000) + 1
        this.log.debug('Using watermark-based filtering', { afterTimestamp, sinceSeconds: sinceTimestamp })
      } else {
        // Fallback to hours-based calculation
        sinceTimestamp = Math.floor(Date.now() / 1000) - (hoursNum * 60 * 60)
      }

      const messages = await db.getMessages(room, {
        since: sinceTimestamp,
        limit: 1000, // Get up to 1000 messages
      })

      this.log.info('Read room alerts', { room, messageCount: messages.length, usedWatermark: !!afterTimestamp })

      // Format messages for LLM consumption
      const formattedMessages = messages.map((msg) => ({
        id: String(msg.id),
        timestamp: new Date(msg.created_at * 1000).toISOString(),
        timestampMs: msg.created_at * 1000,
        agent: msg.agent_id,
        content: msg.content,
      }))

      // Calculate latest timestamp for watermark update
      const latestTimestamp = messages.length > 0
        ? Math.max(...messages.map((m) => m.created_at * 1000))
        : afterTimestamp ?? Date.now()

      return {
        success: true,
        result: {
          room,
          hours: hoursNum,
          messageCount: messages.length,
          messages: formattedMessages,
          latestTimestamp, // Return for watermark tracking
          usedWatermark: !!afterTimestamp,
        },
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.error('Failed to read room alerts', { room, error: errorMsg })
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Execute SEARCH_DISCUSSIONS action - search GitHub Discussions for duplicates
   */
  private async executeSearchDiscussions(
    params: Record<string, string>,
  ): Promise<{ success: boolean; result?: JsonValue; error?: string }> {
    const { query } = params

    if (!query) {
      return { success: false, error: 'SEARCH_DISCUSSIONS requires query parameter' }
    }

    const token = process.env.GITHUB_TOKEN
    const owner = process.env.GITHUB_REPO_OWNER
    const repoName = process.env.GITHUB_REPO_NAME

    if (!token || !owner || !repoName) {
      this.log.warn('GitHub credentials not configured', { hasToken: !!token, hasOwner: !!owner, hasRepo: !!repoName })
      return {
        success: true,
        result: { discussions: [], note: 'GitHub not configured - skipping search' },
      }
    }

    this.log.info('Executing SEARCH_DISCUSSIONS', { query, owner, repoName })

    try {

      // GraphQL query to search discussions
      const graphqlQuery = `
        query SearchDiscussions($query: String!) {
          search(query: $query, type: DISCUSSION, first: 10) {
            nodes {
              ... on Discussion {
                title
                url
                createdAt
                body
              }
            }
          }
        }
      `

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { query: `repo:${owner}/${repoName} ${query}` },
        }),
      })

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json() as {
        data?: { search?: { nodes?: Array<{ title: string; url: string; createdAt: string }> } }
        errors?: Array<{ message: string }>
      }

      if (data.errors) {
        throw new Error(data.errors.map((e) => e.message).join(', '))
      }

      const discussions = data.data?.search?.nodes ?? []

      this.log.info('Found discussions', { count: discussions.length })

      return {
        success: true,
        result: {
          query,
          count: discussions.length,
          discussions: discussions.map((d) => ({
            title: d.title,
            url: d.url,
            createdAt: d.createdAt,
          })),
        },
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.error('Failed to search discussions', { error: errorMsg })
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Execute POST_GITHUB_DISCUSSION action - create a GitHub Discussion
   * Falls back to posting to infra-monitoring room if GitHub fails
   */
  private async executePostGithubDiscussion(
    params: Record<string, string>,
  ): Promise<{ success: boolean; result?: JsonValue; error?: string }> {
    const { title, body } = params

    if (!title) {
      return { success: false, error: 'POST_GITHUB_DISCUSSION requires title parameter' }
    }
    if (!body) {
      return { success: false, error: 'POST_GITHUB_DISCUSSION requires body parameter' }
    }

    const token = process.env.GITHUB_TOKEN
    const owner = process.env.GITHUB_REPO_OWNER
    const repoName = process.env.GITHUB_REPO_NAME
    const categoryId = process.env.GITHUB_CATEGORY_ID

    if (!token || !owner || !repoName || !categoryId) {
      this.log.warn('GitHub credentials not configured, falling back to room post', {
        hasToken: !!token,
        hasOwner: !!owner,
        hasRepo: !!repoName,
        hasCategoryId: !!categoryId,
      })
      // Fallback to posting to infra-monitoring room
      return this.executePostToRoom({
        room: 'infra-monitoring',
        content: `# ${title}\n\n${body}\n\n---\n_Note: GitHub posting unavailable, posted to room instead_`,
      })
    }

    this.log.info('Executing POST_GITHUB_DISCUSSION', { title, owner, repoName })

    try {

      // First, get the repository ID
      const repoQuery = `
        query GetRepoId($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            id
          }
        }
      `

      const repoResponse = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: repoQuery,
          variables: { owner, name: repoName },
        }),
      })

      if (!repoResponse.ok) {
        throw new Error(`GitHub API error: ${repoResponse.status}`)
      }

      const repoData = await repoResponse.json() as {
        data?: { repository?: { id: string } }
        errors?: Array<{ message: string }>
      }

      if (repoData.errors) {
        throw new Error(repoData.errors.map((e) => e.message).join(', '))
      }

      const repositoryId = repoData.data?.repository?.id
      if (!repositoryId) {
        throw new Error('Could not find repository ID')
      }

      // Create the discussion
      const createMutation = `
        mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
          createDiscussion(input: {
            repositoryId: $repositoryId,
            categoryId: $categoryId,
            title: $title,
            body: $body
          }) {
            discussion {
              id
              url
            }
          }
        }
      `

      const createResponse = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: createMutation,
          variables: {
            repositoryId,
            categoryId,
            title,
            body,
          },
        }),
      })

      if (!createResponse.ok) {
        throw new Error(`GitHub API error: ${createResponse.status}`)
      }

      const createData = await createResponse.json() as {
        data?: { createDiscussion?: { discussion?: { id: string; url: string } } }
        errors?: Array<{ message: string }>
      }

      if (createData.errors) {
        throw new Error(createData.errors.map((e) => e.message).join(', '))
      }

      const discussion = createData.data?.createDiscussion?.discussion
      if (!discussion) {
        throw new Error('Failed to create discussion')
      }

      this.log.info('Created GitHub Discussion', { url: discussion.url })

      return {
        success: true,
        result: {
          posted: true,
          url: discussion.url,
          id: discussion.id,
        },
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.error('Failed to post GitHub Discussion, falling back to room', { error: errorMsg })

      // Fallback to posting to infra-monitoring room
      return this.executePostToRoom({
        room: 'infra-monitoring',
        content: `# ${title}\n\n${body}\n\n---\n_Note: GitHub posting failed (${errorMsg}), posted to room instead_`,
      })
    }
  }

  /**
   * Execute GET_INFRA_HEALTH action - probe DWS and inference node endpoints
   * Returns real infrastructure health data
   */
  private async executeGetInfraHealth(
    _params: Record<string, string>,
  ): Promise<{ success: boolean; result?: JsonValue; error?: string }> {
    this.log.info('Executing GET_INFRA_HEALTH - probing infrastructure endpoints')

    const timestamp = Date.now()
    const results: {
      timestamp: number
      dws: { status: string; latencyMs: number; error?: string }
      inference: { nodeCount: number; latencyMs: number; nodes?: Array<{ id: string; status: string }>; error?: string }
    } = {
      timestamp,
      dws: { status: 'unknown', latencyMs: 0 },
      inference: { nodeCount: 0, latencyMs: 0 },
    }

    // Probe DWS health endpoint
    const dwsUrl = process.env.DWS_URL || 'http://localhost:4030'
    try {
      const dwsStart = Date.now()
      const dwsResponse = await fetch(`${dwsUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      results.dws.latencyMs = Date.now() - dwsStart
      results.dws.status = dwsResponse.ok ? 'healthy' : 'unhealthy'
    } catch (err) {
      results.dws.status = 'unhealthy'
      results.dws.error = err instanceof Error ? err.message : 'Connection failed'
      this.log.warn('DWS health check failed', { error: results.dws.error })
    }

    // Probe inference nodes endpoint
    try {
      const inferenceStart = Date.now()
      const inferenceResponse = await fetch(`${dwsUrl}/compute/nodes/inference`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      results.inference.latencyMs = Date.now() - inferenceStart

      if (inferenceResponse.ok) {
        const data = await inferenceResponse.json() as { nodes?: Array<{ id: string; status: string }> }
        const nodes = data.nodes ?? []
        results.inference.nodeCount = nodes.length
        results.inference.nodes = nodes.slice(0, 10) // Limit to first 10 for brevity
      } else {
        results.inference.error = `HTTP ${inferenceResponse.status}`
      }
    } catch (err) {
      results.inference.error = err instanceof Error ? err.message : 'Connection failed'
      this.log.warn('Inference nodes check failed', { error: results.inference.error })
    }

    this.log.info('Infrastructure health check complete', {
      dwsStatus: results.dws.status,
      inferenceNodes: results.inference.nodeCount,
    })

    return {
      success: true,
      result: results,
    }
  }

  /**
   * Execute GET_INFRA_STATUS action - probe infrastructure AND evaluate thresholds
   * Returns evaluated status with alerts, ready for LLM to format
   */
  private async executeGetInfraStatus(
    _params: Record<string, string>,
  ): Promise<{ success: boolean; result?: JsonValue; error?: string }> {
    this.log.info('Executing GET_INFRA_STATUS - probing and evaluating infrastructure')

    const timestamp = Date.now()
    const alerts: Array<{
      severity: 'P0' | 'P1' | 'P2' | 'P3'
      source: string
      message: string
      metric?: string
      value?: number | string
    }> = []

    // Endpoint configurations for infrastructure health monitoring
    const endpoints = {
      dws: { url: process.env.DWS_URL || 'http://localhost:4030', paths: ['/health'] },
      crucible: { url: 'http://localhost:4021', paths: ['/health'] },
      indexer: { url: 'http://localhost:4004', paths: ['/health'] },
      oracle: { url: 'http://localhost:4301', paths: ['/health'] },
      jns: { url: 'http://localhost:4302', paths: ['/health'] },
      sqlit: { url: 'http://localhost:4661', paths: ['/health'] },
    }

    const metrics: Record<string, { status: string; latencyMs: number; error?: string }> = {}

    // Probe each endpoint
    for (const [name, config] of Object.entries(endpoints)) {
      for (const path of config.paths) {
        const key = `${name}${path.replace('/', '_')}`
        try {
          const start = Date.now()
          const response = await fetch(`${config.url}${path}`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
          })
          const latency = Date.now() - start

          metrics[key] = {
            status: response.ok ? 'healthy' : 'unhealthy',
            latencyMs: latency,
          }

          // Threshold checks
          if (!response.ok) {
            alerts.push({
              severity: 'P0',
              source: name,
              message: `${name} service is unhealthy`,
              metric: 'status',
              value: response.status,
            })
          } else if (latency > 5000) {
            alerts.push({
              severity: 'P1',
              source: name,
              message: `${name} latency critically high`,
              metric: 'latency_ms',
              value: latency,
            })
          } else if (latency > 2000) {
            alerts.push({
              severity: 'P2',
              source: name,
              message: `${name} latency elevated`,
              metric: 'latency_ms',
              value: latency,
            })
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Connection failed'
          metrics[key] = { status: 'unreachable', latencyMs: 0, error: errorMsg }
          alerts.push({
            severity: 'P0',
            source: name,
            message: `${name} is unreachable: ${errorMsg}`,
            metric: 'connectivity',
            value: 'failed',
          })
        }
      }
    }

    // Probe inference nodes separately
    const dwsUrl = process.env.DWS_URL || 'http://localhost:4030'
    let inferenceNodeCount = 0
    try {
      const start = Date.now()
      const response = await fetch(`${dwsUrl}/compute/nodes/inference`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      const latency = Date.now() - start

      if (response.ok) {
        // Endpoint returns array directly, not { nodes: [...] }
        const data = await response.json() as Array<{ address: string; isActive: boolean }>
        inferenceNodeCount = Array.isArray(data) ? data.length : 0
        metrics['inference_nodes'] = { status: 'available', latencyMs: latency }

        if (inferenceNodeCount === 0) {
          alerts.push({
            severity: 'P0',
            source: 'inference',
            message: 'No inference nodes available',
            metric: 'node_count',
            value: 0,
          })
        }
      } else {
        metrics['inference_nodes'] = { status: 'error', latencyMs: latency, error: `HTTP ${response.status}` }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Connection failed'
      metrics['inference_nodes'] = { status: 'unreachable', latencyMs: 0, error: errorMsg }
      alerts.push({
        severity: 'P1',
        source: 'inference',
        message: `Cannot query inference nodes: ${errorMsg}`,
        metric: 'connectivity',
        value: 'failed',
      })
    }

    // Determine overall status
    const hasP0 = alerts.some((a) => a.severity === 'P0')
    const hasP1 = alerts.some((a) => a.severity === 'P1')
    const overallStatus = hasP0 ? 'CRITICAL' : hasP1 ? 'DEGRADED' : 'HEALTHY'

    this.log.info('Infrastructure status evaluated', {
      status: overallStatus,
      alertCount: alerts.length,
      inferenceNodes: inferenceNodeCount,
    })

    return {
      success: true,
      result: {
        timestamp,
        status: overallStatus,
        alerts,
        metrics,
        summary: {
          inferenceNodeCount,
          p0Count: alerts.filter((a) => a.severity === 'P0').length,
          p1Count: alerts.filter((a) => a.severity === 'P1').length,
          p2Count: alerts.filter((a) => a.severity === 'P2').length,
        },
      },
    }
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
