import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import type { Address } from 'viem'

export type TierType = 'free' | 'hobby' | 'pro' | 'enterprise'

export interface TierLimits {
  // Compute
  cpuHoursPerMonth: number
  memoryMbLimit: number
  concurrentDeployments: number
  functionInvocationsPerMonth: number
  functionTimeoutMs: number

  // Storage
  storageGbLimit: number
  bandwidthGbPerMonth: number

  // Git/Pkg
  privateRepos: number
  privatePackages: number
  collaborators: number

  // Cache
  cacheMemoryMb: number
  cacheTtlSeconds: number

  // Network
  customDomains: number
  sslCerts: number

  // Support
  supportLevel: 'community' | 'email' | 'priority' | 'dedicated'

  // Sponsorship
  sponsoredGas: boolean
  sponsoredGasLimitWei: bigint
}

export interface UsageMetrics {
  cpuHoursUsed: number
  functionInvocations: number
  storageGbUsed: number
  bandwidthGbUsed: number
  cacheMemoryUsed: number
  deploymentCount: number
  lastUpdated: number
}

export interface QuotaCheckResult {
  allowed: boolean
  reason?: string
  currentUsage: number
  limit: number
  percentUsed: number
  upgradeRequired: boolean
  suggestedTier?: TierType
}

export interface UserTierStatus {
  address: Address
  tier: TierType
  limits: TierLimits
  usage: UsageMetrics
  quotaResetAt: number // Monthly reset timestamp
  isVerified: boolean
  linkedIdentity?: {
    type: 'github' | 'google' | 'email'
    verifiedAt: number
  }
  sponsoredGasUsed: bigint
  sponsoredGasRemaining: bigint
  createdAt: number
  updatedAt: number
}

// ============ Tier Definitions ============

export const TIER_LIMITS: Record<TierType, TierLimits> = {
  free: {
    cpuHoursPerMonth: 100, // ~3.3 hours/day
    memoryMbLimit: 512,
    concurrentDeployments: 3,
    functionInvocationsPerMonth: 100_000,
    functionTimeoutMs: 10_000, // 10 seconds

    storageGbLimit: 1,
    bandwidthGbPerMonth: 10,

    privateRepos: 0,
    privatePackages: 0,
    collaborators: 3,

    cacheMemoryMb: 64,
    cacheTtlSeconds: 3600, // 1 hour

    customDomains: 0,
    sslCerts: 0,

    supportLevel: 'community',

    sponsoredGas: true,
    sponsoredGasLimitWei: 10_000_000_000_000_000n, // 0.01 ETH
  },

  hobby: {
    cpuHoursPerMonth: 1000, // ~33 hours/day
    memoryMbLimit: 1024,
    concurrentDeployments: 10,
    functionInvocationsPerMonth: 1_000_000,
    functionTimeoutMs: 30_000, // 30 seconds

    storageGbLimit: 10,
    bandwidthGbPerMonth: 100,

    privateRepos: 10,
    privatePackages: 10,
    collaborators: 10,

    cacheMemoryMb: 256,
    cacheTtlSeconds: 86400, // 24 hours

    customDomains: 5,
    sslCerts: 5,

    supportLevel: 'email',

    sponsoredGas: false,
    sponsoredGasLimitWei: 0n,
  },

  pro: {
    cpuHoursPerMonth: 10_000,
    memoryMbLimit: 4096,
    concurrentDeployments: 50,
    functionInvocationsPerMonth: 10_000_000,
    functionTimeoutMs: 60_000, // 1 minute

    storageGbLimit: 100,
    bandwidthGbPerMonth: 1000,

    privateRepos: 100,
    privatePackages: 100,
    collaborators: 50,

    cacheMemoryMb: 1024,
    cacheTtlSeconds: 604800, // 7 days

    customDomains: 50,
    sslCerts: 50,

    supportLevel: 'priority',

    sponsoredGas: false,
    sponsoredGasLimitWei: 0n,
  },

  enterprise: {
    cpuHoursPerMonth: -1, // Unlimited
    memoryMbLimit: 32768,
    concurrentDeployments: -1, // Unlimited
    functionInvocationsPerMonth: -1, // Unlimited
    functionTimeoutMs: 900_000, // 15 minutes

    storageGbLimit: 1000,
    bandwidthGbPerMonth: -1, // Unlimited

    privateRepos: -1, // Unlimited
    privatePackages: -1, // Unlimited
    collaborators: -1, // Unlimited

    cacheMemoryMb: 10240,
    cacheTtlSeconds: 2592000, // 30 days

    customDomains: -1, // Unlimited
    sslCerts: -1, // Unlimited

    supportLevel: 'dedicated',

    sponsoredGas: false,
    sponsoredGasLimitWei: 0n,
  },
}

