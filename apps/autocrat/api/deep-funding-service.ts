/**
 * @module DeepFundingService
 * @description Orchestrates deep funding distribution from network fees
 *
 * Features:
 * - Epoch management for funding cycles
 * - Contributor and dependency weight calculation
 * - Deliberation-based weight adjustments
 * - Depth decay for transitive dependencies
 * - Integration with DependencyScanner and ContributorService
 * - Multi-DAO support with configurable fee splits
 */

import { deepFundingDistributorAbi } from '@jejunetwork/contracts'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hash,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import { toHex } from '../lib'
import {
  type ContributorProfile,
  getContributorService,
} from './contributor-service'
import { getDependencyScanner } from './dependency-scanner'
export interface FeeDistributionConfig {
  treasuryBps: number
  contributorPoolBps: number
  dependencyPoolBps: number
  jejuBps: number
  burnBps: number
  reserveBps: number
}

export interface DAOPool {
  daoId: string
  token: Address
  totalAccumulated: bigint
  contributorPool: bigint
  dependencyPool: bigint
  reservePool: bigint
  lastDistributedEpoch: number
  epochStartTime: number
}

export interface ContributorShare {
  contributorId: string
  weight: number
  pendingRewards: bigint
  claimedRewards: bigint
  lastClaimEpoch: number
}

export interface DependencyShare {
  depHash: string
  contributorId: string
  weight: number
  transitiveDepth: number
  usageCount: number
  pendingRewards: bigint
  claimedRewards: bigint
  isRegistered: boolean
}

export interface FundingEpoch {
  epochId: number
  daoId: string
  startTime: number
  endTime: number
  totalContributorRewards: bigint
  totalDependencyRewards: bigint
  totalDistributed: bigint
  finalized: boolean
}

export interface WeightVote {
  voter: Address
  targetId: string
  weightAdjustment: number
  reason: string
  reputation: number
  votedAt: number
}

export interface DeepFundingServiceConfig {
  rpcUrl: string
  distributorAddress: Address
  jejuDaoId: string
  operatorKey?: string
}

function inferChainFromRpcUrl(rpcUrl: string): Chain {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base
  }
  return localhost
}

export interface FundingRecommendation {
  contributorId: string
  contributorProfile: ContributorProfile | null
  suggestedWeight: number
  reason: string
  contributions: {
    bounties: number
    paymentRequests: number
    repos: number
    deps: number
  }
}

export interface DependencyFundingRecommendation {
  packageName: string
  registryType: string
  suggestedWeight: number
  depth: number
  usageCount: number
  isRegistered: boolean
  maintainerContributorId: string | null
}
const MAX_BPS = 10000
const DEPTH_DECAY_BPS = 2000 // 20% decay per level
export class DeepFundingService {
  private readonly publicClient: PublicClient<Transport, Chain>
  private readonly walletClient: WalletClient<Transport, Chain>
  private readonly account: PrivateKeyAccount | null
  private readonly chain: Chain
  private readonly distributorAddress: Address

