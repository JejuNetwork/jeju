/**
 * Unified Ingestion Pipeline
 *
 * DESIGN AXIOMS IMPLEMENTED:
 * 1. Hash-first legality - CSAM hash check is FIRST
 * 2. Conservative youth handling - Any ambiguity → quarantine
 * 3. Automated first, human last - ML decides, humans review edge cases
 * 4. No derivative contraband - No pHash for suspected CSAM
 * 5. Protocol neutrality - Emit signals, operators enforce
 * 6. Deterministic enforcement - All decisions logged
 *
 * Single-pass pipeline:
 * 1. Intake → SHA256 + encrypt + TTL
 * 2. CSAM hash check (STOPS if match)
 * 3. Face/age detection (memory only)
 * 4. Nudity triage
 * 5. Policy routing
 * 6. External AI (adults only)
 * 7. Action (allow/quarantine/block)
 */

import type { Address } from 'viem'
import { logger } from '../logger'
import {
  getOnChainSignalsService,
  type OnChainSignalsConfig,
  type OnChainSignalsService,
} from './on-chain-signals'
import {
  getPolicyEngine,
  type NudityResult,
  type PolicyEngine,
  type RoutingDecision,
} from './policy-engine'
import {
  type AWSRekognitionConfig,
  AWSRekognitionProvider,
} from './providers/aws-rekognition'
import {
  type CSAMHashProvider,
  getCSAMHashProvider,
  type HashMatchResult,
} from './providers/csam-hash'
import {
  type FaceAgeProvider,
  type FaceAgeResult,
  getFaceAgeProvider,
} from './providers/face-age'
import {
  HiveModerationProvider,
  type HiveProviderConfig,
} from './providers/hive'
import { getNsfwScore, NSFWDetectionProvider } from './providers/nsfw'
import {
  type OpenAIModerationConfig,
  OpenAIModerationProvider,
} from './providers/openai'
import { getQuarantineManager, type QuarantineManager } from './quarantine'
import { CSAMReportingService, type ReportingConfig } from './reporting'
import {
  getSanctionsScreener,
  type SanctionsScreener,
  type SanctionsScreenerConfig,
} from './sanctions'
import { recordMetric } from './transparency'
import {
  getWalletEnforcementManager,
  type WalletEnforcementManager,
} from './wallet-enforcement'

