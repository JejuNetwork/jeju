/**
 * Reputation-Based Trust Service
 *
 * Implements graduated trust levels for AI moderation intensity.
 * Higher reputation users get less scrutiny and faster deployments.
 *
 * Trust Factors:
 * - Account age
 * - Successful deployments
 * - Staked tokens
 * - Verified identity
 * - Community vouches
 * - Historical violations
 *
 * Trust Levels:
 * 1. New (0-99): Full AI moderation, manual review queue
 * 2. Basic (100-499): Standard AI moderation
 * 3. Trusted (500-999): Reduced AI moderation
 * 4. Verified (1000-4999): Minimal AI moderation
 * 5. Elite (5000+): Bypass most AI checks
 */

import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import type { Address } from 'viem'

// ============ Types ============

export type TrustLevel = 'new' | 'basic' | 'trusted' | 'verified' | 'elite'

export interface ReputationScore {
  address: Address
  totalScore: number
  level: TrustLevel
  components: {
    accountAge: number // Days since registration
    successfulDeployments: number
    stakedTokens: bigint
    identityVerified: boolean
    communityVouches: number
    violations: number
    violationSeverity: number // Weighted sum of violation severity
  }
  calculatedScore: {
    ageScore: number
    deploymentScore: number
    stakeScore: number
    identityScore: number
    vouchScore: number
    violationPenalty: number
  }
  lastUpdated: number
  createdAt: number
}

export interface ModerationIntensity {
  level: TrustLevel
  score: number
  aiScanRequired: boolean
  aiScanDepth: 'full' | 'standard' | 'quick' | 'minimal' | 'none'
  manualReviewRequired: boolean
  deploymentDelay: number // Seconds to wait before deployment
  bandwidthLimit: number // MB/s limit during review
  allowedContentTypes: string[]
  blockedFeatures: string[]
}

export interface Violation {
  id: string
  address: Address
  type: 'content' | 'tos' | 'abuse' | 'spam' | 'fraud'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  evidence: string
  penaltyApplied: number
  createdAt: number
  resolvedAt?: number
  appealStatus?: 'pending' | 'approved' | 'denied'
}

export interface CommunityVouch {
  id: string
  voucher: Address
  vouchee: Address
  weight: number
  message: string
  createdAt: number
  revokedAt?: number
}

// ============ Constants ============

const TRUST_THRESHOLDS: Record<TrustLevel, number> = {
  new: 0,
  basic: 100,
  trusted: 500,
  verified: 1000,
  elite: 5000,
}

const MODERATION_CONFIG: Record<TrustLevel, ModerationIntensity> = {
  new: {
    level: 'new',
    score: 0,
    aiScanRequired: true,
    aiScanDepth: 'full',
    manualReviewRequired: true,
    deploymentDelay: 300, // 5 minutes
    bandwidthLimit: 10, // 10 MB/s
    allowedContentTypes: [
      'text/html',
      'text/css',
      'text/javascript',
      'image/*',
    ],
    blockedFeatures: [
      'websockets',
      'outbound-http',
      'crypto-mining',
      'tor-exit',
    ],
  },
  basic: {
    level: 'basic',
    score: 100,
    aiScanRequired: true,
    aiScanDepth: 'standard',
    manualReviewRequired: false,
    deploymentDelay: 60, // 1 minute
    bandwidthLimit: 50,
    allowedContentTypes: ['*'],
    blockedFeatures: ['crypto-mining', 'tor-exit'],
  },
  trusted: {
    level: 'trusted',
    score: 500,
    aiScanRequired: true,
    aiScanDepth: 'quick',
    manualReviewRequired: false,
    deploymentDelay: 10,
    bandwidthLimit: 200,
    allowedContentTypes: ['*'],
    blockedFeatures: ['crypto-mining'],
  },
  verified: {
    level: 'verified',
    score: 1000,
    aiScanRequired: true,
    aiScanDepth: 'minimal',
    manualReviewRequired: false,
    deploymentDelay: 0,
    bandwidthLimit: 1000,
    allowedContentTypes: ['*'],
    blockedFeatures: [],
  },
  elite: {
    level: 'elite',
    score: 5000,
    aiScanRequired: false,
    aiScanDepth: 'none',
    manualReviewRequired: false,
    deploymentDelay: 0,
    bandwidthLimit: -1, // Unlimited
    allowedContentTypes: ['*'],
    blockedFeatures: [],
  },
}

