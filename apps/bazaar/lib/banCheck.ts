/**
 * Ban Check for Bazaar
 * Uses shared ModerationAPI with bazaar-specific extensions
 */

import {
  BanType,
  createModerationAPI,
  type ModerationConfig,
  getBanTypeLabel as sharedGetBanTypeLabel,
} from '@jejunetwork/shared'
import { type Address, createPublicClient, http } from 'viem'
import { CONTRACTS, RPC_URL } from '../config'
import { jeju } from '../config/chains'

// ============ Types ============

// Re-export shared types
export { BanType }

export interface BanCheckResult {
  allowed: boolean
  reason?: string
  banType?: BanType
  networkBanned?: boolean
  appBanned?: boolean
  onNotice?: boolean
  caseId?: string
  canAppeal?: boolean
}

export interface QuorumStatus {
  reached: boolean
  currentCount: bigint
  requiredCount: bigint
}

export enum ReputationTier {
  UNTRUSTED = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  TRUSTED = 4,
}

export interface ModeratorReputation {
  successfulBans: bigint
  unsuccessfulBans: bigint
  totalSlashedFrom: bigint
  totalSlashedOthers: bigint
  reputationScore: bigint
  lastReportTimestamp: bigint
  reportCooldownUntil: bigint
  tier: ReputationTier
  netPnL: bigint
  winRate: number
}

// ============ Config ============

const config: ModerationConfig = {
  chain: jeju,
  rpcUrl: RPC_URL,
  banManagerAddress: CONTRACTS.banManager || undefined,
  moderationMarketplaceAddress: CONTRACTS.moderationMarketplace || undefined,
  reportingSystemAddress: CONTRACTS.reportingSystem || undefined,
  reputationLabelManagerAddress: CONTRACTS.reputationLabelManager || undefined,
}

// Create singleton API instance
const moderationAPI = createModerationAPI(config)

// Public client for JEJU token checks
const publicClient = createPublicClient({
  chain: jeju,
  transport: http(RPC_URL),
})

const JEJU_TOKEN_ADDRESS = CONTRACTS.jeju || undefined
const JEJU_TOKEN_ABI = [
  {
    name: 'isBanned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'banEnforcementEnabled',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// ============ Cache ============

interface CacheEntry {
  result: BanCheckResult
  cachedAt: number
}

// Security: Bounded cache size to prevent memory exhaustion
const MAX_CACHE_SIZE = 10000
const banCache = new Map<string, CacheEntry>()
const CACHE_TTL = 10000 // 10 seconds

// Race condition protection: Track in-flight requests
const inFlightRequests = new Map<string, Promise<BanCheckResult>>()

// ============ Ban Check Functions ============

/**
 * Check if a user is banned
 * Uses deduplication to prevent race conditions on concurrent requests
 */
export async function checkUserBan(
  userAddress: Address,
): Promise<BanCheckResult> {
  const cacheKey = userAddress.toLowerCase()

  // Check cache first
  const cached = banCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result
  }

  // Check if request is already in-flight (prevents duplicate concurrent requests)
  const inFlight = inFlightRequests.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  // Create and track the request
  const requestPromise = (async (): Promise<BanCheckResult> => {
    const status = await moderationAPI.checkBanStatus(userAddress)

    // Map string banType to enum - handle both string keys and numeric strings
    const banTypeMap: Record<string, BanType> = {
      NONE: BanType.NONE,
      ON_NOTICE: BanType.ON_NOTICE,
      CHALLENGED: BanType.CHALLENGED,
      PERMANENT: BanType.PERMANENT,
      '0': BanType.NONE,
      '1': BanType.ON_NOTICE,
      '2': BanType.CHALLENGED,
      '3': BanType.PERMANENT,
    }
    const banTypeValue = banTypeMap[status.banType.toUpperCase()]

    const result: BanCheckResult = {
      allowed: !status.isBanned,
      reason: status.reason,
      banType: banTypeValue,
      onNotice: status.isOnNotice,
      canAppeal: status.canAppeal,
    }

    // Evict oldest entry if at capacity
    if (banCache.size >= MAX_CACHE_SIZE) {
      const firstKey = banCache.keys().next().value
      if (firstKey) banCache.delete(firstKey)
    }

    banCache.set(cacheKey, { result, cachedAt: Date.now() })
    return result
  })()

  // Track the in-flight request
  inFlightRequests.set(cacheKey, requestPromise)

  try {
    return await requestPromise
  } finally {
    // Clean up in-flight tracking
    inFlightRequests.delete(cacheKey)
  }
}

/**
 * Simple check if user can trade on Bazaar
 */
export async function isTradeAllowed(userAddress: Address): Promise<boolean> {
  const result = await checkUserBan(userAddress)
  return result.allowed
}

/**
 * Check if user can report others
 */
export async function checkCanReport(userAddress: Address): Promise<boolean> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  return profile?.canReport ?? false
}

