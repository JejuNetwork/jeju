/**
 * OpenAI Moderation Provider - Free speech, CSAM detection only
 * @see https://platform.openai.com/docs/guides/moderation
 */

import { z } from 'zod'
import type { CategoryScore, ModerationCategory, ModerationProvider, ModerationResult } from '../types'

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

const OpenAIResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  results: z.array(ModerationResultSchema),
})

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
  'sexual/minors': 'csam',
  violence: 'violence',
  'violence/graphic': 'violence',
  illicit: 'illegal',
  'illicit/violent': 'illegal',
}

export interface OpenAIModerationConfig {
  apiKey: string
  endpoint?: string
  timeout?: number
  model?: string
}

export class OpenAIModerationProvider {
  readonly name: ModerationProvider = 'openai'
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
    const start = Date.now()

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`OpenAI Moderation error: ${response.status} ${await response.text()}`)
    }

    const data = OpenAIResponseSchema.parse(await response.json())
    const result = data.results[0]
    if (!result) throw new Error('No moderation result')

    return this.process(result, start)
  }

  private process(result: z.infer<typeof ModerationResultSchema>, start: number): ModerationResult {
    const categories: CategoryScore[] = []
    const maxScores = new Map<ModerationCategory, number>()

    for (const [key, score] of Object.entries(result.category_scores)) {
      const cat = OPENAI_TO_CATEGORY[key as OpenAICategory]
      if (cat && score > 0.01) {
        const curr = maxScores.get(cat) ?? 0
        if (score > curr) maxScores.set(cat, score)
      }
    }

    for (const [cat, score] of maxScores) {
      categories.push({ category: cat, score, confidence: 0.95, provider: 'openai' })
    }

    const csam = maxScores.get('csam') ?? 0
    const adult = maxScores.get('adult') ?? 0

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let review = false

    if (csam > 0.1) { action = 'ban'; severity = 'critical'; review = true }
    else if (adult > 0.7) { action = 'warn'; severity = 'low' }

    const primary = categories.length ? categories.reduce((a, b) => a.score > b.score ? a : b).category : undefined

    return {
      safe: action === 'allow',
      action,
      severity,
      categories,
      primaryCategory: primary,
      blockedReason: action !== 'allow' ? `OpenAI: ${primary}` : undefined,
      reviewRequired: review,
      processingTimeMs: Date.now() - start,
      providers: ['openai'],
    }
  }
}
