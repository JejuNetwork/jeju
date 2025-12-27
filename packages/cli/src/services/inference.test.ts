/**
 * Inference Service Tests
 *
 * Tests for:
 * - Model resolution and provider routing
 * - Pattern matching for auto-routing
 * - Response normalization from different providers
 * - Provider request building
 */

import { describe, expect, test } from 'bun:test'
import type { OpenAIResponse } from '../schemas'

// We need to test the internal logic, so we'll recreate the patterns here
// and test them directly. The actual service tests are in services.test.ts

// Pattern matching for auto-routing unknown models (from inference.ts)
const MODEL_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /^gpt-|^o1-|^o1$|^o3-|^o3$|^chatgpt-/i, provider: 'openai' },
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

/**
 * Resolve provider from model name (logic from LocalInferenceServer)
 */
function resolveModelProvider(
  model: string,
  explicitProvider?: string,
  defaultProvider = 'dws',
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
  return { provider: defaultProvider, model }
}

describe('Model Pattern Matching', () => {
  describe('OpenAI Models', () => {
    test('routes gpt-4 to openai', () => {
      expect(resolveModelProvider('gpt-4').provider).toBe('openai')
    })

    test('routes gpt-5.2 to openai', () => {
      expect(resolveModelProvider('gpt-5.2').provider).toBe('openai')
    })

    test('routes gpt-3.5-turbo to openai', () => {
      expect(resolveModelProvider('gpt-3.5-turbo').provider).toBe('openai')
    })

    test('routes o1-preview to openai', () => {
      expect(resolveModelProvider('o1-preview').provider).toBe('openai')
    })

    test('routes o1-mini to openai', () => {
      expect(resolveModelProvider('o1-mini').provider).toBe('openai')
    })

    test('routes o3 to openai', () => {
      expect(resolveModelProvider('o3').provider).toBe('openai')
    })

    test('routes chatgpt-5 to openai', () => {
      expect(resolveModelProvider('chatgpt-5').provider).toBe('openai')
    })

    test('case insensitive - GPT-4 routes to openai', () => {
      expect(resolveModelProvider('GPT-4').provider).toBe('openai')
    })
  })

  describe('Anthropic Models', () => {
    test('routes claude-opus-4-5 to anthropic', () => {
      expect(resolveModelProvider('claude-opus-4-5').provider).toBe('anthropic')
    })

    test('routes claude-sonnet-4-5 to anthropic', () => {
      expect(resolveModelProvider('claude-sonnet-4-5').provider).toBe(
        'anthropic',
      )
    })

    test('routes claude-2 to anthropic', () => {
      expect(resolveModelProvider('claude-2').provider).toBe('anthropic')
    })

    test('case insensitive - CLAUDE-3-OPUS routes to anthropic', () => {
      expect(resolveModelProvider('CLAUDE-3-OPUS').provider).toBe('anthropic')
    })
  })

  describe('Google Models', () => {
    test('routes gemini-pro to google', () => {
      expect(resolveModelProvider('gemini-pro').provider).toBe('google')
    })

    test('routes gemini-1.5-pro to google', () => {
      expect(resolveModelProvider('gemini-1.5-pro').provider).toBe('google')
    })

    test('routes gemini-1.5-flash to google', () => {
      expect(resolveModelProvider('gemini-1.5-flash').provider).toBe('google')
    })

    test('routes gemini-ultra to google', () => {
      expect(resolveModelProvider('gemini-ultra').provider).toBe('google')
    })
  })

  describe('XAI/Grok Models', () => {
    test('routes grok-beta to xai', () => {
      expect(resolveModelProvider('grok-beta').provider).toBe('xai')
    })

    test('routes grok-2 to xai', () => {
      expect(resolveModelProvider('grok-2').provider).toBe('xai')
    })
  })

  describe('Cohere Models', () => {
    test('routes command-r to cohere', () => {
      expect(resolveModelProvider('command-r').provider).toBe('cohere')
    })

    test('routes command-r-plus to cohere', () => {
      expect(resolveModelProvider('command-r-plus').provider).toBe('cohere')
    })

    test('routes command-nightly to cohere', () => {
      expect(resolveModelProvider('command-nightly').provider).toBe('cohere')
    })
  })

  describe('AI21 Models', () => {
    test('routes jamba-1.5-large to ai21', () => {
      expect(resolveModelProvider('jamba-1.5-large').provider).toBe('ai21')
    })

    test('routes jamba-instruct to ai21', () => {
      expect(resolveModelProvider('jamba-instruct').provider).toBe('ai21')
    })
  })

  describe('Groq Models', () => {
    test('routes llama-3.3-70b-versatile to groq', () => {
      expect(resolveModelProvider('llama-3.3-70b-versatile').provider).toBe(
        'groq',
      )
    })

    test('routes llama-3.1-8b-versatile to groq', () => {
      expect(resolveModelProvider('llama-3.1-8b-versatile').provider).toBe(
        'groq',
      )
    })

    test('routes mixtral-8x7b to groq', () => {
      expect(resolveModelProvider('mixtral-8x7b').provider).toBe('groq')
    })

    test('routes mixtral-8x22b to groq', () => {
      expect(resolveModelProvider('mixtral-8x22b').provider).toBe('groq')
    })
  })

  describe('Fireworks Models', () => {
    test('routes accounts/fireworks/models/llama-v3p1-70b to fireworks', () => {
      expect(
        resolveModelProvider('accounts/fireworks/models/llama-v3p1-70b')
          .provider,
      ).toBe('fireworks')
    })

    test('keeps full model path for fireworks', () => {
      const result = resolveModelProvider(
        'accounts/fireworks/models/llama-v3p1-70b',
      )
      expect(result.model).toBe('accounts/fireworks/models/llama-v3p1-70b')
    })
  })

  describe('Mistral Models', () => {
    test('routes mistral-large to mistral', () => {
      expect(resolveModelProvider('mistral-large').provider).toBe('mistral')
    })

    test('routes mistral-medium to mistral', () => {
      expect(resolveModelProvider('mistral-medium').provider).toBe('mistral')
    })

    test('routes mistral-small to mistral', () => {
      expect(resolveModelProvider('mistral-small').provider).toBe('mistral')
    })

    test('routes codestral-latest to mistral', () => {
      expect(resolveModelProvider('codestral-latest').provider).toBe('mistral')
    })
  })

  describe('DeepSeek Models', () => {
    test('routes deepseek-chat to deepseek', () => {
      expect(resolveModelProvider('deepseek-chat').provider).toBe('deepseek')
    })

    test('routes deepseek-coder to deepseek', () => {
      expect(resolveModelProvider('deepseek-coder').provider).toBe('deepseek')
    })
  })

  describe('Perplexity Models', () => {
    test('routes pplx-70b-online to perplexity', () => {
      expect(resolveModelProvider('pplx-70b-online').provider).toBe(
        'perplexity',
      )
    })

    test('routes pplx-7b-chat to perplexity', () => {
      expect(resolveModelProvider('pplx-7b-chat').provider).toBe('perplexity')
    })
  })
})

