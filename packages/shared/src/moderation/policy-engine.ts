/**
 * Policy Engine
 *
 * DESIGN AXIOM: Deterministic enforcement
 * Every action is rule-based, logged, reproducible, auditable.
 *
 * Routes content through the moderation pipeline based on:
 * 1. Hash match results (CSAM = immediate block)
 * 2. Face/age detection results (youth ambiguity = quarantine)
 * 3. NSFW detection results (adult content = external check or tag)
 *
 * Three routing cases:
 * - Case A: Youth-risk + nudity → Quarantine, no external calls
 * - Case B: Adult-likely NSFW → External AI check (OpenAI)
 * - Case C: Non-NSFW → Allow, compute perceptual hash
 */

import { logger } from '../logger'
import type { HashMatchResult } from './providers/csam-hash'
import type { FaceAgeResult } from './providers/face-age'

export interface NudityResult {
  nudityScore: number
  explicitScore: number
  isNSFW: boolean
  isPorn: boolean
  isHentai: boolean
  isSexy: boolean
}

export type RoutingCase =
  | 'csam_match'
  | 'youth_risk'
  | 'adult_nsfw'
  | 'non_nsfw'

export interface RoutingDecision {
  case: RoutingCase
  action: 'block' | 'quarantine' | 'external_check' | 'allow'

  // Processing flags
  runExternalAI: boolean
  computePerceptualHash: boolean
  storeEvidence: boolean
  reportNCMEC: boolean

  // Queue assignment
  queue?: 'restricted_review' | 'standard_review'

  // Reason for audit trail
  reason: string

  // Confidence in decision
  confidence: number
}

export interface PolicyEngineConfig {
  /** Nudity score threshold for NSFW (default: 0.5) */
  nsfwThreshold?: number
  /** Age confidence threshold to clear youth ambiguity (default: 0.85) */
  ageConfidenceThreshold?: number
  /** Effective adult age after buffer (default: 21) */
  effectiveAdultAge?: number
}

const DEFAULT_CONFIG = {
  nsfwThreshold: 0.5,
  ageConfidenceThreshold: 0.85,
  effectiveAdultAge: 21, // 18 + 3 year buffer
}

/**
 * Policy Engine
 *
 * Deterministic routing based on detection results.
 * All decisions are logged with full audit trail.
 */
export class PolicyEngine {
  private config: typeof DEFAULT_CONFIG

  constructor(config: PolicyEngineConfig = {}) {
    this.config = {
      nsfwThreshold: config.nsfwThreshold ?? DEFAULT_CONFIG.nsfwThreshold,
      ageConfidenceThreshold:
        config.ageConfidenceThreshold ?? DEFAULT_CONFIG.ageConfidenceThreshold,
      effectiveAdultAge:
        config.effectiveAdultAge ?? DEFAULT_CONFIG.effectiveAdultAge,
    }
  }

