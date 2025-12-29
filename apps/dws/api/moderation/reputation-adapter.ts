/**
 * Reputation Adapter
 *
 * Connects the DWS ReputationService to the shared moderation pipeline.
 * Implements the ReputationProvider interface for use with ContentModerationPipeline.
 */

import type {
  ModerationCategory,
  ReputationProvider,
  ReputationTier,
  UserReputation,
} from '@jejunetwork/shared'
import type { Address } from 'viem'
import {
  getReputationService,
  type ReputationScore,
  type TrustLevel,
} from './reputation-service'

/**
 * Map DWS TrustLevel to shared ReputationTier
 */
function mapTrustLevel(level: TrustLevel): ReputationTier {
  return level as ReputationTier
}

/**
 * Map shared ModerationCategory to DWS violation type
 */
function mapCategoryToViolationType(
  category: ModerationCategory
): 'content' | 'tos' | 'abuse' | 'spam' | 'fraud' {
  switch (category) {
    case 'csam':
    case 'adult':
    case 'violence':
    case 'drugs':
      return 'content'
    case 'hate':
    case 'harassment':
    case 'self_harm':
      return 'abuse'
    case 'spam':
      return 'spam'
    case 'scam':
    case 'pii':
      return 'fraud'
    case 'malware':
    case 'illegal':
    case 'copyright':
      return 'tos'
    default:
      return 'content'
  }
}

/**
 * Map shared ModerationCategory to DWS violation severity
 */
function mapCategoryToSeverity(
  category: ModerationCategory
): 'low' | 'medium' | 'high' | 'critical' {
  switch (category) {
    case 'csam':
      return 'critical'
    case 'malware':
    case 'illegal':
    case 'hate':
      return 'high'
    case 'scam':
    case 'harassment':
    case 'violence':
    case 'adult':
    case 'self_harm':
      return 'medium'
    case 'spam':
    case 'copyright':
    case 'pii':
    case 'drugs':
      return 'low'
    default:
      return 'medium'
  }
}

/**
 * Adapter that implements ReputationProvider for use with ContentModerationPipeline
 */
export class DWSReputationAdapter implements ReputationProvider {
  private service = getReputationService()

  /**
   * Get user reputation in the format expected by the moderation pipeline
   */
  async getReputation(address: Address): Promise<UserReputation> {
    const score = await this.service.getReputation(address)

    return {
      address,
      tier: mapTrustLevel(score.level),
      score: score.totalScore,
      successfulUploads: score.components.successfulDeployments,
      violations: score.components.violations,
      lastViolationAt: await this.getLastViolationTimestamp(address),
    }
  }

  /**
   * Record a successful upload/operation
   */
  async recordSuccess(address: Address): Promise<void> {
    // Generate a pseudo-deployment ID for tracking
    const operationId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`

    await this.service.recordDeployment(
      address,
      operationId,
      'success',
      await this.getCurrentLevel(address)
    )
  }

  /**
   * Record a moderation violation
   */
  async recordViolation(
    address: Address,
    category: ModerationCategory
  ): Promise<void> {
    const violationType = mapCategoryToViolationType(category)
    const severity = mapCategoryToSeverity(category)

    await this.service.recordViolation(
      address,
      violationType,
      severity,
      `Content moderation violation: ${category}`,
      `Automated detection by content moderation pipeline`
    )
  }

  /**
   * Get the full DWS reputation score
   */
  async getFullReputation(address: Address): Promise<ReputationScore> {
    return this.service.getReputation(address)
  }

  /**
   * Get moderation intensity settings
   */
  async getModerationIntensity(address: Address) {
    return this.service.getModerationIntensity(address)
  }

  private async getCurrentLevel(address: Address): Promise<TrustLevel> {
    const score = await this.service.getReputation(address)
    return score.level
  }

  private async getLastViolationTimestamp(
    address: Address
  ): Promise<number | undefined> {
    const violations = await this.service.getViolations(address)
    if (violations.length === 0) return undefined
    return violations[0].createdAt
  }
}

// Singleton instance
let adapter: DWSReputationAdapter | null = null

export function getDWSReputationAdapter(): DWSReputationAdapter {
  if (!adapter) {
    adapter = new DWSReputationAdapter()
  }
  return adapter
}

export function resetDWSReputationAdapter(): void {
  adapter = null
}