// ============ Database ============

const FREE_TIER_DATABASE_ID = 'dws-free-tier'
let eqliteClient: EQLiteClient | null = null

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite()
    await ensureFreeTierTables()
  }
  return eqliteClient
}

async function ensureFreeTierTables(): Promise<void> {
  if (!eqliteClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS user_tiers (
      address TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      is_verified INTEGER DEFAULT 0,
      linked_identity_type TEXT,
      linked_identity_verified_at INTEGER,
      quota_reset_at INTEGER NOT NULL,
      sponsored_gas_used TEXT DEFAULT '0',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS usage_metrics (
      address TEXT PRIMARY KEY,
      cpu_hours_used REAL DEFAULT 0,
      function_invocations INTEGER DEFAULT 0,
      storage_gb_used REAL DEFAULT 0,
      bandwidth_gb_used REAL DEFAULT 0,
      cache_memory_used INTEGER DEFAULT 0,
      deployment_count INTEGER DEFAULT 0,
      last_updated INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      event_type TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      amount REAL NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS gas_sponsorship (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      gas_amount TEXT NOT NULL,
      sponsored_amount TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_usage_events_address ON usage_events(address)',
    'CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type)',
    'CREATE INDEX IF NOT EXISTS idx_gas_sponsorship_address ON gas_sponsorship(address)',
  ]

  for (const ddl of tables) {
    await eqliteClient.exec(ddl, [], FREE_TIER_DATABASE_ID)
  }

  for (const idx of indexes) {
    await eqliteClient.exec(idx, [], FREE_TIER_DATABASE_ID)
  }

  console.log('[FreeTier] EQLite tables ensured')
}

// ============ Main Service ============

export class FreeTierService {
  /**
   * Get user's tier status
   */
  async getUserStatus(address: Address): Promise<UserTierStatus> {
    const client = await getEQLiteClient()

    // Get tier info
    const tierResult = await client.query<{
      tier: string
      is_verified: number
      linked_identity_type: string | null
      linked_identity_verified_at: number | null
      quota_reset_at: number
      sponsored_gas_used: string
      created_at: number
      updated_at: number
    }>(
      'SELECT * FROM user_tiers WHERE address = ?',
      [address.toLowerCase()],
      FREE_TIER_DATABASE_ID,
    )

    // Get usage metrics
    const usageResult = await client.query<{
      cpu_hours_used: number
      function_invocations: number
      storage_gb_used: number
      bandwidth_gb_used: number
      cache_memory_used: number
      deployment_count: number
      last_updated: number
    }>(
      'SELECT * FROM usage_metrics WHERE address = ?',
      [address.toLowerCase()],
      FREE_TIER_DATABASE_ID,
    )

    const now = Date.now()

    if (tierResult.rows.length === 0) {
      // New user - create with free tier
      const newStatus: UserTierStatus = {
        address,
        tier: 'free',
        limits: TIER_LIMITS.free,
        usage: {
          cpuHoursUsed: 0,
          functionInvocations: 0,
          storageGbUsed: 0,
          bandwidthGbUsed: 0,
          cacheMemoryUsed: 0,
          deploymentCount: 0,
          lastUpdated: now,
        },
        quotaResetAt: this.getNextMonthStart(),
        isVerified: false,
        sponsoredGasUsed: 0n,
        sponsoredGasRemaining: TIER_LIMITS.free.sponsoredGasLimitWei,
        createdAt: now,
        updatedAt: now,
      }

      await this.createUser(address)
      return newStatus
    }

    const tierRow = tierResult.rows[0]
    const tier = tierRow.tier as TierType
    const limits = TIER_LIMITS[tier]
    const sponsoredGasUsed = BigInt(tierRow.sponsored_gas_used)

    // Check if quota needs reset (monthly)
    let usage: UsageMetrics
    if (tierRow.quota_reset_at <= now) {
      // Reset usage for new month
      await this.resetMonthlyUsage(address)
      usage = {
        cpuHoursUsed: 0,
        functionInvocations: 0,
        storageGbUsed: 0,
        bandwidthGbUsed: 0,
        cacheMemoryUsed: 0,
        deploymentCount: 0,
        lastUpdated: now,
      }
    } else if (usageResult.rows.length > 0) {
      const usageRow = usageResult.rows[0]
      usage = {
        cpuHoursUsed: usageRow.cpu_hours_used,
        functionInvocations: usageRow.function_invocations,
        storageGbUsed: usageRow.storage_gb_used,
        bandwidthGbUsed: usageRow.bandwidth_gb_used,
        cacheMemoryUsed: usageRow.cache_memory_used,
        deploymentCount: usageRow.deployment_count,
        lastUpdated: usageRow.last_updated,
      }
    } else {
      usage = {
        cpuHoursUsed: 0,
        functionInvocations: 0,
        storageGbUsed: 0,
        bandwidthGbUsed: 0,
        cacheMemoryUsed: 0,
        deploymentCount: 0,
        lastUpdated: now,
      }
    }

    return {
      address,
      tier,
      limits,
      usage,
      quotaResetAt:
        tierRow.quota_reset_at > now
          ? tierRow.quota_reset_at
          : this.getNextMonthStart(),
      isVerified: tierRow.is_verified === 1,
      linkedIdentity: tierRow.linked_identity_type
        ? {
            type: tierRow.linked_identity_type as 'github' | 'google' | 'email',
            verifiedAt: tierRow.linked_identity_verified_at ?? 0,
          }
        : undefined,
      sponsoredGasUsed,
      sponsoredGasRemaining:
        limits.sponsoredGas && limits.sponsoredGasLimitWei > sponsoredGasUsed
          ? limits.sponsoredGasLimitWei - sponsoredGasUsed
          : 0n,
      createdAt: tierRow.created_at,
      updatedAt: tierRow.updated_at,
    }
  }

  /**
   * Check if user can use a specific resource
   */
  async checkQuota(
    address: Address,
    resource:
      | 'cpu_hours'
      | 'function_invocations'
      | 'storage_gb'
      | 'bandwidth_gb'
      | 'deployments'
      | 'cache_memory',
    requestedAmount: number = 1,
  ): Promise<QuotaCheckResult> {
    const status = await this.getUserStatus(address)

    let currentUsage: number
    let limit: number

    switch (resource) {
      case 'cpu_hours':
        currentUsage = status.usage.cpuHoursUsed
        limit = status.limits.cpuHoursPerMonth
        break
      case 'function_invocations':
        currentUsage = status.usage.functionInvocations
        limit = status.limits.functionInvocationsPerMonth
        break
      case 'storage_gb':
        currentUsage = status.usage.storageGbUsed
        limit = status.limits.storageGbLimit
        break
      case 'bandwidth_gb':
        currentUsage = status.usage.bandwidthGbUsed
        limit = status.limits.bandwidthGbPerMonth
        break
      case 'deployments':
        currentUsage = status.usage.deploymentCount
        limit = status.limits.concurrentDeployments
        break
      case 'cache_memory':
        currentUsage = status.usage.cacheMemoryUsed
        limit = status.limits.cacheMemoryMb
        break
    }

    // -1 means unlimited
    if (limit === -1) {
      return {
        allowed: true,
        currentUsage,
        limit: -1,
        percentUsed: 0,
        upgradeRequired: false,
      }
    }

    const afterUsage = currentUsage + requestedAmount
    const allowed = afterUsage <= limit
    const percentUsed = (afterUsage / limit) * 100

    let suggestedTier: TierType | undefined
    if (!allowed || percentUsed > 80) {
      suggestedTier = this.getSuggestedUpgrade(status.tier)
    }

    return {
      allowed,
      reason: allowed
        ? undefined
        : `${resource} quota exceeded: ${afterUsage}/${limit}`,
      currentUsage,
      limit,
      percentUsed: Math.min(100, percentUsed),
      upgradeRequired: !allowed,
      suggestedTier,
    }
  }

  /**
   * Record resource usage
   */
  async recordUsage(
    address: Address,
    resource:
      | 'cpu_hours'
      | 'function_invocations'
      | 'storage_gb'
      | 'bandwidth_gb'
      | 'deployments'
      | 'cache_memory',
    amount: number,
    metadata?: Record<string, string>,
  ): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()
    const eventId = `evt-${now}-${Math.random().toString(36).slice(2)}`

    // Record event
    await client.exec(
      `INSERT INTO usage_events (id, address, event_type, resource_type, amount, metadata, created_at)
       VALUES (?, ?, 'usage', ?, ?, ?, ?)`,
      [
        eventId,
        address.toLowerCase(),
        resource,
        amount,
        metadata ? JSON.stringify(metadata) : null,
        now,
      ],
      FREE_TIER_DATABASE_ID,
    )

    // Update aggregated metrics
    const columnMap: Record<string, string> = {
      cpu_hours: 'cpu_hours_used',
      function_invocations: 'function_invocations',
      storage_gb: 'storage_gb_used',
      bandwidth_gb: 'bandwidth_gb_used',
      deployments: 'deployment_count',
      cache_memory: 'cache_memory_used',
    }

    const column = columnMap[resource]

    await client.exec(
      `INSERT INTO usage_metrics (address, ${column}, last_updated)
       VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         ${column} = usage_metrics.${column} + ?,
         last_updated = ?`,
      [address.toLowerCase(), amount, now, amount, now],
      FREE_TIER_DATABASE_ID,
    )
  }

  /**
   * Record gas sponsorship usage
   */
  async recordGasSponsorshipUsage(
    address: Address,
    txHash: string,
    gasAmount: bigint,
    sponsoredAmount: bigint,
  ): Promise<{
    allowed: boolean
    remaining: bigint
    reason?: string
  }> {
    const status = await this.getUserStatus(address)

    if (!status.limits.sponsoredGas) {
      return {
        allowed: false,
        remaining: 0n,
        reason: 'Gas sponsorship not available for this tier',
      }
    }

    if (sponsoredAmount > status.sponsoredGasRemaining) {
      return {
        allowed: false,
        remaining: status.sponsoredGasRemaining,
        reason: `Sponsored gas limit exceeded: requested ${sponsoredAmount}, remaining ${status.sponsoredGasRemaining}`,
      }
    }

    const client = await getEQLiteClient()
    const now = Date.now()
    const recordId = `gas-${now}-${Math.random().toString(36).slice(2)}`

    // Record sponsorship
    await client.exec(
      `INSERT INTO gas_sponsorship (id, address, tx_hash, gas_amount, sponsored_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        recordId,
        address.toLowerCase(),
        txHash,
        gasAmount.toString(),
        sponsoredAmount.toString(),
        now,
      ],
      FREE_TIER_DATABASE_ID,
    )

    // Update user's sponsored gas used
    const newTotal = status.sponsoredGasUsed + sponsoredAmount
    await client.exec(
      `UPDATE user_tiers SET sponsored_gas_used = ?, updated_at = ? WHERE address = ?`,
      [newTotal.toString(), now, address.toLowerCase()],
      FREE_TIER_DATABASE_ID,
    )

    return {
      allowed: true,
      remaining: status.sponsoredGasRemaining - sponsoredAmount,
    }
  }

  /**
   * Check if gas sponsorship is available for user
   */
  async canSponsorGas(
    address: Address,
    estimatedGas: bigint,
  ): Promise<{
    canSponsor: boolean
    remaining: bigint
    reason?: string
  }> {
    const status = await this.getUserStatus(address)

    if (!status.limits.sponsoredGas) {
      return {
        canSponsor: false,
        remaining: 0n,
        reason: 'Gas sponsorship not available for this tier',
      }
    }

    if (estimatedGas > status.sponsoredGasRemaining) {
      return {
        canSponsor: false,
        remaining: status.sponsoredGasRemaining,
        reason: 'Insufficient sponsored gas remaining',
      }
    }

    return {
      canSponsor: true,
      remaining: status.sponsoredGasRemaining,
    }
  }

  /**
   * Upgrade user to a new tier
   */
  async upgradeTier(
    address: Address,
    newTier: TierType,
    paymentTxHash?: string,
  ): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    await client.exec(
      `UPDATE user_tiers 
       SET tier = ?, updated_at = ?
       WHERE address = ?`,
      [newTier, now, address.toLowerCase()],
      FREE_TIER_DATABASE_ID,
    )

    // Log upgrade event
    const eventId = `upgrade-${now}-${Math.random().toString(36).slice(2)}`
    await client.exec(
      `INSERT INTO usage_events (id, address, event_type, resource_type, amount, metadata, created_at)
       VALUES (?, ?, 'upgrade', 'tier', 0, ?, ?)`,
      [
        eventId,
        address.toLowerCase(),
        JSON.stringify({ newTier, paymentTxHash }),
        now,
      ],
      FREE_TIER_DATABASE_ID,
    )

    console.log(`[FreeTier] Upgraded ${address} to ${newTier}`)
  }

  /**
   * Verify user identity for tier boost
   */
  async verifyIdentity(
    address: Address,
    identityType: 'github' | 'google' | 'email',
  ): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    await client.exec(
      `UPDATE user_tiers 
       SET is_verified = 1, 
           linked_identity_type = ?, 
           linked_identity_verified_at = ?,
           updated_at = ?
       WHERE address = ?`,
      [identityType, now, now, address.toLowerCase()],
      FREE_TIER_DATABASE_ID,
    )

    console.log(`[FreeTier] Verified ${address} via ${identityType}`)
  }

  /**
   * Get usage report for user
   */
  async getUsageReport(
    address: Address,
    daysBack: number = 30,
  ): Promise<{
    daily: Array<{
      date: string
      cpuHours: number
      invocations: number
      bandwidth: number
    }>
    totals: UsageMetrics
    tier: TierType
    limits: TierLimits
    percentUsed: Record<string, number>
  }> {
    const client = await getEQLiteClient()
    const status = await this.getUserStatus(address)

    const startTime = Date.now() - daysBack * 24 * 60 * 60 * 1000

    const events = await client.query<{
      resource_type: string
      amount: number
      created_at: number
    }>(
      `SELECT resource_type, amount, created_at 
       FROM usage_events 
       WHERE address = ? AND created_at >= ?
       ORDER BY created_at ASC`,
      [address.toLowerCase(), startTime],
      FREE_TIER_DATABASE_ID,
    )

    // Aggregate by day
    const dailyMap = new Map<
      string,
      { cpuHours: number; invocations: number; bandwidth: number }
    >()

    for (const event of events.rows) {
      const date = new Date(event.created_at).toISOString().split('T')[0]
      const existing = dailyMap.get(date) ?? {
        cpuHours: 0,
        invocations: 0,
        bandwidth: 0,
      }

      switch (event.resource_type) {
        case 'cpu_hours':
          existing.cpuHours += event.amount
          break
        case 'function_invocations':
          existing.invocations += event.amount
          break
        case 'bandwidth_gb':
          existing.bandwidth += event.amount
          break
      }

      dailyMap.set(date, existing)
    }

    const daily = Array.from(dailyMap.entries()).map(([date, values]) => ({
      date,
      ...values,
    }))

    const percentUsed: Record<string, number> = {}
    if (status.limits.cpuHoursPerMonth > 0) {
      percentUsed.cpuHours =
        (status.usage.cpuHoursUsed / status.limits.cpuHoursPerMonth) * 100
    }
    if (status.limits.functionInvocationsPerMonth > 0) {
      percentUsed.invocations =
        (status.usage.functionInvocations /
          status.limits.functionInvocationsPerMonth) *
        100
    }
    if (status.limits.storageGbLimit > 0) {
      percentUsed.storage =
        (status.usage.storageGbUsed / status.limits.storageGbLimit) * 100
    }
    if (status.limits.bandwidthGbPerMonth > 0) {
      percentUsed.bandwidth =
        (status.usage.bandwidthGbUsed / status.limits.bandwidthGbPerMonth) * 100
    }

    return {
      daily,
      totals: status.usage,
      tier: status.tier,
      limits: status.limits,
      percentUsed,
    }
  }

  // ============ Internal Methods ============

  private async createUser(address: Address): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    await client.exec(
      `INSERT INTO user_tiers (address, tier, quota_reset_at, sponsored_gas_used, created_at, updated_at)
       VALUES (?, 'free', ?, '0', ?, ?)`,
      [address.toLowerCase(), this.getNextMonthStart(), now, now],
      FREE_TIER_DATABASE_ID,
    )

    await client.exec(
      `INSERT INTO usage_metrics (address, last_updated)
       VALUES (?, ?)`,
      [address.toLowerCase(), now],
      FREE_TIER_DATABASE_ID,
    )
  }

  private async resetMonthlyUsage(address: Address): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    // Reset usage metrics (except storage which is cumulative)
    await client.exec(
      `UPDATE usage_metrics 
       SET cpu_hours_used = 0, 
           function_invocations = 0, 
           bandwidth_gb_used = 0,
           deployment_count = 0,
           last_updated = ?
       WHERE address = ?`,
      [now, address.toLowerCase()],
      FREE_TIER_DATABASE_ID,
    )

    // Reset sponsored gas
    await client.exec(
      `UPDATE user_tiers 
       SET quota_reset_at = ?, 
           sponsored_gas_used = '0',
           updated_at = ?
       WHERE address = ?`,
      [this.getNextMonthStart(), now, address.toLowerCase()],
      FREE_TIER_DATABASE_ID,
    )

    console.log(`[FreeTier] Reset monthly usage for ${address}`)
  }

  private getNextMonthStart(): number {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  }

  private getSuggestedUpgrade(currentTier: TierType): TierType {
    switch (currentTier) {
      case 'free':
        return 'hobby'
      case 'hobby':
        return 'pro'
      case 'pro':
        return 'enterprise'
      default:
        return 'enterprise'
    }
  }
}

// ============ Singleton ============

let freeTierService: FreeTierService | null = null

export function getFreeTierService(): FreeTierService {
  if (!freeTierService) {
    freeTierService = new FreeTierService()
  }
  return freeTierService
}

// ============ Middleware ============

/**
 * Middleware to check quota before handling request
 */
export async function checkQuotaMiddleware(
  address: Address,
  resource:
    | 'cpu_hours'
    | 'function_invocations'
    | 'storage_gb'
    | 'bandwidth_gb'
    | 'deployments'
    | 'cache_memory',
  amount: number = 1,
): Promise<
  | { ok: true }
  | {
      ok: false
      status: 402 | 429
      body: {
        error: string
        currentUsage: number
        limit: number
        percentUsed: number
        upgradeUrl: string
        suggestedTier?: TierType
      }
    }
> {
  const service = getFreeTierService()
  const result = await service.checkQuota(address, resource, amount)

  if (result.allowed) {
    return { ok: true }
  }

  return {
    ok: false,
    status: result.upgradeRequired ? 402 : 429,
    body: {
      error: result.reason ?? 'Quota exceeded',
      currentUsage: result.currentUsage,
      limit: result.limit,
      percentUsed: result.percentUsed,
      upgradeUrl: '/upgrade',
      suggestedTier: result.suggestedTier,
    },
  }
}

/**
 * Middleware to record usage after successful request
 */
export async function recordUsageMiddleware(
  address: Address,
  resource:
    | 'cpu_hours'
    | 'function_invocations'
    | 'storage_gb'
    | 'bandwidth_gb'
    | 'deployments'
    | 'cache_memory',
  amount: number,
  metadata?: Record<string, string>,
): Promise<void> {
  const service = getFreeTierService()
  await service.recordUsage(address, resource, amount, metadata)
}
