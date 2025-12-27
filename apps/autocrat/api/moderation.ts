/** Web-of-Trust Moderation - EQLite-backed for workerd compatibility */

import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { keccak256, stringToHex } from 'viem'
import { z } from 'zod'

export const FlagType = {
  DUPLICATE: 'DUPLICATE',
  SPAM: 'SPAM',
  HARMFUL: 'HARMFUL',
  INFEASIBLE: 'INFEASIBLE',
  MISALIGNED: 'MISALIGNED',
  LOW_QUALITY: 'LOW_QUALITY',
  NEEDS_WORK: 'NEEDS_WORK',
} as const
export type FlagType = (typeof FlagType)[keyof typeof FlagType]

export const FlagTypeSchema = z.enum([
  'DUPLICATE',
  'SPAM',
  'HARMFUL',
  'INFEASIBLE',
  'MISALIGNED',
  'LOW_QUALITY',
  'NEEDS_WORK',
])

/** Validate a flag type value */
export function expectFlagType(value: string): FlagType {
  const result = FlagTypeSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`Invalid flag type: ${value}`)
  }
  return result.data
}

export interface ProposalFlag {
  flagId: string
  proposalId: string
  flagger: string
  flagType: FlagType
  reason: string
  evidence?: string
  stake: number
  reputation: number
  upvotes: number
  downvotes: number
  createdAt: number
  resolved: boolean
  resolution?: 'UPHELD' | 'REJECTED'
}

export interface TrustRelation {
  from: string
  to: string
  score: number
  context: 'MODERATION' | 'PROPOSAL' | 'VOTING' | 'GENERAL'
  updatedAt: number
}
export interface ModerationScore {
  proposalId: string
  visibilityScore: number
  flags: ProposalFlag[]
  trustWeightedFlags: number
  recommendation: 'VISIBLE' | 'REVIEW' | 'HIDDEN'
}
export interface ModeratorStats {
  address: string
  flagsRaised: number
  flagsUpheld: number
  flagsRejected: number
  accuracy: number
  reputation: number
  trustScore: number
}

// Zod schemas for database parsing
const ProposalFlagSchema = z.object({
  flagId: z.string(),
  proposalId: z.string(),
  flagger: z.string(),
  flagType: FlagTypeSchema,
  reason: z.string(),
  evidence: z.string().optional(),
  stake: z.number(),
  reputation: z.number(),
  upvotes: z.number(),
  downvotes: z.number(),
  createdAt: z.number(),
  resolved: z.boolean(),
  resolution: z.enum(['UPHELD', 'REJECTED']).optional(),
})

const ModeratorStatsSchema = z.object({
  address: z.string(),
  flagsRaised: z.number(),
  flagsUpheld: z.number(),
  flagsRejected: z.number(),
  accuracy: z.number(),
  reputation: z.number(),
  trustScore: z.number(),
})

// Database row types
interface FlagRow {
  flag_id: string
  proposal_id: string
  flagger: string
  flag_type: string
  reason: string
  evidence: string | null
  stake: number
  reputation: number
  upvotes: number
  downvotes: number
  created_at: number
  resolved: number
  resolution: string | null
}

interface StatsRow {
  address: string
  flags_raised: number
  flags_upheld: number
  flags_rejected: number
  accuracy: number
  reputation: number
  trust_score: number
}

interface TrustRow {
  from_addr: string
  to_addr: string
  score: number
  context: string
  updated_at: number
}

import { config } from './config'

const EQLITE_DATABASE_ID = config.eqliteDatabaseId

const STAKE: Record<FlagType, number> = {
  DUPLICATE: 10,
  SPAM: 5,
  HARMFUL: 50,
  INFEASIBLE: 20,
  MISALIGNED: 30,
  LOW_QUALITY: 10,
  NEEDS_WORK: 5,
}
const WEIGHT: Record<FlagType, number> = {
  DUPLICATE: 30,
  SPAM: 50,
  HARMFUL: 100,
  INFEASIBLE: 25,
  MISALIGNED: 40,
  LOW_QUALITY: 15,
  NEEDS_WORK: 10,
}

// No in-memory state - use EQLite cache for computed scores

// EQLite/Cache clients
let eqliteClient: EQLiteClient | null = null
let cacheClient: CacheClient | null = null
let tablesInitialized = false

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite({
      databaseId: EQLITE_DATABASE_ID,
      timeout: 30000,
      debug: !config.isProduction,
    })
  }
  return eqliteClient
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('moderation')
  }
  return cacheClient
}

