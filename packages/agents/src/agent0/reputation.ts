/**
 * Reputation Bridge
 *
 * Aggregates reputation from ERC-8004 on-chain data and Agent0 network feedback
 * to provide comprehensive reputation scores.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import { getAgent0Client } from './client'

/**
 * Reputation data structure
 */
export interface ReputationData {
  totalBets: number
  winningBets: number
  accuracyScore: number
  trustScore: number
  totalVolume: string
  profitLoss: number
  isBanned: boolean
  sources?: {
    local: number
    agent0: number
  }
}

/**
 * Reputation summary from Agent0
 */
export interface Agent0ReputationSummary {
  count: number
  averageScore: number
}

/**
 * Reputation Bridge
 *
 * Aggregates reputation from multiple sources for comprehensive scoring.
 */
export class ReputationBridge {
  /**
   * Get aggregated reputation from both local and Agent0 sources
   */
  async getAggregatedReputation(tokenId: number): Promise<ReputationData> {
    const [local, agent0] = await Promise.all([
      this.getLocalReputation(tokenId),
      this.getAgent0Reputation(tokenId),
    ])

    return {
      totalBets: local.totalBets + agent0.totalBets,
      winningBets: local.winningBets + agent0.winningBets,
      accuracyScore: this.calculateWeightedAccuracy(local, agent0),
      trustScore: this.calculateTrustScore(local, agent0),
      totalVolume: this.sumVolumes(local.totalVolume, agent0.totalVolume),
      profitLoss: local.profitLoss + agent0.profitLoss,
      isBanned: local.isBanned || agent0.isBanned,
      sources: {
        local: local.trustScore,
        agent0: agent0.trustScore,
      },
    }
  }

  /**
   * Get Agent0 reputation summary with optional tag filtering
   */
  async getAgent0ReputationSummary(
    agentId: string,
    tag1?: string,
    tag2?: string,
  ): Promise<Agent0ReputationSummary> {
    if (process.env.AGENT0_ENABLED !== 'true') {
      return { count: 0, averageScore: 0 }
    }

    const agent0Client = getAgent0Client()

    if (agent0Client.isAvailable()) {
      try {
        return await agent0Client.getReputationSummary(agentId, tag1, tag2)
      } catch (error) {
        logger.warn('Failed to get Agent0 reputation summary', {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return { count: 0, averageScore: 0 }
  }

  /**
   * Get local reputation (from on-chain or database)
   */
  private async getLocalReputation(_tokenId: number): Promise<ReputationData> {
    // In a full implementation, this would query:
    // 1. ERC-8004 registry on-chain
    // 2. Local database for trading stats

    return this.getDefaultReputation()
  }

  /**
   * Get reputation from Agent0 network
   */
  private async getAgent0Reputation(tokenId: number): Promise<ReputationData> {
    if (process.env.AGENT0_ENABLED !== 'true') {
      return this.getDefaultReputation()
    }

    const agent0Client = getAgent0Client()

    if (agent0Client.isAvailable()) {
      try {
        const chainId = agent0Client.getChainId()
        const agentId = `${chainId}:${tokenId}`
        const summary = await agent0Client.getReputationSummary(agentId)

        return {
          totalBets: summary.count,
          winningBets: 0,
          accuracyScore: summary.averageScore / 100,
          trustScore: summary.averageScore / 100,
          totalVolume: '0',
          profitLoss: 0,
          isBanned: false,
        }
      } catch (error) {
        logger.warn('Failed to get Agent0 reputation', {
          tokenId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return this.getDefaultReputation()
  }

  /**
   * Calculate weighted accuracy score
   * Local data weighted 60%, Agent0 data weighted 40%
   */
  private calculateWeightedAccuracy(
    local: ReputationData,
    agent0: ReputationData,
  ): number {
    const localWeight = 0.6
    const agent0Weight = 0.4

    // If one source has no data, use the other
    if (local.totalBets === 0 && agent0.totalBets === 0) {
      return 0
    }

    if (local.totalBets === 0) {
      return agent0.accuracyScore
    }

    if (agent0.totalBets === 0) {
      return local.accuracyScore
    }

    // Weighted average
    return (
      local.accuracyScore * localWeight + agent0.accuracyScore * agent0Weight
    )
  }

  /**
   * Calculate trust score
   * Takes maximum of both sources (more conservative)
   */
  private calculateTrustScore(
    local: ReputationData,
    agent0: ReputationData,
  ): number {
    if (local.totalBets === 0 && agent0.totalBets === 0) {
      return 0
    }

    if (local.totalBets === 0) {
      return agent0.trustScore
    }

    if (agent0.totalBets === 0) {
      return local.trustScore
    }

    // Take maximum
    return Math.max(local.trustScore, agent0.trustScore)
  }

  /**
   * Sum two volume strings (wei amounts)
   */
  private sumVolumes(volume1: string, volume2: string): string {
    const v1 = BigInt(volume1 || '0')
    const v2 = BigInt(volume2 || '0')
    return (v1 + v2).toString()
  }

  /**
   * Get default reputation data
   */
  private getDefaultReputation(): ReputationData {
    return {
      totalBets: 0,
      winningBets: 0,
      accuracyScore: 0,
      trustScore: 0,
      totalVolume: '0',
      profitLoss: 0,
      isBanned: false,
    }
  }

  /**
   * Sync local reputation to Agent0 network
   */
  async syncReputationToAgent0(tokenId: number): Promise<void> {
    if (process.env.AGENT0_ENABLED !== 'true') {
      return
    }

    logger.info(`Syncing reputation for token ${tokenId} to Agent0 network`)

    const localRep = await this.getLocalReputation(tokenId)

    if (localRep.totalBets === 0) {
      logger.debug(`No local activity for token ${tokenId}, skipping sync`)
      return
    }

    const agent0Client = getAgent0Client()

    if (!agent0Client.isAvailable()) {
      logger.warn('Agent0 client not available for reputation sync')
      return
    }

    // Convert accuracy score to rating (-5 to +5)
    const rating = Math.round((localRep.accuracyScore - 0.5) * 10)
    const clampedRating = Math.max(-5, Math.min(5, rating))

    const comment = `Local reputation sync: ${localRep.totalBets} bets, ${localRep.winningBets} wins, ${(localRep.accuracyScore * 100).toFixed(1)}% accuracy`

    try {
      await agent0Client.submitFeedback({
        targetAgentId: tokenId,
        rating: clampedRating,
        comment,
        tags: ['reputation-sync'],
      })

      logger.info(`Synced reputation for token ${tokenId} to Agent0 network`)
    } catch (error) {
      logger.error('Failed to sync reputation to Agent0', {
        tokenId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

/** Singleton instance */
export const reputationBridge = new ReputationBridge()
