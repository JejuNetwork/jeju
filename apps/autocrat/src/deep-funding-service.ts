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

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hash,
  http,
  type PublicClient,
  parseAbi,
  type Transport,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import {
  type ContributorProfile,
  getContributorService,
} from './contributor-service'
import { getDependencyScanner } from './dependency-scanner'

// ============ Types ============

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

// ============ Contract ABI ============

const DEEP_FUNDING_DISTRIBUTOR_ABI = parseAbi([
  // Fee Collection
  'function depositFees(bytes32 daoId, string source) external payable',
  'function depositTokenFees(bytes32 daoId, address token, uint256 amount, string source) external',

  // Weight Management
  'function setContributorWeight(bytes32 daoId, bytes32 contributorId, uint256 weight) external',
  'function registerDependency(bytes32 daoId, string packageName, string registryType, bytes32 maintainerContributorId, uint256 weight, uint256 transitiveDepth, uint256 usageCount) external',
  'function voteOnWeight(bytes32 daoId, bytes32 targetId, int256 adjustment, string reason, uint256 reputation) external',

  // Epoch Management
  'function finalizeEpoch(bytes32 daoId) external',

  // Claiming
  'function claimContributorRewards(bytes32 daoId, bytes32 contributorId, uint256[] epochs, address recipient) external',
  'function claimDependencyRewards(bytes32 daoId, bytes32 depHash, address recipient) external',

  // Configuration
  'function setDAOConfig(bytes32 daoId, tuple(uint256 treasuryBps, uint256 contributorPoolBps, uint256 dependencyPoolBps, uint256 jejuBps, uint256 burnBps, uint256 reserveBps) config) external',
  'function setDefaultConfig(tuple(uint256 treasuryBps, uint256 contributorPoolBps, uint256 dependencyPoolBps, uint256 jejuBps, uint256 burnBps, uint256 reserveBps) config) external',
  'function authorizeDepositor(address depositor, bool authorized) external',

  // View Functions
  'function getDAOPool(bytes32 daoId) external view returns (tuple(bytes32 daoId, address token, uint256 totalAccumulated, uint256 contributorPool, uint256 dependencyPool, uint256 reservePool, uint256 lastDistributedEpoch, uint256 epochStartTime))',
  'function getCurrentEpoch(bytes32 daoId) external view returns (tuple(uint256 epochId, bytes32 daoId, uint256 startTime, uint256 endTime, uint256 totalContributorRewards, uint256 totalDependencyRewards, uint256 totalDistributed, bool finalized))',
  'function getEpoch(bytes32 daoId, uint256 epochId) external view returns (tuple(uint256 epochId, bytes32 daoId, uint256 startTime, uint256 endTime, uint256 totalContributorRewards, uint256 totalDependencyRewards, uint256 totalDistributed, bool finalized))',
  'function getContributorShare(bytes32 daoId, uint256 epochId, bytes32 contributorId) external view returns (tuple(bytes32 contributorId, uint256 weight, uint256 pendingRewards, uint256 claimedRewards, uint256 lastClaimEpoch))',
  'function getDependencyShare(bytes32 daoId, bytes32 depHash) external view returns (tuple(bytes32 depHash, bytes32 contributorId, uint256 weight, uint256 transitiveDepth, uint256 usageCount, uint256 pendingRewards, uint256 claimedRewards, bool isRegistered))',
  'function getDAOConfig(bytes32 daoId) external view returns (tuple(uint256 treasuryBps, uint256 contributorPoolBps, uint256 dependencyPoolBps, uint256 jejuBps, uint256 burnBps, uint256 reserveBps))',
  'function getEpochVotes(bytes32 daoId, uint256 epochId) external view returns (tuple(address voter, bytes32 targetId, int256 weightAdjustment, string reason, uint256 reputation, uint256 votedAt)[])',
  'function getPendingContributorRewards(bytes32 daoId, bytes32 contributorId) external view returns (uint256)',
  'function defaultConfig() external view returns (tuple(uint256 treasuryBps, uint256 contributorPoolBps, uint256 dependencyPoolBps, uint256 jejuBps, uint256 burnBps, uint256 reserveBps))',

  // Events
  'event FeesDeposited(bytes32 indexed daoId, address indexed depositor, uint256 amount, string source)',
  'event EpochCreated(bytes32 indexed daoId, uint256 indexed epochId, uint256 startTime, uint256 endTime)',
  'event EpochFinalized(bytes32 indexed daoId, uint256 indexed epochId, uint256 totalDistributed)',
  'event ContributorWeightSet(bytes32 indexed daoId, bytes32 indexed contributorId, uint256 weight)',
  'event DependencyRegistered(bytes32 indexed daoId, bytes32 indexed depHash, string packageName, uint256 weight)',
  'event RewardsClaimed(bytes32 indexed contributorId, bytes32 indexed daoId, uint256 amount)',
])

// ============ Constants ============

const MAX_BPS = 10000
const DEPTH_DECAY_BPS = 2000 // 20% decay per level