async function ensureTablesExist(): Promise<void> {
  if (tablesInitialized) return

  const client = await getEQLiteClient()

  const tables = [
    `CREATE TABLE IF NOT EXISTS moderation_proposal_flags (
      flag_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      flagger TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence TEXT,
      stake INTEGER NOT NULL,
      reputation INTEGER NOT NULL,
      upvotes INTEGER DEFAULT 0,
      downvotes INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      resolved INTEGER DEFAULT 0,
      resolution TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS moderation_stats (
      address TEXT PRIMARY KEY,
      flags_raised INTEGER DEFAULT 0,
      flags_upheld INTEGER DEFAULT 0,
      flags_rejected INTEGER DEFAULT 0,
      accuracy REAL DEFAULT 50,
      reputation REAL DEFAULT 10,
      trust_score REAL DEFAULT 50
    )`,
    `CREATE TABLE IF NOT EXISTS moderation_trust (
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      score INTEGER NOT NULL,
      context TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (from_addr, to_addr)
    )`,
  ]

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_flags_proposal ON moderation_proposal_flags(proposal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_flags_flagger ON moderation_proposal_flags(flagger)`,
    `CREATE INDEX IF NOT EXISTS idx_flags_resolved ON moderation_proposal_flags(resolved)`,
    `CREATE INDEX IF NOT EXISTS idx_trust_to ON moderation_trust(to_addr)`,
  ]

  for (const ddl of tables) {
    await client.exec(ddl, [], EQLITE_DATABASE_ID)
  }
  for (const idx of indexes) {
    await client.exec(idx, [], EQLITE_DATABASE_ID)
  }

  tablesInitialized = true
}

// Helper to convert row to ProposalFlag
function rowToFlag(row: FlagRow): ProposalFlag {
  return ProposalFlagSchema.parse({
    flagId: row.flag_id,
    proposalId: row.proposal_id,
    flagger: row.flagger,
    flagType: row.flag_type,
    reason: row.reason,
    evidence: row.evidence ?? undefined,
    stake: row.stake,
    reputation: row.reputation,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    createdAt: row.created_at,
    resolved: row.resolved === 1,
    resolution: row.resolution ?? undefined,
  })
}

// Helper to convert row to ModeratorStats
function rowToStats(row: StatsRow): ModeratorStats {
  return ModeratorStatsSchema.parse({
    address: row.address,
    flagsRaised: row.flags_raised,
    flagsUpheld: row.flags_upheld,
    flagsRejected: row.flags_rejected,
    accuracy: row.accuracy,
    reputation: row.reputation,
    trustScore: row.trust_score,
  })
}

export class ModerationSystem {
  async init(): Promise<void> {
    await ensureTablesExist()
  }

  async submitFlag(
    proposalId: string,
    flagger: string,
    flagType: FlagType,
    reason: string,
    stake: number,
    evidence?: string,
  ): Promise<ProposalFlag> {
    if (stake < STAKE[flagType])
      throw new Error(`Minimum stake for ${flagType} is ${STAKE[flagType]}`)

    const s = await this.getModeratorStats(flagger)
    const flagId = keccak256(
      stringToHex(`${proposalId}-${flagger}-${flagType}-${Date.now()}`),
    ).slice(0, 18)

    const flag: ProposalFlag = {
      flagId,
      proposalId,
      flagger,
      flagType,
      reason,
      evidence,
      stake,
      reputation: s.reputation,
      upvotes: 0,
      downvotes: 0,
      createdAt: Date.now(),
      resolved: false,
    }

    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO moderation_proposal_flags 
       (flag_id, proposal_id, flagger, flag_type, reason, evidence, stake, reputation, upvotes, downvotes, created_at, resolved, resolution)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        flag.flagId,
        flag.proposalId,
        flag.flagger,
        flag.flagType,
        flag.reason,
        flag.evidence ?? null,
        flag.stake,
        flag.reputation,
        flag.upvotes,
        flag.downvotes,
        flag.createdAt,
        0,
        null,
      ],
      EQLITE_DATABASE_ID,
    )

    // Update moderator stats
    s.flagsRaised++
    await this.saveModeratorStats(s)

    // Invalidate cache
    await getCache().delete(`flags:${proposalId}`)

    await this.updateScore(proposalId)
    return flag
  }

  async voteOnFlag(
    flagId: string,
    voter: string,
    upvote: boolean,
  ): Promise<void> {
    const client = await getEQLiteClient()
    const result = await client.query<FlagRow>(
      `SELECT * FROM moderation_proposal_flags WHERE flag_id = ?`,
      [flagId],
      EQLITE_DATABASE_ID,
    )

    const row = result.rows[0]
    if (!row || row.resolved === 1) return

    const voterStats = await this.getModeratorStats(voter)
    const weight = Math.max(1, Math.floor(voterStats.reputation / 10))

    const updateField = upvote ? 'upvotes' : 'downvotes'
    const newValue = (upvote ? row.upvotes : row.downvotes) + weight

    await client.exec(
      `UPDATE moderation_proposal_flags SET ${updateField} = ? WHERE flag_id = ?`,
      [newValue, flagId],
      EQLITE_DATABASE_ID,
    )

    await getCache().delete(`flags:${row.proposal_id}`)
    await this.updateScore(row.proposal_id)
  }

  async resolveFlag(flagId: string, upheld: boolean): Promise<void> {
    const client = await getEQLiteClient()
    const result = await client.query<FlagRow>(
      `SELECT * FROM moderation_proposal_flags WHERE flag_id = ?`,
      [flagId],
      EQLITE_DATABASE_ID,
    )

    const row = result.rows[0]
    if (!row || row.resolved === 1) return

    const resolution = upheld ? 'UPHELD' : 'REJECTED'
    await client.exec(
      `UPDATE moderation_proposal_flags SET resolved = 1, resolution = ? WHERE flag_id = ?`,
      [resolution, flagId],
      EQLITE_DATABASE_ID,
    )

    const s = await this.getModeratorStats(row.flagger)
    const w = WEIGHT[row.flag_type as FlagType]

    if (upheld) {
      s.flagsUpheld++
      s.reputation += w / 10
      s.trustScore = Math.min(100, s.trustScore + 5)
    } else {
      s.flagsRejected++
      s.reputation = Math.max(0, s.reputation - w / 20)
      s.trustScore = Math.max(0, s.trustScore - 3)
    }

    s.accuracy =
      (s.flagsUpheld / Math.max(1, s.flagsUpheld + s.flagsRejected)) * 100
    await this.saveModeratorStats(s)

    await getCache().delete(`flags:${row.proposal_id}`)
    await this.updateScore(row.proposal_id)
  }

  async getProposalModerationScore(
    proposalId: string,
  ): Promise<ModerationScore> {
    const cache = getCache()
    const cacheKey = `mod_score:${proposalId}`
    const cached = await cache.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as ModerationScore
      return parsed
    }

    return this.updateScore(proposalId)
  }

  private async updateScore(proposalId: string): Promise<ModerationScore> {
    const active = await this.getProposalFlags(proposalId)
    const unresolvedFlags = active.filter((f) => !f.resolved)

    let weighted = 0
    for (const f of unresolvedFlags) {
      const s = await this.getModeratorStats(f.flagger)
      const tw = s.accuracy / 100
      const vw =
        (f.upvotes - f.downvotes) / Math.max(1, f.upvotes + f.downvotes)
      weighted += WEIGHT[f.flagType] * tw * (1 + vw)
    }

    const vis = Math.max(0, 100 - weighted)
    const rec: ModerationScore['recommendation'] =
      vis < 30 ? 'HIDDEN' : vis < 70 ? 'REVIEW' : 'VISIBLE'
    const score: ModerationScore = {
      proposalId,
      visibilityScore: vis,
      flags: unresolvedFlags,
      trustWeightedFlags: weighted,
      recommendation: rec,
    }

    // Cache the computed score for 60 seconds
    const cache = getCache()
    await cache.set(`mod_score:${proposalId}`, JSON.stringify(score), 60)
    return score
  }

  async getModeratorStats(address: string): Promise<ModeratorStats> {
    const cache = getCache()
    const cached = await cache.get(`stats:${address}`)
    if (cached) {
      const parsed = JSON.parse(cached)
      return ModeratorStatsSchema.parse(parsed)
    }

    const client = await getEQLiteClient()
    const result = await client.query<StatsRow>(
      `SELECT * FROM moderation_stats WHERE address = ?`,
      [address],
      EQLITE_DATABASE_ID,
    )

    if (result.rows[0]) {
      const stats = rowToStats(result.rows[0])
      await cache.set(`stats:${address}`, JSON.stringify(stats), 300)
      return stats
    }

    // Return default stats for new moderator
    return {
      address,
      flagsRaised: 0,
      flagsUpheld: 0,
      flagsRejected: 0,
      accuracy: 50,
      reputation: 10,
      trustScore: 50,
    }
  }

  private async saveModeratorStats(s: ModeratorStats): Promise<void> {
    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO moderation_stats (address, flags_raised, flags_upheld, flags_rejected, accuracy, reputation, trust_score)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         flags_raised = excluded.flags_raised,
         flags_upheld = excluded.flags_upheld,
         flags_rejected = excluded.flags_rejected,
         accuracy = excluded.accuracy,
         reputation = excluded.reputation,
         trust_score = excluded.trust_score`,
      [
        s.address,
        s.flagsRaised,
        s.flagsUpheld,
        s.flagsRejected,
        s.accuracy,
        s.reputation,
        s.trustScore,
      ],
      EQLITE_DATABASE_ID,
    )

    await getCache().delete(`stats:${s.address}`)
  }

  async setTrust(
    from: string,
    to: string,
    score: number,
    context: TrustRelation['context'],
  ): Promise<void> {
    const client = await getEQLiteClient()
    const clampedScore = Math.max(-100, Math.min(100, score))
    const now = Date.now()

    await client.exec(
      `INSERT INTO moderation_trust (from_addr, to_addr, score, context, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_addr, to_addr) DO UPDATE SET
         score = excluded.score,
         context = excluded.context,
         updated_at = excluded.updated_at`,
      [from, to, clampedScore, context, now],
      EQLITE_DATABASE_ID,
    )

    const s = await this.getModeratorStats(to)
    s.trustScore = await this.calcTrust(to)
    await this.saveModeratorStats(s)
  }

  async getTrust(from: string, to: string): Promise<number> {
    const client = await getEQLiteClient()
    const result = await client.query<TrustRow>(
      `SELECT * FROM moderation_trust WHERE from_addr = ? AND to_addr = ?`,
      [from, to],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0].score ?? 0
  }

  private async calcTrust(addr: string): Promise<number> {
    const client = await getEQLiteClient()
    const result = await client.query<{ score: number }>(
      `SELECT score FROM moderation_trust WHERE to_addr = ?`,
      [addr],
      EQLITE_DATABASE_ID,
    )

    if (result.rows.length === 0) return 50

    const total = result.rows.reduce((sum, row) => sum + row.score, 0)
    return Math.round(50 + total / result.rows.length / 2)
  }

  async getProposalFlags(proposalId: string): Promise<ProposalFlag[]> {
    const cache = getCache()
    const cached = await cache.get(`flags:${proposalId}`)
    if (cached) {
      const parsed = JSON.parse(cached) as FlagRow[]
      return parsed.map((row) => rowToFlag(row))
    }

    const client = await getEQLiteClient()
    const result = await client.query<FlagRow>(
      `SELECT * FROM moderation_proposal_flags WHERE proposal_id = ? ORDER BY created_at DESC`,
      [proposalId],
      EQLITE_DATABASE_ID,
    )

    if (result.rows.length > 0) {
      await cache.set(`flags:${proposalId}`, JSON.stringify(result.rows), 60)
    }

    return result.rows.map(rowToFlag)
  }

  async getActiveFlags(): Promise<ProposalFlag[]> {
    const client = await getEQLiteClient()
    const result = await client.query<FlagRow>(
      `SELECT * FROM moderation_proposal_flags WHERE resolved = 0 ORDER BY created_at DESC`,
      [],
      EQLITE_DATABASE_ID,
    )
    return result.rows.map(rowToFlag)
  }

  async getTopModerators(limit = 10): Promise<ModeratorStats[]> {
    const client = await getEQLiteClient()
    const result = await client.query<StatsRow>(
      `SELECT * FROM moderation_stats ORDER BY reputation DESC LIMIT ?`,
      [limit],
      EQLITE_DATABASE_ID,
    )
    return result.rows.map(rowToStats)
  }

  async filterProposals<T extends { proposalId: string }>(
    proposals: T[],
    minVis = 30,
  ): Promise<T[]> {
    const filtered: T[] = []
    for (const p of proposals) {
      const score = await this.getProposalModerationScore(p.proposalId)
      if (score.visibilityScore >= minVis) {
        filtered.push(p)
      }
    }
    return filtered
  }

  async shouldAutoReject(
    proposalId: string,
  ): Promise<{ reject: boolean; reason?: string }> {
    const s = await this.getProposalModerationScore(proposalId)

    if (s.visibilityScore < 10) {
      const top = s.flags.sort(
        (a, b) => WEIGHT[b.flagType] - WEIGHT[a.flagType],
      )[0]
      return { reject: true, reason: top.reason ?? 'Too many flags' }
    }
    if (
      s.flags.filter(
        (f) => f.flagType === FlagType.SPAM && f.upvotes > f.downvotes * 2,
      ).length >= 3
    ) {
      return { reject: true, reason: 'Multiple spam flags' }
    }
    if (
      s.flags.some((f) => f.flagType === FlagType.HARMFUL && f.upvotes > 10)
    ) {
      return { reject: true, reason: 'Flagged harmful' }
    }
    return { reject: false }
  }

  async flush(): Promise<void> {
    // No-op - EQLite persists immediately
  }
}

let instance: ModerationSystem | null = null
export const getModerationSystem = () => {
  if (!instance) {
    instance = new ModerationSystem()
  }
  return instance
}
export const initModeration = async () => {
  await getModerationSystem().init()
}

// Legacy exports for backwards compatibility (no longer needed but kept for API stability)
export function stopSaveInterval(): void {
  // No-op - EQLite doesn't use intervals
}
