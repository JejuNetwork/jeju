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

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
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

import { z } from 'zod'
import {
  AnthropicResponseSchema,
  type ChatRequest,
  ChatRequestSchema,
  CohereResponseSchema,
  GeminiResponseSchema,
  OpenAIResponseSchema,
  validate,
} from '../schemas'

// Schema for InferenceProvider registration
const InferenceProviderRegistrationSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_-]*$/,
      'Provider name must be alphanumeric (starting with letter)',
    ),
  type: z.string().default('openai'),
  apiKey: z.string().optional(),
  baseUrl: z
    .string()
    .url()
    .regex(/^https?:\/\/.+/, 'Must be valid HTTP/HTTPS URL'),
  knownModels: z.array(z.string()).optional(),
})

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
  private app: Elysia
  private customProviders: InferenceProvider[]
  private port: number
  private defaultProvider: string

  constructor(config: Partial<InferenceConfig> = {}) {
    this.port = config.port ?? 4100
    this.customProviders = config.providers ?? []
    this.defaultProvider =
      config.defaultProvider ?? this.detectDefaultProvider()
    this.app = new Elysia().use(cors())
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
    // Health check
    this.app.get('/health', () => {
      const configuredProviders = Object.keys(API_KEY_VARS).filter((p) =>
        this.getApiKey(p),
      )
      return {
        status: 'ok',
        defaultProvider: this.defaultProvider,
        configuredProviders,
        customProviders: this.customProviders.map((p) => p.name),
      }
    })

    // Models list - returns available providers, not a fixed model list
    this.app.get('/v1/models', () => {
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

      return { object: 'list', data: models }
    })

    // Chat completions - routes to any provider
    this.app.post('/v1/chat/completions', async ({ body }) => {
      const validatedBody = validate(
        body,
        ChatRequestSchema,
        'chat completions request',
      )

      if (!validatedBody.model || validatedBody.model === 'local-fallback') {
        return this.localFallback(validatedBody)
      }

      const { provider, model } = this.resolveModelProvider(
        validatedBody.model,
        validatedBody.provider,
      )
      const endpoint = this.getProviderEndpoint(provider)

      if (!endpoint) {
        logger.warn(`Unknown provider: ${provider}`)
        return this.localFallback(validatedBody, provider)
      }

      // DWS doesn't require API key - it handles auth internally
      const apiKey = provider === 'dws' ? 'dws' : this.getApiKey(provider)
      if (!apiKey) {
        logger.warn(`No API key for provider: ${provider}`)
        return this.localFallback(validatedBody, provider)
      }

      const providerConfig: InferenceProvider = {
        name: provider,
        type: endpoint.type,
        apiKey,
        baseUrl: endpoint.baseUrl,
      }

      const requestWithModel = { ...validatedBody, model }

      const response = await this.proxyToProvider(
        providerConfig,
        requestWithModel,
      )
      return response
    })

    // Provider registration endpoint - let users add custom providers at runtime
    this.app.post('/v1/providers', ({ body, set }) => {
      // SECURITY: Validate with schema - this handles:
      // - Required fields (name, baseUrl)
      // - Name format validation (alphanumeric, starting with letter)
      // - URL format validation (valid HTTP/HTTPS)
      // - Type coercion and sanitization
      const parseResult = InferenceProviderRegistrationSchema.safeParse(body)
      if (!parseResult.success) {
        const errors = parseResult.error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        set.status = 400
        return { error: errors }
      }
      const validatedBody = parseResult.data

      // SECURITY: Additional check for prototype pollution via reserved names
      const forbiddenNames = [
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'hasOwnProperty',
      ]
      if (forbiddenNames.includes(validatedBody.name)) {
        set.status = 400
        return { error: 'Invalid provider name' }
      }

      // SECURITY: Create a clean object with only allowed properties
      // This prevents prototype pollution from spreading untrusted input
      const safeProvider: InferenceProvider = {
        name: validatedBody.name,
        type: validatedBody.type,
        baseUrl: validatedBody.baseUrl,
        apiKey: validatedBody.apiKey,
        knownModels: validatedBody.knownModels,
      }

      this.customProviders.push(safeProvider)
      logger.info(`Added custom provider: ${safeProvider.name}`)
      return { success: true, provider: safeProvider.name }
    })

    // List providers
    this.app.get('/v1/providers', () => {
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

      return { providers }
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

    const rawData: unknown = await response.json()
    return this.normalizeResponse(provider, rawData, request.model)
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
    rawData: unknown,
    model: string,
  ): object {
    // Use safeParse for external API responses (may be malformed)
    // Anthropic format
    if (provider.type === 'anthropic') {
      const result = AnthropicResponseSchema.safeParse(rawData)
      if (result.success) {
        const data = result.data
        return {
          id: data.id,
          object: 'chat.completion',
          model: data.model,
          choices: [
            {
              message: {
                role: 'assistant',
                content: data.content[0]?.text || '',
              },
              finish_reason:
                data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
            },
          ],
          usage: {
            prompt_tokens: data.usage.input_tokens,
            completion_tokens: data.usage.output_tokens,
            total_tokens: data.usage.input_tokens + data.usage.output_tokens,
          },
        }
      }
      logger.warn(
        `Anthropic response validation failed: ${result.error.message}`,
      )
    }

    // Google Gemini format
    if (provider.type === 'google') {
      const result = GeminiResponseSchema.safeParse(rawData)
      if (result.success) {
        const data = result.data
        const candidate = data.candidates?.[0]
        const usage = data.usageMetadata
        return {
          id: `gemini-${Date.now()}`,
          object: 'chat.completion',
          model,
          choices: [
            {
              message: {
                role: 'assistant',
                content: candidate?.content?.parts[0]?.text || '',
              },
              finish_reason:
                candidate?.finishReason === 'STOP' ? 'stop' : 'length',
            },
          ],
          usage: {
            prompt_tokens: usage?.promptTokenCount || 0,
            completion_tokens: usage?.candidatesTokenCount || 0,
            total_tokens: usage?.totalTokenCount || 0,
          },
        }
      }
      logger.warn(`Gemini response validation failed: ${result.error.message}`)
    }

    // Cohere format
    if (provider.type === 'cohere') {
      const result = CohereResponseSchema.safeParse(rawData)
      if (result.success) {
        const data = result.data
        const tokens = data.meta?.billed_units
        return {
          id: data.generation_id || `cohere-${Date.now()}`,
          object: 'chat.completion',
          model,
          choices: [
            {
              message: { role: 'assistant', content: data.text || '' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: tokens?.input_tokens || 0,
            completion_tokens: tokens?.output_tokens || 0,
            total_tokens:
              (tokens?.input_tokens || 0) + (tokens?.output_tokens || 0),
          },
        }
      }
      logger.warn(`Cohere response validation failed: ${result.error.message}`)
    }

    // OpenAI-compatible - validate and pass through
    const result = OpenAIResponseSchema.safeParse(rawData)
    if (result.success) {
      return result.data
    }
    logger.warn(`OpenAI response validation failed: ${result.error.message}`)

    // Last resort: return raw data if it's an object (allows for unknown provider formats)
    if (rawData && typeof rawData === 'object') {
      return rawData as object
    }

    throw new Error(`Invalid provider response format`)
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
    this.app.listen(this.port)

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

  stop(): void {
    this.app.stop()
  }

  getPort(): number {
    return this.port
  }
}

export const createInferenceServer = (config?: Partial<InferenceConfig>) =>
  new LocalInferenceServer(config)
export { LocalInferenceServer }