  /**
   * Route content based on detection results
   *
   * CRITICAL ORDER:
   * 1. Hash match → BLOCK (no further processing)
   * 2. Youth ambiguity + NSFW → QUARANTINE (no external calls)
   * 3. Adult NSFW → EXTERNAL CHECK
   * 4. Clean → ALLOW
   */
  route(params: {
    hashResult?: HashMatchResult
    faceAgeResult?: FaceAgeResult
    nudityResult?: NudityResult
  }): RoutingDecision {
    const { hashResult, faceAgeResult, nudityResult } = params

    // CASE 0: CSAM hash match - IMMEDIATE BLOCK
    if (hashResult?.matched) {
      const decision: RoutingDecision = {
        case: 'csam_match',
        action: 'block',
        runExternalAI: false, // No need
        computePerceptualHash: false, // NEVER for CSAM
        storeEvidence: true,
        reportNCMEC: true,
        reason: `CSAM hash match from ${hashResult.source}`,
        confidence: hashResult.confidence,
      }
      this.logDecision(decision)
      return decision
    }

    // Determine NSFW status
    const isNSFW = (nudityResult?.nudityScore ?? 0) >= this.config.nsfwThreshold
    const nudityScore = nudityResult?.nudityScore ?? 0

    // Determine youth ambiguity
    const hasYouthAmbiguity = this.checkYouthAmbiguity(faceAgeResult)

    // CASE A: Youth-risk + nudity
    if (isNSFW && hasYouthAmbiguity) {
      const decision: RoutingDecision = {
        case: 'youth_risk',
        action: 'quarantine',
        runExternalAI: false, // NO external calls for youth-ambiguous
        computePerceptualHash: false, // NO derivative artifacts
        storeEvidence: true,
        reportNCMEC: false, // Only after manual confirmation
        queue: 'restricted_review',
        reason: 'NSFW content with youth ambiguity detected',
        confidence: Math.min(
          nudityScore,
          1 - (faceAgeResult?.minAgeConfidence ?? 0),
        ),
      }
      this.logDecision(decision)
      return decision
    }

    // CASE B: Adult-likely NSFW
    if (isNSFW && !hasYouthAmbiguity) {
      const decision: RoutingDecision = {
        case: 'adult_nsfw',
        action: 'external_check',
        runExternalAI: true, // OpenAI for adult policy check
        computePerceptualHash: true, // OK for adult content
        storeEvidence: false,
        reportNCMEC: false,
        reason: 'Adult NSFW content - requires external verification',
        confidence: nudityScore,
      }
      this.logDecision(decision)
      return decision
    }

    // CASE C: Non-NSFW (clean content)
    const decision: RoutingDecision = {
      case: 'non_nsfw',
      action: 'allow',
      runExternalAI: false,
      computePerceptualHash: true, // OK for clean content
      storeEvidence: false,
      reportNCMEC: false,
      reason: 'Non-NSFW content allowed',
      confidence: 1 - nudityScore,
    }
    this.logDecision(decision)
    return decision
  }

  /**
   * Check if content has youth ambiguity
   *
   * Conservative: Any doubt = ambiguous
   */
  private checkYouthAmbiguity(faceAgeResult?: FaceAgeResult): boolean {
    if (!faceAgeResult) return false // No face analysis = no youth ambiguity
    if (faceAgeResult.faceCount === 0) return false // No faces detected

    // Explicit flag from face/age provider
    if (faceAgeResult.hasYouthAmbiguity) return true

    // Low confidence on age estimation
    if (faceAgeResult.minAgeConfidence < this.config.ageConfidenceThreshold)
      return true

    // Age estimate below threshold
    if (faceAgeResult.minAgeEstimate < this.config.effectiveAdultAge)
      return true

    return false
  }

  /**
   * Log decision for audit trail
   */
  private logDecision(decision: RoutingDecision): void {
    logger.info('[PolicyEngine] Routing decision', {
      case: decision.case,
      action: decision.action,
      reason: decision.reason,
      confidence: decision.confidence,
      externalAI: decision.runExternalAI,
      perceptualHash: decision.computePerceptualHash,
      evidence: decision.storeEvidence,
      ncmec: decision.reportNCMEC,
      queue: decision.queue ?? 'none',
    })
  }

  /**
   * Validate decision against axioms (for testing)
   */
  validateDecision(decision: RoutingDecision): string[] {
    const violations: string[] = []

    // Axiom: No derivative contraband
    if (decision.case === 'csam_match' && decision.computePerceptualHash) {
      violations.push('CSAM match should not compute perceptual hash')
    }
    if (decision.case === 'youth_risk' && decision.computePerceptualHash) {
      violations.push('Youth-risk content should not compute perceptual hash')
    }

    // Axiom: No external calls for youth-ambiguous
    if (decision.case === 'youth_risk' && decision.runExternalAI) {
      violations.push('Youth-risk content should not use external AI')
    }

    // Axiom: CSAM hash match must report
    if (decision.case === 'csam_match' && !decision.reportNCMEC) {
      violations.push('CSAM hash match must report to NCMEC')
    }

    // Axiom: CSAM hash match must preserve evidence
    if (decision.case === 'csam_match' && !decision.storeEvidence) {
      violations.push('CSAM hash match must preserve evidence')
    }

    return violations
  }
}

// Singleton
let instance: PolicyEngine | null = null

export function getPolicyEngine(config?: PolicyEngineConfig): PolicyEngine {
  if (!instance) {
    instance = new PolicyEngine(config)
  }
  return instance
}
