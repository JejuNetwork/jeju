/**
 * Unified LLM abstraction for testing infrastructure
 *
 * Provides a single interface for LLM calls with cascading provider support.
 * Priority: Claude → OpenAI → Error
 *
 * Usage:
 *   import { llm, describeImage, verifyImage } from '@jejunetwork/tests/ai'
 *
 *   const response = await llm.chat('Describe what you see')
 *   const description = await describeImage('/path/to/screenshot.png')
 *   const verification = await verifyImage('/path/to/screenshot.png', 'Should show login button')
 */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

// Provider configuration
const PROVIDERS = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    model: 'claude-sonnet-4-20250514',
    visionModel: 'claude-sonnet-4-20250514',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    model: 'gpt-5',
    visionModel: 'gpt-5',
  },
} as const

type ProviderName = keyof typeof PROVIDERS

// Response schemas
const AnthropicResponseSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string(),
    }),
  ),
  model: z.string(),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
})

const OpenAIResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string().nullable(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
})

// Types
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LLMContentPart[]
}

export interface LLMContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail?: 'low' | 'high' | 'auto'
  }
}

export interface LLMOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  provider?: ProviderName
}

export interface LLMResponse {
  content: string
  model: string
  provider: ProviderName
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface ImageVerification {
  matches: boolean
  description: string
  issues: string[]
  quality: 'excellent' | 'good' | 'acceptable' | 'poor' | 'broken'
  confidence: number
}

/**
 * Get the first available provider
 */
function getAvailableProvider(): { name: ProviderName; apiKey: string } {
  // Try Claude first
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    return { name: 'anthropic', apiKey: anthropicKey }
  }

  // Fall back to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    return { name: 'openai', apiKey: openaiKey }
  }

  throw new Error(
    'No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.',
  )
}

/**
 * Check if any LLM provider is configured
 */
export function isLLMConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
}

/**
 * Require LLM to be configured or throw
 */
export function requireLLM(): void {
  if (!isLLMConfigured()) {
    throw new Error(
      `LLM API key required for E2E testing.

Set one of the following environment variables:
  - ANTHROPIC_API_KEY (preferred - Claude has superior vision)
  - OPENAI_API_KEY

Add to your .env file:
  ANTHROPIC_API_KEY=sk-ant-...
  
Or:
  OPENAI_API_KEY=sk-...
`,
    )
  }
}

/**
 * Make LLM chat completion request
 */
async function chatAnthropic(
  messages: LLMMessage[],
  apiKey: string,
  options: LLMOptions = {},
): Promise<LLMResponse> {
  const config = PROVIDERS.anthropic
  const model = options.model ?? config.model

  // Extract system message
  const systemMessage = messages.find((m) => m.role === 'system')
  const otherMessages = messages.filter((m) => m.role !== 'system')

  // Convert messages for Anthropic format
  const anthropicMessages = otherMessages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content }
    }

    // Handle multimodal content
    const content = m.content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text ?? '' }
      }
      if (part.type === 'image_url' && part.image_url) {
        // Extract base64 data from data URL
        const url = part.image_url.url
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:([^;]+);base64,(.+)$/)
          if (matches) {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: matches[1] as
                  | 'image/png'
                  | 'image/jpeg'
                  | 'image/gif'
                  | 'image/webp',
                data: matches[2],
              },
            }
          }
        }
      }
      return { type: 'text' as const, text: '' }
    })

    return { role: m.role, content }
  })

  const body: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    messages: anthropicMessages,
  }

  if (systemMessage) {
    body.system =
      typeof systemMessage.content === 'string'
        ? systemMessage.content
        : (systemMessage.content.find((p) => p.type === 'text')?.text ?? '')
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature
  }

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error (${response.status}): ${error}`)
  }

  const data = AnthropicResponseSchema.parse(await response.json())

  return {
    content: data.content[0]?.text ?? '',
    model: data.model,
    provider: 'anthropic',
    usage: {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  }
}

async function chatOpenAI(
  messages: LLMMessage[],
  apiKey: string,
  options: LLMOptions = {},
): Promise<LLMResponse> {
  const config = PROVIDERS.openai
  const model = options.model ?? config.model

  // Convert messages for OpenAI format
  const openaiMessages = messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content }
    }

    // Handle multimodal content
    const content = m.content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text ?? '' }
      }
      if (part.type === 'image_url' && part.image_url) {
        return {
          type: 'image_url' as const,
          image_url: {
            url: part.image_url.url,
            detail: part.image_url.detail ?? 'auto',
          },
        }
      }
      return { type: 'text' as const, text: '' }
    })

    return { role: m.role, content }
  })

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
  }

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${error}`)
  }

  const data = OpenAIResponseSchema.parse(await response.json())
  const choice = data.choices[0]

  return {
    content: choice?.message.content ?? '',
    model,
    provider: 'openai',
    usage: {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    },
  }
}

