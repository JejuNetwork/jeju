/**
 * AWS Rekognition Moderation Provider
 * @see https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html
 */

import { z } from 'zod'
import type { CategoryScore, ModerationCategory, ModerationProvider, ModerationResult } from '../types'

const RekognitionResponseSchema = z.object({
  ModerationLabels: z.array(z.object({
    Name: z.string(),
    Confidence: z.number(),
    ParentName: z.string().optional(),
  })),
  ModerationModelVersion: z.string().optional(),
})

const AWS_TO_CATEGORY: Record<string, ModerationCategory> = {
  'Explicit Nudity': 'adult', Nudity: 'adult', 'Graphic Male Nudity': 'adult', 'Graphic Female Nudity': 'adult',
  'Sexual Activity': 'adult', 'Illustrated Explicit Nudity': 'adult', 'Adult Toys': 'adult',
  Suggestive: 'adult', 'Female Swimwear Or Underwear': 'adult', 'Male Swimwear Or Underwear': 'adult',
  'Partial Nudity': 'adult', 'Revealing Clothes': 'adult',
  Violence: 'violence', 'Graphic Violence Or Gore': 'violence', 'Physical Violence': 'violence',
  'Weapon Violence': 'violence', Weapons: 'violence', 'Self Injury': 'self_harm',
  'Hate Symbols': 'hate',
  Drugs: 'drugs', Tobacco: 'drugs', Alcohol: 'drugs', 'Drug Paraphernalia': 'drugs', Pills: 'drugs',
  Gambling: 'spam',
  'Visually Disturbing': 'violence', 'Emaciated Bodies': 'self_harm', Corpses: 'violence',
  Hanging: 'self_harm', 'Air Crash': 'violence', 'Explosions And Blasts': 'violence',
}

export interface AWSRekognitionConfig {
  accessKeyId: string
  secretAccessKey: string
  region?: string
  timeout?: number
  minConfidence?: number
}

export class AWSRekognitionProvider {
  readonly name: ModerationProvider = 'aws_rekognition'
  private accessKeyId: string
  private secretAccessKey: string
  private region: string
  private timeout: number
  private minConfidence: number

  constructor(config: AWSRekognitionConfig) {
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.region = config.region ?? 'us-east-1'
    this.timeout = config.timeout ?? 30000
    this.minConfidence = config.minConfidence ?? 50
  }

  async moderateImage(buf: Buffer): Promise<ModerationResult> {
    const start = Date.now()
    const { headers, body } = await this.sign(buf)

    const res = await fetch(`https://rekognition.${this.region}.amazonaws.com`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!res.ok) throw new Error(`AWS Rekognition error: ${res.status} ${await res.text()}`)
    return this.process(RekognitionResponseSchema.parse(await res.json()), start)
  }

  private async sign(buf: Buffer): Promise<{ headers: Record<string, string>; body: string }> {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const host = `rekognition.${this.region}.amazonaws.com`
    const body = JSON.stringify({ Image: { Bytes: buf.toString('base64') }, MinConfidence: this.minConfidence })

    const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:RekognitionService.DetectModerationLabels\n`
    const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'
    const payloadHash = await this.sha256(body)
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

    const credentialScope = `${dateStamp}/${this.region}/rekognition/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await this.sha256(canonicalRequest)}`

    const signingKey = await this.getSignKey(dateStamp)
    const signature = await this.hmacHex(signingKey, stringToSign)

    return {
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Date': amzDate,
        'X-Amz-Target': 'RekognitionService.DetectModerationLabels',
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
    }
  }

  private async sha256(msg: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async hmac(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
  }

  private async hmacHex(key: ArrayBuffer, msg: string): Promise<string> {
    const sig = await this.hmac(key, msg)
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async getSignKey(dateStamp: string): Promise<ArrayBuffer> {
    const kDate = await this.hmac(new TextEncoder().encode(`AWS4${this.secretAccessKey}`).buffer as ArrayBuffer, dateStamp)
    const kRegion = await this.hmac(kDate, this.region)
    const kService = await this.hmac(kRegion, 'rekognition')
    return this.hmac(kService, 'aws4_request')
  }

  private process(data: z.infer<typeof RekognitionResponseSchema>, start: number): ModerationResult {
    const categories: CategoryScore[] = []
    const maxScores = new Map<ModerationCategory, number>()

    for (const label of data.ModerationLabels) {
      const cat = AWS_TO_CATEGORY[label.Name]
      if (cat) {
        const score = label.Confidence / 100
        const curr = maxScores.get(cat) ?? 0
        if (score > curr) maxScores.set(cat, score)
      }
    }

    for (const [cat, score] of maxScores) {
      categories.push({ category: cat, score, confidence: 0.9, provider: 'aws_rekognition' })
    }

    const adult = maxScores.get('adult') ?? 0
    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'

    if (adult > 0.7) { action = 'warn'; severity = 'low' }

    const primary = categories.length ? categories.reduce((a, b) => a.score > b.score ? a : b).category : undefined

    return {
      safe: action === 'allow',
      action,
      severity,
      categories,
      primaryCategory: primary,
      blockedReason: action !== 'allow' ? `AWS: ${primary}` : undefined,
      reviewRequired: false,
      processingTimeMs: Date.now() - start,
      providers: ['aws_rekognition'],
    }
  }
}
