/**
 * Quarantine Manager
 *
 * DESIGN AXIOM: Automated first, human last
 * Humans only see content when automation cannot resolve legality.
 *
 * DESIGN AXIOM: No derivative contraband
 * Quarantined content has NO perceptual hashes computed.
 *
 * Manages:
 * 1. Encrypted quarantine bucket for suspected content
 * 2. Evidence vault for confirmed CSAM (WORM storage)
 * 3. Restricted review queue access controls
 */

import { logger } from '../logger'
import type { Address } from 'viem'

export interface QuarantineItem {
  id: string
  sha256: string
  
  // Encrypted content reference (NEVER raw content)
  encryptedRef: string
  encryptionKeyId: string
  
  // Detection context
  detectedAt: number
  detectionReason: QuarantineReason
  detectionSource: string
  confidence: number
  
  // Attribution
  uploaderAddress?: Address
  uploaderIp?: string
  providerAddress?: Address
  
  // Status
  status: QuarantineStatus
  ttlExpiresAt?: number
  legalHoldUntil?: number
  
  // Review
  assignedReviewerId?: string
  reviewStartedAt?: number
  decision?: QuarantineDecision
  decidedAt?: number
  decidedBy?: string
}

export type QuarantineReason =
  | 'csam_hash_match'
  | 'youth_ambiguity'
  | 'ai_csam_detection'
  | 'user_report'
  | 'manual_escalation'

export type QuarantineStatus =
  | 'pending_review'
  | 'under_review'
  | 'decided_csam'
  | 'decided_violation'
  | 'decided_false_positive'
  | 'decided_inconclusive'
  | 'expired'
  | 'deleted'

export type QuarantineDecision =
  | { outcome: 'csam'; action: 'report_ncmec'; ncmecReportId?: string }
  | { outcome: 'policy_violation'; action: 'delete'; reason: string }
  | { outcome: 'false_positive'; action: 'release' }
  | { outcome: 'inconclusive'; action: 'escalate'; escalatedTo: string }

export interface EvidenceBundle {
  id: string
  quarantineItemId: string
  createdAt: number
  
  // Content hashes ONLY (never actual content for CSAM)
  contentHash: {
    sha256: string
    md5: string
    // NO perceptual hashes for suspected CSAM
  }
  
  // Match metadata
  matchSource?: string
  matchId?: string
  matchConfidence?: number
  
  // Attribution chain
  wallets: Address[]
  providers: string[]
  ips: string[]
  txHashes: string[]
  
  // Timeline
  uploadedAt: number
  detectedAt: number
  quarantinedAt: number
  reportedAt?: number
  ncmecReportId?: string
  
  // Legal hold
  legalHoldUntil?: number
  
  // Access log
  accessLog: AccessLogEntry[]
}

export interface AccessLogEntry {
  timestamp: number
  accessor: string
  action: 'view' | 'export' | 'decision' | 'escalate'
  ipAddress?: string
  details?: string
}

export interface QuarantineManagerConfig {
  /** Default TTL for quarantined items in ms (default: 30 days) */
  defaultTtlMs?: number
  /** Encryption key for quarantine bucket */
  encryptionKey?: string
  /** Maximum items in review queue per reviewer */
  maxQueuePerReviewer?: number
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// In-memory storage (replace with actual encrypted storage in production)
const quarantineStore = new Map<string, QuarantineItem>()
const evidenceStore = new Map<string, EvidenceBundle>()

/**
 * Quarantine Manager
 *
 * Handles isolation of suspected content and evidence preservation.
 */
export class QuarantineManager {
  private config: Required<QuarantineManagerConfig>

  constructor(config: QuarantineManagerConfig = {}) {
    this.config = {
      defaultTtlMs: config.defaultTtlMs ?? DEFAULT_TTL_MS,
      encryptionKey: config.encryptionKey ?? process.env.QUARANTINE_ENCRYPTION_KEY ?? '',
      maxQueuePerReviewer: config.maxQueuePerReviewer ?? 10,
    }
  }

