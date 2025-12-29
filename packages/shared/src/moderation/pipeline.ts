/**
 * Content Moderation Pipeline
 *
 * POLICY: Free speech. Only CSAM is blocked, adult content is tagged.
 *
 * Text: CSAM keywords → AI verification → manual review queue
 * Image: Hash check → NSFW tag → CSAM AI check
 */

import { logger } from '../logger'
import type { Address } from 'viem'
import { HashModerationProvider, type HashProviderConfig } from './providers/hash'
import { LocalModerationProvider, type LocalProviderConfig } from './providers/local'
import { NSFWDetectionProvider, type NSFWProviderConfig, needsCsamVerification } from './providers/nsfw'
import type {
  CategoryScore,
  ModerationCategory,
  ModerationProvider,
  ModerationRequest,
  ModerationResult,
} from './types'
import { OpenAIModerationProvider, type OpenAIModerationConfig } from './providers/openai'
import { HiveModerationProvider, type HiveProviderConfig } from './providers/hive'
import { AWSRekognitionProvider, type AWSRekognitionConfig } from './providers/aws-rekognition'

// Thresholds - only CSAM and adult matter
const CSAM_THRESHOLD = 0.01
const ADULT_THRESHOLD = 0.6

export type ReputationTier = 'new' | 'basic' | 'trusted' | 'verified' | 'elite'

export interface ReputationProvider {
  getReputation(address: Address): Promise<{ tier: ReputationTier; violations: number }>
  recordViolation(address: Address, category: ModerationCategory): Promise<void>
}

export interface PipelineConfig {
  local?: LocalProviderConfig
  hash?: HashProviderConfig
  nsfw?: NSFWProviderConfig
  openai?: OpenAIModerationConfig
  hive?: HiveProviderConfig
  awsRekognition?: AWSRekognitionConfig
  reputationProvider?: ReputationProvider
}

export class ContentModerationPipeline {
  private config: PipelineConfig
  private localProvider: LocalModerationProvider
  private hashProvider: HashModerationProvider
  private nsfwProvider: NSFWDetectionProvider
  private openaiProvider?: OpenAIModerationProvider
  private hiveProvider?: HiveModerationProvider
  private awsProvider?: AWSRekognitionProvider

  constructor(config: PipelineConfig = {}) {
    this.config = config
    this.localProvider = new LocalModerationProvider(config.local)
    this.hashProvider = new HashModerationProvider(config.hash)
    this.nsfwProvider = new NSFWDetectionProvider(config.nsfw)

    if (config.openai?.apiKey) {
      this.openaiProvider = new OpenAIModerationProvider(config.openai)
    }
    if (config.hive?.apiKey) {
      this.hiveProvider = new HiveModerationProvider(config.hive)
    }
    if (config.awsRekognition?.accessKeyId) {
      this.awsProvider = new AWSRekognitionProvider(config.awsRekognition)
    }
  }

  async initialize(): Promise<void> {
    await this.hashProvider.initialize()
    logger.info('[ModerationPipeline] Initialized - Free speech, CSAM detection only')
  }

  async moderate(request: ModerationRequest): Promise<ModerationResult> {
    const start = Date.now()
    const categories: CategoryScore[] = []
    const providers: ModerationProvider[] = []

    // Hash check for known CSAM (instant)
    if (Buffer.isBuffer(request.content)) {
      const hashResult = await this.hashProvider.moderate(request.content)
      providers.push('hash')
      categories.push(...hashResult.categories)
      if (hashResult.categories.some(c => c.category === 'csam')) {
        return this.csamResult(categories, providers, start, request.senderAddress)
      }
    }

    // Route by content type
    if (typeof request.content === 'string' || request.contentType === 'text') {
      const text = typeof request.content === 'string' ? request.content : request.content.toString('utf-8')
      return this.moderateText(text, categories, providers, start, request.senderAddress)
    }

    if (Buffer.isBuffer(request.content) && request.contentType === 'image') {
      return this.moderateImage(request.content, categories, providers, start, request.senderAddress)
    }

    return this.allowResult(categories, providers, start)
  }

