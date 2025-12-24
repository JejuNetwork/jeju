/**
 * @module PaymentRequestService
 * @description Service for managing payment requests for non-bounty work
 *
 * Features:
 * - Multi-category support (marketing, ops, community, etc.)
 * - Council review with supermajority voting
 * - CEO approval for amounts below threshold
 * - Dispute escalation to futarchy
 * - Retroactive funding support
 * - Payments in DAO treasury tokens (own token preferred)
 */

import { paymentRequestRegistryAbi } from '@jejunetwork/contracts'
import type {
  Account,
  Address,
  Chain,
  Hash,
  PublicClient,
  WalletClient,
} from 'viem'
import { toHex } from '../lib'
export type PaymentCategory =
  | 'MARKETING'
  | 'COMMUNITY_MANAGEMENT'
  | 'OPERATIONS'
  | 'DOCUMENTATION'
  | 'DESIGN'
  | 'SUPPORT'
  | 'RESEARCH'
  | 'PARTNERSHIP'
  | 'EVENTS'
  | 'INFRASTRUCTURE'
  | 'OTHER'

export type PaymentRequestStatus =
  | 'SUBMITTED'
  | 'COUNCIL_REVIEW'
  | 'CEO_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'DISPUTED'
  | 'CANCELLED'

export type VoteType = 'APPROVE' | 'REJECT' | 'ABSTAIN'

export interface PaymentRequest {
  requestId: string
  daoId: string
  requester: Address
  contributorId: string
  category: PaymentCategory
  title: string
  description: string
  evidenceUri: string
  paymentToken: Address
  requestedAmount: bigint
  approvedAmount: bigint
  status: PaymentRequestStatus
  isRetroactive: boolean
  workStartDate: number
  workEndDate: number
  submittedAt: number
  reviewedAt: number
  paidAt: number
  rejectionReason: string
  disputeCaseId: string
}

export interface CouncilVote {
  voter: Address
  vote: VoteType
  reason: string
  votedAt: number
}

export interface CEODecision {
  approved: boolean
  modifiedAmount: bigint
  reason: string
  decidedAt: number
}

export interface DAOPaymentConfig {
  requiresCouncilApproval: boolean
  minCouncilVotes: number
  councilSupermajorityBps: number
  ceoCanOverride: boolean
  maxAutoApproveAmount: bigint
  reviewPeriod: number
  disputePeriod: number
  treasuryToken: Address
  allowRetroactive: boolean
  retroactiveMaxAge: number
}

export interface PaymentRequestServiceConfig {
  publicClient: PublicClient
  walletClient?: WalletClient
  registryAddress: Address
  chain: Chain
  account?: Account | Address
}

export interface SubmitPaymentRequestParams {
  daoId: string
  contributorId: string
  category: PaymentCategory
  title: string
  description: string
  evidenceUri: string
  requestedAmount: bigint
  isRetroactive?: boolean
  workStartDate?: number
  workEndDate?: number
}
const CATEGORY_NAMES: PaymentCategory[] = [
  'MARKETING',
  'COMMUNITY_MANAGEMENT',
  'OPERATIONS',
  'DOCUMENTATION',
  'DESIGN',
  'SUPPORT',
  'RESEARCH',
  'PARTNERSHIP',
  'EVENTS',
  'INFRASTRUCTURE',
  'OTHER',
]

const STATUS_NAMES: PaymentRequestStatus[] = [
  'SUBMITTED',
  'COUNCIL_REVIEW',
  'CEO_REVIEW',
  'APPROVED',
  'REJECTED',
  'PAID',
  'DISPUTED',
  'CANCELLED',
]

const VOTE_NAMES: VoteType[] = ['APPROVE', 'REJECT', 'ABSTAIN']

function getCategoryIndex(category: PaymentCategory): number {
  return CATEGORY_NAMES.indexOf(category)
}

function getVoteIndex(vote: VoteType): number {
  return VOTE_NAMES.indexOf(vote)
}
export class PaymentRequestService {
  private publicClient: PublicClient
  private walletClient: WalletClient | null
  private registryAddress: Address
  private chain: Chain
  private account: Account | Address | null

