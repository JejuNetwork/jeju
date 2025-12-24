/**
 * @module WorkAgreementService
 * @description TypeScript service for managing work agreements between contributors and DAOs
 *
 * Features:
 * - Create/sign formal work agreements
 * - Milestone tracking and payment
 * - Recurring payment processing
 * - Dispute escalation (Council -> Futarchy)
 * - Link bounties and payment requests
 */

import { workAgreementRegistryAbi } from '@jejunetwork/contracts'
import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { toHex } from '../lib'
export type AgreementType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'BOUNTY_BASED'
  | 'RETAINER'
export type AgreementStatus =
  | 'DRAFT'
  | 'PENDING_SIGNATURE'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'TERMINATED'
  | 'DISPUTED'
export type DisputeStatus =
  | 'NONE'
  | 'COUNCIL_REVIEW'
  | 'FUTARCHY_PENDING'
  | 'RESOLVED'

export interface TokenAmount {
  token: Address
  amount: bigint
}

export interface Agreement {
  agreementId: string
  daoId: string
  contributor: Address
  contributorId: string
  agreementType: AgreementType
  title: string
  scopeUri: string
  compensation: TokenAmount
  paymentPeriod: number
  duration: number
  startDate: number
  endDate: number
  status: AgreementStatus
  lastPaymentAt: number
  totalPaid: bigint
  paymentsCompleted: number
  createdAt: number
  signedAt: number
}

export interface Milestone {
  milestoneId: string
  agreementId: string
  title: string
  description: string
  dueDate: number
  payment: bigint
  completed: boolean
  completedAt: number
  deliverableUri: string
}

export interface Dispute {
  disputeId: string
  agreementId: string
  initiator: Address
  reason: string
  evidenceUri: string
  status: DisputeStatus
  councilDeadline: number
  councilApprovals: number
  councilRejections: number
  futarchyCaseId: string
  createdAt: number
  resolvedAt: number
  inFavorOfContributor: boolean
}

export interface WorkAgreementServiceConfig {
  publicClient: PublicClient
  walletClient?: WalletClient
  registryAddress: Address
}
const AGREEMENT_TYPE_MAP: Record<number, AgreementType> = {
  0: 'FULL_TIME',
  1: 'PART_TIME',
  2: 'CONTRACT',
  3: 'BOUNTY_BASED',
  4: 'RETAINER',
}

const AGREEMENT_STATUS_MAP: Record<number, AgreementStatus> = {
  0: 'DRAFT',
  1: 'PENDING_SIGNATURE',
  2: 'ACTIVE',
  3: 'PAUSED',
  4: 'COMPLETED',
  5: 'TERMINATED',
  6: 'DISPUTED',
}

const DISPUTE_STATUS_MAP: Record<number, DisputeStatus> = {
  0: 'NONE',
  1: 'COUNCIL_REVIEW',
  2: 'FUTARCHY_PENDING',
  3: 'RESOLVED',
}
export class WorkAgreementService {
  private publicClient: PublicClient
  private walletClient: WalletClient | null
  private registryAddress: Address

