/**
 * Local Inference Service
 *
 * OpenAI-compatible proxy that routes to any provider. Users can specify
 * any model - known models get auto-routed, unknown models can specify
 * provider explicitly or get routed by pattern matching.
 *
 * Model format: "model-name" or "provider/model-name"
 * Examples: "gpt-4o", "anthropic/claude-3", "groq/llama-3.3-70b-versatile"
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from '../lib/logger'

export type ProviderType = string // Any provider name - not restricted

export interface InferenceConfig {
  port: number
  providers?: InferenceProvider[]
  defaultProvider?: string
}

export interface InferenceProvider {
  name: string
  type: string
  apiKey?: string
  baseUrl: string
  knownModels?: string[] // Optional hints, not restrictions
}

import type { ChatRequest } from '../schemas'

// DWS endpoint for decentralized inference
const DWS_ENDPOINT = process.env.DWS_URL || 'http://localhost:4030'

// Provider endpoints - only used by local inference node, not CLI directly
const PROVIDER_ENDPOINTS: Record<string, { baseUrl: string; type: string }> = {
  dws: { baseUrl: `${DWS_ENDPOINT}/compute`, type: 'openai' }, // Primary - DWS
  openai: { baseUrl: 'https://api.openai.com/v1', type: 'openai' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', type: 'anthropic' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', type: 'openai' },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    type: 'google',
  },
  xai: { baseUrl: 'https://api.x.ai/v1', type: 'openai' },
  cohere: { baseUrl: 'https://api.cohere.ai/v1', type: 'cohere' },
  ai21: { baseUrl: 'https://api.ai21.com/studio/v1', type: 'openai' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', type: 'openai' },
  fireworks: {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    type: 'openai',
  },
  together: { baseUrl: 'https://api.together.xyz/v1', type: 'openai' },
  perplexity: { baseUrl: 'https://api.perplexity.ai', type: 'openai' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', type: 'openai' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', type: 'openai' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', type: 'openai' },
}

// Pattern matching for auto-routing unknown models
const MODEL_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /^gpt-|^o1-|^o3-|^chatgpt-/i, provider: 'openai' },
  { pattern: /^claude-/i, provider: 'anthropic' },
  { pattern: /^gemini-/i, provider: 'google' },
  { pattern: /^grok-/i, provider: 'xai' },
  { pattern: /^command-/i, provider: 'cohere' },
  { pattern: /^jamba-/i, provider: 'ai21' },
  { pattern: /^llama-.*-versatile|^mixtral-/i, provider: 'groq' },
  { pattern: /^accounts\/fireworks\//i, provider: 'fireworks' },
  { pattern: /^mistral-|^codestral-/i, provider: 'mistral' },
  { pattern: /^deepseek-/i, provider: 'deepseek' },
  { pattern: /^pplx-/i, provider: 'perplexity' },
]

// API key env var names per provider
const API_KEY_VARS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  google: 'GOOGLE_AI_API_KEY',
  xai: 'XAI_API_KEY',
  cohere: 'COHERE_API_KEY',
  ai21: 'AI21_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  together: 'TOGETHER_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

class LocalInferenceServer {
  private app: Hono
  private customProviders: InferenceProvider[]
  private port: number
  private server: ReturnType<typeof Bun.serve> | null = null
  private defaultProvider: string

  constructor(config: Partial<InferenceConfig> = {}) {
    this.port = config.port ?? 4100
    this.customProviders = config.providers ?? []
    this.defaultProvider =
      config.defaultProvider ?? this.detectDefaultProvider()
    this.app = new Hono()
    this.setupRoutes()
  }

  private detectDefaultProvider(): string {
    // Always try DWS first for decentralized inference
    return 'dws'
  }

  private getApiKey(provider: string): string | undefined {
    // Check custom providers first
    const custom = this.customProviders.find((p) => p.name === provider)
    if (custom?.apiKey) return custom.apiKey
    // Then check env vars
    const keyVar = API_KEY_VARS[provider]
    return keyVar ? process.env[keyVar] : undefined
  }

  private getProviderEndpoint(
    provider: string,
  ): { baseUrl: string; type: string } | null {
    // Check custom providers first
    const custom = this.customProviders.find((p) => p.name === provider)
    if (custom)
      return { baseUrl: custom.baseUrl, type: custom.type || 'openai' }
    // Then check known providers
    return PROVIDER_ENDPOINTS[provider] || null
  }

  private resolveModelProvider(
    model: string,
    explicitProvider?: string,
  ): { provider: string; model: string } {
    // 1. Explicit provider in request
    if (explicitProvider) return { provider: explicitProvider, model }

    // 2. Provider prefix in model name: "provider/model"
    if (model.includes('/') && !model.startsWith('accounts/')) {
      const [provider, ...rest] = model.split('/')
      return { provider, model: rest.join('/') }
    }

    // 3. Pattern matching
    for (const { pattern, provider } of MODEL_PATTERNS) {
      if (pattern.test(model)) return { provider, model }
    }

    // 4. Default provider
    return { provider: this.defaultProvider, model }
  }

  private setupRoutes(): void {
    this.app.use('*', cors())

    // Health check
    this.app.get('/health', (c) => {
      const configuredProviders = Object.keys(API_KEY_VARS).filter((p) =>
        this.getApiKey(p),
      )
      return c.json({
        status: 'ok',
        defaultProvider: this.defaultProvider,
        configuredProviders,
        customProviders: this.customProviders.map((p) => p.name),
      })
    })

    // Models list - returns available providers, not a fixed model list
    this.app.get('/v1/models', (c) => {
      const models: Array<{
        id: string
        object: string
        created: number
        owned_by: string
      }> = []

      // Add models from custom providers
      for (const provider of this.customProviders) {
        for (const model of provider.knownModels || []) {
          models.push({
            id: model,
            object: 'model',
            created: Date.now(),
            owned_by: provider.name,
          })
        }
      }

      // Add a marker for each configured provider (users can use any model)
      for (const [name, keyVar] of Object.entries(API_KEY_VARS)) {
        if (process.env[keyVar]) {
          models.push({
            id: `${name}/*`,
            object: 'model',
            created: Date.now(),
            owned_by: name,
          })
        }
      }

      // Add local fallback
      models.push({
        id: 'local-fallback',
        object: 'model',
        created: Date.now(),
        owned_by: 'jeju',
      })

      return c.json({ object: 'list', data: models })
    })

    // Chat completions - routes to any provider
    this.app.post('/v1/chat/completions', async (c) => {
      const body = await c.req.json<ChatRequest>()

      if (!body.model || body.model === 'local-fallback') {
        return c.json(this.localFallback(body))
      }

      const { provider, model } = this.resolveModelProvider(
        body.model,
        body.provider,
      )
      const endpoint = this.getProviderEndpoint(provider)

      if (!endpoint) {
        logger.warn(`Unknown provider: ${provider}`)
        return c.json(this.localFallback(body, provider))
      }

      // DWS doesn't require API key - it handles auth internally
      const apiKey = provider === 'dws' ? 'dws' : this.getApiKey(provider)
      if (!apiKey) {
        logger.warn(`No API key for provider: ${provider}`)
        return c.json(this.localFallback(body, provider))
      }

      const providerConfig: InferenceProvider = {
        name: provider,
        type: endpoint.type,
        apiKey,
        baseUrl: endpoint.baseUrl,
      }

      const requestWithModel = { ...body, model }

      const response = await this.proxyToProvider(
        providerConfig,
        requestWithModel,
      )
      return c.json(response)
    })

    // Provider registration endpoint - let users add custom providers at runtime
    this.app.post('/v1/providers', async (c) => {
      const body = await c.req.json<InferenceProvider>()
      if (!body.name || !body.baseUrl) {
        return c.json({ error: 'name and baseUrl required' }, 400)
      }

      // SECURITY: Validate provider name to prevent prototype pollution
      // Names like __proto__, constructor, prototype could pollute object prototypes
      const forbiddenNames = [
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'hasOwnProperty',
      ]
      if (forbiddenNames.includes(body.name)) {
        return c.json({ error: 'Invalid provider name' }, 400)
      }

      // Validate name format - alphanumeric with hyphens/underscores only
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(body.name)) {
        return c.json(
          {
            error: 'Provider name must be alphanumeric (starting with letter)',
          },
          400,
        )
      }

      // Validate URL format
      if (!/^https?:\/\/.+/.test(body.baseUrl)) {
        return c.json({ error: 'baseUrl must be a valid HTTP/HTTPS URL' }, 400)
      }

      // SECURITY: Create a clean object with only allowed properties
      // This prevents prototype pollution from spreading untrusted input
      const safeProvider: InferenceProvider = {
        name: String(body.name),
        type: String(body.type || 'openai'),
        baseUrl: String(body.baseUrl),
        apiKey: body.apiKey ? String(body.apiKey) : undefined,
        knownModels: Array.isArray(body.knownModels)
          ? body.knownModels
              .filter((m): m is string => typeof m === 'string')
              .map(String)
          : undefined,
      }

      this.customProviders.push(safeProvider)
      logger.info(`Added custom provider: ${safeProvider.name}`)
      return c.json({ success: true, provider: safeProvider.name })
    })

    // List providers
    this.app.get('/v1/providers', (c) => {
      const providers: Array<{
        name: string
        configured: boolean
        baseUrl: string
      }> = []

      for (const [name, endpoint] of Object.entries(PROVIDER_ENDPOINTS)) {
        providers.push({
          name,
          configured: !!this.getApiKey(name),
          baseUrl: endpoint.baseUrl,
        })
      }

      for (const custom of this.customProviders) {
        providers.push({
          name: custom.name,
          configured: !!custom.apiKey,
          baseUrl: custom.baseUrl,
        })
      }

      return c.json({ providers })
    })
  }

  private async proxyToProvider(
    provider: InferenceProvider,
    request: ChatRequest,
  ): Promise<object> {
    const { url, headers, body } = this.buildProviderRequest(provider, request)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Provider ${provider.name} error: ${response.status} - ${errorText}`,
      )
      return this.localFallback(
        request,
        provider.name,
        `${response.status}: ${errorText.slice(0, 200)}`,
      )
    }

    const data = (await response.json()) as Record<string, unknown>
    return this.normalizeResponse(provider, data, request.model)
  }

  private buildProviderRequest(
    provider: InferenceProvider,
    request: ChatRequest,
  ): {
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
  } {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Route based on provider type (API format)
    if (provider.type === 'anthropic') {
      headers['x-api-key'] = provider.apiKey || ''
      headers['anthropic-version'] = '2023-06-01'
      const systemMessage = request.messages.find((m) => m.role === 'system')
      const otherMessages = request.messages.filter((m) => m.role !== 'system')
      return {
        url: `${provider.baseUrl}/messages`,
        headers,
        body: {
          model: request.model,
          max_tokens: request.max_tokens || 4096,
          messages: otherMessages,
          ...(systemMessage && { system: systemMessage.content }),
          ...(request.temperature !== undefined && {
            temperature: request.temperature,
          }),
        },
      }
    }

    if (provider.type === 'google') {
      const modelPath = `models/${request.model}:generateContent`
      return {
        url: `${provider.baseUrl}/${modelPath}?key=${provider.apiKey}`,
        headers,
        body: {
          contents: request.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: request.max_tokens || 4096,
            ...(request.temperature !== undefined && {
              temperature: request.temperature,
            }),
          },
        },
      }
    }

    if (provider.type === 'cohere') {
      headers.Authorization = `Bearer ${provider.apiKey}`
      const systemMessage = request.messages.find((m) => m.role === 'system')
      const chatHistory = request.messages
        .filter((m) => m.role !== 'system')
        .slice(0, -1)
        .map((m) => ({
          role: m.role === 'assistant' ? 'CHATBOT' : 'USER',
          message: m.content,
        }))
      const lastMessage = request.messages
        .filter((m) => m.role !== 'system')
        .slice(-1)[0]
      return {
        url: `${provider.baseUrl}/chat`,
        headers,
        body: {
          model: request.model,
          message: lastMessage?.content || '',
          chat_history: chatHistory,
          ...(systemMessage && { preamble: systemMessage.content }),
          ...(request.max_tokens && { max_tokens: request.max_tokens }),
          ...(request.temperature !== undefined && {
            temperature: request.temperature,
          }),
        },
      }
    }

    // Default: OpenAI-compatible (works for openai, groq, xai, cerebras, fireworks, together, etc.)
    headers.Authorization = `Bearer ${provider.apiKey}`
    return {
      url: `${provider.baseUrl}/chat/completions`,
      headers,
      body: {
        model: request.model,
        messages: request.messages,
        ...(request.max_tokens && { max_tokens: request.max_tokens }),
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
      },
    }
  }

  private normalizeResponse(
    provider: InferenceProvider,
    data: Record<string, unknown>,
    model: string,
  ): object {
    // Anthropic format
    if (provider.type === 'anthropic' && data.content) {
      const content = data.content as Array<{ text: string }>
      const usage = data.usage as {
        input_tokens: number
        output_tokens: number
      }
      return {
        id: data.id,
        object: 'chat.completion',
        model: data.model,
        choices: [
          {
            message: { role: 'assistant', content: content[0]?.text || '' },
            finish_reason:
              data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
          },
        ],
        usage: {
          prompt_tokens: usage?.input_tokens || 0,
          completion_tokens: usage?.output_tokens || 0,
          total_tokens:
            (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
        },
      }
    }

    // Google Gemini format
    if (provider.type === 'google' && data.candidates) {
      const candidates = data.candidates as Array<{
        content: { parts: Array<{ text: string }> }
        finishReason: string
      }>
      const usageMetadata = data.usageMetadata as
        | {
            promptTokenCount?: number
            candidatesTokenCount?: number
            totalTokenCount?: number
          }
        | undefined
      return {
        id: `gemini-${Date.now()}`,
        object: 'chat.completion',
        model,
        choices: [
          {
            message: {
              role: 'assistant',
              content: candidates[0]?.content?.parts[0]?.text || '',
            },
            finish_reason:
              candidates[0]?.finishReason === 'STOP' ? 'stop' : 'length',
          },
        ],
        usage: {
          prompt_tokens: usageMetadata?.promptTokenCount || 0,
          completion_tokens: usageMetadata?.candidatesTokenCount || 0,
          total_tokens: usageMetadata?.totalTokenCount || 0,
        },
      }
    }

    // Cohere format
    if (provider.type === 'cohere' && data.text !== undefined) {
      const meta = data.meta as
        | { tokens?: { input_tokens: number; output_tokens: number } }
        | undefined
      return {
        id: data.generation_id || `cohere-${Date.now()}`,
        object: 'chat.completion',
        model,
        choices: [
          {
            message: { role: 'assistant', content: data.text as string },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: meta?.tokens?.input_tokens || 0,
          completion_tokens: meta?.tokens?.output_tokens || 0,
          total_tokens:
            (meta?.tokens?.input_tokens || 0) +
            (meta?.tokens?.output_tokens || 0),
        },
      }
    }

    // OpenAI-compatible - pass through
    return data
  }

  private localFallback(
    _request: ChatRequest,
    provider?: string,
    error?: string,
  ): object {
    const content = this.generateLocalResponse(provider, error)

    return {
      id: `local-${Date.now()}`,
      object: 'chat.completion',
      model: 'local-fallback',
      created: Math.floor(Date.now() / 1000),
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }

  private generateLocalResponse(provider?: string, error?: string): string {
    if (provider && error) {
      return `**Provider Error: ${provider}**

${error}

Check your API key for ${provider.toUpperCase()}_API_KEY or try a different model/provider.

**Usage:** Specify models as "model-name" or "provider/model-name"
Examples: "gpt-4o", "anthropic/claude-3-opus", "groq/llama-3.3-70b-versatile"`
    }

    if (provider) {
      const keyVar =
        API_KEY_VARS[provider] || `${provider.toUpperCase()}_API_KEY`
      return `**No API key for provider: ${provider}**

Set ${keyVar} environment variable to use this provider.

Or try one of these configured providers:
${
  Object.entries(API_KEY_VARS)
    .filter(([_, v]) => process.env[v])
    .map(([p]) => `- ${p}`)
    .join('\n') || '(none configured)'
}`
    }

    return `**AI Service - No Provider Configured**

Set any provider API key. Examples:
- GROQ_API_KEY (free tier at console.groq.com)
- OPENAI_API_KEY
- ANTHROPIC_API_KEY

**Model Format:** "model-name" or "provider/model-name"
- "gpt-4o" → routes to OpenAI
- "claude-3-opus" → routes to Anthropic
- "groq/llama-3.3-70b-versatile" → explicit Groq
- "openrouter/meta-llama/llama-3.1-405b" → OpenRouter

Any model works - the system routes by pattern or explicit prefix.`
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch: this.app.fetch,
    })

    const configured = Object.entries(API_KEY_VARS)
      .filter(([_, v]) => process.env[v])
      .map(([p]) => p)

    logger.success(`Inference server running on http://localhost:${this.port}`)
    logger.info(`Default provider: ${this.defaultProvider}`)
    logger.info(
      `Configured: ${configured.join(', ') || 'none (set any *_API_KEY)'}`,
    )
    if (this.customProviders.length > 0) {
      logger.info(
        `Custom: ${this.customProviders.map((p) => p.name).join(', ')}`,
      )
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop()
      this.server = null
    }
  }

  getPort(): number {
    return this.port
  }
}

export const createInferenceServer = (config?: Partial<InferenceConfig>) =>
  new LocalInferenceServer(config)
export { LocalInferenceServer }
