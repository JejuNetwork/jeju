/**
 * Cloudflare Content Moderation Provider
 *
 * Integration with Cloudflare Images and Workers AI for content moderation.
 * Uses nsfw-image-classification model for visual content.
 *
 * @see https://developers.cloudflare.com/workers-ai/models/nsfw-image-classification/
 */

import { z } from 'zod'
import type {
  CategoryScore,
  ContentType,
  ModerationCategory,
  ModerationProvider,
  ModerationResult,
} from '../types'

// ============ Cloudflare Response Schemas ============

const ClassificationResultSchema = z.object({
  label: z.string(),
  score: z.number(),
})

const CloudflareAIResponseSchema = z.object({
  result: z.array(ClassificationResultSchema).optional(),
  success: z.boolean(),
  errors: z.array(z.string()).optional(),
})

// For text classification (toxicity model)
const TextClassificationSchema = z.object({
  result: z.object({
    toxic: z.number().optional(),
    severe_toxic: z.number().optional(),
    obscene: z.number().optional(),
    threat: z.number().optional(),
    insult: z.number().optional(),
    identity_hate: z.number().optional(),
  }).optional(),
  success: z.boolean(),
  errors: z.array(z.string()).optional(),
})

// ============ Category Mapping ============

const CF_IMAGE_TO_CATEGORY: Record<string, ModerationCategory> = {
  nsfw: 'adult',
  sexual: 'adult',
  porn: 'adult',
  hentai: 'adult',
  sexy: 'adult',
  drawing: 'clean', // Drawings are generally safe unless combined with other labels
  neutral: 'clean',
}

// ============ Provider Implementation ============

export interface CloudflareProviderConfig {
  accountId: string
  apiToken: string
  endpoint?: string
  timeout?: number
  imageModel?: string
  textModel?: string
}

export class CloudflareModerationProvider {
  readonly name: ModerationProvider = 'cloudflare'
  readonly supportedTypes: ContentType[] = ['image', 'text']

  private apiToken: string
  private endpoint: string
  private timeout: number