  constructor(config: PaymentRequestServiceConfig) {
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient || null
    this.registryAddress = config.registryAddress
    this.chain = config.chain
    this.account = config.account || null
  }
  async submitRequest(params: SubmitPaymentRequestParams): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'submitRequest',
      chain: this.chain,
      account: this.account,
      args: [
        toHex(params.daoId),
        toHex(params.contributorId),
        getCategoryIndex(params.category),
        params.title,
        params.description,
        params.evidenceUri,
        params.requestedAmount,
        params.isRetroactive || false,
        BigInt(params.workStartDate || 0),
        BigInt(params.workEndDate || 0),
      ],
    })

    return hash
  }

  async updateEvidence(requestId: string, evidenceUri: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'updateEvidence',
      chain: this.chain,
      account: this.account,
      args: [toHex(requestId), evidenceUri],
    })

    return hash
  }

  async cancelRequest(requestId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'cancelRequest',
      chain: this.chain,
      account: this.account,
      args: [toHex(requestId)],
    })

    return hash
  }
  async councilVote(
    requestId: string,
    vote: VoteType,
    reason: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'councilVote',
      chain: this.chain,
      account: this.account,
      args: [toHex(requestId), getVoteIndex(vote), reason],
    })

    return hash
  }

  async escalateToCEO(requestId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'escalateToCEO',
      chain: this.chain,
      account: this.account,
      args: [toHex(requestId)],
    })

    return hash
  }
  async ceoDecision(
    requestId: string,
    approved: boolean,
    modifiedAmount: bigint,
    reason: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'ceoDecision',
      chain: this.chain,
      account: this.account,
      args: [toHex(requestId), approved, modifiedAmount, reason],
    })

    return hash
  }
  async fileDispute(requestId: string, evidenceUri: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'fileDispute',
      chain: this.chain,
      account: this.account,
      args: [toHex(requestId), evidenceUri],
    })

    return hash
  }
  async executePayment(requestId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'executePayment',
      chain: this.chain,
      account: this.account,
      args: [toHex(requestId)],
    })

    return hash
  }
  async setDAOConfig(daoId: string, config: DAOPaymentConfig): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'setDAOConfig',
      chain: this.chain,
      account: this.account,
      args: [
        toHex(daoId),
        {
          requiresCouncilApproval: config.requiresCouncilApproval,
          minCouncilVotes: BigInt(config.minCouncilVotes),
          councilSupermajorityBps: BigInt(config.councilSupermajorityBps),
          ceoCanOverride: config.ceoCanOverride,
          maxAutoApproveAmount: config.maxAutoApproveAmount,
          reviewPeriod: BigInt(config.reviewPeriod),
          disputePeriod: BigInt(config.disputePeriod),
          treasuryToken: config.treasuryToken,
          allowRetroactive: config.allowRetroactive,
          retroactiveMaxAge: BigInt(config.retroactiveMaxAge),
        },
      ],
    })

    return hash
  }
  async getRequest(requestId: string): Promise<PaymentRequest | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getRequest',
      args: [toHex(requestId)],
    })

    if (!result || result.submittedAt === 0n) return null

    return {
      requestId: result.requestId,
      daoId: result.daoId,
      requester: result.requester,
      contributorId: result.contributorId,
      category: CATEGORY_NAMES[result.category] || 'OTHER',
      title: result.title,
      description: result.description,
      evidenceUri: result.evidenceUri,
      paymentToken: result.paymentToken,
      requestedAmount: result.requestedAmount,
      approvedAmount: result.approvedAmount,
      status: STATUS_NAMES[result.status] || 'SUBMITTED',
      isRetroactive: result.isRetroactive,
      workStartDate: Number(result.workStartDate),
      workEndDate: Number(result.workEndDate),
      submittedAt: Number(result.submittedAt),
      reviewedAt: Number(result.reviewedAt),
      paidAt: Number(result.paidAt),
      rejectionReason: result.rejectionReason,
      disputeCaseId: result.disputeCaseId,
    }
  }

  async getCouncilVotes(requestId: string): Promise<CouncilVote[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getCouncilVotes',
      args: [toHex(requestId)],
    })

    return result.map((v) => ({
      voter: v.voter,
      vote: VOTE_NAMES[v.vote] || 'ABSTAIN',
      reason: v.reason,
      votedAt: Number(v.votedAt),
    }))
  }

  async getCEODecision(requestId: string): Promise<CEODecision | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getCEODecision',
      args: [toHex(requestId)],
    })

    if (result.decidedAt === 0n) return null

    return {
      approved: result.approved,
      modifiedAmount: result.modifiedAmount,
      reason: result.reason,
      decidedAt: Number(result.decidedAt),
    }
  }

  async getDAORequests(daoId: string): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getDAORequests',
      args: [toHex(daoId)],
    })
  }

  async getRequesterRequests(
    requester: Address,
  ): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getRequesterRequests',
      args: [requester],
    })
  }

  async getContributorRequests(
    contributorId: string,
  ): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getContributorRequests',
      args: [toHex(contributorId)],
    })
  }

  async getDAOConfig(daoId: string): Promise<DAOPaymentConfig> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getDAOConfig',
      args: [toHex(daoId)],
    })

    return {
      requiresCouncilApproval: result.requiresCouncilApproval,
      minCouncilVotes: Number(result.minCouncilVotes),
      councilSupermajorityBps: Number(result.councilSupermajorityBps),
      ceoCanOverride: result.ceoCanOverride,
      maxAutoApproveAmount: result.maxAutoApproveAmount,
      reviewPeriod: Number(result.reviewPeriod),
      disputePeriod: Number(result.disputePeriod),
      treasuryToken: result.treasuryToken,
      allowRetroactive: result.allowRetroactive,
      retroactiveMaxAge: Number(result.retroactiveMaxAge),
    }
  }

  async getPendingRequests(daoId: string): Promise<PaymentRequest[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: paymentRequestRegistryAbi,
      functionName: 'getPendingRequests',
      args: [toHex(daoId)],
    })

    return result.map((r) => ({
      requestId: r.requestId,
      daoId: r.daoId,
      requester: r.requester,
      contributorId: r.contributorId,
      category: CATEGORY_NAMES[r.category] || 'OTHER',
      title: r.title,
      description: r.description,
      evidenceUri: r.evidenceUri,
      paymentToken: r.paymentToken,
      requestedAmount: r.requestedAmount,
      approvedAmount: r.approvedAmount,
      status: STATUS_NAMES[r.status] || 'SUBMITTED',
      isRetroactive: r.isRetroactive,
      workStartDate: Number(r.workStartDate),
      workEndDate: Number(r.workEndDate),
      submittedAt: Number(r.submittedAt),
      reviewedAt: Number(r.reviewedAt),
      paidAt: Number(r.paidAt),
      rejectionReason: r.rejectionReason,
      disputeCaseId: r.disputeCaseId,
    }))
  }
  getCategoryDisplayName(category: PaymentCategory): string {
    const names: Record<PaymentCategory, string> = {
      MARKETING: 'Marketing',
      COMMUNITY_MANAGEMENT: 'Community Management',
      OPERATIONS: 'Operations',
      DOCUMENTATION: 'Documentation',
      DESIGN: 'Design',
      SUPPORT: 'Support',
      RESEARCH: 'Research',
      PARTNERSHIP: 'Partnership',
      EVENTS: 'Events',
      INFRASTRUCTURE: 'Infrastructure',
      OTHER: 'Other',
    }
    return names[category]
  }

  getStatusDisplayName(status: PaymentRequestStatus): string {
    const names: Record<PaymentRequestStatus, string> = {
      SUBMITTED: 'Submitted',
      COUNCIL_REVIEW: 'Under Council Review',
      CEO_REVIEW: 'Awaiting CEO Decision',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      PAID: 'Paid',
      DISPUTED: 'Disputed',
      CANCELLED: 'Cancelled',
    }
    return names[status]
  }
}
let service: PaymentRequestService | null = null

export function getPaymentRequestService(
  config?: PaymentRequestServiceConfig,
): PaymentRequestService {
  if (!service && config) {
    service = new PaymentRequestService(config)
  }
  if (!service) {
    throw new Error('PaymentRequestService not initialized')
  }
  return service
}

export function resetPaymentRequestService(): void {
  service = null
}