describe('Provider Prefix Routing', () => {
  test('extracts provider from prefix', () => {
    const result = resolveModelProvider('anthropic/claude-opus-4-5')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-opus-4-5')
  })

  test('extracts provider with nested path', () => {
    const result = resolveModelProvider('openrouter/meta-llama/llama-3.1-405b')
    expect(result.provider).toBe('openrouter')
    expect(result.model).toBe('meta-llama/llama-3.1-405b')
  })

  test('handles unknown provider prefix', () => {
    const result = resolveModelProvider('custom-provider/some-model')
    expect(result.provider).toBe('custom-provider')
    expect(result.model).toBe('some-model')
  })

  test('provider prefix overrides pattern matching', () => {
    // Even though gpt-4 would match openai pattern,
    // the explicit prefix should win
    const result = resolveModelProvider('groq/gpt-4')
    expect(result.provider).toBe('groq')
    expect(result.model).toBe('gpt-4')
  })
})

describe('Explicit Provider Parameter', () => {
  test('explicit provider takes highest priority', () => {
    const result = resolveModelProvider('gpt-4', 'anthropic')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('gpt-4')
  })

  test('explicit provider overrides prefix', () => {
    const result = resolveModelProvider('openai/gpt-4', 'groq')
    expect(result.provider).toBe('groq')
    expect(result.model).toBe('openai/gpt-4')
  })
})

