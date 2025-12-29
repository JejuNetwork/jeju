/**
 * OpenAI Moderation Provider
 *
 * Integration with OpenAI's free Moderation API for text content.
 * Uses the omni-moderation-latest model.
 *
 * @see https://platform.openai.com/docs/guides/moderation
 */

import { z } from 'zod'
import type {
  CategoryScore,
  ContentType,
  ModerationCategory,
  ModerationProvider,
  ModerationResult,
} from '../types'

// ============ OpenAI Response Schemas ============

const CategoryScoresSchema = z.object({
  harassment: z.number(),
  'harassment/threatening': z.number(),
  hate: z.number(),
  'hate/threatening': z.number(),
  'self-harm': z.number(),
  'self-harm/instructions': z.number(),
  'self-harm/intent': z.number(),
  sexual: z.number(),
  'sexual/minors': z.number(),
  violence: z.number(),
  'violence/graphic': z.number(),
  // New omni categories
  illicit: z.number().optional(),
  'illicit/violent': z.number().optional(),
})

const CategoryFlagsSchema = z.object({
  harassment: z.boolean(),
  'harassment/threatening': z.boolean(),
  hate: z.boolean(),
  'hate/threatening': z.boolean(),
  'self-harm': z.boolean(),
  'self-harm/instructions': z.boolean(),
  'self-harm/intent': z.boolean(),
  sexual: z.boolean(),
  'sexual/minors': z.boolean(),
  violence: z.boolean(),
  'violence/graphic': z.boolean(),
  illicit: z.boolean().optional(),
  'illicit/violent': z.boolean().optional(),
})

const ModerationResultSchema = z.object({
  flagged: z.boolean(),
  categories: CategoryFlagsSchema,
  category_scores: CategoryScoresSchema,
})

const OpenAIModerationResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  results: z.array(ModerationResultSchema),
})

// ============ Category Mapping ============

type OpenAICategory = keyof z.infer<typeof CategoryScoresSchema>

const OPENAI_TO_CATEGORY: Record<OpenAICategory, ModerationCategory> = {
  harassment: 'harassment',
  'harassment/threatening': 'harassment',
  hate: 'hate',
  'hate/threatening': 'hate',
  'self-harm': 'self_harm',
  'self-harm/instructions': 'self_harm',
  'self-harm/intent': 'self_harm',
  sexual: 'adult',
  'sexual/minors': 'csam', // CRITICAL
  violence: 'violence',
  'violence/graphic': 'violence',
  illicit: 'illegal',
  'illicit/violent': 'illegal',
}

// ============ Provider Implementation ============

export interface OpenAIModerationConfig {
  apiKey: string
  endpoint?: string
  timeout?: number
  model?: string
}

export class OpenAIModerationProvider {
  readonly name: ModerationProvider = 'openai'
  readonly supportedTypes: ContentType[] = ['text']

  private apiKey: string
  private endpoint: string
  private timeout: number
  private model: string

  constructor(config: OpenAIModerationConfig) {
    this.apiKey = config.apiKey
    this.endpoint = config.endpoint ?? 'https://api.openai.com/v1/moderations'
    this.timeout = config.timeout ?? 10000
    this.model = config.model ?? 'omni-moderation-latest'
  }

  async moderateText(text: string): Promise<ModerationResult> {
    const startTime = Date.now()

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI Moderation error: ${response.status} ${errorText}`)
    }

    const rawData: unknown = await response.json()
    const parseResult = OpenAIModerationResponseSchema.safeParse(rawData)

    if (!parseResult.success) {
      throw new Error(`Invalid OpenAI response: ${parseResult.error.message}`)
    }

    const data = parseResult.data
    const firstResult = data.results[0]
    
    if (!firstResult) {
      throw new Error('No moderation result returned from OpenAI')
    }

    return this.processResponse(firstResult, startTime)
  }

  private processResponse(
    result: z.infer<typeof ModerationResultSchema>,
    startTime: number
  ): ModerationResult {
    const categories: CategoryScore[] = []
    const categoryMaxScores = new Map<ModerationCategory, number>()

    // Process all category scores
    const scores = result.category_scores
    for (const [openaiCategory, score] of Object.entries(scores)) {
      const category = OPENAI_TO_CATEGORY[openaiCategory as OpenAICategory]
      if (category && score > 0.01) {
        const existing = categoryMaxScores.get(category) ?? 0
        if (score > existing) {
          categoryMaxScores.set(category, score)
        }
      }
    }

    // Build category scores
    for (const [category, score] of categoryMaxScores) {
      categories.push({
        category,
        score,
        confidence: 0.95, // OpenAI is highly reliable
        provider: 'openai',
      })
    }

    // Check for CSAM only - free speech policy
    const csamScore = categoryMaxScores.get('csam') ?? 0
    const adultScore = categoryMaxScores.get('adult') ?? 0

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let reviewRequired = false

    // CSAM is ALWAYS immediate ban - OpenAI's sexual/minors category
    // This is the only thing we block under free speech policy
    if (csamScore > 0.1) {
      action = 'ban'
      severity = 'critical'
      reviewRequired = true
    } else if (adultScore > 0.7) {
      // Tag adult content for downstream consumers
      action = 'warn'
      severity = 'low'
    }
    // All other categories (hate, violence, etc) are FREE SPEECH

    const primaryCategory =
      categories.length > 0
        ? categories.reduce((a, b) => (a.score > b.score ? a : b)).category
        : undefined

    return {
      safe: action === 'allow',
      action,
      severity,
      categories,
      primaryCategory,
      blockedReason:
        action !== 'allow' ? `OpenAI detection: ${primaryCategory}` : undefined,
      reviewRequired,
      processingTimeMs: Date.now() - startTime,
      providers: ['openai'],
    }
  }
}