  constructor(config: WorkAgreementServiceConfig) {
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient || null
    this.registryAddress = config.registryAddress
  }
  async createAgreement(
    daoId: string,
    contributor: Address,
    contributorId: string,
    agreementType: AgreementType,
    title: string,
    scopeUri: string,
    paymentToken: Address,
    compensationAmount: bigint,
    paymentPeriod: number,
    duration: number,
    startDate?: number,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const typeIndex =
      Object.entries(AGREEMENT_TYPE_MAP).find(
        ([_, v]) => v === agreementType,
      )?.[0] || '0'

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'createAgreement',
      args: [
        toHex(daoId),
        contributor,
        toHex(contributorId),
        Number(typeIndex),
        title,
        scopeUri,
        paymentToken,
        compensationAmount,
        BigInt(paymentPeriod),
        BigInt(duration),
        BigInt(startDate || 0),
      ],
    })
  }

  async signAgreement(agreementId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'signAgreement',
      args: [toHex(agreementId)],
    })
  }

  async pauseAgreement(agreementId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'pauseAgreement',
      args: [toHex(agreementId)],
    })
  }

  async resumeAgreement(agreementId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'resumeAgreement',
      args: [toHex(agreementId)],
    })
  }

  async terminateAgreement(agreementId: string, reason: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'terminateAgreement',
      args: [toHex(agreementId), reason],
    })
  }
  async addMilestone(
    agreementId: string,
    title: string,
    description: string,
    dueDate: number,
    payment: bigint,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'addMilestone',
      args: [toHex(agreementId), title, description, BigInt(dueDate), payment],
    })
  }

  async completeMilestone(
    agreementId: string,
    milestoneIndex: number,
    deliverableUri: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'completeMilestone',
      args: [toHex(agreementId), BigInt(milestoneIndex), deliverableUri],
    })
  }

  async approveMilestone(
    agreementId: string,
    milestoneIndex: number,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'approveMilestone',
      args: [toHex(agreementId), BigInt(milestoneIndex)],
    })
  }
  async processPayment(agreementId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'processPayment',
      args: [toHex(agreementId)],
    })
  }
  async raiseDispute(
    agreementId: string,
    reason: string,
    evidenceUri: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'raiseDispute',
      args: [toHex(agreementId), reason, evidenceUri],
    })
  }

  async voteOnDispute(
    disputeId: string,
    inFavorOfContributor: boolean,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'voteOnDispute',
      args: [toHex(disputeId), inFavorOfContributor],
    })
  }

  async escalateToFutarchy(disputeId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'escalateToFutarchy',
      args: [toHex(disputeId)],
    })
  }
  async getAgreement(agreementId: string): Promise<Agreement | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'getAgreement',
      args: [toHex(agreementId)],
    })

    if (result.createdAt === 0n) return null // createdAt == 0 means not found

    return {
      agreementId: result.agreementId,
      daoId: result.daoId,
      contributor: result.contributor,
      contributorId: result.contributorId,
      agreementType: AGREEMENT_TYPE_MAP[result.agreementType] || 'CONTRACT',
      title: result.title,
      scopeUri: result.scopeUri,
      compensation: {
        token: result.compensation.token,
        amount: result.compensation.amount,
      },
      paymentPeriod: Number(result.paymentPeriod),
      duration: Number(result.duration),
      startDate: Number(result.startDate),
      endDate: Number(result.endDate),
      status: AGREEMENT_STATUS_MAP[result.status] || 'DRAFT',
      lastPaymentAt: Number(result.lastPaymentAt),
      totalPaid: result.totalPaid,
      paymentsCompleted: Number(result.paymentsCompleted),
      createdAt: Number(result.createdAt),
      signedAt: Number(result.signedAt),
    }
  }

  async getMilestones(agreementId: string): Promise<Milestone[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'getMilestones',
      args: [toHex(agreementId)],
    })

    return result.map((m) => ({
      milestoneId: m.milestoneId,
      agreementId: m.agreementId,
      title: m.title,
      description: m.description,
      dueDate: Number(m.dueDate),
      payment: m.payment,
      completed: m.completed,
      completedAt: Number(m.completedAt),
      deliverableUri: m.deliverableUri,
    }))
  }

  async getDispute(disputeId: string): Promise<Dispute | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'getDispute',
      args: [toHex(disputeId)],
    })

    if (result.createdAt === 0n) return null // createdAt == 0

    return {
      disputeId: result.disputeId,
      agreementId: result.agreementId,
      initiator: result.initiator,
      reason: result.reason,
      evidenceUri: result.evidenceUri,
      status: DISPUTE_STATUS_MAP[result.status] || 'NONE',
      councilDeadline: Number(result.councilDeadline),
      councilApprovals: Number(result.councilApprovals),
      councilRejections: Number(result.councilRejections),
      futarchyCaseId: result.futarchyCaseId,
      createdAt: Number(result.createdAt),
      resolvedAt: Number(result.resolvedAt),
      inFavorOfContributor: result.inFavorOfContributor,
    }
  }

  async getDAOAgreements(daoId: string): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'getDAOAgreements',
      args: [toHex(daoId)],
    })
  }

  async getContributorAgreements(
    contributor: Address,
  ): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'getContributorAgreements',
      args: [contributor],
    })
  }

  async getLinkedBounties(
    agreementId: string,
  ): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'getLinkedBounties',
      args: [toHex(agreementId)],
    })
  }

  async getLinkedPaymentRequests(
    agreementId: string,
  ): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: workAgreementRegistryAbi,
      functionName: 'getLinkedPaymentRequests',
      args: [toHex(agreementId)],
    })
  }
}
let service: WorkAgreementService | null = null

export function getWorkAgreementService(
  config?: WorkAgreementServiceConfig,
): WorkAgreementService {
  if (!service && config) {
    service = new WorkAgreementService(config)
  }
  if (!service) {
    throw new Error('WorkAgreementService not initialized')
  }
  return service
}

export function resetWorkAgreementService(): void {
  service = null
}