describe('Default Provider Fallback', () => {
  test('unknown models fall back to default provider', () => {
    const result = resolveModelProvider('some-unknown-model')
    expect(result.provider).toBe('dws')
    expect(result.model).toBe('some-unknown-model')
  })

  test('custom default provider is respected', () => {
    const result = resolveModelProvider(
      'some-unknown-model',
      undefined,
      'openai',
    )
    expect(result.provider).toBe('openai')
  })

  test('models not matching any pattern use default', () => {
    const unknownModels = [
      'my-fine-tuned-model',
      'custom-llm-v1',
      'local-model-7b',
      'experimental-v2',
    ]

    for (const model of unknownModels) {
      const result = resolveModelProvider(model)
      expect(result.provider).toBe('dws')
    }
  })
})

describe('Response Normalization', () => {
  // Helper to simulate Anthropic response normalization
  function normalizeAnthropicResponse(data: {
    id: string
    model: string
    content: Array<{ text: string }>
    stop_reason: string
    usage: { input_tokens: number; output_tokens: number }
  }): OpenAIResponse {
    return {
      id: data.id,
      object: 'chat.completion',
      model: data.model,
      choices: [
        {
          message: { role: 'assistant', content: data.content[0].text ?? '' },
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

  // Helper to simulate Google Gemini response normalization
  function normalizeGoogleResponse(
    data: {
      candidates: Array<{
        content: { parts: Array<{ text: string }> }
        finishReason: string
      }>
      usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        totalTokenCount?: number
      }
    },
    model: string,
  ): OpenAIResponse {
    const candidate = data.candidates[0]
    const firstPart = candidate.content.parts[0]
    const usage = data.usageMetadata

    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: firstPart.text ?? '',
          },
          finish_reason: candidate.finishReason === 'STOP' ? 'stop' : 'length',
        },
      ],
      usage: {
        prompt_tokens: usage?.promptTokenCount ?? 0,
        completion_tokens: usage?.candidatesTokenCount ?? 0,
        total_tokens: usage?.totalTokenCount ?? 0,
      },
    }
  }

  // Helper to simulate Cohere response normalization
  function normalizeCohereResponse(
    data: {
      generation_id?: string
      text: string
      meta?: { tokens?: { input_tokens: number; output_tokens: number } }
    },
    model: string,
  ): OpenAIResponse {
    return {
      id: data.generation_id || `cohere-${Date.now()}`,
      object: 'chat.completion',
      model,
      choices: [
        {
          message: { role: 'assistant', content: data.text },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.meta?.tokens?.input_tokens ?? 0,
        completion_tokens: data.meta?.tokens?.output_tokens ?? 0,
        total_tokens:
          (data.meta?.tokens?.input_tokens ?? 0) +
          (data.meta?.tokens?.output_tokens ?? 0),
      },
    }
  }

  describe('Anthropic Response', () => {
    test('normalizes standard response', () => {
      const anthropicResponse = {
        id: 'msg_123',
        model: 'claude-opus-4-5',
        content: [{ text: 'Hello, I am Claude.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }

      const normalized = normalizeAnthropicResponse(anthropicResponse)

      expect(normalized).toEqual({
        id: 'msg_123',
        object: 'chat.completion',
        model: 'claude-opus-4-5',
        choices: [
          {
            message: { role: 'assistant', content: 'Hello, I am Claude.' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      })
    })

    test('handles empty content array', () => {
      const anthropicResponse = {
        id: 'msg_123',
        model: 'claude-opus-4-5',
        content: [],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 0 },
      }

      const normalized = normalizeAnthropicResponse(anthropicResponse)

      expect(
        (normalized as { choices: Array<{ message: { content: string } }> })
          .choices[0].message.content,
      ).toBe('')
    })

    test('preserves non-end_turn stop reasons', () => {
      const anthropicResponse = {
        id: 'msg_123',
        model: 'claude-opus-4-5',
        content: [{ text: 'Truncated...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 1000 },
      }

      const normalized = normalizeAnthropicResponse(anthropicResponse)

      expect(
        (normalized as { choices: Array<{ finish_reason: string }> }).choices[0]
          .finish_reason,
      ).toBe('max_tokens')
    })
  })

  describe('Google Gemini Response', () => {
    test('normalizes standard response', () => {
      const geminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Hello from Gemini!' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15,
        },
      }

      const normalized = normalizeGoogleResponse(geminiResponse, 'gemini-pro')

      expect((normalized as { object: string }).object).toBe('chat.completion')
      expect((normalized as { model: string }).model).toBe('gemini-pro')
      expect(
        (normalized as { choices: Array<{ message: { content: string } }> })
          .choices[0].message.content,
      ).toBe('Hello from Gemini!')
      expect(
        (normalized as { choices: Array<{ finish_reason: string }> }).choices[0]
          .finish_reason,
      ).toBe('stop')
    })

    test('handles missing usage metadata', () => {
      const geminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Response without usage' }] },
            finishReason: 'STOP',
          },
        ],
      }

      const normalized = normalizeGoogleResponse(geminiResponse, 'gemini-pro')

      expect(
        (normalized as { usage: { total_tokens: number } }).usage.total_tokens,
      ).toBe(0)
    })

    test('handles non-STOP finish reason', () => {
      const geminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Truncated' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      }

      const normalized = normalizeGoogleResponse(geminiResponse, 'gemini-pro')

      expect(
        (normalized as { choices: Array<{ finish_reason: string }> }).choices[0]
          .finish_reason,
      ).toBe('length')
    })
  })

  describe('Cohere Response', () => {
    test('normalizes standard response', () => {
      const cohereResponse = {
        generation_id: 'gen_123',
        text: 'Hello from Cohere!',
        meta: {
          tokens: { input_tokens: 8, output_tokens: 12 },
        },
      }

      const normalized = normalizeCohereResponse(cohereResponse, 'command-r')

      expect((normalized as { id: string }).id).toBe('gen_123')
      expect((normalized as { model: string }).model).toBe('command-r')
      expect(
        (normalized as { choices: Array<{ message: { content: string } }> })
          .choices[0].message.content,
      ).toBe('Hello from Cohere!')
      expect(
        (normalized as { usage: { total_tokens: number } }).usage.total_tokens,
      ).toBe(20)
    })

    test('handles missing generation_id', () => {
      const cohereResponse = {
        text: 'Response without id',
      }

      const normalized = normalizeCohereResponse(cohereResponse, 'command-r')

      expect((normalized as { id: string }).id).toMatch(/^cohere-\d+$/)
    })

    test('handles missing meta', () => {
      const cohereResponse = {
        text: 'Response without meta',
      }

      const normalized = normalizeCohereResponse(cohereResponse, 'command-r')

      expect(
        (normalized as { usage: { prompt_tokens: number } }).usage
          .prompt_tokens,
      ).toBe(0)
      expect(
        (normalized as { usage: { completion_tokens: number } }).usage
          .completion_tokens,
      ).toBe(0)
    })
  })
})

describe('Provider Request Building', () => {
  // Simulated buildProviderRequest logic for testing
  interface ChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
  }

  interface ChatRequest {
    model: string
    messages: ChatMessage[]
    temperature?: number
    max_tokens?: number
  }

  function buildAnthropicRequest(request: ChatRequest): {
    url: string
    body: Record<string, unknown>
  } {
    const systemMessage = request.messages.find((m) => m.role === 'system')
    const otherMessages = request.messages.filter((m) => m.role !== 'system')

    return {
      url: 'https://api.anthropic.com/v1/messages',
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

  function buildGoogleRequest(request: ChatRequest): {
    body: Record<string, unknown>
  } {
    return {
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

  describe('Anthropic Request Building', () => {
    test('extracts system message correctly', () => {
      const request: ChatRequest = {
        model: 'claude-opus-4-5',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
        ],
      }

      const built = buildAnthropicRequest(request)

      expect(built.body.system).toBe('You are a helpful assistant.')
      expect((built.body.messages as ChatMessage[]).length).toBe(1)
      expect((built.body.messages as ChatMessage[])[0].role).toBe('user')
    })

    test('handles request without system message', () => {
      const request: ChatRequest = {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Hello!' }],
      }

      const built = buildAnthropicRequest(request)

      expect(built.body.system).toBeUndefined()
    })

    test('includes temperature when provided', () => {
      const request: ChatRequest = {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Hello!' }],
        temperature: 0.7,
      }

      const built = buildAnthropicRequest(request)

      expect(built.body.temperature).toBe(0.7)
    })

    test('uses default max_tokens when not provided', () => {
      const request: ChatRequest = {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Hello!' }],
      }

      const built = buildAnthropicRequest(request)

      expect(built.body.max_tokens).toBe(4096)
    })
  })

  describe('Google Gemini Request Building', () => {
    test('converts roles correctly', () => {
      const request: ChatRequest = {
        model: 'gemini-pro',
        messages: [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      }

      const built = buildGoogleRequest(request)
      const contents = built.body.contents as Array<{ role: string }>

      expect(contents[0].role).toBe('user')
      expect(contents[1].role).toBe('model') // assistant -> model
      expect(contents[2].role).toBe('user')
    })

    test('structures parts correctly', () => {
      const request: ChatRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Test message' }],
      }

      const built = buildGoogleRequest(request)
      const contents = built.body.contents as Array<{
        parts: Array<{ text: string }>
      }>

      expect(contents[0].parts[0].text).toBe('Test message')
    })

    test('includes temperature in generationConfig', () => {
      const request: ChatRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hello!' }],
        temperature: 0.5,
      }

      const built = buildGoogleRequest(request)
      const config = built.body.generationConfig as { temperature: number }

      expect(config.temperature).toBe(0.5)
    })
  })
})

describe('Edge Cases', () => {
  test('handles empty model string', () => {
    const result = resolveModelProvider('')
    expect(result.provider).toBe('dws')
    expect(result.model).toBe('')
  })

  test('handles model with only slashes', () => {
    const result = resolveModelProvider('///')
    expect(result.provider).toBe('')
    expect(result.model).toBe('//')
  })

  test('handles model with trailing slash', () => {
    const result = resolveModelProvider('openai/')
    expect(result.provider).toBe('openai')
    expect(result.model).toBe('')
  })

  test('handles very long model names', () => {
    const longModel = 'x'.repeat(1000)
    const result = resolveModelProvider(longModel)
    expect(result.provider).toBe('dws')
    expect(result.model.length).toBe(1000)
  })

  test('handles special characters in model name', () => {
    const result = resolveModelProvider(
      'model-with-dashes_and_underscores.v1.0',
    )
    expect(result.provider).toBe('dws')
    expect(result.model).toBe('model-with-dashes_and_underscores.v1.0')
  })
})
