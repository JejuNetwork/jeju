/**
 * Reputation verification service for OAuth3 client registration.
 * Verifies on-chain and off-chain reputation scores.
 */

import type { Address } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { MIN_REPUTATION_SCORE } from '../../lib/types'

const isDev = process.env.NODE_ENV !== 'production'

// Reputation provider registry ABI (minimal)
const REPUTATION_REGISTRY_ABI = parseAbi([
  'function getAggregatedReputation(address user) view returns (uint256 score, uint256[] scores, uint256[] weights, uint256 providerCount, bool isValid)',
])

// Moderation marketplace ABI
const MODERATION_ABI = parseAbi([
  'function getReputationTier(address user) view returns (uint8)',
  'function isBanned(address user) view returns (bool)',
  'function moderatorReputation(address) view returns (uint256 successfulBans, uint256 unsuccessfulBans, uint256 totalSlashedFrom, uint256 totalSlashedOthers, uint256 reputationScore, uint256 lastReportTimestamp, uint256 reportCooldownUntil, uint256 dailyReportCount, uint256 weeklyReportCount, uint256 reportDayStart, uint256 reportWeekStart, uint256 consecutiveWins, uint256 lastActivityTimestamp, uint256 activeReportCount)',
])

// Get RPC URL from environment
function getRpcUrl(): string {
  const rpcUrl = process.env.RPC_URL
  if (rpcUrl) return rpcUrl

  if (isDev) {
    return process.env.NETWORK === 'sepolia'
      ? 'https://sepolia.drpc.org'
      : 'https://eth.drpc.org'
  }

  throw new Error('RPC_URL environment variable is required in production')
}

// Get reputation registry contract address
function getReputationRegistryAddress(): Address {
  const address = process.env.REPUTATION_REGISTRY_ADDRESS
  if (address) return address as Address

  if (isDev) {
    return '0x0000000000000000000000000000000000000000' as Address
  }

  throw new Error(
    'REPUTATION_REGISTRY_ADDRESS environment variable is required in production',
  )
}

// Get moderation contract address
function getModerationAddress(): Address {
  const address = process.env.MODERATION_CONTRACT_ADDRESS
  if (address) return address as Address

  if (isDev) {
    return '0x0000000000000000000000000000000000000000' as Address
  }

  throw new Error(
    'MODERATION_CONTRACT_ADDRESS environment variable is required in production',
  )
}

function getPublicClient() {
  const rpcUrl = getRpcUrl()
  const chain = process.env.NETWORK === 'sepolia' ? sepolia : mainnet

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

export interface ReputationCheck {
  valid: boolean
  score: number
  isBanned: boolean
  hasMinReputation: boolean
  error?: string
  /** True if this was a dev mode bypass, NOT a real verification */
  devMode?: boolean
}

/**
 * Check reputation for an address.
 * Combines on-chain reputation from multiple sources.
 *
 * WARNING: In dev mode without contracts configured, this returns
 * unverified default reputation. This is NOT a security check in dev.
 */
export async function checkReputation(
  address: Address,
): Promise<ReputationCheck> {
  const reputationAddress = getReputationRegistryAddress()
  const moderationAddress = getModerationAddress()

  // Dev mode: skip verification if no contracts configured
  if (
    reputationAddress === '0x0000000000000000000000000000000000000000' &&
    moderationAddress === '0x0000000000000000000000000000000000000000'
  ) {
    if (isDev) {
      // EXPLICIT: Return unverified dev mode response
      console.warn(
        `[Reputation] DEV MODE: Bypassing reputation check for ${address}`,
      )
      return {
        valid: true,
        devMode: true, // Flag that this is NOT a real verification
        score: 5000, // 50% - medium reputation (unverified)
        isBanned: false,
        hasMinReputation: true,
      }
    }
    return {
      valid: false,
      score: 0,
      isBanned: false,
      hasMinReputation: false,
      error: 'reputation_not_configured',
    }
  }

  const client = getPublicClient()
  let aggregatedScore = 5000 // Default 50% for new addresses
  let _isBanned = false

  // Check moderation status first
  if (moderationAddress !== '0x0000000000000000000000000000000000000000') {
    try {
      const banned = await client.readContract({
        address: moderationAddress,
        abi: MODERATION_ABI,
        functionName: 'isBanned',
        args: [address],
      })
      _isBanned = banned

      if (banned) {
        return {
          valid: false,
          score: 0,
          isBanned: true,
          hasMinReputation: false,
          error: 'address_banned',
        }
      }

      // Get moderation reputation
      const modRep = await client.readContract({
        address: moderationAddress,
        abi: MODERATION_ABI,
        functionName: 'moderatorReputation',
        args: [address],
      })
      if (modRep.reputationScore > 0) {
        aggregatedScore = Number(modRep.reputationScore)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[Reputation] Moderation contract call failed: ${message}`)
      return {
        valid: false,
        score: 0,
        isBanned: false,
        hasMinReputation: false,
        error: `moderation_contract_failed: ${message}`,
      }
    }
  }

  // Get aggregated reputation if registry is configured
  if (reputationAddress !== '0x0000000000000000000000000000000000000000') {
    try {
      const reputation = await client.readContract({
        address: reputationAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getAggregatedReputation',
        args: [address],
      })

      if (reputation.isValid && reputation.score > 0) {
        // Combine with moderation score (weighted average: 40% moderation, 60% reputation)
        aggregatedScore = Math.floor(
          (aggregatedScore * 4000 + Number(reputation.score) * 6000) / 10000,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[Reputation] Registry contract call failed: ${message}`)
      return {
        valid: false,
        score: 0,
        isBanned: false,
        hasMinReputation: false,
        error: `reputation_contract_failed: ${message}`,
      }
    }
  }

  const hasMinReputation = aggregatedScore >= MIN_REPUTATION_SCORE

  return {
    valid: true,
    score: aggregatedScore,
    isBanned: false,
    hasMinReputation,
    error: hasMinReputation
      ? undefined
      : `Reputation score ${aggregatedScore} is below minimum ${MIN_REPUTATION_SCORE}`,
  }
}
