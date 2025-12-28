import { getCurrentNetwork, getRpcUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'
import { foundry, mainnet, sepolia } from 'viem/chains'
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

// Get RPC URL from config with env override
function getRpcUrlFromConfig(): string {
  const network = getCurrentNetwork()
  return process.env.RPC_URL ?? getRpcUrl(network)
}

function getReputationRegistryAddress(): Address | null {
  const address = process.env.REPUTATION_REGISTRY_ADDRESS
  return address ? (address as Address) : null
}

function getModerationAddress(): Address | null {
  const address = process.env.MODERATION_CONTRACT_ADDRESS
  return address ? (address as Address) : null
}

function getPublicClient() {
  const rpcUrl = getRpcUrlFromConfig()
  const network = getCurrentNetwork()

  const chain =
    network === 'mainnet' ? mainnet : network === 'testnet' ? sepolia : foundry

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

  // Check moderation status first
  if (moderationAddress) {
    try {
      const banned = await client.readContract({
        address: moderationAddress,
        abi: MODERATION_ABI,
        functionName: 'isBanned',
        args: [address],
      })

      if (banned) {
        return {
          valid: false,
          score: 0,
          isBanned: true,
          hasMinReputation: false,
          error: 'address_banned',
        }
      }

      // Get moderation reputation - returns tuple, index 4 is reputationScore
      const modRepTuple = await client.readContract({
        address: moderationAddress,
        abi: MODERATION_ABI,
        functionName: 'moderatorReputation',
        args: [address],
      })
      // moderatorReputation returns: (successfulBans, unsuccessfulBans, totalSlashedFrom, totalSlashedOthers, reputationScore, ...)
      const reputationScore = modRepTuple[4]
      if (reputationScore > 0n) {
        aggregatedScore = Number(reputationScore)
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
      // getAggregatedReputation returns: (score, scores[], weights[], providerCount, isValid)
      const reputationTuple = await client.readContract({
        address: reputationAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getAggregatedReputation',
        args: [address],
      })
      const [score, , , , isValid] = reputationTuple

      if (isValid && score > 0n) {
        // Combine with moderation score (weighted average: 40% moderation, 60% reputation)
        aggregatedScore = Math.floor(
          (aggregatedScore * 4000 + Number(score) * 6000) / 10000,
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
