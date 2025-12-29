/**
 * AWS Rekognition Moderation Provider
 *
 * Integration with AWS Rekognition for image content moderation.
 * Uses DetectModerationLabels API for detecting unsafe content.
 *
 * @see https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html
 */

import { z } from 'zod'
import type {
  CategoryScore,
  ContentType,
  ModerationCategory,
  ModerationProvider,
  ModerationResult,
} from '../types'

// ============ AWS Response Schemas ============

const ModerationLabelSchema = z.object({
  Name: z.string(),
  Confidence: z.number(),
  ParentName: z.string().optional(),
  TaxonomyLevel: z.number().optional(),
})

const RekognitionResponseSchema = z.object({
  ModerationLabels: z.array(ModerationLabelSchema),
  ModerationModelVersion: z.string().optional(),
  ContentTypes: z.array(z.object({
    Name: z.string(),
    Confidence: z.number(),
  })).optional(),
})

// ============ Category Mapping ============

// AWS Rekognition labels mapped to our categories
const AWS_TO_CATEGORY: Record<string, ModerationCategory> = {
  // Explicit content
  'Explicit Nudity': 'adult',
  'Nudity': 'adult',
  'Graphic Male Nudity': 'adult',
  'Graphic Female Nudity': 'adult',
  'Sexual Activity': 'adult',
  'Illustrated Explicit Nudity': 'adult',
  'Adult Toys': 'adult',
  
  // Suggestive
  'Suggestive': 'adult',
  'Female Swimwear Or Underwear': 'adult',
  'Male Swimwear Or Underwear': 'adult',
  'Partial Nudity': 'adult',
  'Revealing Clothes': 'adult',
  
  // Violence
  'Violence': 'violence',
  'Graphic Violence Or Gore': 'violence',
  'Physical Violence': 'violence',
  'Weapon Violence': 'violence',
  'Weapons': 'violence',
  'Self Injury': 'self_harm',
  
  // Hate
  'Hate Symbols': 'hate',
  
  // Drugs
  'Drugs': 'drugs',
  'Tobacco': 'drugs',
  'Alcohol': 'drugs',
  'Drug Paraphernalia': 'drugs',
  'Pills': 'drugs',
  
  // Gambling (map to spam for our purposes)
  'Gambling': 'spam',
  
  // Visually disturbing
  'Visually Disturbing': 'violence',
  'Emaciated Bodies': 'self_harm',
  'Corpses': 'violence',
  'Hanging': 'self_harm',
  'Air Crash': 'violence',
  'Explosions And Blasts': 'violence',
}

// ============ Provider Implementation ============

export interface AWSRekognitionConfig {
  accessKeyId: string
  secretAccessKey: string
  region?: string
  endpoint?: string
  timeout?: number
  minConfidence?: number
}

export class AWSRekognitionProvider {
  readonly name: ModerationProvider = 'aws_rekognition'
  readonly supportedTypes: ContentType[] = ['image']

  private accessKeyId: string
  private secretAccessKey: string
  private region: string
  private endpoint: string
  private timeout: number
  private minConfidence: number

  constructor(config: AWSRekognitionConfig) {
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.region = config.region ?? 'us-east-1'
    this.endpoint =
      config.endpoint ?? `https://rekognition.${this.region}.amazonaws.com`
    this.timeout = config.timeout ?? 30000
    this.minConfidence = config.minConfidence ?? 50
  }

