/**
 * Reputation Integration
 * ERC-8004 based reputation system for Git/Pkg
 */

import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { stringToBytes32, zeroBytes } from './utils/crypto'

export interface ReputationScore {
  totalScore: number
  normalizedScore: number // 0-100
  lastUpdated: number
  breakdown: {
    activity: number
    quality: number
    community: number
    longevity: number
  }
}

export interface MetricsInput {
  // Git metrics
  commitCount?: number
  prMergeRate?: number
  issueCloseRate?: number
  reviewCount?: number
  starCount?: number
  forkCount?: number
  contributorCount?: number

  // Package metrics
  downloadCount?: number
  dependentCount?: number
  versionCount?: number
  publishFrequency?: number

  // Quality metrics
  documentationScore?: number
  testCoverage?: number
  securityScore?: number
  codeQualityScore?: number

  // Community metrics
  responseTime?: number
  issueResolutionTime?: number
  activeContributors?: number
}

// Reputation weights
const WEIGHTS = {
  // Activity
  commit: 1,
  prMerge: 5,
  issueClose: 2,
  review: 3,
  publish: 10,

  // Community
  star: 0.5,
  fork: 2,
  download: 0.001,
  dependent: 5,

  // Quality
  documentation: 10,
  testCoverage: 10,
  security: 15,
  codeQuality: 10,
}

