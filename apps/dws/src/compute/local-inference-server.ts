/**
 * Local Inference Server
 *
 * A standalone server that provides inference capabilities by proxying to
 * configured provider APIs (Groq, OpenAI, Anthropic, etc.)
 *
 * This runs alongside DWS in development to provide inference from your machine.
 * In production, dedicated nodes run this to offer inference services.
 *
 * Usage:
 *   bun run src/compute/local-inference-server.ts
 *
 * Environment:
 *   GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
 *   DWS_URL (to register with)
 *   INFERENCE_PORT (default 4031)
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/*', cors({ origin: '*' }))

// Provider configurations
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

// Get configured providers
function getConfiguredProviders(): Array<ProviderConfig & { apiKey: string }> {
  return PROVIDERS.map((p) => ({
    ...p,
    apiKey: process.env[p.envKey] || '',
  })).filter((p) => p.apiKey.length > 0)
}

// Model to provider routing
function getProviderForModel(
  model: string,
): (ProviderConfig & { apiKey: string }) | null {
  const configured = getConfiguredProviders()
  if (configured.length === 0) return null

  // Check explicit model matches first
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

  // Model prefix matching
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

  // Fallback to first configured
  return configured[0] || null
}

// Health check
app.get('/health', (c) => {
  const configured = getConfiguredProviders()
  return c.json({
    service: 'dws-inference-node',
    status: configured.length > 0 ? 'healthy' : 'no_providers',
    providers: configured.map((p) => p.id),
    models: configured.flatMap((p) => p.models).filter((m) => m !== '*'),
  })
})

// List available models
app.get('/v1/models', (c) => {
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
  return c.json({ object: 'list', data: models })
})

// Chat completions
app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json<{
    model: string
    messages: Array<{ role: string; content: string }>
    max_tokens?: number
    temperature?: number
    stream?: boolean
  }>()

  const provider = getProviderForModel(body.model)
  if (!provider) {
    return c.json(
      {
        error: 'No inference provider configured',
        message: 'Set GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY',
        configured: getConfiguredProviders().map((p) => p.id),
      },
      503,
    )
  }

  // Handle Anthropic's different API format
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
      const error = await response.text()
      return c.json(
        { error: `Anthropic error: ${error}` },
        response.status as 400 | 500,
      )
    }

    const result = (await response.json()) as {
      content: Array<{ text: string }>
      usage: { input_tokens: number; output_tokens: number }
    }

    return c.json({
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
        total_tokens: result.usage.input_tokens + result.usage.output_tokens,
      },
    })
  }

  // OpenAI-compatible providers
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
    const error = await response.text()
    return c.json(
      { error: `${provider.id} error: ${error}` },
      response.status as 400 | 500,
    )
  }

  const result = await response.json()
  return c.json({ ...result, provider: provider.id })
})

// Embeddings
app.post('/v1/embeddings', async (c) => {
  const body = await c.req.json<{ input: string | string[]; model?: string }>()

  // Only OpenAI and Together support embeddings
  const configured = getConfiguredProviders()
  const provider =
    configured.find((p) => p.id === 'openai') ||
    configured.find((p) => p.id === 'together')

  if (!provider) {
    // No embedding provider available - fail with clear error
    return c.json(
      {
        error: 'No embedding provider configured',
        message: 'Set OPENAI_API_KEY or TOGETHER_API_KEY for embeddings',
      },
      503,
    )
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
    const error = await response.text()
    return c.json(
      { error: `${provider.id} embeddings error: ${error}` },
      response.status as 400 | 500,
    )
  }

  const result = await response.json()
  return c.json({ ...result, provider: provider.id })
})

// Start server and register with DWS
const PORT = parseInt(process.env.INFERENCE_PORT || '4031', 10)
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'

async function registerWithDWS(): Promise<void> {
  const configured = getConfiguredProviders()
  if (configured.length === 0) {
    console.log(
      '[Inference Node] No providers configured - skipping DWS registration',
    )
    return
  }

  try {
    const response = await fetch(`${DWS_URL}/compute/nodes/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Use a valid local Ethereum address for dev nodes
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
    } else {
      console.warn(
        '[Inference Node] Failed to register with DWS:',
        await response.text(),
      )
    }
  } catch (error) {
    console.warn(
      '[Inference Node] Could not reach DWS for registration:',
      (error as Error).message,
    )
  }
}

// Heartbeat to keep registration alive
async function heartbeat(): Promise<void> {
  try {
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
  } catch {
    // Silently ignore heartbeat failures
  }
}

if (import.meta.main) {
  console.log(`[Inference Node] Starting on port ${PORT}`)

  const configured = getConfiguredProviders()
  console.log(
    `[Inference Node] Configured providers: ${configured.map((p) => p.id).join(', ') || 'none'}`,
  )

  Bun.serve({ port: PORT, fetch: app.fetch })

  // Register with DWS after a short delay
  setTimeout(registerWithDWS, 2000)

  // Heartbeat every 30 seconds
  setInterval(heartbeat, 30000)
}

export { app, getConfiguredProviders, getProviderForModel }