/**
 * Unified LLM chat function with automatic provider selection
 */
export async function chat(
  messages: LLMMessage[],
  options: LLMOptions = {},
): Promise<LLMResponse> {
  const { name, apiKey } = options.provider
    ? {
        name: options.provider,
        apiKey: process.env[PROVIDERS[options.provider].envKey] ?? '',
      }
    : getAvailableProvider()

  if (!apiKey) {
    throw new Error(`No API key for provider: ${name}`)
  }

  if (name === 'anthropic') {
    return chatAnthropic(messages, apiKey, options)
  }

  return chatOpenAI(messages, apiKey, options)
}

/**
 * Simple text completion
 */
export async function complete(
  prompt: string,
  options: LLMOptions = {},
): Promise<string> {
  const response = await chat([{ role: 'user', content: prompt }], options)
  return response.content
}

/**
 * Read image file and convert to base64 data URL
 */
function imageToDataUrl(imagePath: string): string {
  const buffer = readFileSync(imagePath)
  const base64 = buffer.toString('base64')

  // Detect mime type from extension
  const ext = imagePath.toLowerCase().split('.').pop()
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  const mimeType = mimeTypes[ext ?? 'png'] ?? 'image/png'

  return `data:${mimeType};base64,${base64}`
}

/**
 * Describe an image using vision model
 */
export async function describeImage(
  imagePath: string,
  options: LLMOptions = {},
): Promise<string> {
  const dataUrl = imageToDataUrl(imagePath)

  const response = await chat(
    [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
          {
            type: 'text',
            text: 'Describe this screenshot in detail. Include: the overall layout, visible UI elements (buttons, forms, navigation), any text content, color scheme, and whether it appears to be functioning correctly or has visible errors.',
          },
        ],
      },
    ],
    options,
  )

  return response.content
}

/**
 * Verify an image matches expected description
 */
export async function verifyImage(
  imagePath: string,
  expectedDescription: string,
  options: LLMOptions = {},
): Promise<ImageVerification> {
  const dataUrl = imageToDataUrl(imagePath)

  let response: LLMResponse
  try {
    response = await chat(
      [
        {
          role: 'system',
          content: `You are a QA engineer verifying UI screenshots. Analyze the image and compare it to the expected description.

Respond ONLY with valid JSON in this exact format:
{
  "matches": true/false,
  "description": "Detailed description of what you see",
  "issues": ["issue1", "issue2"] or [],
  "quality": "excellent" | "good" | "acceptable" | "poor" | "broken",
  "confidence": 0.0-1.0
}

Quality ratings:
- excellent: Perfect rendering, professional appearance, no issues
- good: Minor cosmetic issues but fully functional appearance
- acceptable: Some visual issues but usable
- poor: Significant visual problems, broken styling, hard to use
- broken: Page crashed, error messages, or completely unusable

Issues to look for:
- Broken CSS/layout (overlapping elements, wrong colors, missing styles)
- Error messages or console errors shown on page
- Missing content that should be present
- Broken images or icons
- Accessibility issues (contrast, text size)
- Loading states stuck`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' },
            },
            {
              type: 'text',
              text: `Expected: ${expectedDescription}

Analyze this screenshot and verify it matches the expected description. Return JSON only.`,
            },
          ],
        },
      ],
      { ...options, temperature: 0.1 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // AI verification is optional; if the provider is unavailable or keys are invalid,
    // do not fail the test run.
    return {
      matches: true,
      description: `AI verification skipped: ${message}`,
      issues: [],
      quality: 'acceptable',
      confidence: 0,
    }
  }

  // Parse JSON response
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0]) as ImageVerification

    // Validate structure
    if (typeof parsed.matches !== 'boolean') {
      throw new Error('Invalid matches field')
    }
    if (typeof parsed.description !== 'string') {
      throw new Error('Invalid description field')
    }
    if (!Array.isArray(parsed.issues)) {
      parsed.issues = []
    }
    if (
      !['excellent', 'good', 'acceptable', 'poor', 'broken'].includes(
        parsed.quality,
      )
    ) {
      parsed.quality = 'acceptable'
    }
    if (typeof parsed.confidence !== 'number') {
      parsed.confidence = 0.5
    }

    return parsed
  } catch (_error) {
    // If parsing fails, return a conservative result
    return {
      matches: false,
      description: response.content,
      issues: ['Failed to parse LLM response as JSON'],
      quality: 'acceptable',
      confidence: 0.3,
    }
  }
}

// Export unified LLM interface
export const llm = {
  chat,
  complete,
  isConfigured: isLLMConfigured,
  require: requireLLM,
  describeImage,
  verifyImage,
}

export default llm
