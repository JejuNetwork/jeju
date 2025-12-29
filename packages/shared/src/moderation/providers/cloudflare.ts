/**
 * Cloudflare Content Moderation Provider
 * @see https://developers.cloudflare.com/workers-ai/models/nsfw-image-classification/
 */

import { z } from 'zod'
import type { CategoryScore, ModerationCategory, ModerationProvider, ModerationResult } from '../types'

const ImageResponseSchema = z.object({
  result: z.array(z.object({ label: z.string(), score: z.number() })).optional(),
  success: z.boolean(),
  errors: z.array(z.string()).optional(),
})

const TextResponseSchema = z.object({
  result: z.object({
    toxic: z.number().optional(),
    severe_toxic: z.number().optional(),
    obscene: z.number().optional(),
    threat: z.number().optional(),
    insult: z.number().optional(),
    identity_hate: z.number().optional(),
  }).optional(),
  success: z.boolean(),
})

const CF_IMAGE_TO_CATEGORY: Record<string, ModerationCategory> = {
  nsfw: 'adult', sexual: 'adult', porn: 'adult', hentai: 'adult', sexy: 'adult',
}

export interface CloudflareProviderConfig {
  accountId: string
  apiToken: string
  timeout?: number
}

export class CloudflareModerationProvider {
  readonly name: ModerationProvider = 'cloudflare'
  private apiToken: string
  private endpoint: string
  private timeout: number

  constructor(config: CloudflareProviderConfig) {
    this.apiToken = config.apiToken
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run`
    this.timeout = config.timeout ?? 30000
  }

  async moderateImage(buf: Buffer): Promise<ModerationResult> {
    const start = Date.now()
    const arr = new Uint8Array(buf.length)
    for (let i = 0; i < buf.length; i++) arr[i] = buf[i]

    const res = await fetch(`${this.endpoint}/@cf/nsfw-image-classification`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/octet-stream' },
      body: arr,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!res.ok) throw new Error(`Cloudflare API error: ${res.status}`)
    const data = ImageResponseSchema.parse(await res.json())
    if (!data.success) throw new Error(`Cloudflare AI failed: ${data.errors?.join(', ')}`)

    return this.processImage(data, start)
  }

  async moderateText(text: string): Promise<ModerationResult> {
    const start = Date.now()
    const res = await fetch(`${this.endpoint}/@cf/toxicity-classification`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!res.ok) {
      console.warn(`[Cloudflare] Text moderation unavailable: ${res.status}`)
      return this.empty(start)
    }

    const parsed = TextResponseSchema.safeParse(await res.json())
    if (!parsed.success || !parsed.data.result) return this.empty(start)
    return this.processText(parsed.data.result, start)
  }

  private processImage(data: z.infer<typeof ImageResponseSchema>, start: number): ModerationResult {
    const categories: CategoryScore[] = []
    let adultScore = 0

    for (const r of data.result ?? []) {
      const cat = CF_IMAGE_TO_CATEGORY[r.label.toLowerCase()]
      if (cat) {
        categories.push({ category: cat, score: r.score, confidence: 0.85, provider: 'cloudflare' })
        if (cat === 'adult') adultScore = Math.max(adultScore, r.score)
      }
    }

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    if (adultScore > 0.7) { action = 'warn'; severity = 'low' }

    return {
      safe: action === 'allow',
      action,
      severity,
      categories,
      primaryCategory: categories[0]?.category,
      blockedReason: action !== 'allow' ? `Cloudflare: adult` : undefined,
      reviewRequired: false,
      processingTimeMs: Date.now() - start,
      providers: ['cloudflare'],
    }
  }

  private processText(result: NonNullable<z.infer<typeof TextResponseSchema>['result']>, start: number): ModerationResult {
    const categories: CategoryScore[] = []
    if (result.obscene && result.obscene > 0.5) categories.push({ category: 'adult', score: result.obscene, confidence: 0.8, provider: 'cloudflare' })
    if (result.threat && result.threat > 0.5) categories.push({ category: 'violence', score: result.threat, confidence: 0.8, provider: 'cloudflare' })
    if (result.identity_hate && result.identity_hate > 0.5) categories.push({ category: 'hate', score: result.identity_hate, confidence: 0.8, provider: 'cloudflare' })

    return {
      safe: true,
      action: 'allow',
      severity: 'none',
      categories,
      reviewRequired: false,
      processingTimeMs: Date.now() - start,
      providers: ['cloudflare'],
    }
  }

  private empty(start: number): ModerationResult {
    return { safe: true, action: 'allow', severity: 'none', categories: [], reviewRequired: false, processingTimeMs: Date.now() - start, providers: ['cloudflare'] }
  }
}
