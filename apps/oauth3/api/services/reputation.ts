/**
 * Reputation verification service for OAuth3 client registration.
 * Verifies on-chain reputation scores.
 * REQUIRES contracts - no fallback.
 */

import type { Address } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet, sepolia, foundry } from 'viem/chains'
import { MIN_REPUTATION_SCORE } from '../../lib/types'

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

// Get RPC URL from environment - REQUIRED
function getRpcUrl(): string {
  const rpcUrl = process.env.RPC_URL
  if (!rpcUrl) {
    throw new Error(
      'RPC_URL environment variable is required.\n' +
        'For local development with anvil: RPC_URL=http://localhost:8545\n' +
        'Use `bun run start` to start all dependencies including anvil.',
    )
  }
  return rpcUrl
}

// Get reputation registry contract address (optional - can use only moderation)
function getReputationRegistryAddress(): Address | null {
  const address = process.env.REPUTATION_REGISTRY_ADDRESS
  return address ? (address as Address) : null
}

// Get moderation contract address (optional - can use only reputation registry)
function getModerationAddress(): Address | null {
  const address = process.env.MODERATION_CONTRACT_ADDRESS
  return address ? (address as Address) : null
}

function getPublicClient() {
  const rpcUrl = getRpcUrl()
  const network = process.env.NETWORK ?? 'localnet'

  let chain
  switch (network) {
    case 'mainnet':
      chain = mainnet
      break
    case 'sepolia':
    case 'testnet':
      chain = sepolia
      break
    case 'localnet':
    case 'anvil':
    default:
      chain = foundry
      break
  }

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
}

/**
 * Check reputation for an address.
 * Combines on-chain reputation from multiple sources.
 *
 * If neither REPUTATION_REGISTRY_ADDRESS nor MODERATION_CONTRACT_ADDRESS is set,
 * returns default reputation (new addresses are trusted by default for FREE tier).
 */
export async function checkReputation(
  address: Address,
): Promise<ReputationCheck> {
  const reputationAddress = getReputationRegistryAddress()
  const moderationAddress = getModerationAddress()

  // If no contracts configured, allow with default reputation
  // This is valid for FREE tier clients - higher tiers require contracts
  if (!reputationAddress && !moderationAddress) {
    console.log(
      `[Reputation] No reputation contracts configured, using default score for ${address}`,
    )
    return {
      valid: true,
      score: 5000, // Default 50% for new addresses
      isBanned: false,
      hasMinReputation: true,
    }
  }

  const client = getPublicClient()
  let aggregatedScore = 5000 // Default 50% for new addresses
  let _isBanned = false

  // Check moderation status first
  if (moderationAddress) {
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
  if (reputationAddress) {
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