  constructor(config: DeepFundingServiceConfig) {
    const chain = inferChainFromRpcUrl(config.rpcUrl)
    this.chain = chain
    this.distributorAddress = config.distributorAddress

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient<Transport, Chain>

    if (config.operatorKey) {
      this.account = privateKeyToAccount(toHex(config.operatorKey))
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(config.rpcUrl),
      }) as WalletClient<Transport, Chain>
    } else {
      this.account = null
      this.walletClient = createWalletClient({
        chain,
        transport: http(config.rpcUrl),
      }) as WalletClient<Transport, Chain>
    }
  }
  async depositFees(
    daoId: string,
    source: string,
    amount: bigint,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'depositFees',
      args: [toHex(daoId), source],
      value: amount,
      account: this.account,
    })

    return hash
  }

  async depositTokenFees(
    daoId: string,
    token: Address,
    amount: bigint,
    source: string,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'depositTokenFees',
      args: [toHex(daoId), token, amount, source],
      account: this.account,
    })

    return hash
  }
  async setContributorWeight(
    daoId: string,
    contributorId: string,
    weight: number,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'setContributorWeight',
      args: [toHex(daoId), toHex(contributorId), BigInt(weight)],
      account: this.account,
    })

    return hash
  }

  async registerDependency(
    daoId: string,
    packageName: string,
    registryType: string,
    maintainerContributorId: string | null,
    weight: number,
    transitiveDepth: number,
    usageCount: number,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const maintainerId = maintainerContributorId || `0x${'0'.repeat(64)}`

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'registerDependency',
      args: [
        toHex(daoId),
        packageName,
        registryType,
        toHex(maintainerId),
        BigInt(weight),
        BigInt(transitiveDepth),
        BigInt(usageCount),
      ],
      account: this.account,
    })

    return hash
  }

  async voteOnWeight(
    daoId: string,
    targetId: string,
    adjustment: number,
    reason: string,
    reputation: number,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'voteOnWeight',
      args: [
        toHex(daoId),
        toHex(targetId),
        BigInt(adjustment),
        reason,
        BigInt(reputation),
      ],
      account: this.account,
    })

    return hash
  }
  async finalizeEpoch(daoId: string): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'finalizeEpoch',
      args: [toHex(daoId)],
      account: this.account,
    })

    return hash
  }
  async claimContributorRewards(
    daoId: string,
    contributorId: string,
    epochs: number[],
    recipient: Address,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'claimContributorRewards',
      args: [toHex(daoId), toHex(contributorId), epochs.map(BigInt), recipient],
      account: this.account,
    })

    return hash
  }

  async claimDependencyRewards(
    daoId: string,
    depHash: string,
    recipient: Address,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'claimDependencyRewards',
      args: [toHex(daoId), toHex(depHash), recipient],
      account: this.account,
    })

    return hash
  }
  async setDAOConfig(
    daoId: string,
    config: FeeDistributionConfig,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'setDAOConfig',
      args: [
        toHex(daoId),
        {
          treasuryBps: BigInt(config.treasuryBps),
          contributorPoolBps: BigInt(config.contributorPoolBps),
          dependencyPoolBps: BigInt(config.dependencyPoolBps),
          jejuBps: BigInt(config.jejuBps),
          burnBps: BigInt(config.burnBps),
          reserveBps: BigInt(config.reserveBps),
        },
      ],
      account: this.account,
    })

    return hash
  }

  async authorizeDepositor(
    depositor: Address,
    authorized: boolean,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'authorizeDepositor',
      args: [depositor, authorized],
      account: this.account,
    })

    return hash
  }
  async getDAOPool(daoId: string): Promise<DAOPool | null> {
    const result = await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'getDAOPool',
      args: [toHex(daoId)],
    })

    if (!result || result.daoId === `0x${'0'.repeat(64)}`) return null

    return {
      daoId: result.daoId,
      token: result.token,
      totalAccumulated: result.totalAccumulated,
      contributorPool: result.contributorPool,
      dependencyPool: result.dependencyPool,
      reservePool: result.reservePool,
      lastDistributedEpoch: Number(result.lastDistributedEpoch),
      epochStartTime: Number(result.epochStartTime),
    }
  }

  async getCurrentEpoch(daoId: string): Promise<FundingEpoch | null> {
    const result = await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'getCurrentEpoch',
      args: [toHex(daoId)],
    })

    if (result.epochId === 0n) return null

    return {
      epochId: Number(result.epochId),
      daoId: result.daoId,
      startTime: Number(result.startTime),
      endTime: Number(result.endTime),
      totalContributorRewards: result.totalContributorRewards,
      totalDependencyRewards: result.totalDependencyRewards,
      totalDistributed: result.totalDistributed,
      finalized: result.finalized,
    }
  }

  async getContributorShare(
    daoId: string,
    epochId: number,
    contributorId: string,
  ): Promise<ContributorShare | null> {
    const result = await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'getContributorShare',
      args: [toHex(daoId), BigInt(epochId), toHex(contributorId)],
    })

    if (!result || result.contributorId === `0x${'0'.repeat(64)}`) return null

    return {
      contributorId: result.contributorId,
      weight: Number(result.weight),
      pendingRewards: result.pendingRewards,
      claimedRewards: result.claimedRewards,
      lastClaimEpoch: Number(result.lastClaimEpoch),
    }
  }

  async getDependencyShare(
    daoId: string,
    depHash: string,
  ): Promise<DependencyShare | null> {
    const result = await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'getDependencyShare',
      args: [toHex(daoId), toHex(depHash)],
    })

    if (!result || result.depHash === `0x${'0'.repeat(64)}`) return null

    return {
      depHash: result.depHash,
      contributorId: result.contributorId,
      weight: Number(result.weight),
      transitiveDepth: Number(result.transitiveDepth),
      usageCount: Number(result.usageCount),
      pendingRewards: result.pendingRewards,
      claimedRewards: result.claimedRewards,
      isRegistered: result.isRegistered,
    }
  }

  async getDAOConfig(daoId: string): Promise<FeeDistributionConfig> {
    const result = await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'getDAOConfig',
      args: [toHex(daoId)],
    })

    return {
      treasuryBps: Number(result.treasuryBps),
      contributorPoolBps: Number(result.contributorPoolBps),
      dependencyPoolBps: Number(result.dependencyPoolBps),
      jejuBps: Number(result.jejuBps),
      burnBps: Number(result.burnBps),
      reserveBps: Number(result.reserveBps),
    }
  }

  async getDefaultConfig(): Promise<FeeDistributionConfig> {
    const result = await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'defaultConfig',
    })

    // defaultConfig returns multiple outputs as array, not a single tuple struct
    return {
      treasuryBps: Number(result[0]),
      contributorPoolBps: Number(result[1]),
      dependencyPoolBps: Number(result[2]),
      jejuBps: Number(result[3]),
      burnBps: Number(result[4]),
      reserveBps: Number(result[5]),
    }
  }

  async getPendingContributorRewards(
    daoId: string,
    contributorId: string,
  ): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'getPendingContributorRewards',
      args: [toHex(daoId), toHex(contributorId)],
    })
  }

  async getEpochVotes(daoId: string, epochId: number): Promise<WeightVote[]> {
    const result = await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: deepFundingDistributorAbi,
      functionName: 'getEpochVotes',
      args: [toHex(daoId), BigInt(epochId)],
    })

    return result.map((v) => ({
      voter: v.voter,
      targetId: v.targetId,
      weightAdjustment: Number(v.weightAdjustment),
      reason: v.reason,
      reputation: Number(v.reputation),
      votedAt: Number(v.votedAt),
    }))
  }
  /**
   * Generate funding recommendations for contributors based on activity
   */
  async generateContributorRecommendations(
    daoId: string,
  ): Promise<FundingRecommendation[]> {
    const recommendations: FundingRecommendation[] = []
    const contributorService = getContributorService()
    const allContributors = await contributorService.getAllContributors()

    for (const contributorId of allContributors) {
      const profile = await contributorService.getContributor(contributorId)
      const daoContrib = await contributorService.getDAOContribution(
        contributorId,
        daoId,
      )
      const repoClaims =
        await contributorService.getRepositoryClaims(contributorId)
      const depClaims =
        await contributorService.getDependencyClaims(contributorId)

      // Calculate suggested weight based on contributions
      let weight = 0
      let reason = ''

      if (daoContrib.bountyCount > 0) {
        weight += daoContrib.bountyCount * 50
        reason += `${daoContrib.bountyCount} bounties completed. `
      }

      if (daoContrib.paymentRequestCount > 0) {
        weight += daoContrib.paymentRequestCount * 30
        reason += `${daoContrib.paymentRequestCount} payment requests. `
      }

      const verifiedRepos = repoClaims.filter(
        (c) => c.status === 'VERIFIED',
      ).length
      if (verifiedRepos > 0) {
        weight += verifiedRepos * 100
        reason += `${verifiedRepos} verified repos. `
      }

      const verifiedDeps = depClaims.filter(
        (c) => c.status === 'VERIFIED',
      ).length
      if (verifiedDeps > 0) {
        weight += verifiedDeps * 150
        reason += `${verifiedDeps} verified dependencies. `
      }

      if (weight > 0) {
        recommendations.push({
          contributorId,
          contributorProfile: profile,
          suggestedWeight: Math.min(weight, MAX_BPS),
          reason: reason.trim(),
          contributions: {
            bounties: daoContrib.bountyCount,
            paymentRequests: daoContrib.paymentRequestCount,
            repos: verifiedRepos,
            deps: verifiedDeps,
          },
        })
      }
    }

    // Normalize weights
    const totalWeight = recommendations.reduce(
      (sum, r) => sum + r.suggestedWeight,
      0,
    )
    if (totalWeight > 0) {
      for (const r of recommendations) {
        r.suggestedWeight = Math.floor(
          (r.suggestedWeight * MAX_BPS) / totalWeight,
        )
      }
    }

    return recommendations.sort((a, b) => b.suggestedWeight - a.suggestedWeight)
  }

  /**
   * Generate dependency funding recommendations from repo scan
   */
  async generateDependencyRecommendations(
    _daoId: string,
    repoOwner: string,
    repoName: string,
  ): Promise<DependencyFundingRecommendation[]> {
    const scanner = getDependencyScanner()
    const contributorService = getContributorService()

    // Load registered contributors for lookup
    const allContributors = await contributorService.getAllContributors()
    const depLookup = new Map<string, string>()

    for (const contributorId of allContributors) {
      const depClaims =
        await contributorService.getDependencyClaims(contributorId)
      for (const claim of depClaims) {
        if (claim.status === 'VERIFIED') {
          const key = `${claim.registryType}:${claim.packageName}`
          depLookup.set(key, contributorId)
        }
      }
    }

    scanner.setRegisteredContributors(depLookup)

    // Scan repository
    const scanResult = await scanner.scanRepository(repoOwner, repoName)

    // Convert to recommendations
    return scanResult.dependencies.map((dep) => ({
      packageName: dep.packageName,
      registryType: dep.registryType,
      suggestedWeight: dep.adjustedWeight,
      depth: dep.depth,
      usageCount: dep.usageCount,
      isRegistered: !!dep.registeredContributorId,
      maintainerContributorId: dep.registeredContributorId || null,
    }))
  }

  /**
   * Apply depth decay to weight (deps of deps get less)
   */
  applyDepthDecay(weight: number, depth: number): number {
    if (depth === 0) return weight

    let decayFactor = MAX_BPS
    for (let i = 0; i < depth; i++) {
      decayFactor = Math.floor(
        (decayFactor * (MAX_BPS - DEPTH_DECAY_BPS)) / MAX_BPS,
      )
    }

    return Math.floor((weight * decayFactor) / MAX_BPS)
  }

  /**
   * Sync dependencies from scan to on-chain registry
   */
  async syncDependencies(
    daoId: string,
    recommendations: DependencyFundingRecommendation[],
  ): Promise<Hash[]> {
    const hashes: Hash[] = []

    for (const rec of recommendations) {
      const hash = await this.registerDependency(
        daoId,
        rec.packageName,
        rec.registryType,
        rec.maintainerContributorId,
        rec.suggestedWeight,
        rec.depth,
        rec.usageCount,
      )
      hashes.push(hash)
    }

    return hashes
  }
}
let service: DeepFundingService | null = null

export function getDeepFundingService(
  config?: DeepFundingServiceConfig,
): DeepFundingService {
  if (!service && config) {
    service = new DeepFundingService(config)
  }
  if (!service) {
    throw new Error('DeepFundingService not initialized')
  }
  return service
}

export function resetDeepFundingService(): void {
  service = null
}
