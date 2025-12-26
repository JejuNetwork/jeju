/**
 * Reputation Bridge - aggregates local + Agent0 reputation data
 */

import { isAgent0Enabled } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { agentRegistry } from '../services/agent-registry.service'
import { getAgent0Client } from './client'

export interface ReputationData {
  totalBets: number
  winningBets: number
  accuracyScore: number
  trustScore: number
  totalVolume: string
  profitLoss: number
  isBanned: boolean
  sources?: { local: number; agent0: number }
}

export interface Agent0ReputationSummary {
  count: number
  averageScore: number
}

export interface LocalReputationProvider {
  getStats(tokenId: number): Promise<{
    totalBets: number
    winningBets: number
    totalVolume: string
    profitLoss: number
  }>
  isBanned(tokenId: number): Promise<boolean>
}

let localProvider: LocalReputationProvider | null = null

export function setLocalReputationProvider(
  provider: LocalReputationProvider,
): void {
  localProvider = provider
}

const DEFAULT_REP: ReputationData = {
  totalBets: 0,
  winningBets: 0,
  accuracyScore: 0,
  trustScore: 0,
  totalVolume: '0',
  profitLoss: 0,
  isBanned: false,
}

/** Parse volume string to BigInt, returning 0n for invalid values */
export function safeBigInt(value: string | undefined | null): bigint {
  if (!value) return 0n
  const cleaned = value.trim()
  if (!/^-?\d+$/.test(cleaned)) return 0n
  return BigInt(cleaned)
}

export class ReputationBridge {
  async getAggregatedReputation(tokenId: number): Promise<ReputationData> {
    const [local, agent0] = await Promise.all([
      this.getLocalReputation(tokenId),
      this.getAgent0Reputation(tokenId),
    ])

    const noBets = local.totalBets === 0 && agent0.totalBets === 0
    const localOnly = agent0.totalBets === 0
    const agent0Only = local.totalBets === 0

    return {
      totalBets: local.totalBets + agent0.totalBets,
      winningBets: local.winningBets + agent0.winningBets,
      accuracyScore: noBets
        ? 0
        : localOnly
          ? local.accuracyScore
          : agent0Only
            ? agent0.accuracyScore
            : local.accuracyScore * 0.6 + agent0.accuracyScore * 0.4,
      trustScore: noBets
        ? 0
        : localOnly
          ? local.trustScore
          : agent0Only
            ? agent0.trustScore
            : Math.max(local.trustScore, agent0.trustScore),
      totalVolume: (
        safeBigInt(local.totalVolume) + safeBigInt(agent0.totalVolume)
      ).toString(),
      profitLoss: local.profitLoss + agent0.profitLoss,
      isBanned: local.isBanned || agent0.isBanned,
      sources: { local: local.trustScore, agent0: agent0.trustScore },
    }
  }

  async getAgent0ReputationSummary(
    agentId: string,
    tag1?: string,
    tag2?: string,
  ): Promise<Agent0ReputationSummary> {
    if (!isAgent0Enabled()) return { count: 0, averageScore: 0 }
    const client = getAgent0Client()
    if (!client.isAvailable()) return { count: 0, averageScore: 0 }
    return client.getReputationSummary(agentId, tag1, tag2)
  }

  private async getLocalReputation(tokenId: number): Promise<ReputationData> {
    const agents = await agentRegistry.discoverAgents({})
    const agent = agents.find((a) => a.onChainData?.tokenId === tokenId)

    const onChainScore = agent?.onChainData?.reputationScore ?? 0
    const trustLevel = agent?.trustLevel ?? 0

    let stats = {
      totalBets: 0,
      winningBets: 0,
      totalVolume: '0',
      profitLoss: 0,
    }
    let isBanned = false

    if (localProvider) {
      ;[stats, isBanned] = await Promise.all([
        localProvider.getStats(tokenId),
        localProvider.isBanned(tokenId),
      ])
    }

    return {
      totalBets: stats.totalBets,
      winningBets: stats.winningBets,
      accuracyScore:
        stats.totalBets > 0 ? stats.winningBets / stats.totalBets : 0,
      trustScore: onChainScore > 0 ? onChainScore / 100 : trustLevel * 0.25,
      totalVolume: stats.totalVolume,
      profitLoss: stats.profitLoss,
      isBanned,
    }
  }

  private async getAgent0Reputation(tokenId: number): Promise<ReputationData> {
    if (!isAgent0Enabled()) return { ...DEFAULT_REP }
    const client = getAgent0Client()
    if (!client.isAvailable()) return { ...DEFAULT_REP }

    const agentId = `${client.getChainId()}:${tokenId}`
    const summary = await client.getReputationSummary(agentId)
    const profile = await client.getAgentProfile(tokenId)

    const score = summary.averageScore / 100
    return {
      totalBets: summary.count,
      winningBets: Math.round(summary.count * score),
      accuracyScore: score,
      trustScore: score,
      totalVolume: '0',
      profitLoss: 0,
      isBanned: profile?.active === false,
    }
  }

  async syncReputationToAgent0(tokenId: number): Promise<void> {
    if (!isAgent0Enabled()) return

    const local = await this.getLocalReputation(tokenId)
    if (local.totalBets === 0) {
      logger.debug('No local activity, skipping sync', { tokenId })
      return
    }

    const client = getAgent0Client()
    if (!client.isAvailable()) {
      logger.warn('Agent0 unavailable for sync')
      return
    }

    const rating = Math.max(
      -5,
      Math.min(5, Math.round((local.accuracyScore - 0.5) * 10)),
    )
    await client.submitFeedback({
      targetAgentId: tokenId,
      rating,
      comment: `Sync: ${local.totalBets} bets, ${local.winningBets} wins, ${(local.accuracyScore * 100).toFixed(1)}%`,
      tags: ['reputation-sync'],
    })
    logger.info('Synced reputation to Agent0', { tokenId })
  }
}

export const reputationBridge = new ReputationBridge()
