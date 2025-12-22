/**
 * Inference API E2E Tests
 *
 * Tests the local inference service.
 * Without API keys, the service returns an honest fallback message.
 * With API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY),
 * it uses real LLM inference.
 */

import { expect, test } from '@playwright/test'
import { z } from 'zod'

// Zod schemas for test validation
const ModelInfoSchema = z.object({
  id: z.string(),
})

const ChatChoiceSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
})

const ChatCompletionResponseSchema = z.object({
  id: z.string().optional(),
  object: z.string(),
  model: z.string().optional(),
  choices: z.array(ChatChoiceSchema),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
})

const ModelsResponseSchema = z.object({
  object: z.string(),
  data: z.array(ModelInfoSchema),
})

const HealthResponseSchema = z.object({
  status: z.string(),
  providers: z.number().optional(),
})

type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>
type ModelsResponse = z.infer<typeof ModelsResponseSchema>
type HealthResponse = z.infer<typeof HealthResponseSchema>

test.describe('Inference API', () => {
  const inferenceUrl = 'http://localhost:4100'

  test('should respond to health check', async ({ request }) => {
    const response = await request.get(`${inferenceUrl}/health`)
    expect(response.ok()).toBe(true)

    const data = HealthResponseSchema.parse(await response.json())
    expect(data.status).toBe('ok')
  })

  test('should list available models', async ({ request }) => {
    const response = await request.get(`${inferenceUrl}/v1/models`)
    expect(response.ok()).toBe(true)

    const data = ModelsResponseSchema.parse(await response.json())
    expect(data.object).toBe('list')
    expect(data.data).toBeInstanceOf(Array)
    expect(data.data.length).toBeGreaterThan(0)

    const models = data.data.map((m) => m.id)
    expect(models).toContain('local-fallback')
  })

  test('should handle chat completion request', async ({ request }) => {
    const response = await request.post(`${inferenceUrl}/v1/chat/completions`, {
      data: {
        model: 'local-fallback',
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.ok()).toBe(true)

    const data = ChatCompletionResponseSchema.parse(await response.json())
    expect(data.object).toBe('chat.completion')
    expect(data.choices).toBeInstanceOf(Array)
    expect(data.choices.length).toBe(1)
    expect(data.choices[0].message.role).toBe('assistant')
    expect(data.choices[0].message.content.length).toBeGreaterThan(0)
  })

  test('should return OpenAI-compatible response format', async ({
    request,
  }) => {
    const response = await request.post(`${inferenceUrl}/v1/chat/completions`, {
      data: {
        model: 'local-fallback',
        messages: [{ role: 'user', content: 'test' }],
      },
    })

    expect(response.ok()).toBe(true)

    const data = ChatCompletionResponseSchema.parse(await response.json())
    expect(data).toHaveProperty('id')
    expect(data).toHaveProperty('object', 'chat.completion')
    expect(data).toHaveProperty('model')
    expect(data).toHaveProperty('choices')
    expect(data).toHaveProperty('usage')
    expect(data.usage).toHaveProperty('prompt_tokens')
    expect(data.usage).toHaveProperty('completion_tokens')
    expect(data.usage).toHaveProperty('total_tokens')
  })

  test('should indicate when no API key is configured', async ({ request }) => {
    const healthResponse = await request.get(`${inferenceUrl}/health`)
    const health = HealthResponseSchema.parse(await healthResponse.json())

    if (health.providers === 0) {
      const response = await request.post(
        `${inferenceUrl}/v1/chat/completions`,
        {
          data: {
            model: 'local-fallback',
            messages: [{ role: 'user', content: 'test' }],
          },
        },
      )

      const data = ChatCompletionResponseSchema.parse(await response.json())
      const content = data.choices[0].message.content.toLowerCase()
      expect(content).toContain('api')
    }
  })
})