  private async moderateText(
    text: string,
    categories: CategoryScore[],
    providers: ModerationProvider[],
    start: number,
    sender?: Address
  ): Promise<ModerationResult> {
    const result = await this.localProvider.moderate(text)
    providers.push('local')
    categories.push(...result.categories)

    if (!result.categories.some(c => c.category === 'csam')) {
      return this.allowResult(categories, providers, start)
    }

    // CSAM keywords found - verify with AI
    if (this.openaiProvider) {
      const ai = await this.openaiProvider.moderateText(text).catch(err => {
        logger.warn('[ModerationPipeline] OpenAI failed', { error: String(err) })
        return null
      })
      if (ai) {
        providers.push('openai')
        categories.push(...ai.categories)
        if (ai.categories.some(c => c.category === 'csam' && c.score > 0.5)) {
          return this.csamResult(categories, providers, start, sender)
        }
      }
    }

    // Queue for manual review
    return {
      safe: false,
      action: 'queue',
      severity: 'medium',
      categories,
      primaryCategory: 'csam',
      blockedReason: 'Flagged for manual review',
      reviewRequired: true,
      processingTimeMs: Date.now() - start,
      providers,
    }
  }

  private async moderateImage(
    buffer: Buffer,
    categories: CategoryScore[],
    providers: ModerationProvider[],
    start: number,
    sender?: Address
  ): Promise<ModerationResult> {
    const nsfw = await this.nsfwProvider.moderateImage(buffer)
    providers.push('nsfw_local')
    categories.push(...nsfw.categories)

    if (needsCsamVerification(nsfw)) {
      // AI CSAM check
      for (const [provider, api] of [
        ['hive', this.hiveProvider] as const,
        ['aws-rekognition', this.awsProvider] as const,
      ]) {
        if (!api) continue
        const result = await api.moderateImage(buffer).catch(err => {
          logger.warn(`[ModerationPipeline] ${provider} failed`, { error: String(err) })
          return null
        })
        if (result) {
          providers.push(provider)
          categories.push(...result.categories)
          if (result.categories.some(c => c.category === 'csam' && c.score > 0.3)) {
            return this.csamResult(categories, providers, start, sender)
          }
        }
      }
    }

    // Tag adult content
    const adult = categories.find(c => c.category === 'adult')
    if (adult && adult.score >= ADULT_THRESHOLD) {
      return {
        safe: true,
        action: 'warn',
        severity: 'low',
        categories,
        primaryCategory: 'adult',
        reviewRequired: false,
        processingTimeMs: Date.now() - start,
        providers,
      }
    }

    return this.allowResult(categories, providers, start)
  }

  private allowResult(categories: CategoryScore[], providers: ModerationProvider[], start: number): ModerationResult {
    return {
      safe: true,
      action: 'allow',
      severity: 'none',
      categories,
      reviewRequired: false,
      processingTimeMs: Date.now() - start,
      providers,
    }
  }

  private csamResult(categories: CategoryScore[], providers: ModerationProvider[], start: number, sender?: Address): ModerationResult {
    if (sender && this.config.reputationProvider) {
      this.config.reputationProvider.recordViolation(sender, 'csam').catch(console.error)
    }
    return {
      safe: false,
      action: 'ban',
      severity: 'critical',
      categories,
      primaryCategory: 'csam',
      blockedReason: 'CSAM detected',
      reviewRequired: true,
      processingTimeMs: Date.now() - start,
      providers: [...new Set(providers)],
    }
  }

  async quickCheck(text: string): Promise<ModerationResult> {
    return this.localProvider.moderate(text)
  }

  addCsamHash(hash: string, description?: string): void {
    this.hashProvider.addHash(hash, 'csam', description)
  }

  getStats() {
    return {
      mode: 'free-speech',
      csamThreshold: CSAM_THRESHOLD,
      adultThreshold: ADULT_THRESHOLD,
      providers: {
        openai: !!this.openaiProvider,
        hive: !!this.hiveProvider,
        aws: !!this.awsProvider,
      },
    }
  }
}

// Singleton
let instance: ContentModerationPipeline | null = null

export function getContentModerationPipeline(): ContentModerationPipeline {
  if (!instance) {
    instance = new ContentModerationPipeline({
      openai: process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : undefined,
      hive: process.env.HIVE_API_KEY ? { apiKey: process.env.HIVE_API_KEY } : undefined,
      awsRekognition: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, region: process.env.AWS_REGION ?? 'us-east-1' }
        : undefined,
    })
  }
  return instance
}

export function createContentModerationPipeline(config: PipelineConfig): ContentModerationPipeline {
  return new ContentModerationPipeline(config)
}

export function resetContentModerationPipeline(): void {
  instance = null
}

export const NEVER_BYPASS_CATEGORIES: readonly ModerationCategory[] = ['csam'] as const