// Score weights
const SCORE_WEIGHTS = {
  agePerDay: 1, // 1 point per day
  ageMax: 365, // Max 365 points from age
  deploymentSuccess: 5, // 5 points per successful deployment
  deploymentMax: 1000, // Max 1000 points from deployments
  stakedPerEth: 100, // 100 points per ETH staked
  stakeMax: 2000, // Max 2000 points from staking
  identityVerified: 500, // 500 points for verified identity
  vouchPerVouch: 50, // 50 points per vouch
  vouchMax: 500, // Max 500 points from vouches
  violationPenalty: {
    low: -50,
    medium: -200,
    high: -500,
    critical: -2000,
  },
}

// ============ Database ============

const REPUTATION_DATABASE_ID = 'dws-reputation'
let sqlitClient: SQLitClient | null = null

async function getSQLitClient(): Promise<SQLitClient> {
  if (!sqlitClient) {
    sqlitClient = getSQLit()
    await ensureReputationTables()
  }
  return sqlitClient
}

async function ensureReputationTables(): Promise<void> {
  if (!sqlitClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS reputation_scores (
      address TEXT PRIMARY KEY,
      total_score INTEGER DEFAULT 0,
      account_age_days INTEGER DEFAULT 0,
      successful_deployments INTEGER DEFAULT 0,
      staked_tokens TEXT DEFAULT '0',
      identity_verified INTEGER DEFAULT 0,
      community_vouches INTEGER DEFAULT 0,
      violations INTEGER DEFAULT 0,
      violation_severity INTEGER DEFAULT 0,
      last_updated INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS violations (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT,
      evidence TEXT,
      penalty_applied INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      appeal_status TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS community_vouches (
      id TEXT PRIMARY KEY,
      voucher TEXT NOT NULL,
      vouchee TEXT NOT NULL,
      weight INTEGER DEFAULT 1,
      message TEXT,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS deployment_history (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      deployment_id TEXT NOT NULL,
      status TEXT NOT NULL,
      moderation_level TEXT NOT NULL,
      ai_scan_result TEXT,
      created_at INTEGER NOT NULL
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_violations_address ON violations(address)',
    'CREATE INDEX IF NOT EXISTS idx_violations_type ON violations(type)',
    'CREATE INDEX IF NOT EXISTS idx_vouches_voucher ON community_vouches(voucher)',
    'CREATE INDEX IF NOT EXISTS idx_vouches_vouchee ON community_vouches(vouchee)',
    'CREATE INDEX IF NOT EXISTS idx_deployments_address ON deployment_history(address)',
  ]

  for (const ddl of tables) {
    await sqlitClient.exec(ddl, [], REPUTATION_DATABASE_ID)
  }

  for (const idx of indexes) {
    await sqlitClient.exec(idx, [], REPUTATION_DATABASE_ID)
  }

  console.log('[Reputation] SQLit tables ensured')
}

// ============ Main Service ============

export class ReputationService {
  /**
   * Get reputation score for an address
   */
  async getReputation(address: Address): Promise<ReputationScore> {
    const client = await getSQLitClient()

    const result = await client.query<{
      total_score: number
      account_age_days: number
      successful_deployments: number
      staked_tokens: string
      identity_verified: number
      community_vouches: number
      violations: number
      violation_severity: number
      last_updated: number
      created_at: number
    }>(
      'SELECT * FROM reputation_scores WHERE address = ?',
      [address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    const now = Date.now()

    if (result.rows.length === 0) {
      // New user - create entry
      await this.initializeUser(address)
      return {
        address,
        totalScore: 0,
        level: 'new',
        components: {
          accountAge: 0,
          successfulDeployments: 0,
          stakedTokens: 0n,
          identityVerified: false,
          communityVouches: 0,
          violations: 0,
          violationSeverity: 0,
        },
        calculatedScore: {
          ageScore: 0,
          deploymentScore: 0,
          stakeScore: 0,
          identityScore: 0,
          vouchScore: 0,
          violationPenalty: 0,
        },
        lastUpdated: now,
        createdAt: now,
      }
    }

    const row = result.rows[0]
    const ageScore = Math.min(
      row.account_age_days * SCORE_WEIGHTS.agePerDay,
      SCORE_WEIGHTS.ageMax,
    )
    const deploymentScore = Math.min(
      row.successful_deployments * SCORE_WEIGHTS.deploymentSuccess,
      SCORE_WEIGHTS.deploymentMax,
    )
    const stakedTokens = BigInt(row.staked_tokens)
    const stakeScore = Math.min(
      Number(stakedTokens / BigInt(1e18)) * SCORE_WEIGHTS.stakedPerEth,
      SCORE_WEIGHTS.stakeMax,
    )
    const identityScore = row.identity_verified
      ? SCORE_WEIGHTS.identityVerified
      : 0
    const vouchScore = Math.min(
      row.community_vouches * SCORE_WEIGHTS.vouchPerVouch,
      SCORE_WEIGHTS.vouchMax,
    )
    const violationPenalty = row.violation_severity

    const totalScore = Math.max(
      0,
      ageScore +
        deploymentScore +
        stakeScore +
        identityScore +
        vouchScore -
        violationPenalty,
    )

    return {
      address,
      totalScore,
      level: this.getTrustLevel(totalScore),
      components: {
        accountAge: row.account_age_days,
        successfulDeployments: row.successful_deployments,
        stakedTokens,
        identityVerified: row.identity_verified === 1,
        communityVouches: row.community_vouches,
        violations: row.violations,
        violationSeverity: row.violation_severity,
      },
      calculatedScore: {
        ageScore,
        deploymentScore,
        stakeScore,
        identityScore,
        vouchScore,
        violationPenalty,
      },
      lastUpdated: row.last_updated,
      createdAt: row.created_at,
    }
  }

  /**
   * Get moderation intensity for an address
   */
  async getModerationIntensity(address: Address): Promise<ModerationIntensity> {
    const reputation = await this.getReputation(address)
    const config = MODERATION_CONFIG[reputation.level]
    return {
      ...config,
      score: reputation.totalScore,
    }
  }

  /**
   * Record a successful deployment
   */
  async recordDeployment(
    address: Address,
    deploymentId: string,
    status: 'success' | 'failed' | 'rejected',
    moderationLevel: TrustLevel,
    aiScanResult?: string,
  ): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()
    const id = `dep-${now}-${Math.random().toString(36).slice(2)}`

    // Record deployment
    await client.exec(
      `INSERT INTO deployment_history (id, address, deployment_id, status, moderation_level, ai_scan_result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        address.toLowerCase(),
        deploymentId,
        status,
        moderationLevel,
        aiScanResult ?? null,
        now,
      ],
      REPUTATION_DATABASE_ID,
    )

    // Update successful deployments count
    if (status === 'success') {
      await client.exec(
        `UPDATE reputation_scores 
         SET successful_deployments = successful_deployments + 1,
             last_updated = ?
         WHERE address = ?`,
        [now, address.toLowerCase()],
        REPUTATION_DATABASE_ID,
      )
      await this.recalculateScore(address)
    }
  }

  /**
   * Record a violation
   */
  async recordViolation(
    address: Address,
    type: Violation['type'],
    severity: Violation['severity'],
    description: string,
    evidence: string,
  ): Promise<Violation> {
    const client = await getSQLitClient()
    const now = Date.now()
    const id = `vio-${now}-${Math.random().toString(36).slice(2)}`

    const penalty = Math.abs(SCORE_WEIGHTS.violationPenalty[severity])

    await client.exec(
      `INSERT INTO violations (id, address, type, severity, description, evidence, penalty_applied, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        address.toLowerCase(),
        type,
        severity,
        description,
        evidence,
        penalty,
        now,
      ],
      REPUTATION_DATABASE_ID,
    )

    // Update violation counts
    await client.exec(
      `UPDATE reputation_scores 
       SET violations = violations + 1,
           violation_severity = violation_severity + ?,
           last_updated = ?
       WHERE address = ?`,
      [penalty, now, address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    await this.recalculateScore(address)

    return {
      id,
      address,
      type,
      severity,
      description,
      evidence,
      penaltyApplied: penalty,
      createdAt: now,
    }
  }

  /**
   * Add a community vouch
   */
  async addVouch(
    voucher: Address,
    vouchee: Address,
    message: string,
  ): Promise<CommunityVouch> {
    // Voucher must have at least 'trusted' level
    const voucherRep = await this.getReputation(voucher)
    if (voucherRep.totalScore < TRUST_THRESHOLDS.trusted) {
      throw new Error('Voucher must have at least trusted reputation level')
    }

    // Can't vouch for self
    if (voucher.toLowerCase() === vouchee.toLowerCase()) {
      throw new Error('Cannot vouch for yourself')
    }

    const client = await getSQLitClient()
    const now = Date.now()
    const id = `vouch-${now}-${Math.random().toString(36).slice(2)}`

    // Check existing vouch
    const existing = await client.query(
      `SELECT id FROM community_vouches 
       WHERE voucher = ? AND vouchee = ? AND revoked_at IS NULL`,
      [voucher.toLowerCase(), vouchee.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    if (existing.rows.length > 0) {
      throw new Error('Already vouched for this user')
    }

    // Calculate weight based on voucher's reputation
    const weight = Math.floor(voucherRep.totalScore / 1000) + 1

    await client.exec(
      `INSERT INTO community_vouches (id, voucher, vouchee, weight, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, voucher.toLowerCase(), vouchee.toLowerCase(), weight, message, now],
      REPUTATION_DATABASE_ID,
    )

    // Update vouchee's vouch count
    await client.exec(
      `UPDATE reputation_scores 
       SET community_vouches = community_vouches + 1,
           last_updated = ?
       WHERE address = ?`,
      [now, vouchee.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    await this.recalculateScore(vouchee)

    return {
      id,
      voucher,
      vouchee,
      weight,
      message,
      createdAt: now,
    }
  }

  /**
   * Revoke a vouch
   */
  async revokeVouch(voucher: Address, vouchee: Address): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    await client.exec(
      `UPDATE community_vouches 
       SET revoked_at = ?
       WHERE voucher = ? AND vouchee = ? AND revoked_at IS NULL`,
      [now, voucher.toLowerCase(), vouchee.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    // Update vouchee's vouch count
    await client.exec(
      `UPDATE reputation_scores 
       SET community_vouches = CASE WHEN community_vouches > 0 THEN community_vouches - 1 ELSE 0 END,
           last_updated = ?
       WHERE address = ?`,
      [now, vouchee.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    await this.recalculateScore(vouchee)
  }

  /**
   * Update staked tokens
   */
  async updateStakedTokens(address: Address, amount: bigint): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    await client.exec(
      `UPDATE reputation_scores 
       SET staked_tokens = ?,
           last_updated = ?
       WHERE address = ?`,
      [amount.toString(), now, address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    await this.recalculateScore(address)
  }

  /**
   * Mark identity as verified
   */
  async verifyIdentity(address: Address): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    await client.exec(
      `UPDATE reputation_scores 
       SET identity_verified = 1,
           last_updated = ?
       WHERE address = ?`,
      [now, address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    await this.recalculateScore(address)
  }

  /**
   * Get violations for an address
   */
  async getViolations(address: Address): Promise<Violation[]> {
    const client = await getSQLitClient()

    const result = await client.query<{
      id: string
      address: string
      type: string
      severity: string
      description: string
      evidence: string
      penalty_applied: number
      created_at: number
      resolved_at: number | null
      appeal_status: string | null
    }>(
      'SELECT * FROM violations WHERE address = ? ORDER BY created_at DESC',
      [address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    return result.rows.map((row) => ({
      id: row.id,
      address: row.address as Address,
      type: row.type as Violation['type'],
      severity: row.severity as Violation['severity'],
      description: row.description,
      evidence: row.evidence,
      penaltyApplied: row.penalty_applied,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
      appealStatus: row.appeal_status as Violation['appealStatus'] | undefined,
    }))
  }

  /**
   * Appeal a violation
   */
  async appealViolation(address: Address, violationId: string): Promise<void> {
    const client = await getSQLitClient()

    // Verify violation belongs to address
    const result = await client.query(
      'SELECT * FROM violations WHERE id = ? AND address = ?',
      [violationId, address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    if (result.rows.length === 0) {
      throw new Error('Violation not found')
    }

    await client.exec(
      `UPDATE violations SET appeal_status = 'pending' WHERE id = ?`,
      [violationId],
      REPUTATION_DATABASE_ID,
    )
  }

  /**
   * Resolve appeal
   */
  async resolveAppeal(violationId: string, approved: boolean): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    const result = await client.query<{
      address: string
      penalty_applied: number
    }>(
      'SELECT address, penalty_applied FROM violations WHERE id = ?',
      [violationId],
      REPUTATION_DATABASE_ID,
    )

    if (result.rows.length === 0) {
      throw new Error('Violation not found')
    }

    const { address, penalty_applied } = result.rows[0]

    await client.exec(
      `UPDATE violations 
       SET appeal_status = ?,
           resolved_at = CASE WHEN ? THEN ? ELSE resolved_at END
       WHERE id = ?`,
      [approved ? 'approved' : 'denied', approved ? 1 : 0, now, violationId],
      REPUTATION_DATABASE_ID,
    )

    // If approved, remove penalty
    if (approved) {
      await client.exec(
        `UPDATE reputation_scores 
         SET violations = CASE WHEN violations > 0 THEN violations - 1 ELSE 0 END,
             violation_severity = CASE WHEN violation_severity > ? THEN violation_severity - ? ELSE 0 END,
             last_updated = ?
         WHERE address = ?`,
        [penalty_applied, penalty_applied, now, address],
        REPUTATION_DATABASE_ID,
      )

      await this.recalculateScore(address as Address)
    }
  }

  /**
   * Update account age (called daily by cron)
   */
  async updateAccountAges(): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    await client.exec(
      `UPDATE reputation_scores 
       SET account_age_days = (? - created_at) / 86400000,
           last_updated = ?`,
      [now, now],
      REPUTATION_DATABASE_ID,
    )
  }

  // ============ Internal Methods ============

  private async initializeUser(address: Address): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    await client.exec(
      `INSERT INTO reputation_scores (address, last_updated, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(address) DO NOTHING`,
      [address.toLowerCase(), now, now],
      REPUTATION_DATABASE_ID,
    )
  }

  private async recalculateScore(address: Address): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    const result = await client.query<{
      account_age_days: number
      successful_deployments: number
      staked_tokens: string
      identity_verified: number
      community_vouches: number
      violation_severity: number
    }>(
      'SELECT * FROM reputation_scores WHERE address = ?',
      [address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )

    if (result.rows.length === 0) return

    const row = result.rows[0]
    const ageScore = Math.min(
      row.account_age_days * SCORE_WEIGHTS.agePerDay,
      SCORE_WEIGHTS.ageMax,
    )
    const deploymentScore = Math.min(
      row.successful_deployments * SCORE_WEIGHTS.deploymentSuccess,
      SCORE_WEIGHTS.deploymentMax,
    )
    const stakeScore = Math.min(
      Number(BigInt(row.staked_tokens) / BigInt(1e18)) *
        SCORE_WEIGHTS.stakedPerEth,
      SCORE_WEIGHTS.stakeMax,
    )
    const identityScore = row.identity_verified
      ? SCORE_WEIGHTS.identityVerified
      : 0
    const vouchScore = Math.min(
      row.community_vouches * SCORE_WEIGHTS.vouchPerVouch,
      SCORE_WEIGHTS.vouchMax,
    )

    const totalScore = Math.max(
      0,
      ageScore +
        deploymentScore +
        stakeScore +
        identityScore +
        vouchScore -
        row.violation_severity,
    )

    await client.exec(
      `UPDATE reputation_scores SET total_score = ?, last_updated = ? WHERE address = ?`,
      [totalScore, now, address.toLowerCase()],
      REPUTATION_DATABASE_ID,
    )
  }

  private getTrustLevel(score: number): TrustLevel {
    if (score >= TRUST_THRESHOLDS.elite) return 'elite'
    if (score >= TRUST_THRESHOLDS.verified) return 'verified'
    if (score >= TRUST_THRESHOLDS.trusted) return 'trusted'
    if (score >= TRUST_THRESHOLDS.basic) return 'basic'
    return 'new'
  }
}

// ============ Singleton ============

let reputationService: ReputationService | null = null

export function getReputationService(): ReputationService {
  if (!reputationService) {
    reputationService = new ReputationService()
  }
  return reputationService
}

// ============ Integration with Moderation ============

/**
 * Determine if deployment should be moderated and how
 */
export async function shouldModerateDeployment(address: Address): Promise<{
  shouldModerate: boolean
  intensity: ModerationIntensity
  reputation: ReputationScore
}> {
  const service = getReputationService()
  const reputation = await service.getReputation(address)
  const intensity = await service.getModerationIntensity(address)

  return {
    shouldModerate: intensity.aiScanRequired || intensity.manualReviewRequired,
    intensity,
    reputation,
  }
}

/**
 * Apply moderation result to reputation
 */
export async function applyModerationResult(
  address: Address,
  deploymentId: string,
  passed: boolean,
  moderationLevel: TrustLevel,
  aiScanResult?: string,
  violation?: {
    type: Violation['type']
    severity: Violation['severity']
    description: string
    evidence: string
  },
): Promise<void> {
  const service = getReputationService()

  await service.recordDeployment(
    address,
    deploymentId,
    passed ? 'success' : 'rejected',
    moderationLevel,
    aiScanResult,
  )

  if (!passed && violation) {
    await service.recordViolation(
      address,
      violation.type,
      violation.severity,
      violation.description,
      violation.evidence,
    )
  }
}