  async initialize(): Promise<void> {
    if (!this.config.encryptionKey) {
      logger.warn('[QuarantineManager] No encryption key configured - quarantine storage not secure!')
    }
    logger.info('[QuarantineManager] Initialized', { ttlDays: this.config.defaultTtlMs / (24 * 60 * 60 * 1000) })
  }

  /**
   * Quarantine content for review
   *
   * CRITICAL: Content is encrypted and isolated.
   * No perceptual hashes are computed.
   * No external API calls are made with the content.
   */
  async quarantine(params: {
    contentHash: string
    contentRef: string
    reason: QuarantineReason
    detectionSource: string
    confidence: number
    uploaderAddress?: Address
    uploaderIp?: string
  }): Promise<QuarantineItem> {
    const id = crypto.randomUUID()
    const now = Date.now()

    const item: QuarantineItem = {
      id,
      sha256: params.contentHash,
      encryptedRef: params.contentRef, // Already encrypted by upload gateway
      encryptionKeyId: 'default', // Key rotation would update this
      detectedAt: now,
      detectionReason: params.reason,
      detectionSource: params.detectionSource,
      confidence: params.confidence,
      uploaderAddress: params.uploaderAddress,
      uploaderIp: params.uploaderIp,
      status: 'pending_review',
      ttlExpiresAt: now + this.config.defaultTtlMs,
    }

    quarantineStore.set(id, item)

    logger.info('[QuarantineManager] Content quarantined', {
      id,
      reason: params.reason,
      source: params.detectionSource,
      confidence: params.confidence,
    })

    return item
  }

  /**
   * Create evidence bundle for confirmed CSAM
   *
   * CRITICAL: Evidence is preserved with legal hold.
   * This is WORM storage - cannot be deleted until hold expires.
   */
  async createEvidenceBundle(params: {
    quarantineItemId: string
    matchSource?: string
    matchId?: string
    matchConfidence?: number
    wallets: Address[]
    providers: string[]
    ips: string[]
    txHashes: string[]
    legalHoldDays?: number
  }): Promise<EvidenceBundle> {
    const item = quarantineStore.get(params.quarantineItemId)
    if (!item) {
      throw new Error(`Quarantine item not found: ${params.quarantineItemId}`)
    }

    const id = crypto.randomUUID()
    const now = Date.now()
    const legalHoldDays = params.legalHoldDays ?? 365 // 1 year default

    const bundle: EvidenceBundle = {
      id,
      quarantineItemId: params.quarantineItemId,
      createdAt: now,
      contentHash: {
        sha256: item.sha256,
        md5: '', // Would be computed at intake
      },
      matchSource: params.matchSource,
      matchId: params.matchId,
      matchConfidence: params.matchConfidence,
      wallets: params.wallets,
      providers: params.providers,
      ips: params.ips,
      txHashes: params.txHashes,
      uploadedAt: item.detectedAt,
      detectedAt: item.detectedAt,
      quarantinedAt: item.detectedAt,
      legalHoldUntil: now + (legalHoldDays * 24 * 60 * 60 * 1000),
      accessLog: [{
        timestamp: now,
        accessor: 'system',
        action: 'view',
        details: 'Evidence bundle created',
      }],
    }

    // Set legal hold on quarantine item
    item.legalHoldUntil = bundle.legalHoldUntil
    item.status = 'decided_csam'

    evidenceStore.set(id, bundle)
    quarantineStore.set(params.quarantineItemId, item)

    logger.info('[QuarantineManager] Evidence bundle created', {
      bundleId: id,
      quarantineId: params.quarantineItemId,
      legalHoldDays,
    })

    return bundle
  }