  async moderateImage(imageBuffer: Buffer): Promise<ModerationResult> {
    const startTime = Date.now()

    // Create AWS signature
    const { headers, body } = await this.createSignedRequest(imageBuffer)

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`AWS Rekognition error: ${response.status} ${errorText}`)
    }

    const rawData: unknown = await response.json()
    const parseResult = RekognitionResponseSchema.safeParse(rawData)

    if (!parseResult.success) {
      throw new Error(`Invalid AWS response: ${parseResult.error.message}`)
    }

    return this.processResponse(parseResult.data, startTime)
  }

  private async createSignedRequest(
    imageBuffer: Buffer
  ): Promise<{ headers: Record<string, string>; body: string }> {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    
    const requestBody = JSON.stringify({
      Image: {
        Bytes: imageBuffer.toString('base64'),
      },
      MinConfidence: this.minConfidence,
    })

    const service = 'rekognition'
    const host = `rekognition.${this.region}.amazonaws.com`
    const contentType = 'application/x-amz-json-1.1'
    const amzTarget = 'RekognitionService.DetectModerationLabels'

    // Create canonical request
    const canonicalUri = '/'
    const canonicalQueryString = ''
    const canonicalHeaders = [
      `content-type:${contentType}`,
      `host:${host}`,
      `x-amz-date:${amzDate}`,
      `x-amz-target:${amzTarget}`,
    ].join('\n') + '\n'
    const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'

    // Hash the payload
    const payloadHash = await this.sha256(requestBody)

    const canonicalRequest = [
      'POST',
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256'
    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`
    const canonicalRequestHash = await this.sha256(canonicalRequest)
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join('\n')

    // Calculate signature
    const signingKey = await this.getSignatureKey(
      this.secretAccessKey,
      dateStamp,
      this.region,
      service
    )
    const signature = await this.hmacSha256Hex(signingKey, stringToSign)

    const authorizationHeader = [
      `${algorithm} Credential=${this.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ')

    return {
      headers: {
        'Content-Type': contentType,
        'X-Amz-Date': amzDate,
        'X-Amz-Target': amzTarget,
        Authorization: authorizationHeader,
      },
      body: requestBody,
    }
  }

  private async sha256(message: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async hmacSha256(
    key: ArrayBuffer | Uint8Array,
    message: string
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    // Ensure we have a proper ArrayBuffer for importKey
    const keyBuffer = key instanceof ArrayBuffer ? key : new Uint8Array(key).buffer
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  }

  private async hmacSha256Hex(
    key: ArrayBuffer | Uint8Array,
    message: string
  ): Promise<string> {
    const sig = await this.hmacSha256(key, message)
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async getSignatureKey(
    key: string,
    dateStamp: string,
    region: string,
    service: string
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    const kDate = await this.hmacSha256(
      encoder.encode(`AWS4${key}`),
      dateStamp
    )
    const kRegion = await this.hmacSha256(kDate, region)
    const kService = await this.hmacSha256(kRegion, service)
    return this.hmacSha256(kService, 'aws4_request')
  }

  private processResponse(
    data: z.infer<typeof RekognitionResponseSchema>,
    startTime: number
  ): ModerationResult {
    const categories: CategoryScore[] = []
    const categoryMaxScores = new Map<ModerationCategory, number>()

    // Process all moderation labels
    for (const label of data.ModerationLabels) {
      const category = AWS_TO_CATEGORY[label.Name]
      if (category) {
        const score = label.Confidence / 100 // Convert to 0-1
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
        confidence: 0.9,
        provider: 'aws_rekognition',
      })
    }

    // Determine action
    const adultScore = categoryMaxScores.get('adult') ?? 0
    const violenceScore = categoryMaxScores.get('violence') ?? 0
    const hateScore = categoryMaxScores.get('hate') ?? 0
    const selfHarmScore = categoryMaxScores.get('self_harm') ?? 0

    let action: ModerationResult['action'] = 'allow'
    let severity: ModerationResult['severity'] = 'none'
    let reviewRequired = false

    // Note: AWS doesn't directly detect CSAM - combine with other providers
    if (adultScore > 0.9 || violenceScore > 0.9 || hateScore > 0.9) {
      action = 'block'
      severity = 'high'
      reviewRequired = true
    } else if (selfHarmScore > 0.8) {
      action = 'block'
      severity = 'high'
      reviewRequired = true
    } else if (adultScore > 0.7 || violenceScore > 0.7) {
      action = 'warn'
      severity = 'medium'
    } else if (categories.some((c) => c.score > 0.5)) {
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
        action !== 'allow' ? `AWS detection: ${primaryCategory}` : undefined,
      reviewRequired,
      processingTimeMs: Date.now() - startTime,
      providers: ['aws_rekognition'],
    }
  }
}

