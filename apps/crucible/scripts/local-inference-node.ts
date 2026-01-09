#!/usr/bin/env bun
/**
 * Local Inference Node for Crucible Development
 *
 * SECURITY: This is a LOCAL DEVELOPMENT TOOL only.
 * Auto-detects API keys from environment and routes to the appropriate provider.
 *
 * Priority: OPENAI_API_KEY > GROQ_API_KEY > ANTHROPIC_API_KEY
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import { buildMaxTokensParam } from '@jejunetwork/shared/tokens'
import { Elysia, t } from 'elysia'

// SECURITY: Only allow this script to run in localnet
const network = getCurrentNetwork()
if (network !== 'localnet') {
  console.error(
    `ERROR: This script is only for localnet development. Current network: ${network}`,
  )
  process.exit(1)
}

const PORT = parseInt(process.env.INFERENCE_PORT ?? '4032', 10)
const DWS_URL = process.env.DWS_URL ?? 'http://127.0.0.1:4030'
const NODE_ADDRESS = process.env.NODE_ADDRESS ?? '0xLocalInferenceNode'

// Provider configuration
type ProviderConfig = {
  name: string
  apiKey: string
  baseUrl: string
  mapModel: (model: string) => string
  supportedModels: string[]
}

// Detect available provider
function detectProvider(): ProviderConfig | null {
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      mapModel: (model: string) => {
        // Map Llama/Groq models to OpenAI equivalents
        const lower = model.toLowerCase()
        if (lower.includes('llama-3.1-8b') || lower.includes('instant'))
          return 'gpt-4o-mini'
        if (lower.includes('llama') || lower.includes('70b')) return 'gpt-4o'
        if (lower.includes('mixtral')) return 'gpt-4o'
        if (lower.includes('gemma')) return 'gpt-4o-mini'
        return model // Pass through OpenAI models as-is
      },
      supportedModels: [
        'gpt-5.2',
        'gpt-4o',
        'gpt-4o-mini',
        'o1',
        'o1-mini',
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
        'mixtral-8x7b-32768',
      ],
    }
  }

  if (process.env.GROQ_API_KEY) {
    return {
      name: 'groq',
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      mapModel: (model: string) => {
        const lower = model.toLowerCase()
        if (lower.includes('70b')) return 'llama-3.3-70b-versatile'
        if (lower.includes('8b')) return 'llama-3.1-8b-instant'
        if (lower.includes('mixtral')) return 'mixtral-8x7b-32768'
        if (lower.includes('gemma')) return 'gemma2-9b-it'
        if (lower.includes('gpt')) return 'llama-3.3-70b-versatile' // Map GPT to Llama
        return 'llama-3.1-8b-instant'
      },
      supportedModels: [
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
      ],
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: 'https://api.anthropic.com/v1',
      mapModel: (model: string) => {
        const lower = model.toLowerCase()
        if (lower.includes('opus')) return 'claude-opus-4-5-20251101'
        if (lower.includes('sonnet')) return 'claude-sonnet-4-5-20251022'
        return 'claude-sonnet-4-5-20251022'
      },
      supportedModels: [
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20251022',
        'claude-3-5-sonnet-20241022',
      ],
    }
  }

  return null
}

const provider = detectProvider()

if (!provider) {
  console.error('No API key found. Set one of:')
  console.error('  OPENAI_API_KEY=sk-...')
  console.error('  GROQ_API_KEY=gsk_...')
  console.error('  ANTHROPIC_API_KEY=sk-ant-...')
  process.exit(1)
}

console.log(`[Inference Node] Using provider: ${provider.name}`)
console.log(`[Inference Node] API key: ${provider.apiKey.slice(0, 10)}...`)

// Create inference server
const app = new Elysia()
  .get('/health', () => ({
    status: 'healthy',
    service: 'local-inference-node',
    provider: provider.name,
  }))
  .post(
    '/v1/chat/completions',
    async ({ body }) => {
      const requestedModel = body.model || 'gpt-4o'
      const actualModel = provider.mapModel(requestedModel)

      if (requestedModel !== actualModel) {
        console.log(
          `[Inference Node] Mapping ${requestedModel} -> ${actualModel}`,
        )
      }

      // Handle Anthropic differently (different API format)
      if (provider.name === 'anthropic') {
        const systemMessage = body.messages.find(
          (m: { role: string }) => m.role === 'system',
        )
        const otherMessages = body.messages.filter(
          (m: { role: string }) => m.role !== 'system',
        )

        const response = await fetch(`${provider.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: actualModel,
            max_tokens: body.max_tokens ?? 4096,
            messages: otherMessages,
            ...(systemMessage && { system: systemMessage.content }),
            ...(body.temperature !== undefined && {
              temperature: body.temperature,
            }),
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Anthropic API error: ${response.status} - ${error}`)
        }

        const result = (await response.json()) as {
          id: string
          model: string
          content: Array<{ text: string }>
          stop_reason: string
          usage: { input_tokens: number; output_tokens: number }
        }

        // Convert to OpenAI format
        return {
          id: result.id,
          object: 'chat.completion',
          model: result.model,
          choices: [
            {
              message: {
                role: 'assistant',
                content: result.content[0]?.text ?? '',
              },
              finish_reason:
                result.stop_reason === 'end_turn' ? 'stop' : result.stop_reason,
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

      // OpenAI-compatible providers (OpenAI, Groq)
      const maxTokens = body.max_tokens ?? 1024

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: actualModel,
          messages: body.messages,
          temperature: body.temperature ?? 0.7,
          ...buildMaxTokensParam(actualModel, maxTokens),
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(
          `${provider.name} API error: ${response.status} - ${error}`,
        )
      }

      const result = await response.json()
      console.log(
        `[Inference Node] Success, tokens: ${(result as { usage?: { total_tokens?: number } }).usage?.total_tokens}`,
      )
      return result
    },
    {
      body: t.Object({
        model: t.Optional(t.String()),
        messages: t.Array(
          t.Object({
            role: t.String(),
            content: t.String(),
          }),
        ),
        temperature: t.Optional(t.Number()),
        max_tokens: t.Optional(t.Number()),
      }),
    },
  )

// Start server
app.listen(PORT)
console.log(`[Inference Node] Started on port ${PORT}`)

// Register with DWS
async function registerWithDWS() {
  console.log(`[Inference Node] Registering with DWS at ${DWS_URL}...`)

  const response = await fetch(`${DWS_URL}/compute/nodes/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: NODE_ADDRESS,
      endpoint: `http://127.0.0.1:${PORT}`,
      gpuTier: 2,
      capabilities: ['inference'],
      provider: 'local', // Always 'local' so DWS routing prefers us for llama models
      models: ['*', ...provider.supportedModels],
      region: 'local',
      maxConcurrent: 50,
    }),
  })

  if (!response.ok) {
    console.error(
      `[Inference Node] Failed to register with DWS: ${await response.text()}`,
    )
    return false
  }

  console.log('[Inference Node] Registered with DWS successfully')
  return true
}

// Heartbeat loop
async function heartbeatLoop() {
  while (true) {
    await fetch(`${DWS_URL}/compute/nodes/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: NODE_ADDRESS, load: 0 }),
    }).catch(() => {})
    await Bun.sleep(30000)
  }
}

registerWithDWS()
  .then((ok) => ok && heartbeatLoop())
  .catch(console.error)

process.on('SIGINT', () => process.exit(0))
