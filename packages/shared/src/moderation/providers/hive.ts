/**
 * Hive Moderation Provider - Free speech, CSAM detection only
 * @see https://docs.thehive.ai/docs/moderation
 */

import { z } from 'zod'
import type {
  CategoryScore,
  ModerationCategory,
  ModerationProvider,
  ModerationResult,
} from '../types'

const HiveResponseSchema = z.object({
  status: z.array(z.object({ code: z.number(), description: z.string() })),
  output: z
    .array(
      z.object({
        classes: z.array(z.object({ class: z.string(), score: z.number() })),
      }),
    )
    .optional(),
})

const HIVE_TO_CATEGORY: Record<string, ModerationCategory> = {
  sexual_display: 'adult',
  sexual_activity: 'adult',
  sex_toy: 'adult',
  suggestive: 'adult',
  yes_minor: 'csam',
  yes_sexual_minor: 'csam',
  very_bloody: 'violence',
  human_corpse: 'violence',
  hanging: 'violence',
  nazi: 'hate',
  confederate: 'hate',
  supremacist: 'hate',
  self_harm: 'self_harm',
  pills: 'drugs',
  drug_use: 'drugs',
  smoking: 'drugs',
  spam: 'spam',
}

export interface HiveProviderConfig {
  apiKey: string
  endpoint?: string
  timeout?: number
}

export class HiveModerationProvider {
  readonly name: ModerationProvider = 'hive'
  private apiKey: string
  private endpoint: string
  private timeout: number

  constructor(config: HiveProviderConfig) {
    this.apiKey = config.apiKey
    this.endpoint = config.endpoint ?? 'https://api.thehive.ai/api/v2/task/sync'
    this.timeout = config.timeout ?? 30000
  }

  async moderateImage(buf: Buffer): Promise<ModerationResult> {
    const start = Date.now()
    const form = new FormData()
    const arr = new Uint8Array(buf.length)
    for (let i = 0; i < buf.length; i++) arr[i] = buf[i]
    form.append('media', new Blob([arr]), 'image.jpg')

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        Accept: 'application/json',
      },
      body: form,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!res.ok) throw new Error(`Hive API error: ${res.status}`)
    return this.process(HiveResponseSchema.parse(await res.json()), start)
  }

  async moderateText(text: string): Promise<ModerationResult> {
    const start = Date.now()
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text_data: text }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!res.ok) throw new Error(`Hive API error: ${res.status}`)
    return this.process(HiveResponseSchema.parse(await res.json()), start)
  }

  private process(
    data: z.infer<typeof HiveResponseSchema>,
    start: number,
  ): ModerationResult {
    const categories: CategoryScore[] = []
    const maxScores = new Map<ModerationCategory, number>()

    for (const output of data.output ?? []) {
      for (const cls of output.classes) {
        const cat = HIVE_TO_CATEGORY[cls.class]
        if (cat) {
          const curr = maxScores.get(cat) ?? 0
          if (cls.score > curr) maxScores.set(cat, cls.score)
        }
      }
    }

    for (const [cat, score] of maxScores) {
      categories.push({
        category: cat,
        score,
        confidence: 0.95,
        provider: 'hive',
      })
    }

    const csam = maxScores.get('csam') ?? 0
    const adult = maxScores.get('adult') ?? 0

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let review = false

    if (csam > 0.3) {
      action = 'ban'
      severity = 'critical'
      review = true
    } else if (adult > 0.7) {
      action = 'warn'
      severity = 'low'
    }

    const primary = categories.length
      ? categories.reduce((a, b) => (a.score > b.score ? a : b)).category
      : undefined

    return {
      safe: action === 'allow',
      action,
      severity,
      categories,
      primaryCategory: primary,
      blockedReason: action !== 'allow' ? `Hive: ${primary}` : undefined,
      reviewRequired: review,
      processingTimeMs: Date.now() - start,
      providers: ['hive'],
    }
  }
}
