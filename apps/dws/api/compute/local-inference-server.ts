/**
 * Local Inference Server
 */

import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'
import type { AnthropicResponse } from '../types'

interface ProviderConfig {
  id: string
  baseUrl: string
  envKey: string
  isAnthropic?: boolean
  models: string[]
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma-7b-it',
    ],
  },
  {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    isAnthropic: true,
    models: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
    ],
  },
  {
    id: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    envKey: 'TOGETHER_API_KEY',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
    ],
  },
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    models: ['*'],
  },
]

function getConfiguredProviders(): Array<ProviderConfig & { apiKey: string }> {
  return PROVIDERS.map((p) => ({
    ...p,
    apiKey: process.env[p.envKey] || '',
  })).filter((p) => p.apiKey.length > 0)
}

function getProviderForModel(
  model: string,
): (ProviderConfig & { apiKey: string }) | null {
  const configured = getConfiguredProviders()
  if (configured.length === 0) return null

  for (const provider of configured) {
    if (provider.models.includes('*')) continue
    if (
      provider.models.some(
        (m) => model.includes(m) || m.includes(model.split('-')[0]),
      )
    ) {
      return provider
    }
  }

  const modelLower = model.toLowerCase()
  for (const provider of configured) {
    if (modelLower.startsWith('gpt') && provider.id === 'openai')
      return provider
    if (modelLower.startsWith('claude') && provider.id === 'anthropic')
      return provider
    if (
      modelLower.startsWith('llama') &&
      (provider.id === 'groq' || provider.id === 'together')
    )
      return provider
    if (modelLower.startsWith('mixtral') && provider.id === 'groq')
      return provider
  }

  return configured[0] || null
}

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'

const app = new Elysia()
  .use(
    cors({
      origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
      credentials: true,
    }),
  )
  .get('/health', () => {
    const configured = getConfiguredProviders()
    return {
      service: 'dws-inference-node',
      status: configured.length > 0 ? 'healthy' : 'no_providers',
      providers: configured.map((p) => p.id),
      models: configured.flatMap((p) => p.models).filter((m) => m !== '*'),
    }
  })
  .get('/v1/models', () => {
    const configured = getConfiguredProviders()
    const models = configured.flatMap((p) =>
      p.models
        .filter((m) => m !== '*')
        .map((m) => ({
          id: m,
          object: 'model',
          owned_by: p.id,
          created: Date.now(),
        })),
    )
    return { object: 'list', data: models }
  })
  .post(
    '/v1/chat/completions',
    async ({ body, set }) => {
      const provider = getProviderForModel(body.model)
      if (!provider) {
        set.status = 503
        return {
          error: 'No inference provider configured',
          message: 'Set GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY',
          configured: getConfiguredProviders().map((p) => p.id),
        }
      }

      if (provider.isAnthropic) {
        const anthropicBody = {
          model: body.model,
          max_tokens: body.max_tokens || 1024,
          messages: body.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
          system: body.messages.find((m) => m.role === 'system')?.content,
        }

        const response = await fetch(`${provider.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(anthropicBody),
        })

        if (!response.ok) {
          set.status = response.status as 400 | 500
          return { error: `Anthropic error: ${await response.text()}` }
        }

        const result = (await response.json()) as AnthropicResponse

        return {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          provider: 'anthropic',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: result.content[0]?.text || '',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: result.usage.input_tokens,
            completion_tokens: result.usage.output_tokens,
            total_tokens:
              result.usage.input_tokens + result.usage.output_tokens,
          },
        }
      }

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
          ...(provider.id === 'openrouter'
            ? {
                'HTTP-Referer': 'https://jejunetwork.org',
                'X-Title': 'Jeju DWS',
              }
            : {}),
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        set.status = response.status as 400 | 500
        return { error: `${provider.id} error: ${await response.text()}` }
      }

      const result = await response.json()
      return { ...result, provider: provider.id }
    },
    {
      body: t.Object({
        model: t.String(),
        messages: t.Array(t.Object({ role: t.String(), content: t.String() })),
        max_tokens: t.Optional(t.Number()),
        temperature: t.Optional(t.Number()),
        stream: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    '/v1/embeddings',
    async ({ body, set }) => {
      const configured = getConfiguredProviders()
      const provider =
        configured.find((p) => p.id === 'openai') ||
        configured.find((p) => p.id === 'together')

      if (!provider) {
        set.status = 503
        return {
          error: 'No embedding provider configured',
          message: 'Set OPENAI_API_KEY or TOGETHER_API_KEY for embeddings',
        }
      }

      const response = await fetch(`${provider.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          input: body.input,
          model: body.model || 'text-embedding-3-small',
        }),
      })

      if (!response.ok) {
        set.status = response.status as 400 | 500
        return {
          error: `${provider.id} embeddings error: ${await response.text()}`,
        }
      }

      const result = await response.json()
      return { ...result, provider: provider.id }
    },
    {
      body: t.Object({
        input: t.Union([t.String(), t.Array(t.String())]),
        model: t.Optional(t.String()),
      }),
    },
  )

const PORT = parseInt(process.env.INFERENCE_PORT || '4031', 10)
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'

async function registerWithDWS(): Promise<void> {
  const configured = getConfiguredProviders()
  if (configured.length === 0) return

  const response = await fetch(`${DWS_URL}/compute/nodes/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address:
        process.env.NODE_ADDRESS ??
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      endpoint: `http://localhost:${PORT}`,
      gpuTier: 0,
      capabilities: ['inference', 'embeddings'],
      provider: configured[0].id,
      models: configured.flatMap((p) => p.models).filter((m) => m !== '*'),
      region: 'local',
      maxConcurrent: 10,
    }),
  })

  if (response.ok) {
    console.log(`[Inference Node] Registered with DWS at ${DWS_URL}`)
  }
}

async function heartbeat(): Promise<void> {
  await fetch(`${DWS_URL}/compute/nodes/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address:
        process.env.NODE_ADDRESS ??
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      load: 0,
    }),
  })
}

if (import.meta.main) {
  console.log(`[Inference Node] Starting on port ${PORT}`)
  const configured = getConfiguredProviders()
  console.log(
    `[Inference Node] Configured providers: ${configured.map((p) => p.id).join(', ') || 'none'}`,
  )

  app.listen(PORT)

  setTimeout(registerWithDWS, 2000)
  setInterval(heartbeat, 30000)
}

export type InferenceApp = typeof app
export { app, getConfiguredProviders, getProviderForModel }