  constructor(config: CloudflareProviderConfig) {
    this.apiToken = config.apiToken
    this.endpoint =
      config.endpoint ??
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run`
    this.timeout = config.timeout ?? 30000
  }

  async moderateImage(imageBuffer: Buffer): Promise<ModerationResult> {
    const startTime = Date.now()

    // Use NSFW classification model
    // Create a proper Uint8Array copy for fetch
    const uint8Array = new Uint8Array(imageBuffer.length)
    for (let i = 0; i < imageBuffer.length; i++) {
      uint8Array[i] = imageBuffer[i]
    }
    const response = await fetch(
      `${this.endpoint}/@cf/nsfw-image-classification`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: uint8Array,
        signal: AbortSignal.timeout(this.timeout),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Cloudflare API error: ${response.status} ${errorText}`)
    }

    const rawData: unknown = await response.json()
    const parseResult = CloudflareAIResponseSchema.safeParse(rawData)

    if (!parseResult.success) {
      throw new Error(`Invalid Cloudflare response: ${parseResult.error.message}`)
    }

    const data = parseResult.data
    if (!data.success) {
      throw new Error(`Cloudflare AI failed: ${data.errors?.join(', ')}`)
    }

    return this.processImageResponse(data, startTime)
  }

  async moderateText(text: string): Promise<ModerationResult> {
    const startTime = Date.now()

    // Use toxicity classification model
    const response = await fetch(
      `${this.endpoint}/@cf/toxicity-classification`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(this.timeout),
      }
    )

    if (!response.ok) {
      // Fallback: Cloudflare might not have toxicity model available
      // Return empty result rather than failing
      console.warn(
        `[Cloudflare] Text moderation unavailable: ${response.status}`
      )
      return {
        safe: true,
        action: 'allow',
        severity: 'none',
        categories: [],
        reviewRequired: false,
        processingTimeMs: Date.now() - startTime,
        providers: ['cloudflare'],
      }
    }

    const rawData: unknown = await response.json()
    const parseResult = TextClassificationSchema.safeParse(rawData)

    if (!parseResult.success || !parseResult.data.result) {
      // Return neutral result if parsing fails
      return {
        safe: true,
        action: 'allow',
        severity: 'none',
        categories: [],
        reviewRequired: false,
        processingTimeMs: Date.now() - startTime,
        providers: ['cloudflare'],
      }
    }

    return this.processTextResponse(parseResult.data.result, startTime)
  }

  private processImageResponse(
    data: z.infer<typeof CloudflareAIResponseSchema>,
    startTime: number
  ): ModerationResult {
    const categories: CategoryScore[] = []
    const categoryMaxScores = new Map<ModerationCategory, number>()

    // Process classification results
    for (const result of data.result ?? []) {
      const category = CF_IMAGE_TO_CATEGORY[result.label.toLowerCase()]
      if (category && category !== 'clean') {
        const existing = categoryMaxScores.get(category) ?? 0
        if (result.score > existing) {
          categoryMaxScores.set(category, result.score)
        }
      }
    }

    // Build category scores
    for (const [category, score] of categoryMaxScores) {
      categories.push({
        category,
        score,
        confidence: 0.85,
        provider: 'cloudflare',
      })
    }

    // Determine action
    const adultScore = categoryMaxScores.get('adult') ?? 0

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let reviewRequired = false

    if (adultScore > 0.9) {
      action = 'block'
      severity = 'high'
      reviewRequired = true
    } else if (adultScore > 0.7) {
      action = 'warn'
      severity = 'medium'
    } else if (adultScore > 0.5) {
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
        action !== 'allow' ? `Cloudflare detection: ${primaryCategory}` : undefined,
      reviewRequired,
      processingTimeMs: Date.now() - startTime,
      providers: ['cloudflare'],
    }
  }

  private processTextResponse(
    result: NonNullable<z.infer<typeof TextClassificationSchema>['result']>,
    startTime: number
  ): ModerationResult {
    const categories: CategoryScore[] = []
    const categoryMaxScores = new Map<ModerationCategory, number>()

    // Map toxicity scores to categories
    if (result.toxic && result.toxic > 0.5) {
      categoryMaxScores.set('harassment', result.toxic)
    }
    if (result.severe_toxic && result.severe_toxic > 0.5) {
      categoryMaxScores.set('harassment', 
        Math.max(result.severe_toxic, categoryMaxScores.get('harassment') ?? 0))
    }
    if (result.obscene && result.obscene > 0.5) {
      categoryMaxScores.set('adult', result.obscene)
    }
    if (result.threat && result.threat > 0.5) {
      categoryMaxScores.set('violence', result.threat)
    }
    if (result.insult && result.insult > 0.5) {
      categoryMaxScores.set('harassment', 
        Math.max(result.insult, categoryMaxScores.get('harassment') ?? 0))
    }
    if (result.identity_hate && result.identity_hate > 0.5) {
      categoryMaxScores.set('hate', result.identity_hate)
    }

    // Build category scores
    for (const [category, score] of categoryMaxScores) {
      categories.push({
        category,
        score,
        confidence: 0.8,
        provider: 'cloudflare',
      })
    }

    // Determine action
    const maxScore = Math.max(...categoryMaxScores.values(), 0)
    
    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let reviewRequired = false

    if (maxScore > 0.9) {
      action = 'block'
      severity = 'high'
      reviewRequired = true
    } else if (maxScore > 0.7) {
      action = 'warn'
      severity = 'medium'
    } else if (maxScore > 0.5) {
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
        action !== 'allow' ? `Cloudflare detection: ${primaryCategory}` : undefined,
      reviewRequired,
      processingTimeMs: Date.now() - startTime,
      providers: ['cloudflare'],
    }
  }
}

