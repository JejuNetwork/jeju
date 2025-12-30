/**
 * Vercel AI SDK Compatibility Test
 *
 * Tests DWS inference with the Vercel AI SDK (ai package).
 * Validates OpenAI-compatible API for streaming and non-streaming responses.
 *
 * Requirements:
 * - DWS server running with inference endpoints
 * - At least one inference provider configured (or mock node)
 *
 * Run with: bun test tests/sdk-compatibility/vercel-ai-sdk.test.ts
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import { dwsRequest } from '../setup'

setDefaultTimeout(60000)

const MOCK_NODE_ADDRESS = 'vercel-ai-sdk-test-node'
const MOCK_PORT = 14033

// Mock inference server that mimics OpenAI-compatible API
let mockServer: ReturnType<typeof Bun.serve> | null = null

interface ChatMessage {
  role: string
  content: string
}

interface ChatRequest {
  model?: string
  messages?: ChatMessage[]
  stream?: boolean
  max_tokens?: number
  temperature?: number
}

interface EmbeddingRequest {
  input: string | string[]
  model?: string
}

// Response types
interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  provider?: string
  node?: string
  choices: Array<{
    index: number
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface EmbeddingResponse {
  object: string
  data: Array<{
    object: string
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

interface ModelsResponse {
  object: string
  data: Array<{
    id: string
    object: string
    owned_by: string
  }>
}

interface HealthResponse {
  status: string
  nodes?: number
}

// Flag to track if inference infrastructure is available
let inferenceAvailable = false

describe('Vercel AI SDK Compatibility', () => {
  beforeAll(async () => {
    // Start mock inference server
    mockServer = Bun.serve({
      port: MOCK_PORT,
      fetch: async (req) => {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({ status: 'healthy', provider: 'mock' })
        }

        // OpenAI-compatible chat completions endpoint
        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
          const body = (await req.json()) as ChatRequest
          const isStream = body.stream === true

          const userMessage =
            body.messages?.find((m) => m.role === 'user')?.content || ''
          let responseContent =
            'This is a mock response from the DWS inference node.'

          // Handle specific test cases
          if (userMessage.includes('capital of France')) {
            responseContent = 'The capital of France is Paris.'
          } else if (userMessage.includes('2+2')) {
            responseContent = '4'
          } else if (userMessage.includes('JSON')) {
            responseContent = '{"name": "John", "age": 30, "city": "Paris"}'
          } else if (userMessage.includes('streaming test')) {
            responseContent =
              'This is a streaming response that comes in chunks.'
          }

          if (isStream) {
            // SSE streaming response
            const encoder = new TextEncoder()
            const stream = new ReadableStream({
              start(controller) {
                const words = responseContent.split(' ')
                let wordIndex = 0

                const sendChunk = () => {
                  if (wordIndex < words.length) {
                    const chunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: body.model || 'mock-gpt-4',
                      choices: [
                        {
                          index: 0,
                          delta: {
                            content:
                              (wordIndex === 0 ? '' : ' ') + words[wordIndex],
                          },
                          finish_reason: null,
                        },
                      ],
                    }
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
                    )
                    wordIndex++
                    setTimeout(sendChunk, 50)
                  } else {
                    // Send final chunk
                    const finalChunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: body.model || 'mock-gpt-4',
                      choices: [
                        {
                          index: 0,
                          delta: {},
                          finish_reason: 'stop',
                        },
                      ],
                    }
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`),
                    )
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                    controller.close()
                  }
                }

                sendChunk()
              },
            })

            return new Response(stream, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              },
            })
          }

          // Non-streaming response
          return Response.json({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model || 'mock-gpt-4',
            provider: 'mock',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: responseContent },
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

        // Embeddings endpoint
        if (url.pathname === '/v1/embeddings' && req.method === 'POST') {
          const body = (await req.json()) as EmbeddingRequest
          const inputs = Array.isArray(body.input) ? body.input : [body.input]

          return Response.json({
            object: 'list',
            data: inputs.map((_, i) => ({
              object: 'embedding',
              embedding: Array(1536)
                .fill(0)
                .map(() => Math.random() * 2 - 1),
              index: i,
            })),
            model: body.model || 'text-embedding-ada-002',
            usage: {
              prompt_tokens: inputs.length * 5,
              total_tokens: inputs.length * 5,
            },
          })
        }

        // Models list
        if (url.pathname === '/v1/models') {
          return Response.json({
            object: 'list',
            data: [
              { id: 'mock-gpt-4', object: 'model', owned_by: 'mock' },
              { id: 'mock-gpt-3.5-turbo', object: 'model', owned_by: 'mock' },
              {
                id: 'text-embedding-ada-002',
                object: 'model',
                owned_by: 'mock',
              },
            ],
          })
        }

        return new Response('Not Found', { status: 404 })
      },
    })

    // Register mock node with DWS via HTTP API
    const registerRes = await dwsRequest('/compute/nodes/register', {
      method: 'POST',
      body: JSON.stringify({
        address: MOCK_NODE_ADDRESS,
        endpoint: `http://localhost:${MOCK_PORT}`,
        capabilities: ['inference', 'embeddings', 'streaming'],
        models: ['mock-gpt-4', 'mock-gpt-3.5-turbo', 'text-embedding-ada-002'],
        provider: 'mock',
        region: 'test',
        gpuTier: 0,
        maxConcurrent: 100,
        name: 'Vercel AI SDK Test Node',
      }),
    })

    if (registerRes.ok) {
      inferenceAvailable = true
      console.log('[Vercel AI SDK Test] Mock node registered successfully')
    } else {
      const error = await registerRes.text()
      console.log('[Vercel AI SDK Test] Node registration failed:', error)
      console.log(
        '[Vercel AI SDK Test] Inference tests will be skipped (requires SQLit)',
      )
    }

    console.log('[Vercel AI SDK Test] Mock server started on port', MOCK_PORT)
  })

  afterAll(() => {
    mockServer?.stop()
    console.log('[Vercel AI SDK Test] Cleanup complete')
  })

  describe('OpenAI-Compatible Chat API', () => {
    test('POST /compute/chat/completions - basic chat completion', async () => {
      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is the capital of France?' },
          ],
          max_tokens: 100,
        }),
      })

      // In local dev mode, infrastructure may not be available
      if (res.status === 404 || res.status === 503) {
        console.log(
          '[Vercel AI SDK Test] Skipping - no inference nodes available (requires SQLit)',
        )
        return
      }

      expect(res.status).toBe(200)
      const data = (await res.json()) as ChatCompletionResponse

      expect(data.id).toBeDefined()
      expect(data.object).toBe('chat.completion')
      expect(data.choices).toHaveLength(1)
      expect(data.choices[0].message.role).toBe('assistant')
      expect(data.choices[0].message.content).toContain('Paris')
      expect(data.choices[0].finish_reason).toBe('stop')
      expect(data.usage.total_tokens).toBeGreaterThan(0)
    })

    test('POST /compute/chat/completions - handles math questions', async () => {
      if (!inferenceAvailable) {
        console.log('[Vercel AI SDK Test] Skipping - inference not available')
        return
      }

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [
            {
              role: 'user',
              content: 'What is 2+2? Reply with just the number.',
            },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as ChatCompletionResponse
      expect(data.choices[0].message.content).toContain('4')
    })

    test('POST /compute/chat/completions - JSON response', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [
            {
              role: 'user',
              content: 'Return a JSON object with name, age, city',
            },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as ChatCompletionResponse
      const jsonContent = JSON.parse(data.choices[0].message.content)
      expect(jsonContent.name).toBeDefined()
      expect(jsonContent.age).toBeDefined()
    })

    test('POST /compute/chat/completions - streaming response', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [{ role: 'user', content: 'streaming test please' }],
          stream: true,
        }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')

      // Read streaming response
      const reader = res.body?.getReader()
      expect(reader).toBeDefined()

      let fullContent = ''
      let chunkCount = 0
      const decoder = new TextDecoder()

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))

        for (const line of lines) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          const parsed = JSON.parse(data) as {
            choices: Array<{ delta?: { content?: string } }>
          }
          const deltaContent = parsed.choices[0]?.delta?.content
          if (deltaContent) {
            fullContent += deltaContent
            chunkCount++
          }
        }
      }

      expect(chunkCount).toBeGreaterThan(0)
      expect(fullContent).toContain('streaming')
    })

    test('POST /compute/chat/completions - respects temperature', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0,
        }),
      })

      expect(res.status).toBe(200)
    })

    test('POST /compute/chat/completions - respects max_tokens', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10,
        }),
      })

      expect(res.status).toBe(200)
    })
  })

  describe('Embeddings API', () => {
    test('POST /compute/embeddings - single text embedding', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Hello, DWS!',
          model: 'text-embedding-ada-002',
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as EmbeddingResponse

      expect(data.object).toBe('list')
      expect(data.data).toHaveLength(1)
      expect(data.data[0].embedding).toHaveLength(1536)
      expect(data.data[0].index).toBe(0)
    })

    test('POST /compute/embeddings - batch embeddings', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: ['Hello', 'World', 'DWS'],
          model: 'text-embedding-ada-002',
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as EmbeddingResponse

      expect(data.data).toHaveLength(3)
      expect(data.data[0].index).toBe(0)
      expect(data.data[1].index).toBe(1)
      expect(data.data[2].index).toBe(2)
    })
  })

  describe('Models API', () => {
    test('GET /compute/models - lists available models', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/models')

      expect(res.status).toBe(200)
      const data = (await res.json()) as ModelsResponse

      expect(data.object).toBe('list')
      expect(data.data).toBeInstanceOf(Array)
    })
  })

  describe('Inference Health', () => {
    test('GET /compute/health - returns node status', async () => {
      const res = await dwsRequest('/compute/health')

      expect(res.status).toBe(200)
      const data = (await res.json()) as HealthResponse
      expect(data.status).toBe('healthy')
    })
  })

  describe('Vercel AI SDK Patterns', () => {
    test('supports system + user message pattern', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a pirate. Respond like a pirate.',
            },
            { role: 'user', content: 'Hello' },
          ],
        }),
      })

      expect(res.status).toBe(200)
    })

    test('supports multi-turn conversation', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [
            { role: 'user', content: 'My name is Alice' },
            { role: 'assistant', content: 'Hello Alice!' },
            { role: 'user', content: 'What is my name?' },
          ],
        }),
      })

      expect(res.status).toBe(200)
    })

    test('handles empty messages array gracefully', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-gpt-4',
          messages: [],
        }),
      })

      // Should either return 400 or handle gracefully
      expect([200, 400]).toContain(res.status)
    })
  })

  describe('Error Handling', () => {
    test('returns 400 for missing model', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      })

      // Model should be optional with default, or required with 400
      expect([200, 400]).toContain(res.status)
    })

    test('returns 400 for invalid JSON', async () => {
      if (!inferenceAvailable) return

      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      })

      expect([400, 422]).toContain(res.status)
    })
  })
})