// ============ Service Class ============

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
      this.account = privateKeyToAccount(config.operatorKey as `0x${string}`)
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

  // ============ Fee Deposit ============

  async depositFees(
    daoId: string,
    source: string,
    amount: bigint,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'depositFees',
      args: [daoId as `0x${string}`, source],
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
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'depositTokenFees',
      args: [daoId as `0x${string}`, token, amount, source],
      account: this.account,
    })

    return hash
  }

  // ============ Weight Management ============

  async setContributorWeight(
    daoId: string,
    contributorId: string,
    weight: number,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'setContributorWeight',
      args: [
        daoId as `0x${string}`,
        contributorId as `0x${string}`,
        BigInt(weight),
      ],
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
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'registerDependency',
      args: [
        daoId as `0x${string}`,
        packageName,
        registryType,
        maintainerId as `0x${string}`,
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
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'voteOnWeight',
      args: [
        daoId as `0x${string}`,
        targetId as `0x${string}`,
        BigInt(adjustment),
        reason,
        BigInt(reputation),
      ],
      account: this.account,
    })

    return hash
  }

  // ============ Epoch Management ============

  async finalizeEpoch(daoId: string): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'finalizeEpoch',
      args: [daoId as `0x${string}`],
      account: this.account,
    })

    return hash
  }

  // ============ Claiming ============

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
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'claimContributorRewards',
      args: [
        daoId as `0x${string}`,
        contributorId as `0x${string}`,
        epochs.map(BigInt),
        recipient,
      ],
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
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'claimDependencyRewards',
      args: [daoId as `0x${string}`, depHash as `0x${string}`, recipient],
      account: this.account,
    })

    return hash
  }

  // ============ Configuration ============

  async setDAOConfig(
    daoId: string,
    config: FeeDistributionConfig,
  ): Promise<Hash> {
    if (!this.account) throw new Error('Operator key required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'setDAOConfig',
      args: [
        daoId as `0x${string}`,
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
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'authorizeDepositor',
      args: [depositor, authorized],
      account: this.account,
    })

    return hash
  }

  // ============ View Functions ============

  async getDAOPool(daoId: string): Promise<DAOPool | null> {
    const result = (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getDAOPool',
      args: [daoId as `0x${string}`],
    })) as [string, Address, bigint, bigint, bigint, bigint, bigint, bigint]

    if (!result || result[0] === `0x${'0'.repeat(64)}`) return null

    return {
      daoId: result[0],
      token: result[1],
      totalAccumulated: result[2],
      contributorPool: result[3],
      dependencyPool: result[4],
      reservePool: result[5],
      lastDistributedEpoch: Number(result[6]),
      epochStartTime: Number(result[7]),
    }
  }

  async getCurrentEpoch(daoId: string): Promise<FundingEpoch | null> {
    const result = (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getCurrentEpoch',
      args: [daoId as `0x${string}`],
    })) as [bigint, string, bigint, bigint, bigint, bigint, bigint, boolean]

    if (result[0] === 0n) return null

    return {
      epochId: Number(result[0]),
      daoId: result[1],
      startTime: Number(result[2]),
      endTime: Number(result[3]),
      totalContributorRewards: result[4],
      totalDependencyRewards: result[5],
      totalDistributed: result[6],
      finalized: result[7],
    }
  }

  async getContributorShare(
    daoId: string,
    epochId: number,
    contributorId: string,
  ): Promise<ContributorShare | null> {
    const result = (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getContributorShare',
      args: [
        daoId as `0x${string}`,
        BigInt(epochId),
        contributorId as `0x${string}`,
      ],
    })) as [string, bigint, bigint, bigint, bigint]

    if (!result || result[0] === `0x${'0'.repeat(64)}`) return null

    return {
      contributorId: result[0],
      weight: Number(result[1]),
      pendingRewards: result[2],
      claimedRewards: result[3],
      lastClaimEpoch: Number(result[4]),
    }
  }

  async getDependencyShare(
    daoId: string,
    depHash: string,
  ): Promise<DependencyShare | null> {
    const result = (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getDependencyShare',
      args: [daoId as `0x${string}`, depHash as `0x${string}`],
    })) as [string, string, bigint, bigint, bigint, bigint, bigint, boolean]

    if (!result || result[0] === `0x${'0'.repeat(64)}`) return null

    return {
      depHash: result[0],
      contributorId: result[1],
      weight: Number(result[2]),
      transitiveDepth: Number(result[3]),
      usageCount: Number(result[4]),
      pendingRewards: result[5],
      claimedRewards: result[6],
      isRegistered: result[7],
    }
  }

  async getDAOConfig(daoId: string): Promise<FeeDistributionConfig> {
    const result = (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getDAOConfig',
      args: [daoId as `0x${string}`],
    })) as [bigint, bigint, bigint, bigint, bigint, bigint]

    return {
      treasuryBps: Number(result[0]),
      contributorPoolBps: Number(result[1]),
      dependencyPoolBps: Number(result[2]),
      jejuBps: Number(result[3]),
      burnBps: Number(result[4]),
      reserveBps: Number(result[5]),
    }
  }

  async getDefaultConfig(): Promise<FeeDistributionConfig> {
    const result = (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'defaultConfig',
    })) as [bigint, bigint, bigint, bigint, bigint, bigint]

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
    return (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getPendingContributorRewards',
      args: [daoId as `0x${string}`, contributorId as `0x${string}`],
    })) as bigint
  }

  async getEpochVotes(daoId: string, epochId: number): Promise<WeightVote[]> {
    const result = (await this.publicClient.readContract({
      address: this.distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getEpochVotes',
      args: [daoId as `0x${string}`, BigInt(epochId)],
    })) as Array<[Address, string, bigint, string, bigint, bigint]>

    return result.map((v) => ({
      voter: v[0],
      targetId: v[1],
      weightAdjustment: Number(v[2]),
      reason: v[3],
      reputation: Number(v[4]),
      votedAt: Number(v[5]),
    }))
  }

  // ============ Recommendation Engine ============

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

// ============ Singleton Export ============

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
