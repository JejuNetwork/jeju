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

import { logger } from '../logger'
import type { Address } from 'viem'
import { CSAMHashProvider, getCSAMHashProvider, type HashMatchResult } from './providers/csam-hash'
import { FaceAgeProvider, getFaceAgeProvider, type FaceAgeResult } from './providers/face-age'
import { NSFWDetectionProvider, needsCsamVerification, getNsfwScore } from './providers/nsfw'
import { PolicyEngine, getPolicyEngine, type RoutingDecision, type NudityResult } from './policy-engine'
import { QuarantineManager, getQuarantineManager } from './quarantine'
import { WalletEnforcementManager, getWalletEnforcementManager } from './wallet-enforcement'
import { CSAMReportingService, type ReportingConfig } from './reporting'
import { recordMetric } from './transparency'

async function sha256(buffer: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
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
}

/**
 * Unified Ingestion Pipeline
 *
 * Processes all incoming content through a single deterministic flow.
 */
export class IngestionPipeline {
  private config: Required<IngestionPipelineConfig>
  private csamHashProvider: CSAMHashProvider
  private faceAgeProvider: FaceAgeProvider
  private nsfwProvider: NSFWDetectionProvider
  private policyEngine: PolicyEngine
  private quarantineManager: QuarantineManager
  private walletEnforcement: WalletEnforcementManager
  private reportingService: CSAMReportingService
  private initialized = false

  constructor(config: IngestionPipelineConfig = {}) {
    this.config = {
      reporting: config.reporting ?? {},
      defaultTtlMs: config.defaultTtlMs ?? 30 * 60 * 1000,
      enablePerceptualHash: config.enablePerceptualHash ?? true,
    }

    this.csamHashProvider = getCSAMHashProvider()
    this.faceAgeProvider = getFaceAgeProvider()
    this.nsfwProvider = new NSFWDetectionProvider()
    this.policyEngine = getPolicyEngine()
    this.quarantineManager = getQuarantineManager()
    this.walletEnforcement = getWalletEnforcementManager()
    this.reportingService = new CSAMReportingService(this.config.reporting)
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
    ])

    logger.info('[IngestionPipeline] Initialized', {
      csamHash: this.csamHashProvider.getStats(),
      reporting: !!this.config.reporting.ncmec || !!this.config.reporting.iwf,
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
  async processImage(buffer: Buffer, context: Partial<IntakeContext> = {}): Promise<IngestionResult> {
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
      isNSFW: nsfwResult.categories.some(c => c.category === 'adult' && c.score > 0.5),
      isPorn: nsfwResult.categories.some(c => c.details?.includes('Porn')),
      isHentai: nsfwResult.categories.some(c => c.details?.includes('Hentai')),
      isSexy: nsfwResult.categories.some(c => c.details?.includes('Suggestive')),
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
    buffer: Buffer,
    intake: IntakeContext,
    hashResult: HashMatchResult,
    start: number
  ): Promise<IngestionResult> {
    logger.warn('[IngestionPipeline] CSAM hash match detected', {
      hash: intake.sha256.slice(0, 16),
      source: hashResult.source,
      matchId: hashResult.matchId,
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
    if (report.ncmecReportId) {
      await this.quarantineManager.recordNCMECReport(evidenceBundle.id, report.ncmecReportId)
    }

    // 5. Block wallet
    if (intake.uploaderAddress) {
      await this.walletEnforcement.recordViolation(intake.uploaderAddress, {
        type: 'csam_upload',
        severity: 'critical',
        contentHash: intake.sha256,
        description: `CSAM hash match from ${hashResult.source}`,
        evidenceBundleId: evidenceBundle.id,
      })
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
      ncmecReportId: report.ncmecReportId,
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
    }
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
    }
  ): Promise<IngestionResult> {
    // TODO: Run OpenAI/Hive/AWS for adult content verification
    // For now, tag as adult and allow

    logger.info('[IngestionPipeline] Adult content tagged', {
      hash: intake.sha256.slice(0, 16),
      nudityScore: details.nudity?.nudityScore,
    })

    // Compute perceptual hash (OK for adult content)
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
    }
  ): Promise<IngestionResult> {
    // Compute perceptual hash for clean content (for retroactive enforcement)
    let perceptualHash: string | undefined
    if (this.config.enablePerceptualHash) {
      perceptualHash = await this.computePerceptualHash(buffer)
    }

    recordMetric({
      contentType: 'image',
      action: 'allow',
      detectionMethod: 'local',
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
    details: Partial<Omit<IngestionResult, 'action' | 'contentHash' | 'processingTimeMs'>>
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
      quarantine: this.quarantineManager.getStats(),
      walletEnforcement: this.walletEnforcement.getStats(),
    }
  }
}

// Singleton
let instance: IngestionPipeline | null = null

export function getIngestionPipeline(config?: IngestionPipelineConfig): IngestionPipeline {
  if (!instance) {
    instance = new IngestionPipeline(config)
  }
  return instance
}

export function resetIngestionPipeline(): void {
  instance = null
}