async function sha256(buffer: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface IntakeContext {
  sha256: string
  encryptedRef: string
  receivedAt: number
  ttlMs: number

  uploaderAddress?: Address
  uploaderIp?: string
  userAgent?: string

  // PoW challenge (for rate limiting)
  powDifficulty?: number
  powSolution?: string
}

export type IngestionAction = 'allow' | 'block' | 'quarantine' | 'tag_adult'

export interface IngestionResult {
  action: IngestionAction
  contentHash: string

  // Detection details
  hashMatch?: HashMatchResult
  faceAge?: FaceAgeResult
  nudity?: NudityResult
  routing?: RoutingDecision

  // Action details
  quarantineId?: string
  evidenceBundleId?: string
  ncmecReportId?: string
  blockedReason?: string

  // Perceptual hash (only for allowed non-youth content)
  perceptualHash?: string

  // Processing
  processingTimeMs: number
}

export interface IngestionPipelineConfig {
  /** Reporting config for NCMEC/IWF */
  reporting?: ReportingConfig
  /** Default content TTL in ms (default: 30 minutes) */
  defaultTtlMs?: number
  /** Enable perceptual hashing for allowed content (default: true) */
  enablePerceptualHash?: boolean
  /** Enable sanctions screening (default: true) */
  enableSanctionsCheck?: boolean
  /** Enable on-chain signals (default: true in production) */
  enableOnChainSignals?: boolean
  /** Sanctions screener config */
  sanctions?: SanctionsScreenerConfig
  /** On-chain signals config */
  onChainSignals?: OnChainSignalsConfig
  /** Hive AI config for external image moderation */
  hive?: HiveProviderConfig
  /** AWS Rekognition config for external image moderation */
  awsRekognition?: AWSRekognitionConfig
  /** OpenAI config for external text/image moderation */
  openai?: OpenAIModerationConfig
}

/**
 * Unified Ingestion Pipeline
 *
 * Processes all incoming content through a single deterministic flow.
 */
export class IngestionPipeline {
  private config: IngestionPipelineConfig & {
    defaultTtlMs: number
    enablePerceptualHash: boolean
    enableSanctionsCheck: boolean
    enableOnChainSignals: boolean
  }
  private csamHashProvider: CSAMHashProvider
  private faceAgeProvider: FaceAgeProvider
  private nsfwProvider: NSFWDetectionProvider
  private policyEngine: PolicyEngine
  private quarantineManager: QuarantineManager
  private walletEnforcement: WalletEnforcementManager
  private reportingService: CSAMReportingService
  private sanctionsScreener: SanctionsScreener
  private onChainSignals: OnChainSignalsService
  private hiveProvider?: HiveModerationProvider
  private awsProvider?: AWSRekognitionProvider
  private openaiProvider?: OpenAIModerationProvider
  private initialized = false

  constructor(config: IngestionPipelineConfig = {}) {
    this.config = {
      ...config,
      defaultTtlMs: config.defaultTtlMs ?? 30 * 60 * 1000,
      enablePerceptualHash: config.enablePerceptualHash ?? true,
      enableSanctionsCheck: config.enableSanctionsCheck ?? true,
      enableOnChainSignals: config.enableOnChainSignals ?? true,
    }

    this.csamHashProvider = getCSAMHashProvider()
    this.faceAgeProvider = getFaceAgeProvider()
    this.nsfwProvider = new NSFWDetectionProvider()
    this.policyEngine = getPolicyEngine()
    this.quarantineManager = getQuarantineManager()
    this.walletEnforcement = getWalletEnforcementManager()
    this.reportingService = new CSAMReportingService(
      this.config.reporting ?? {},
    )
    this.sanctionsScreener = getSanctionsScreener(this.config.sanctions)
    this.onChainSignals = getOnChainSignalsService(this.config.onChainSignals)

    // Initialize external AI providers if configured
    if (config.hive?.apiKey) {
      this.hiveProvider = new HiveModerationProvider(config.hive)
    }
    if (config.awsRekognition?.accessKeyId) {
      this.awsProvider = new AWSRekognitionProvider(config.awsRekognition)
    }
    if (config.openai?.apiKey) {
      this.openaiProvider = new OpenAIModerationProvider(config.openai)
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    await Promise.all([
      this.csamHashProvider.initialize(),
      this.faceAgeProvider.initialize(),
      this.nsfwProvider.initialize(),
      this.quarantineManager.initialize(),
      this.walletEnforcement.initialize(),
      this.reportingService.initialize(),
      this.sanctionsScreener.initialize(),
      this.onChainSignals.initialize(),
    ])

    logger.info('[IngestionPipeline] Initialized', {
      csamHash: this.csamHashProvider.getStats(),
      sanctions: this.sanctionsScreener.getStats(),
      onChainSignals: this.onChainSignals.getStats(),
      reporting: !!(this.config.reporting?.ncmec || this.config.reporting?.iwf),
    })

    this.initialized = true
  }

  /**
   * Process incoming image through the full pipeline
   *
   * AXIOM COMPLIANCE:
   * - Hash check is FIRST
   * - Youth ambiguity → quarantine with no external calls
   * - No pHash for suspected CSAM
   * - All decisions logged
   */
  async processImage(
    buffer: Buffer,
    context: Partial<IntakeContext> = {},
  ): Promise<IngestionResult> {
    const start = Date.now()
    const contentHash = await sha256(buffer)

    // Build intake context
    const intake: IntakeContext = {
      sha256: contentHash,
      encryptedRef: contentHash, // In production: actual encrypted ref
      receivedAt: Date.now(),
      ttlMs: this.config.defaultTtlMs,
      ...context,
    }

    // STEP 0: Sanctions check (if wallet provided)
    if (this.config.enableSanctionsCheck && intake.uploaderAddress) {
      const sanctionsResult = await this.sanctionsScreener.checkAddress(
        intake.uploaderAddress,
      )
      if (sanctionsResult.isSanctioned) {
        logger.warn('[IngestionPipeline] Sanctioned wallet blocked', {
          address: intake.uploaderAddress,
          source: sanctionsResult.source,
          list: sanctionsResult.matchedList ?? 'unknown',
        })

        // Block sanctioned wallet from uploading
        return this.buildResult('block', contentHash, start, {
          blockedReason: `Sanctioned wallet: ${sanctionsResult.source} - ${sanctionsResult.matchedList ?? 'Unknown list'}`,
        })
      }
    }

    // STEP 1: CSAM hash check (MANDATORY FIRST)
    const hashResult = await this.csamHashProvider.checkImage(buffer)

    if (hashResult.matched) {
      // IMMEDIATE BLOCK - pipeline STOPS
      return this.handleCSAMMatch(buffer, intake, hashResult, start)
    }

    // STEP 2: Face/age detection (memory only, no storage)
    const faceAgeResult = await this.faceAgeProvider.analyze(buffer)

    // STEP 3: NSFW detection
    const nsfwResult = await this.nsfwProvider.moderateImage(buffer)
    const nudityResult: NudityResult = {
      nudityScore: getNsfwScore(nsfwResult) ?? 0,
      explicitScore: getNsfwScore(nsfwResult) ?? 0,
      isNSFW: nsfwResult.categories.some(
        (c) => c.category === 'adult' && c.score > 0.5,
      ),
      isPorn: nsfwResult.categories.some((c) => c.details?.includes('Porn')),
      isHentai: nsfwResult.categories.some((c) =>
        c.details?.includes('Hentai'),
      ),
      isSexy: nsfwResult.categories.some((c) =>
        c.details?.includes('Suggestive'),
      ),
    }

    // STEP 4: Policy routing
    const routing = this.policyEngine.route({
      hashResult,
      faceAgeResult,
      nudityResult,
    })

    // STEP 5: Execute action based on routing
    switch (routing.action) {
      case 'block':
        // Should not happen here (hash match handled above)
        return this.buildResult('block', contentHash, start, {
          hashMatch: hashResult,
          faceAge: faceAgeResult,
          nudity: nudityResult,
          routing,
          blockedReason: routing.reason,
        })

      case 'quarantine':
        return this.handleQuarantine(buffer, intake, start, {
          hashMatch: hashResult,
          faceAge: faceAgeResult,
          nudity: nudityResult,
          routing,
        })

      case 'external_check':
        return this.handleExternalCheck(buffer, intake, start, {
          hashMatch: hashResult,
          faceAge: faceAgeResult,
          nudity: nudityResult,
          routing,
        })

      case 'allow':
        return this.handleAllow(buffer, intake, start, {
          hashMatch: hashResult,
          faceAge: faceAgeResult,
          nudity: nudityResult,
          routing,
        })
    }
  }

  /**
   * Handle CSAM hash match - IMMEDIATE block + report
   */
  private async handleCSAMMatch(
    _buffer: Buffer, // Not used - content is quarantined by reference
    intake: IntakeContext,
    hashResult: HashMatchResult,
    start: number,
  ): Promise<IngestionResult> {
    logger.warn('[IngestionPipeline] CSAM hash match detected', {
      hash: intake.sha256.slice(0, 16),
      source: hashResult.source,
      matchId: hashResult.matchId ?? 'unknown',
    })

    // 1. Quarantine immediately
    const quarantineItem = await this.quarantineManager.quarantine({
      contentHash: intake.sha256,
      contentRef: intake.encryptedRef,
      reason: 'csam_hash_match',
      detectionSource: hashResult.source,
      confidence: hashResult.confidence,
      uploaderAddress: intake.uploaderAddress,
      uploaderIp: intake.uploaderIp,
    })

    // 2. Create evidence bundle
    const evidenceBundle = await this.quarantineManager.createEvidenceBundle({
      quarantineItemId: quarantineItem.id,
      matchSource: hashResult.source,
      matchId: hashResult.matchId,
      matchConfidence: hashResult.confidence,
      wallets: intake.uploaderAddress ? [intake.uploaderAddress] : [],
      providers: [],
      ips: intake.uploaderIp ? [intake.uploaderIp] : [],
      txHashes: [],
    })

    // 3. Report to NCMEC
    const report = await this.reportingService.createReport({
      contentHash: intake.sha256,
      contentType: 'image',
      detectionMethod: 'hash',
      confidence: hashResult.confidence,
      uploaderAddress: intake.uploaderAddress,
      uploaderIp: intake.uploaderIp,
      userAgent: intake.userAgent,
      service: 'ingestion-pipeline',
    })

    // 4. Record NCMEC report ID on evidence
    if (report.authorityReportId) {
      await this.quarantineManager.recordNCMECReport(
        evidenceBundle.id,
        report.authorityReportId,
      )
    }

    // 5. Block wallet (off-chain enforcement)
    if (intake.uploaderAddress) {
      await this.walletEnforcement.recordViolation(intake.uploaderAddress, {
        type: 'csam_upload',
        severity: 'critical',
        contentHash: intake.sha256,
        description: `CSAM hash match from ${hashResult.source}`,
        evidenceBundleId: evidenceBundle.id,
      })

      // 5b. Emit on-chain ban signal
      if (this.config.enableOnChainSignals) {
        await this.onChainSignals.applyBan({
          target: intake.uploaderAddress,
          reason: `CSAM hash match (${hashResult.source})`,
          caseId: evidenceBundle.id,
          evidenceBundleId: evidenceBundle.id,
          contentHash: intake.sha256,
        })
      }
    }

    // 6. Record metric
    recordMetric({
      contentType: 'image',
      action: 'report',
      detectionMethod: 'hash',
      processingTimeMs: Date.now() - start,
      csamReported: true,
      csamReportTarget: 'ncmec',
    })

    return this.buildResult('block', intake.sha256, start, {
      hashMatch: hashResult,
      quarantineId: quarantineItem.id,
      evidenceBundleId: evidenceBundle.id,
      ncmecReportId: report.authorityReportId,
      blockedReason: `CSAM hash match from ${hashResult.source}`,
    })
  }

  /**
   * Handle youth-ambiguous content - quarantine for restricted review
   */
  private async handleQuarantine(
    _buffer: Buffer,
    intake: IntakeContext,
    start: number,
    details: {
      hashMatch?: HashMatchResult
      faceAge?: FaceAgeResult
      nudity?: NudityResult
      routing: RoutingDecision
    },
  ): Promise<IngestionResult> {
    logger.info('[IngestionPipeline] Content quarantined for review', {
      hash: intake.sha256.slice(0, 16),
      reason: details.routing.reason,
    })

    // Quarantine for restricted review
    const quarantineItem = await this.quarantineManager.quarantine({
      contentHash: intake.sha256,
      contentRef: intake.encryptedRef,
      reason: 'youth_ambiguity',
      detectionSource: 'policy-engine',
      confidence: details.routing.confidence,
      uploaderAddress: intake.uploaderAddress,
      uploaderIp: intake.uploaderIp,
    })

    // Record metric (NOT a CSAM report yet - pending human review)
    recordMetric({
      contentType: 'image',
      action: 'queue',
      detectionMethod: 'ai',
      processingTimeMs: Date.now() - start,
    })

    return this.buildResult('quarantine', intake.sha256, start, {
      ...details,
      quarantineId: quarantineItem.id,
      blockedReason: details.routing.reason,
    })
  }

  /**
   * Handle adult NSFW content - run external AI check
   *
   * Only runs for content that:
   * 1. Has NSFW detected locally
   * 2. Has NO youth ambiguity (confirmed adult)
   *
   * External AI providers verify the content is legal adult content,
   * not anything else that should be blocked.
   */
  private async handleExternalCheck(
    buffer: Buffer,
    intake: IntakeContext,
    start: number,
    details: {
      hashMatch?: HashMatchResult
      faceAge?: FaceAgeResult
      nudity?: NudityResult
      routing: RoutingDecision
    },
  ): Promise<IngestionResult> {
    logger.info('[IngestionPipeline] Running external AI verification', {
      hash: intake.sha256.slice(0, 16),
      nudityScore: details.nudity?.nudityScore ?? 0,
      hasHive: !!this.hiveProvider,
      hasAWS: !!this.awsProvider,
    })

    // Run external AI checks (if configured)
    const externalResults = await this.runExternalAIChecks(buffer)

    // Check if any external provider flagged CSAM
    for (const result of externalResults) {
      if (result.csamDetected) {
        logger.warn('[IngestionPipeline] External AI detected potential CSAM', {
          hash: intake.sha256.slice(0, 16),
          provider: result.provider,
          confidence: result.confidence,
        })

        // Quarantine immediately - this should not happen for adult-routed content
        // but we check anyway for safety
        const quarantineItem = await this.quarantineManager.quarantine({
          contentHash: intake.sha256,
          contentRef: intake.encryptedRef,
          reason: 'ai_csam_detection',
          detectionSource: result.provider,
          confidence: result.confidence,
          uploaderAddress: intake.uploaderAddress,
          uploaderIp: intake.uploaderIp,
        })

        recordMetric({
          contentType: 'image',
          action: 'queue',
          detectionMethod: 'ai',
          processingTimeMs: Date.now() - start,
        })

        return this.buildResult('quarantine', intake.sha256, start, {
          ...details,
          quarantineId: quarantineItem.id,
          blockedReason: `External AI (${result.provider}) flagged potential illegal content`,
        })
      }
    }

    // All checks passed - tag as adult content
    logger.info('[IngestionPipeline] Adult content verified and tagged', {
      hash: intake.sha256.slice(0, 16),
      nudityScore: details.nudity?.nudityScore ?? 0,
      externalChecks: externalResults.length,
    })

    // Compute perceptual hash (OK for verified adult content)
    let perceptualHash: string | undefined
    if (this.config.enablePerceptualHash) {
      perceptualHash = await this.computePerceptualHash(buffer)
    }

    recordMetric({
      contentType: 'image',
      action: 'allow',
      detectionMethod: 'ai',
      processingTimeMs: Date.now() - start,
    })

    return this.buildResult('tag_adult', intake.sha256, start, {
      ...details,
      perceptualHash,
    })
  }

  /**
   * Run external AI checks on image content
   *
   * Returns array of results from each configured provider.
   * Used for adult content verification only.
   */
  private async runExternalAIChecks(buffer: Buffer): Promise<
    Array<{
      provider: string
      csamDetected: boolean
      confidence: number
      categories: string[]
    }>
  > {
    const results: Array<{
      provider: string
      csamDetected: boolean
      confidence: number
      categories: string[]
    }> = []

    // Run Hive AI check
    if (this.hiveProvider) {
      try {
        const hiveResult = await this.hiveProvider.moderateImage(buffer)
        const csamCategory = hiveResult.categories.find(
          (c) => c.category === 'csam',
        )
        results.push({
          provider: 'hive',
          csamDetected: csamCategory !== undefined && csamCategory.score > 0.3,
          confidence: csamCategory?.score ?? 0,
          categories: hiveResult.categories.map((c) => c.category),
        })
      } catch (err) {
        logger.warn('[IngestionPipeline] Hive AI check failed', {
          error: String(err),
        })
      }
    }

    // Run AWS Rekognition check
    if (this.awsProvider) {
      try {
        const awsResult = await this.awsProvider.moderateImage(buffer)
        const csamCategory = awsResult.categories.find(
          (c) => c.category === 'csam',
        )
        results.push({
          provider: 'aws-rekognition',
          csamDetected: csamCategory !== undefined && csamCategory.score > 0.3,
          confidence: csamCategory?.score ?? 0,
          categories: awsResult.categories.map((c) => c.category),
        })
      } catch (err) {
        logger.warn('[IngestionPipeline] AWS Rekognition check failed', {
          error: String(err),
        })
      }
    }

    return results
  }

  /**
   * Handle clean content - allow with perceptual hash
   */
  private async handleAllow(
    buffer: Buffer,
    intake: IntakeContext,
    start: number,
    details: {
      hashMatch?: HashMatchResult
      faceAge?: FaceAgeResult
      nudity?: NudityResult
      routing: RoutingDecision
    },
  ): Promise<IngestionResult> {
    // Compute perceptual hash for clean content (for retroactive enforcement)
    let perceptualHash: string | undefined
    if (this.config.enablePerceptualHash) {
      perceptualHash = await this.computePerceptualHash(buffer)
    }

    recordMetric({
      contentType: 'image',
      action: 'allow',
      detectionMethod: 'ai', // Local ML detection (nsfwjs)
      processingTimeMs: Date.now() - start,
    })

    return this.buildResult('allow', intake.sha256, start, {
      ...details,
      perceptualHash,
    })
  }

  /**
   * Compute perceptual hash for retroactive enforcement
   *
   * ONLY for non-youth-ambiguous, non-CSAM content
   */
  private async computePerceptualHash(buffer: Buffer): Promise<string> {
    // Simple difference hash for now
    // In production: use proper pHash/dHash/aHash
    const hash = await sha256(buffer)
    return hash.slice(0, 16) // Placeholder
  }

  private buildResult(
    action: IngestionAction,
    contentHash: string,
    start: number,
    details: Partial<
      Omit<IngestionResult, 'action' | 'contentHash' | 'processingTimeMs'>
    >,
  ): IngestionResult {
    return {
      action,
      contentHash,
      processingTimeMs: Date.now() - start,
      ...details,
    }
  }

  /**
   * Get pipeline statistics
   */
  getStats() {
    return {
      csamHash: this.csamHashProvider.getStats(),
      sanctions: this.sanctionsScreener.getStats(),
      onChainSignals: this.onChainSignals.getStats(),
      quarantine: this.quarantineManager.getStats(),
      walletEnforcement: this.walletEnforcement.getStats(),
      externalProviders: {
        hive: !!this.hiveProvider,
        aws: !!this.awsProvider,
        openai: !!this.openaiProvider,
      },
    }
  }

  /**
   * Get sanctions screener for direct address checks
   */
  getSanctionsScreener(): SanctionsScreener {
    return this.sanctionsScreener
  }
}

// Singleton
let instance: IngestionPipeline | null = null

export function getIngestionPipeline(
  config?: IngestionPipelineConfig,
): IngestionPipeline {
  if (!instance) {
    // Use environment variables for external providers if not explicitly configured
    const finalConfig: IngestionPipelineConfig = {
      ...config,
      hive:
        config?.hive ??
        (process.env.HIVE_API_KEY
          ? { apiKey: process.env.HIVE_API_KEY }
          : undefined),
      awsRekognition:
        config?.awsRekognition ??
        (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              region: process.env.AWS_REGION ?? 'us-east-1',
            }
          : undefined),
      openai:
        config?.openai ??
        (process.env.OPENAI_API_KEY
          ? { apiKey: process.env.OPENAI_API_KEY }
          : undefined),
    }
    instance = new IngestionPipeline(finalConfig)
  }
  return instance
}

export function resetIngestionPipeline(): void {
  instance = null
}
