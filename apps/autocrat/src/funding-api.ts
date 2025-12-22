/**
 * @module funding-api
 * @description Shared API layer for funding operations
 * Used by both MCP server and A2A agent to eliminate duplication
 */

import type { Address, Hash } from 'viem'
import {
  type ContributorProfile,
  type DependencyClaim,
  getContributorService,
  type RepositoryClaim,
  type SocialLink,
} from './contributor-service'
import {
  type ContributorShare,
  type DAOPool,
  type DependencyShare,
  type FeeDistributionConfig,
  type FundingEpoch,
  getDeepFundingService,
  type WeightVote,
} from './deep-funding-service'
import { getDependencyScanner, type ScanResult } from './dependency-scanner'
import {
  type CEODecision,
  type CouncilVote,
  getPaymentRequestService,
  type PaymentRequest,
  type VoteType,
} from './payment-request-service'

// ============ Types ============

export interface FundingApiConfig {
  /** If true, write operations will throw instead of returning error results */
  strictMode?: boolean
}

export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

// ============ Read Operations (No wallet required) ============

export const fundingApi = {
  // ============ DAO Pool & Epoch ============

  async getDAOPool(daoId: string): Promise<ApiResult<DAOPool>> {
    const service = getDeepFundingService()
    const pool = await service.getDAOPool(daoId)
    if (!pool) {
      return { success: false, error: 'Pool not found' }
    }
    return { success: true, data: pool }
  },

  async getCurrentEpoch(daoId: string): Promise<ApiResult<FundingEpoch>> {
    const service = getDeepFundingService()
    const epoch = await service.getCurrentEpoch(daoId)
    if (!epoch) {
      return { success: false, error: 'No active epoch' }
    }
    return { success: true, data: epoch }
  },

  async getEpochVotes(
    daoId: string,
    epochId: number,
  ): Promise<ApiResult<WeightVote[]>> {
    const service = getDeepFundingService()
    const votes = await service.getEpochVotes(daoId, epochId)
    return { success: true, data: votes }
  },

  async getDAOFundingConfig(
    daoId: string,
  ): Promise<ApiResult<FeeDistributionConfig>> {
    const service = getDeepFundingService()
    const config = await service.getDAOConfig(daoId)
    return { success: true, data: config }
  },

  async getDefaultFundingConfig(): Promise<ApiResult<FeeDistributionConfig>> {
    const service = getDeepFundingService()
    const config = await service.getDefaultConfig()
    return { success: true, data: config }
  },

  // ============ Contributors ============

  async getContributor(
    contributorId: string,
  ): Promise<ApiResult<ContributorProfile>> {
    const service = getContributorService()
    const profile = await service.getContributor(contributorId)
    if (!profile) {
      return { success: false, error: 'Contributor not found' }
    }
    return { success: true, data: profile }
  },

  async getContributorByWallet(
    wallet: Address,
  ): Promise<ApiResult<ContributorProfile>> {
    const service = getContributorService()
    const profile = await service.getContributorByWallet(wallet)
    if (!profile) {
      return { success: false, error: 'Contributor not found' }
    }
    return { success: true, data: profile }
  },

  async getContributorProfile(contributorId: string): Promise<
    ApiResult<{
      profile: ContributorProfile | null
      socialLinks: SocialLink[]
      repoClaims: RepositoryClaim[]
      depClaims: DependencyClaim[]
    }>
  > {
    const service = getContributorService()
    const [profile, socialLinks, repoClaims, depClaims] = await Promise.all([
      service.getContributor(contributorId),
      service.getSocialLinks(contributorId),
      service.getRepositoryClaims(contributorId),
      service.getDependencyClaims(contributorId),
    ])
    return {
      success: true,
      data: { profile, socialLinks, repoClaims, depClaims },
    }
  },

  async getPendingContributorRewards(
    daoId: string,
    contributorId: string,
  ): Promise<ApiResult<bigint>> {
    const service = getDeepFundingService()
    const rewards = await service.getPendingContributorRewards(
      daoId,
      contributorId,
    )
    return { success: true, data: rewards }
  },

  async getContributorShare(
    daoId: string,
    epochId: number,
    contributorId: string,
  ): Promise<ApiResult<ContributorShare>> {
    const service = getDeepFundingService()
    const share = await service.getContributorShare(
      daoId,
      epochId,
      contributorId,
    )
    if (!share) {
      return { success: false, error: 'Share not found' }
    }
    return { success: true, data: share }
  },

  async getAllContributors(): Promise<ApiResult<string[]>> {
    const service = getContributorService()
    const contributors = await service.getAllContributors()
    return { success: true, data: contributors }
  },

  async getContributorCount(): Promise<ApiResult<number>> {
    const service = getContributorService()
    const count = await service.getContributorCount()
    return { success: true, data: count }
  },

  async isVerifiedGitHub(contributorId: string): Promise<ApiResult<boolean>> {
    const service = getContributorService()
    const verified = await service.isVerifiedGitHub(contributorId)
    return { success: true, data: verified }
  },

  // ============ Dependencies ============

  async getDependencyShare(
    daoId: string,
    depHash: string,
  ): Promise<ApiResult<DependencyShare>> {
    const service = getDeepFundingService()
    const share = await service.getDependencyShare(daoId, depHash)
    if (!share) {
      return { success: false, error: 'Dependency share not found' }
    }
    return { success: true, data: share }
  },

  async scanRepository(
    owner: string,
    repo: string,
  ): Promise<ApiResult<ScanResult>> {
    const scanner = getDependencyScanner()
    const result = await scanner.scanRepository(owner, repo)
    return { success: true, data: result }
  },

  async generateContributorRecommendations(daoId: string): Promise<
    ApiResult<
      Array<{
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
      }>
    >
  > {
    const service = getDeepFundingService()
    const recommendations =
      await service.generateContributorRecommendations(daoId)
    return { success: true, data: recommendations }
  },

  async generateDependencyRecommendations(
    daoId: string,
    owner: string,
    repo: string,
  ): Promise<
    ApiResult<
      Array<{
        packageName: string
        registryType: string
        suggestedWeight: number
        depth: number
        usageCount: number
        isRegistered: boolean
        maintainerContributorId: string | null
      }>
    >
  > {
    const service = getDeepFundingService()
    const recommendations = await service.generateDependencyRecommendations(
      daoId,
      owner,
      repo,
    )
    return { success: true, data: recommendations }
  },

  // ============ Payment Requests ============

  async getPaymentRequest(
    requestId: string,
  ): Promise<ApiResult<PaymentRequest>> {
    const service = getPaymentRequestService()
    const request = await service.getRequest(requestId)
    if (!request) {
      return { success: false, error: 'Request not found' }
    }
    return { success: true, data: request }
  },

  async getPendingPaymentRequests(
    daoId: string,
  ): Promise<ApiResult<PaymentRequest[]>> {
    const service = getPaymentRequestService()
    const requests = await service.getPendingRequests(daoId)
    return { success: true, data: requests }
  },

  async getCouncilVotes(requestId: string): Promise<ApiResult<CouncilVote[]>> {
    const service = getPaymentRequestService()
    const votes = await service.getCouncilVotes(requestId)
    return { success: true, data: votes }
  },

  async getCEODecision(
    requestId: string,
  ): Promise<ApiResult<CEODecision | null>> {
    const service = getPaymentRequestService()
    const decision = await service.getCEODecision(requestId)
    return { success: true, data: decision }
  },

  // ============ Write Operations (Require wallet) ============

  /**
   * Vote on a weight adjustment during deliberation
   * Returns error result if no wallet client configured
   */
  async voteOnWeight(
    daoId: string,
    targetId: string,
    adjustment: number,
    reason: string,
    reputation: number,
  ): Promise<ApiResult<Hash>> {
    try {
      const service = getDeepFundingService()
      const hash = await service.voteOnWeight(
        daoId,
        targetId,
        adjustment,
        reason,
        reputation,
      )
      return { success: true, data: hash }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('Wallet client required')) {
        return {
          success: false,
          error: 'Wallet not connected. This operation requires a wallet.',
        }
      }
      return { success: false, error: message }
    }
  },

  /**
   * Submit a council vote on a payment request
   */
  async councilVote(
    requestId: string,
    vote: VoteType,
    reason: string,
  ): Promise<ApiResult<Hash>> {
    try {
      const service = getPaymentRequestService()
      const hash = await service.councilVote(requestId, vote, reason)
      return { success: true, data: hash }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('Wallet client required')) {
        return {
          success: false,
          error: 'Wallet not connected. This operation requires a wallet.',
        }
      }
      return { success: false, error: message }
    }
  },

  /**
   * Finalize an epoch
   */
  async finalizeEpoch(daoId: string): Promise<ApiResult<Hash>> {
    try {
      const service = getDeepFundingService()
      const hash = await service.finalizeEpoch(daoId)
      return { success: true, data: hash }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('Wallet client required')) {
        return {
          success: false,
          error: 'Wallet not connected. This operation requires a wallet.',
        }
      }
      return { success: false, error: message }
    }
  },

  /**
   * Deposit fees to a DAO pool
   */
  async depositFees(
    daoId: string,
    source: string,
    amount: bigint,
  ): Promise<ApiResult<Hash>> {
    try {
      const service = getDeepFundingService()
      const hash = await service.depositFees(daoId, source, amount)
      return { success: true, data: hash }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('Wallet client required')) {
        return {
          success: false,
          error: 'Wallet not connected. This operation requires a wallet.',
        }
      }
      return { success: false, error: message }
    }
  },

  /**
   * Claim contributor rewards
   */
  async claimContributorRewards(
    daoId: string,
    contributorId: string,
    epochs: number[],
    recipient: Address,
  ): Promise<ApiResult<Hash>> {
    try {
      const service = getDeepFundingService()
      const hash = await service.claimContributorRewards(
        daoId,
        contributorId,
        epochs,
        recipient,
      )
      return { success: true, data: hash }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('Wallet client required')) {
        return {
          success: false,
          error: 'Wallet not connected. This operation requires a wallet.',
        }
      }
      return { success: false, error: message }
    }
  },

  /**
   * Check if services are initialized with wallet support
   */
  hasWalletSupport(): boolean {
    try {
      // This will throw if services not initialized
      getDeepFundingService()
      return true
    } catch {
      return false
    }
  },
}

// ============ Convenience exports ============

export type FundingApi = typeof fundingApi