// On-chain ABI for reputation registry (ERC-8004)
const REPUTATION_REGISTRY_ABI = [
  {
    inputs: [
      { name: 'entityType', type: 'uint8' }, // 0=repo, 1=package, 2=user
      { name: 'entityId', type: 'bytes32' },
      { name: 'score', type: 'uint256' },
      { name: 'metadataCid', type: 'bytes32' },
    ],
    name: 'updateReputation',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'entityType', type: 'uint8' },
      { name: 'entityId', type: 'bytes32' },
    ],
    name: 'getReputation',
    outputs: [
      { name: 'score', type: 'uint256' },
      { name: 'lastUpdated', type: 'uint256' },
      { name: 'metadataCid', type: 'bytes32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface ReputationManagerConfig {
  rpcUrl: string
  reputationRegistryAddress?: Address
  privateKey?: Hex
  updateIntervalMs?: number
}

export class ReputationManager {
  private config: ReputationManagerConfig
  private cache: Map<string, ReputationScore> = new Map()
  private pendingUpdates: Map<string, MetricsInput> = new Map()

  constructor(config: ReputationManagerConfig) {
    this.config = config
  }

  /**
   * Calculate reputation score from metrics
   */
  calculateScore(metrics: MetricsInput): ReputationScore {
    let activityScore = 0
    let qualityScore = 0
    let communityScore = 0
    let longevityScore = 0

    // Activity score
    activityScore += (metrics.commitCount ?? 0) * WEIGHTS.commit
    activityScore += (metrics.prMergeRate ?? 0) * 100 * WEIGHTS.prMerge
    activityScore += (metrics.issueCloseRate ?? 0) * 100 * WEIGHTS.issueClose
    activityScore += (metrics.reviewCount ?? 0) * WEIGHTS.review
    activityScore += (metrics.publishFrequency ?? 0) * WEIGHTS.publish

    // Quality score
    qualityScore += (metrics.documentationScore ?? 0) * WEIGHTS.documentation
    qualityScore += (metrics.testCoverage ?? 0) * WEIGHTS.testCoverage
    qualityScore += (metrics.securityScore ?? 0) * WEIGHTS.security
    qualityScore += (metrics.codeQualityScore ?? 0) * WEIGHTS.codeQuality

    // Community score
    communityScore += (metrics.starCount ?? 0) * WEIGHTS.star
    communityScore += (metrics.forkCount ?? 0) * WEIGHTS.fork
    communityScore += (metrics.downloadCount ?? 0) * WEIGHTS.download
    communityScore += (metrics.dependentCount ?? 0) * WEIGHTS.dependent

    // Longevity score (based on contributors and version history)
    longevityScore += (metrics.contributorCount ?? 0) * 2
    longevityScore += (metrics.versionCount ?? 0) * 1
    longevityScore += (metrics.activeContributors ?? 0) * 5

    const totalScore =
      activityScore + qualityScore + communityScore + longevityScore

    // Normalize to 0-100 using logarithmic scale
    // This prevents extreme values while still rewarding high activity
    const normalizedScore = Math.min(100, Math.log10(totalScore + 1) * 25)

    return {
      totalScore,
      normalizedScore: Math.round(normalizedScore),
      lastUpdated: Date.now(),
      breakdown: {
        activity: activityScore,
        quality: qualityScore,
        community: communityScore,
        longevity: longevityScore,
      },
    }
  }

  /**
   * Get cached reputation score
   */
  getScore(entityId: string): ReputationScore | null {
    return this.cache.get(entityId) || null
  }

  /**
   * Update reputation score with new metrics
   */
  async updateScore(
    entityType: 'repo' | 'package' | 'user',
    entityId: string,
    metrics: MetricsInput,
  ): Promise<ReputationScore> {
    // Merge with existing metrics if any
    const existing = this.pendingUpdates.get(entityId) || {}
    const merged: MetricsInput = { ...existing }

    // Accumulate counts - use type-safe assignment
    const numericKeys = Object.keys(metrics).filter(
      (k): k is keyof MetricsInput => k in metrics,
    )
    for (const key of numericKeys) {
      const value = metrics[key]
      if (typeof value === 'number') {
        const existingValue = existing[key]
        merged[key] =
          typeof existingValue === 'number' ? existingValue + value : value
      }
    }

    this.pendingUpdates.set(entityId, merged)

    // Calculate new score
    const score = this.calculateScore(merged)
    this.cache.set(entityId, score)

    // Optionally update on-chain
    if (this.config.reputationRegistryAddress) {
      await this.updateOnChain(entityType, entityId, score).catch((err) => {
        console.error(`[Reputation] Failed to update on-chain: ${err}`)
      })
    }

    return score
  }

  /**
   * Update reputation on-chain
   */
  private async updateOnChain(
    entityType: 'repo' | 'package' | 'user',
    entityId: string,
    score: ReputationScore,
  ): Promise<void> {
    if (!this.config.privateKey || !this.config.reputationRegistryAddress) {
      return
    }

    const account = privateKeyToAccount(this.config.privateKey)
    const client = createWalletClient({
      account,
      chain: base,
      transport: http(this.config.rpcUrl),
    })

    const entityTypeCode =
      entityType === 'repo' ? 0 : entityType === 'package' ? 1 : 2
    const entityIdBytes = stringToBytes32(entityId)
    const metadataCid = zeroBytes(32) // Would store breakdown on IPFS

    const data = encodeFunctionData({
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'updateReputation',
      args: [
        entityTypeCode,
        entityIdBytes,
        BigInt(score.normalizedScore),
        metadataCid,
      ],
    })

    await client.sendTransaction({
      to: this.config.reputationRegistryAddress,
      data,
    })
  }

  /**
   * Get on-chain reputation
   */
  async getOnChainReputation(
    entityType: 'repo' | 'package' | 'user',
    entityId: string,
  ): Promise<{ score: number; lastUpdated: number } | null> {
    if (!this.config.reputationRegistryAddress) {
      return null
    }

    const client = createPublicClient({
      chain: base,
      transport: http(this.config.rpcUrl),
    })

    const entityTypeCode =
      entityType === 'repo' ? 0 : entityType === 'package' ? 1 : 2
    const entityIdBytes = stringToBytes32(entityId)

    const result = await client.readContract({
      address: this.config.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'getReputation',
      args: [entityTypeCode, entityIdBytes],
    })

    return {
      score: Number(result[0]),
      lastUpdated: Number(result[1]) * 1000,
    }
  }

  /**
   * Record a contribution event and update reputation
   */
  async recordContribution(
    entityType: 'repo' | 'package' | 'user',
    entityId: string,
    contributionType:
      | 'commit'
      | 'pr'
      | 'issue'
      | 'review'
      | 'star'
      | 'fork'
      | 'download'
      | 'publish',
  ): Promise<void> {
    const metrics: MetricsInput = {}

    switch (contributionType) {
      case 'commit':
        metrics.commitCount = 1
        break
      case 'pr':
        metrics.prMergeRate = 0.01 // Incremental
        break
      case 'issue':
        metrics.issueCloseRate = 0.01
        break
      case 'review':
        metrics.reviewCount = 1
        break
      case 'star':
        metrics.starCount = 1
        break
      case 'fork':
        metrics.forkCount = 1
        break
      case 'download':
        metrics.downloadCount = 1
        break
      case 'publish':
        metrics.publishFrequency = 1
        break
    }

    await this.updateScore(entityType, entityId, metrics)
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(
    entityType?: 'repo' | 'package' | 'user',
    limit: number = 100,
  ): Array<{ entityId: string; score: ReputationScore }> {
    const entries: Array<{ entityId: string; score: ReputationScore }> = []

    for (const [entityId, score] of this.cache) {
      // Filter by type if specified (based on id prefix convention)
      if (entityType) {
        if (entityType === 'repo' && !entityId.startsWith('0x')) continue
        if (entityType === 'package' && !entityId.includes('/')) continue
        if (
          entityType === 'user' &&
          !(entityId.startsWith('0x') && entityId.length === 42)
        )
          continue
      }
      entries.push({ entityId, score })
    }

    // Sort by normalized score descending
    entries.sort((a, b) => b.score.normalizedScore - a.score.normalizedScore)

    return entries.slice(0, limit)
  }

  /**
   * Export all reputation data
   */
  exportData(): Array<{
    entityId: string
    metrics: MetricsInput
    score: ReputationScore
  }> {
    const data: Array<{
      entityId: string
      metrics: MetricsInput
      score: ReputationScore
    }> = []

    for (const [entityId, score] of this.cache) {
      const metrics = this.pendingUpdates.get(entityId) || {}
      data.push({ entityId, metrics, score })
    }

    return data
  }

  /**
   * Import reputation data
   */
  importData(
    data: Array<{
      entityId: string
      metrics: MetricsInput
      score: ReputationScore
    }>,
  ): void {
    for (const { entityId, metrics, score } of data) {
      this.pendingUpdates.set(entityId, metrics)
      this.cache.set(entityId, score)
    }
  }
}