/**
 * Get user's stake info
 */
export async function getUserStake(userAddress: Address): Promise<{
  amount: bigint
  stakedAt: bigint
  isStaked: boolean
} | null> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  if (!profile) return null
  return {
    amount: BigInt(profile.stakeAmount),
    stakedAt: BigInt(profile.stakedSince),
    isStaked: profile.isStaked,
  }
}

/**
 * Get moderator reputation
 */
export async function getModeratorReputation(
  userAddress: Address,
): Promise<ModeratorReputation | null> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  if (!profile) return null

  // Map tier string to enum
  const tierMap: Record<string, ReputationTier> = {
    UNTRUSTED: ReputationTier.UNTRUSTED,
    LOW: ReputationTier.LOW,
    MEDIUM: ReputationTier.MEDIUM,
    HIGH: ReputationTier.HIGH,
    TRUSTED: ReputationTier.TRUSTED,
  }
  const tier = tierMap[profile.tier.toUpperCase()] ?? ReputationTier.UNTRUSTED

  return {
    successfulBans: BigInt(profile.successfulBans),
    unsuccessfulBans: BigInt(profile.unsuccessfulBans),
    totalSlashedFrom: BigInt(profile.totalLost),
    totalSlashedOthers: BigInt(profile.totalEarned),
    reputationScore: BigInt(profile.reputationScore),
    lastReportTimestamp: 0n, // Not available in shared type
    reportCooldownUntil: 0n, // Not available in shared type
    tier,
    netPnL: BigInt(profile.netPnL),
    winRate: profile.winRate,
  }
}

/**
 * Get required stake for a reporter
 */
export async function getRequiredStakeForReporter(
  userAddress: Address,
): Promise<bigint | null> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  if (!profile) return null
  return BigInt(profile.requiredStake)
}

/**
 * Get quorum required for a reporter
 */
export async function getQuorumRequired(
  userAddress: Address,
): Promise<bigint | null> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  if (!profile) return null
  return BigInt(profile.quorumRequired)
}

/**
 * Check quorum status for a target
 */
export async function checkQuorumStatus(
  _targetAddress: Address,
): Promise<QuorumStatus | null> {
  // This would need the reporting system contract
  // Return null for now - implement if needed
  return null
}

// ============ JEJU Token Functions ============

export async function checkTransferAllowed(
  userAddress: Address,
): Promise<boolean> {
  if (!JEJU_TOKEN_ADDRESS) return true

  const enforcementEnabled = await publicClient
    .readContract({
      address: JEJU_TOKEN_ADDRESS,
      abi: JEJU_TOKEN_ABI,
      functionName: 'banEnforcementEnabled',
    })
    .catch(() => false)

  if (!enforcementEnabled) return true

  const isBanned = await publicClient
    .readContract({
      address: JEJU_TOKEN_ADDRESS,
      abi: JEJU_TOKEN_ABI,
      functionName: 'isBanned',
      args: [userAddress],
    })
    .catch(() => false)

  return !isBanned
}

export async function checkTradeAllowed(
  userAddress: Address,
): Promise<BanCheckResult> {
  const generalResult = await checkUserBan(userAddress)
  if (!generalResult.allowed) return generalResult

  const jejuAllowed = await checkTransferAllowed(userAddress)
  if (!jejuAllowed) {
    return {
      allowed: false,
      reason: 'Banned from JEJU token transfers',
      networkBanned: true,
    }
  }

  return { allowed: true }
}

// ============ Display Helpers ============

export const getBanTypeLabel = sharedGetBanTypeLabel

export function getReputationTierLabel(tier: ReputationTier): string {
  const labels = ['Untrusted', 'Low', 'Medium', 'High', 'Trusted']
  return labels[tier] ?? 'Unknown'
}

export function getReputationTierColor(tier: ReputationTier): string {
  const colors = [
    'text-red-600 bg-red-50',
    'text-orange-600 bg-orange-50',
    'text-yellow-600 bg-yellow-50',
    'text-blue-600 bg-blue-50',
    'text-green-600 bg-green-50',
  ]
  return colors[tier] ?? 'text-gray-600 bg-gray-50'
}

export function formatPnL(pnl: bigint): string {
  const eth = Number(pnl) / 1e18
  const sign = eth >= 0 ? '+' : ''
  return `${sign}${eth.toFixed(4)} ETH`
}

export function clearBanCache(userAddress?: Address): void {
  if (userAddress) {
    banCache.delete(userAddress.toLowerCase())
  } else {
    banCache.clear()
  }
}
