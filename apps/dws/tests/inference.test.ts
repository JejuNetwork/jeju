/**
 * Inference E2E Tests
 *
 * Tests inference through DWS with all configured providers.
 * Requires API keys in .env: GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
 *
 * These tests now require a registered inference node. In test mode,
 * a mock node is registered automatically via the test preload.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  getActiveNodes,
  inferenceNodes,
  registerNode,
  unregisterNode,
} from '../api/compute/inference-node'
import { app } from '../api/server/index'

// Test response types
interface ChatRequestBody {
  model?: string
  messages?: Array<{ content: string }>
}

interface ProvidersResponse {
  providers: Array<{ id: string; configured: boolean }>
}

interface ModelsResponse {
  models: Array<{ id: string; provider: string }>
}

interface ChatCompletionResponse {
  provider: string
  model: string
  choices: Array<{ message: { content: string } }>
}

interface EmbeddingResponse {
  object: string
  model: string
  data: Array<{ embedding: number[] }>
}

interface InferenceResponse {
  content: string
  provider: string
}

const HAS_GROQ = !!process.env.GROQ_API_KEY
const HAS_OPENAI = !!process.env.OPENAI_API_KEY
const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY
const HAS_ANY_PROVIDER =
  HAS_GROQ ||
  HAS_OPENAI ||
  HAS_ANTHROPIC ||
  !!process.env.TOGETHER_API_KEY ||
  !!process.env.OPENROUTER_API_KEY

describe('Inference E2E', () => {
  // Set up mock inference node for tests without real providers
  beforeAll(async () => {
    // Clear any existing nodes
    inferenceNodes.clear()

    // Start mock server for tests
    const mockPort = 14032
    const mockServer = Bun.serve({
      port: mockPort,
      fetch: async (req) => {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({ status: 'healthy', provider: 'mock' })
        }

        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
          const body = (await req.json()) as ChatRequestBody
          const userMessage =
            body.messages?.find((m) => (m as { role: string }).role === 'user')
              .content ?? ''

          // Parse math questions for mock responses
          let content = `Mock response to: ${userMessage}`
          if (userMessage.includes('2+2')) content = '4'
          if (userMessage.includes('3+3')) content = '6'
          if (userMessage.includes('4+4')) content = '8'
          if (userMessage.includes('5+5')) content = '10'

          return Response.json({
            id: `chatcmpl-test-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model ?? 'mock-model',
            provider: 'mock',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          })
        }

        if (url.pathname === '/v1/embeddings' && req.method === 'POST') {
          return Response.json({
            object: 'list',
            data: [
              { object: 'embedding', index: 0, embedding: Array(1536).fill(0) },
            ],
            model: 'mock-embeddings',
            usage: { prompt_tokens: 10, total_tokens: 10 },
          })
        }

        return new Response('Not Found', { status: 404 })
      },
    })

    ;(globalThis as Record<string, unknown>)._inferenceTestMockServer =
      mockServer

    // Register mock node
    registerNode({
      address: 'inference-test-mock-node',
      endpoint: `http://localhost:${mockPort}`,
      capabilities: ['inference', 'embeddings'],
      models: ['*'],
      provider: 'mock',
      region: 'test',
      gpuTier: 0,
      maxConcurrent: 100,
      isActive: true,
    })

    console.log('[Inference Tests] Mock inference node registered')
    console.log('[Inference Tests] Providers configured:')
    console.log(`  - Groq: ${HAS_GROQ ? '✓' : '✗'}`)
    console.log(`  - OpenAI: ${HAS_OPENAI ? '✓' : '✗'}`)
    console.log(`  - Anthropic: ${HAS_ANTHROPIC ? '✓' : '✗'}`)
    console.log(`  - Active nodes: ${getActiveNodes().length}`)
  })

  afterAll(() => {
    unregisterNode('inference-test-mock-node')
    const server = (globalThis as Record<string, unknown>)
      ._inferenceTestMockServer as { stop?: () => void } | undefined
    if (server?.stop) server.stop()
  })

  // Skip provider tests if no providers are configured
  describe.skipIf(!HAS_ANY_PROVIDER)('Provider Configuration', () => {
    test('should list configured providers', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/providers?configured=true'),
      )
      expect(res.status).toBe(200)

      const data = (await res.json()) as ProvidersResponse
      expect(data.providers.length).toBeGreaterThan(0)

      const configuredProviders = data.providers.filter((p) => p.configured)
      console.log(
        `[Inference Tests] ${configuredProviders.length} providers ready`,
      )
    })

    test('should list available models', async () => {
      const res = await app.fetch(new Request('http://localhost/api/v1/models'))
      expect(res.status).toBe(200)

      const data = (await res.json()) as ModelsResponse
      expect(data.models.length).toBeGreaterThan(0)
      console.log(`[Inference Tests] ${data.models.length} models available`)
    })
  })

  describe('Groq Inference', () => {
    test.skipIf(!HAS_GROQ)('should complete chat with Llama', async () => {
      const start = Date.now()
      const res = await app.fetch(
        new Request('http://localhost/compute/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'user',
                content: 'What is 2+2? Reply with just the number.',
              },
            ],
            max_tokens: 10,
          }),
        }),
      )

      expect(res.status).toBe(200)

      const data = (await res.json()) as ChatCompletionResponse
      const latency = Date.now() - start

      expect(data.provider).toBe('groq')
      expect(data.choices[0].message.content).toContain('4')
      console.log(
        `[Groq] Response: "${data.choices[0].message.content}" (${latency}ms)`,
      )
    })
  })

  describe('OpenAI Inference', () => {
    test.skipIf(!HAS_OPENAI)(
      'should complete chat with GPT-4o-mini',
      async () => {
        const start = Date.now()
        const res = await app.fetch(
          new Request('http://localhost/compute/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-5.2',
              messages: [
                {
                  role: 'user',
                  content: 'What is 3+3? Reply with just the number.',
                },
              ],
              max_tokens: 10,
            }),
          }),
        )

        const latency = Date.now() - start
        expect(res.status).toBe(200)

        const data = (await res.json()) as ChatCompletionResponse

        expect(data.provider).toBe('openai')
        expect(data.choices[0].message.content).toContain('6')
        console.log(
          `[OpenAI] Response: "${data.choices[0].message.content}" (${latency}ms)`,
        )
      },
    )

    test.skipIf(!HAS_OPENAI)('should generate embeddings', async () => {
      const res = await app.fetch(
        new Request('http://localhost/compute/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: 'Hello DWS',
            model: 'text-embedding-3-small',
          }),
        }),
      )

      expect(res.status).toBe(200)

      const data = (await res.json()) as EmbeddingResponse

      expect(data.object).toBe('list')
      expect(data.data[0].embedding.length).toBe(1536)
      console.log(
        `[OpenAI] Embedding dimensions: ${data.data[0].embedding.length}`,
      )
    })
  })

  describe('Anthropic Inference', () => {
    test.skipIf(!HAS_ANTHROPIC)(
      'should complete chat with Claude',
      async () => {
        const start = Date.now()
        const res = await app.fetch(
          new Request('http://localhost/compute/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              messages: [
                {
                  role: 'user',
                  content: 'What is 4+4? Reply with just the number.',
                },
              ],
              max_tokens: 10,
            }),
          }),
        )

        const latency = Date.now() - start
        expect(res.status).toBe(200)

        const data = (await res.json()) as ChatCompletionResponse

        expect(data.provider).toBe('anthropic')
        expect(data.choices[0].message.content).toContain('8')
        console.log(
          `[Anthropic] Response: "${data.choices[0].message.content}" (${latency}ms)`,
        )
      },
    )
  })

  describe('Convenience Endpoints', () => {
    test.skipIf(!HAS_GROQ)('should work via /api/v1/inference', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/v1/inference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'user', content: 'What is 5+5? Just the number.' },
            ],
            maxTokens: 10,
          }),
        }),
      )

      expect(res.status).toBe(200)

      const data = (await res.json()) as InferenceResponse
      expect(data.content).toContain('10')
      expect(data.provider).toBe('groq')
    })
  })
})