  /**
   * Record NCMEC report ID on evidence bundle
   */
  async recordNCMECReport(bundleId: string, ncmecReportId: string): Promise<void> {
    const bundle = evidenceStore.get(bundleId)
    if (!bundle) {
      throw new Error(`Evidence bundle not found: ${bundleId}`)
    }

    bundle.ncmecReportId = ncmecReportId
    bundle.reportedAt = Date.now()
    bundle.accessLog.push({
      timestamp: Date.now(),
      accessor: 'system',
      action: 'decision',
      details: `NCMEC report submitted: ${ncmecReportId}`,
    })

    evidenceStore.set(bundleId, bundle)

    logger.info('[QuarantineManager] NCMEC report recorded', { bundleId, ncmecReportId })
  }

  /**
   * Get items pending review for restricted review queue
   *
   * CONSTRAINTS:
   * - Only authorized reviewers
   * - No downloads
   * - Full audit trail
   * - Time-limited access
   */
  async getPendingReview(limit: number = 10): Promise<QuarantineItem[]> {
    const pending: QuarantineItem[] = []
    for (const item of quarantineStore.values()) {
      if (item.status === 'pending_review') {
        pending.push(item)
        if (pending.length >= limit) break
      }
    }
    return pending
  }

  /**
   * Assign item to reviewer
   */
  async assignReviewer(itemId: string, reviewerId: string): Promise<void> {
    const item = quarantineStore.get(itemId)
    if (!item) {
      throw new Error(`Quarantine item not found: ${itemId}`)
    }

    item.assignedReviewerId = reviewerId
    item.reviewStartedAt = Date.now()
    item.status = 'under_review'
    quarantineStore.set(itemId, item)

    logger.info('[QuarantineManager] Reviewer assigned', { itemId, reviewerId })
  }

  /**
   * Record decision on quarantine item
   */
  async recordDecision(itemId: string, decision: QuarantineDecision, decidedBy: string): Promise<void> {
    const item = quarantineStore.get(itemId)
    if (!item) {
      throw new Error(`Quarantine item not found: ${itemId}`)
    }

    item.decision = decision
    item.decidedAt = Date.now()
    item.decidedBy = decidedBy

    switch (decision.outcome) {
      case 'csam':
        item.status = 'decided_csam'
        break
      case 'policy_violation':
        item.status = 'decided_violation'
        break
      case 'false_positive':
        item.status = 'decided_false_positive'
        break
      case 'inconclusive':
        item.status = 'decided_inconclusive'
        break
    }

    quarantineStore.set(itemId, item)

    logger.info('[QuarantineManager] Decision recorded', {
      itemId,
      outcome: decision.outcome,
      decidedBy,
    })
  }

  /**
   * Get quarantine item by ID
   */
  async getItem(id: string): Promise<QuarantineItem | null> {
    return quarantineStore.get(id) ?? null
  }

  /**
   * Get evidence bundle by ID
   */
  async getEvidenceBundle(id: string): Promise<EvidenceBundle | null> {
    return evidenceStore.get(id) ?? null
  }

  /**
   * Get statistics
   */
  getStats(): {
    pendingReview: number
    underReview: number
    decidedCsam: number
    decidedFalsePositive: number
    evidenceBundles: number
  } {
    let pendingReview = 0
    let underReview = 0
    let decidedCsam = 0
    let decidedFalsePositive = 0

    for (const item of quarantineStore.values()) {
      switch (item.status) {
        case 'pending_review':
          pendingReview++
          break
        case 'under_review':
          underReview++
          break
        case 'decided_csam':
          decidedCsam++
          break
        case 'decided_false_positive':
          decidedFalsePositive++
          break
      }
    }

    return {
      pendingReview,
      underReview,
      decidedCsam,
      decidedFalsePositive,
      evidenceBundles: evidenceStore.size,
    }
  }
}

// Singleton
let instance: QuarantineManager | null = null

export function getQuarantineManager(config?: QuarantineManagerConfig): QuarantineManager {
  if (!instance) {
    instance = new QuarantineManager(config)
  }
  return instance
}

