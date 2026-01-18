/**
 * Content Moderation Pipeline
 *
 * POLICY: Free speech. Only CSAM is blocked, adult content is tagged.
 *
 * Text: CSAM keywords → AI verification → manual review queue
 * Image: Hash check → NSFW tag → CSAM AI check
 *
 * CSAM Detection triggers:
 * 1. Content block (immediate)
 * 2. User ban (immediate)
 * 3. NCMEC/IWF report (mandatory per UK/US law)
 *
 * @see UK Voluntary Guidance for Internet Infrastructure Providers on CSEA
 */

import type { Address } from 'viem'
import { logger } from '../logger'
import {
  HashModerationProvider,
  type HashProviderConfig,
} from './providers/hash'
import {
  HiveModerationProvider,
  type HiveProviderConfig,
} from './providers/hive'
import {
  LocalModerationProvider,
  type LocalProviderConfig,
} from './providers/local'
import {
  NSFWDetectionProvider,
  type NSFWProviderConfig,
  needsCsamVerification,
} from './providers/nsfw'
import {
  type OpenAIModerationConfig,
  OpenAIModerationProvider,
} from './providers/openai'
import { CSAMReportingService, type ReportingConfig } from './reporting'
import { recordMetric } from './transparency'
import type {
  CategoryScore,
  ModerationCategory,
  ModerationProvider,
  ModerationRequest,
  ModerationResult,
} from './types'

