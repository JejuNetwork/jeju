/**
 * Ban Check for Bazaar
 * Uses shared ModerationAPI with bazaar-specific extensions
 */

import { type Address, createPublicClient, http, formatEther } from 'viem'
import {
  createModerationAPI,
  BanType,
  type ModerationConfig,
  type BanStatus as SharedBanStatus,
  getBanTypeLabel as sharedGetBanTypeLabel,
  getBanTypeColor as sharedGetBanTypeColor,
} from '@jejunetwork/shared'
import { jeju } from '../config/chains'
import { RPC_URL, CONTRACTS } from '../config'

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
  TRUSTED = 4
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

const banCache = new Map<string, CacheEntry>()
const CACHE_TTL = 10000 // 10 seconds

// ============ Ban Check Functions ============

/**
 * Check if a user is banned
 */
export async function checkUserBan(userAddress: Address): Promise<BanCheckResult> {
  const cacheKey = userAddress.toLowerCase()
  const cached = banCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result
  }

  const status = await moderationAPI.checkBanStatus(userAddress)
  
  const result: BanCheckResult = {
    allowed: !status.isBanned,
    reason: status.reason,
    banType: status.banType,
    networkBanned: status.networkBanned,
    onNotice: status.banType === BanType.ON_NOTICE,
    canAppeal: status.canAppeal,
  }

  banCache.set(cacheKey, { result, cachedAt: Date.now() })
  return result
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
    amount: profile.stakedAmount,
    stakedAt: profile.stakedAt,
    isStaked: profile.isStaked,
  }
}

/**
 * Get moderator reputation
 */
export async function getModeratorReputation(userAddress: Address): Promise<ModeratorReputation | null> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  if (!profile) return null

  const wins = Number(profile.successfulReports)
  const losses = Number(profile.failedReports)
  const total = wins + losses
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 50

  return {
    successfulBans: profile.successfulReports,
    unsuccessfulBans: profile.failedReports,
    totalSlashedFrom: profile.totalSlashedFrom ?? 0n,
    totalSlashedOthers: profile.totalSlashedOthers ?? 0n,
    reputationScore: profile.reputationScore,
    lastReportTimestamp: profile.lastReportTime,
    reportCooldownUntil: profile.cooldownUntil ?? 0n,
    tier: profile.reputationTier as ReputationTier,
    netPnL: profile.netPnL ?? 0n,
    winRate,
  }
}

/**
 * Get required stake for a reporter
 */
export async function getRequiredStakeForReporter(userAddress: Address): Promise<bigint | null> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  return profile?.requiredStake ?? null
}

/**
 * Get quorum required for a reporter
 */
export async function getQuorumRequired(userAddress: Address): Promise<bigint | null> {
  const profile = await moderationAPI.getModeratorProfile(userAddress)
  return profile?.quorumRequired ?? null
}

/**
 * Check quorum status for a target
 */
export async function checkQuorumStatus(targetAddress: Address): Promise<QuorumStatus | null> {
  // This would need the reporting system contract
  // Return null for now - implement if needed
  return null
}

// ============ JEJU Token Functions ============

export async function checkTransferAllowed(userAddress: Address): Promise<boolean> {
  if (!JEJU_TOKEN_ADDRESS) return true

  const enforcementEnabled = await publicClient.readContract({
    address: JEJU_TOKEN_ADDRESS,
    abi: JEJU_TOKEN_ABI,
    functionName: 'banEnforcementEnabled',
  }).catch(() => false)

  if (!enforcementEnabled) return true

  const isBanned = await publicClient.readContract({
    address: JEJU_TOKEN_ADDRESS,
    abi: JEJU_TOKEN_ABI,
    functionName: 'isBanned',
    args: [userAddress],
  }).catch(() => false)

  return !isBanned
}

export async function checkTradeAllowed(userAddress: Address): Promise<BanCheckResult> {
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
