/**
 * Hive Moderation Provider
 *
 * Integration with Hive Moderation API for image and text content.
 * Excellent for visual content moderation including CSAM detection.
 *
 * @see https://docs.thehive.ai/docs/moderation
 */

import { z } from 'zod'
import type {
  CategoryScore,
  ContentType,
  ModerationCategory,
  ModerationProvider,
  ModerationResult,
} from '../types'

// ============ Hive API Response Schemas ============

const HiveClassSchema = z.object({
  class: z.string(),
  score: z.number(),
})

const HiveOutputSchema = z.object({
  classes: z.array(HiveClassSchema),
})

const HiveResultSchema = z.object({
  code: z.number(),
  description: z.string(),
})

const HiveResponseSchema = z.object({
  status: z.array(HiveResultSchema),
  output: z.array(HiveOutputSchema).optional(),
})

// ============ Category Mapping ============

const HIVE_TO_CATEGORY: Record<string, ModerationCategory> = {
  // Sexual content
  sexual_display: 'adult',
  sexual_activity: 'adult',
  sex_toy: 'adult',
  suggestive: 'adult',
  
  // CSAM - CRITICAL
  yes_minor: 'csam',
  yes_sexual_minor: 'csam',
  
  // Violence
  very_bloody: 'violence',
  human_corpse: 'violence',
  hanging: 'violence',
  
  // Hate symbols
  nazi: 'hate',
  confederate: 'hate',
  supremacist: 'hate',
  
  // Self-harm
  self_harm: 'self_harm',
  
  // Drugs
  pills: 'drugs',
  drug_use: 'drugs',
  smoking: 'drugs',
  
  // Spam
  spam: 'spam',
}

// ============ Provider Implementation ============

export interface HiveProviderConfig {
  apiKey: string
  endpoint?: string
  timeout?: number
  models?: string[] // e.g., ['visual_moderation', 'text_moderation']
}

export class HiveModerationProvider {
  readonly name: ModerationProvider = 'hive'
  readonly supportedTypes: ContentType[] = ['image', 'video', 'text']

  private apiKey: string
  private endpoint: string
  private timeout: number

  constructor(config: HiveProviderConfig) {
    this.apiKey = config.apiKey
    this.endpoint = config.endpoint ?? 'https://api.thehive.ai/api/v2/task/sync'
    this.timeout = config.timeout ?? 30000
  }

  async moderateImage(imageBuffer: Buffer): Promise<ModerationResult> {
    const startTime = Date.now()

    const formData = new FormData()
    // Create a proper Uint8Array copy for Blob
    const uint8Array = new Uint8Array(imageBuffer.length)
    for (let i = 0; i < imageBuffer.length; i++) {
      uint8Array[i] = imageBuffer[i]
    }
    formData.append('media', new Blob([uint8Array]), 'image.jpg')

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        Accept: 'application/json',
      },
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Hive API error: ${response.status} ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const parseResult = HiveResponseSchema.safeParse(rawData)

    if (!parseResult.success) {
      throw new Error(`Invalid Hive response: ${parseResult.error.message}`)
    }

    const data = parseResult.data
    return this.processResponse(data, startTime)
  }

  async moderateText(text: string): Promise<ModerationResult> {
    const startTime = Date.now()

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text_data: text,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Hive API error: ${response.status} ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const parseResult = HiveResponseSchema.safeParse(rawData)

    if (!parseResult.success) {
      throw new Error(`Invalid Hive response: ${parseResult.error.message}`)
    }

    const data = parseResult.data
    return this.processResponse(data, startTime)
  }

  private processResponse(
    data: z.infer<typeof HiveResponseSchema>,
    startTime: number
  ): ModerationResult {
    const categories: CategoryScore[] = []
    const categoryMaxScores = new Map<ModerationCategory, number>()

    // Process all output classes
    for (const output of data.output ?? []) {
      for (const cls of output.classes) {
        const category = HIVE_TO_CATEGORY[cls.class]
        if (category) {
          const existing = categoryMaxScores.get(category) ?? 0
          if (cls.score > existing) {
            categoryMaxScores.set(category, cls.score)
          }
        }
      }
    }

    // Build category scores
    for (const [category, score] of categoryMaxScores) {
      categories.push({
        category,
        score,
        confidence: 0.95, // Hive is highly reliable
        provider: 'hive',
      })
    }

    // Determine action based on scores
    const csamScore = categoryMaxScores.get('csam') ?? 0
    const adultScore = categoryMaxScores.get('adult') ?? 0
    const violenceScore = categoryMaxScores.get('violence') ?? 0
    const hateScore = categoryMaxScores.get('hate') ?? 0
    const selfHarmScore = categoryMaxScores.get('self_harm') ?? 0

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let reviewRequired = false

    // CSAM is ALWAYS immediate ban - no tolerance
    if (csamScore > 0.3) {
      action = 'ban'
      severity = 'critical'
      reviewRequired = true
    } else if (adultScore > 0.8 || violenceScore > 0.8 || hateScore > 0.8) {
      action = 'block'
      severity = 'high'
      reviewRequired = true
    } else if (selfHarmScore > 0.7) {
      action = 'block'
      severity = 'high'
      reviewRequired = true
    } else if (adultScore > 0.5 || violenceScore > 0.5) {
      action = 'warn'
      severity = 'medium'
    } else if (categories.some((c) => c.score > 0.3)) {
      action = 'warn'
      severity = 'low'
    }

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
        action !== 'allow' ? `Hive detection: ${primaryCategory}` : undefined,
      reviewRequired,
      processingTimeMs: Date.now() - startTime,
      providers: ['hive'],
    }
  }
}