async function sha256(buffer: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const ADULT_THRESHOLD = 0.6

export type ReputationTier = 'new' | 'basic' | 'trusted' | 'verified' | 'elite'

export interface ReputationProvider {
  getReputation(
    address: Address,
  ): Promise<{ tier: ReputationTier; violations: number }>
  recordViolation(address: Address, category: ModerationCategory): Promise<void>
}

export interface QueuedContent {
  content: Buffer | string
  contentType: 'text' | 'image'
  senderAddress?: Address
  result: ModerationResult
  timestamp: number
}

export interface PipelineConfig {
  local?: LocalProviderConfig
  hash?: HashProviderConfig
  nsfw?: NSFWProviderConfig
  openai?: OpenAIModerationConfig
  hive?: HiveProviderConfig
  reputationProvider?: ReputationProvider
  /** NCMEC/IWF reporting config (MANDATORY for production) */
  reporting?: ReportingConfig
  /** Callback when content is queued for review. If not set, queued content is logged only. */
  onQueue?: (item: QueuedContent) => void | Promise<void>
}

export class ContentModerationPipeline {
  private config: PipelineConfig
  private localProvider: LocalModerationProvider
  private hashProvider: HashModerationProvider
  private nsfwProvider: NSFWDetectionProvider
  private openaiProvider?: OpenAIModerationProvider
  private hiveProvider?: HiveModerationProvider
  private reportingService: CSAMReportingService

  constructor(config: PipelineConfig = {}) {
    this.config = config
    this.localProvider = new LocalModerationProvider(config.local)
    this.hashProvider = new HashModerationProvider(config.hash)
    this.nsfwProvider = new NSFWDetectionProvider(config.nsfw)
    this.reportingService = new CSAMReportingService(config.reporting)

    if (config.openai?.apiKey) {
      this.openaiProvider = new OpenAIModerationProvider(config.openai)
    }
    if (config.hive?.apiKey) {
      this.hiveProvider = new HiveModerationProvider(config.hive)
    }
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.hashProvider.initialize(),
      this.nsfwProvider.initialize(),
      this.reportingService.initialize(),
    ])

    const stats = this.hashProvider.getStats()
    const hasImageCsam = !!this.hiveProvider
    const hasTextCsam = !!this.openaiProvider
    const hasHashDb = stats.csamCount > 0 || stats.phashCount > 0
    const hasReporting = !!(
      this.config.reporting?.ncmec || this.config.reporting?.iwf
    )

    if (!hasImageCsam) {
      logger.warn(
        '[ModerationPipeline] No image CSAM AI configured. Set HIVE_API_KEY.',
      )
    }
    if (!hasTextCsam) {
      logger.warn(
        '[ModerationPipeline] No text CSAM AI configured. Set OPENAI_API_KEY.',
      )
    }
    if (!hasHashDb) {
      logger.warn(
        '[ModerationPipeline] No CSAM hash database loaded. Set CSAM_HASH_LIST_PATH to path of hash file.',
      )
    }
    if (!hasReporting && !this.config.reporting?.dryRun) {
      logger.error(
        '[ModerationPipeline] COMPLIANCE WARNING: No NCMEC/IWF reporting configured!',
      )
      logger.error(
        '[ModerationPipeline] Set NCMEC_USERNAME/NCMEC_PASSWORD or IWF_API_KEY for mandatory CSAM reporting.',
      )
    }

    logger.info('[ModerationPipeline] Initialized', {
      mode: 'free-speech',
      imageCsam: hasImageCsam,
      textCsam: hasTextCsam,
      hashCount: stats.csamCount,
      phashCount: stats.phashCount,
      nsfwModel: true,
      reporting: hasReporting ? 'configured' : 'MISSING',
    })
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
      if (hashResult.categories.some((c) => c.category === 'csam')) {
        const contentHash = await sha256(request.content)
        return this.csamResult(
          categories,
          providers,
          start,
          request.senderAddress,
          contentHash,
          'image',
        )
      }
    }

    // Route by content type
    if (typeof request.content === 'string' || request.contentType === 'text') {
      const text =
        typeof request.content === 'string'
          ? request.content
          : request.content.toString('utf-8')
      return this.moderateText(
        text,
        categories,
        providers,
        start,
        request.senderAddress,
      )
    }

    if (Buffer.isBuffer(request.content) && request.contentType === 'image') {
      return this.moderateImage(
        request.content,
        categories,
        providers,
        start,
        request.senderAddress,
      )
    }

    return this.allowResult(categories, providers, start)
  }

  private async moderateText(
    text: string,
    categories: CategoryScore[],
    providers: ModerationProvider[],
    start: number,
    sender?: Address,
  ): Promise<ModerationResult> {
    const result = await this.localProvider.moderate(text)
    providers.push('local')
    categories.push(...result.categories)

    if (!result.categories.some((c) => c.category === 'csam')) {
      return this.allowResult(categories, providers, start)
    }

    // CSAM keywords found - verify with AI
    if (this.openaiProvider) {
      const ai = await this.openaiProvider.moderateText(text).catch((err) => {
        logger.warn('[ModerationPipeline] OpenAI failed', {
          error: String(err),
        })
        return null
      })
      if (ai) {
        providers.push('openai')
        categories.push(...ai.categories)
        if (ai.categories.some((c) => c.category === 'csam' && c.score > 0.5)) {
          const textHash = await sha256(Buffer.from(text, 'utf-8'))
          return this.csamResult(
            categories,
            providers,
            start,
            sender,
            textHash,
            'text',
          )
        }
      }
    }

    // Queue for manual review
    const queueResult: ModerationResult = {
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

    // Notify queue handler if configured
    if (this.config.onQueue) {
      try {
        await this.config.onQueue({
          content: text,
          contentType: 'text',
          senderAddress: sender,
          result: queueResult,
          timestamp: Date.now(),
        })
      } catch (err) {
        logger.warn('[ModerationPipeline] onQueue callback failed', {
          error: String(err),
        })
      }
    } else {
      logger.warn(
        '[ModerationPipeline] Content queued but no onQueue handler configured',
        {
          primaryCategory: 'csam',
          sender: sender ?? 'unknown',
        },
      )
    }

    return queueResult
  }

  private async moderateImage(
    buffer: Buffer,
    categories: CategoryScore[],
    providers: ModerationProvider[],
    start: number,
    sender?: Address,
  ): Promise<ModerationResult> {
    // Local NSFW detection using nsfwjs
    const nsfw = await this.nsfwProvider.moderateImage(buffer)
    providers.push('nsfw_local')
    categories.push(...nsfw.categories)

    // If NSFW detected locally, flag for further handling
    const nsfwDetected = nsfw.categories.some(
      (c) => c.category === 'adult' && c.score > 0.5,
    )
    if (nsfwDetected) {
      const adultScore =
        nsfw.categories.find((c) => c.category === 'adult')?.score ?? 0
      logger.info('[ModerationPipeline] NSFW detected locally', {
        score: adultScore,
      })
    }

    // CSAM verification via external AI (Hive/OpenAI)
    if (needsCsamVerification(nsfw) || nsfwDetected) {
      for (const [provider, api] of [['hive', this.hiveProvider] as const]) {
        if (!api) continue
        const result = await api.moderateImage(buffer).catch((err) => {
          logger.warn(`[ModerationPipeline] ${provider} failed`, {
            error: String(err),
          })
          return null
        })
        if (result) {
          providers.push(provider)
          categories.push(...result.categories)

          // CSAM confirmed by external AI - add to hash database and report
          if (
            result.categories.some(
              (c) => c.category === 'csam' && c.score > 0.3,
            )
          ) {
            await this.hashProvider.addBannedImage(
              buffer,
              'csam',
              `Detected by ${provider}`,
            )
            const imageHash = await sha256(buffer)
            return this.csamResult(
              categories,
              providers,
              start,
              sender,
              imageHash,
              'image',
            )
          }
        }
      }
    }

    // Tag adult content
    const adult = categories.find((c) => c.category === 'adult')
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

  private allowResult(
    categories: CategoryScore[],
    providers: ModerationProvider[],
    start: number,
  ): ModerationResult {
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

  private async csamResult(
    categories: CategoryScore[],
    providers: ModerationProvider[],
    start: number,
    sender?: Address,
    contentHash?: string,
    contentType: 'image' | 'text' = 'image',
  ): Promise<ModerationResult> {
    const processingTimeMs = Date.now() - start

    // Record reputation violation
    if (sender && this.config.reputationProvider) {
      this.config.reputationProvider
        .recordViolation(sender, 'csam')
        .catch(console.error)
    }

    // MANDATORY: Report to authorities (NCMEC/IWF)
    if (contentHash) {
      this.reportingService
        .createReport({
          contentHash,
          contentType,
          detectionMethod: providers.includes('hash') ? 'hash' : 'ai',
          confidence:
            categories.find((c) => c.category === 'csam')?.score ?? 0.9,
          uploaderAddress: sender,
          service: 'moderation-pipeline',
        })
        .catch((err) => {
          logger.error('[ModerationPipeline] CSAM reporting failed', {
            error: String(err),
          })
        })
    }

    // Record metric for transparency
    recordMetric({
      contentType,
      action: 'report',
      detectionMethod: providers.includes('hash') ? 'hash' : 'ai',
      processingTimeMs,
      csamReported: true,
      csamReportTarget: this.config.reporting?.ncmec ? 'ncmec' : 'iwf',
    })

    return {
      safe: false,
      action: 'ban',
      severity: 'critical',
      categories,
      primaryCategory: 'csam',
      blockedReason: 'CSAM detected - reported to authorities',
      reviewRequired: true,
      processingTimeMs,
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
      adultThreshold: ADULT_THRESHOLD,
      providers: {
        openai: !!this.openaiProvider,
        hive: !!this.hiveProvider,
      },
    }
  }
}

// Singleton
let instance: ContentModerationPipeline | null = null

export function getContentModerationPipeline(): ContentModerationPipeline {
  if (!instance) {
    instance = new ContentModerationPipeline({
      hash: {
        csamHashListPath: process.env.CSAM_HASH_LIST_PATH,
        malwareHashListPath: process.env.MALWARE_HASH_LIST_PATH,
      },
      openai: process.env.OPENAI_API_KEY
        ? { apiKey: process.env.OPENAI_API_KEY }
        : undefined,
      hive: process.env.HIVE_API_KEY
        ? { apiKey: process.env.HIVE_API_KEY }
        : undefined,
    })
  }
  return instance
}

export function createContentModerationPipeline(
  config: PipelineConfig,
): ContentModerationPipeline {
  return new ContentModerationPipeline(config)
}

export function resetContentModerationPipeline(): void {
  instance = null
}

export const NEVER_BYPASS_CATEGORIES: readonly ModerationCategory[] = [
  'csam',
] as const
