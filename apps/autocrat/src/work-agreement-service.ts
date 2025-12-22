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

import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'

// ============ Types ============

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

// ============ Contract ABI ============

const WORK_AGREEMENT_REGISTRY_ABI = parseAbi([
  // Agreement Management
  'function createAgreement(bytes32 daoId, address contributor, bytes32 contributorId, uint8 agreementType, string title, string scopeUri, address paymentToken, uint256 compensationAmount, uint256 paymentPeriod, uint256 duration, uint256 startDate) external returns (bytes32)',
  'function signAgreement(bytes32 agreementId) external',
  'function pauseAgreement(bytes32 agreementId) external',
  'function resumeAgreement(bytes32 agreementId) external',
  'function terminateAgreement(bytes32 agreementId, string reason) external',
  'function completeAgreement(bytes32 agreementId) external',

  // Milestones
  'function addMilestone(bytes32 agreementId, string title, string description, uint256 dueDate, uint256 payment) external returns (bytes32)',
  'function completeMilestone(bytes32 agreementId, uint256 milestoneIndex, string deliverableUri) external',
  'function approveMilestone(bytes32 agreementId, uint256 milestoneIndex) external',

  // Payments
  'function processPayment(bytes32 agreementId) external',

  // Linking
  'function linkBounty(bytes32 agreementId, bytes32 bountyId) external',
  'function linkPaymentRequest(bytes32 agreementId, bytes32 requestId) external',

  // Disputes
  'function raiseDispute(bytes32 agreementId, string reason, string evidenceUri) external returns (bytes32)',
  'function voteOnDispute(bytes32 disputeId, bool inFavorOfContributor) external',
  'function escalateToFutarchy(bytes32 disputeId) external',

  // View Functions
  'function getAgreement(bytes32 agreementId) external view returns (bytes32, bytes32, address, bytes32, uint8, string, string, address, uint256, uint256, uint256, uint256, uint256, uint8, uint256, uint256, uint256, uint256, uint256)',
  'function getMilestones(bytes32 agreementId) external view returns (tuple(bytes32 milestoneId, bytes32 agreementId, string title, string description, uint256 dueDate, uint256 payment, bool completed, uint256 completedAt, string deliverableUri)[])',
  'function getLinkedBounties(bytes32 agreementId) external view returns (bytes32[])',
  'function getLinkedPaymentRequests(bytes32 agreementId) external view returns (bytes32[])',
  'function getDispute(bytes32 disputeId) external view returns (bytes32, bytes32, address, string, string, uint8, uint256, uint256, uint256, bytes32, uint256, uint256, bool)',
  'function getDAOAgreements(bytes32 daoId) external view returns (bytes32[])',
  'function getContributorAgreements(address contributor) external view returns (bytes32[])',
  'function getActiveAgreements(bytes32 daoId) external view returns (tuple(bytes32, bytes32, address, bytes32, uint8, string, string, address, uint256, uint256, uint256, uint256, uint256, uint8, uint256, uint256, uint256, uint256, uint256)[])',
])

// ============ Status Mappings ============

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

// ============ Service Class ============

export class WorkAgreementService {
  private publicClient: PublicClient
  private walletClient: WalletClient | null
  private registryAddress: Address

  constructor(config: WorkAgreementServiceConfig) {
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient || null
    this.registryAddress = config.registryAddress
  }

  // ============ Agreement Creation ============

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
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'createAgreement',
      args: [
        daoId as Hex,
        contributor,
        contributorId as Hex,
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
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'signAgreement',
      args: [agreementId as Hex],
    })
  }

  async pauseAgreement(agreementId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'pauseAgreement',
      args: [agreementId as Hex],
    })
  }

  async resumeAgreement(agreementId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'resumeAgreement',
      args: [agreementId as Hex],
    })
  }

  async terminateAgreement(agreementId: string, reason: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'terminateAgreement',
      args: [agreementId as Hex, reason],
    })
  }

  // ============ Milestones ============

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
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'addMilestone',
      args: [agreementId as Hex, title, description, BigInt(dueDate), payment],
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
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'completeMilestone',
      args: [agreementId as Hex, BigInt(milestoneIndex), deliverableUri],
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
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'approveMilestone',
      args: [agreementId as Hex, BigInt(milestoneIndex)],
    })
  }

  // ============ Payments ============

  async processPayment(agreementId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'processPayment',
      args: [agreementId as Hex],
    })
  }

  // ============ Disputes ============

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
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'raiseDispute',
      args: [agreementId as Hex, reason, evidenceUri],
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
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'voteOnDispute',
      args: [disputeId as Hex, inFavorOfContributor],
    })
  }

  async escalateToFutarchy(disputeId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    return await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'escalateToFutarchy',
      args: [disputeId as Hex],
    })
  }

  // ============ View Functions ============

  async getAgreement(agreementId: string): Promise<Agreement | null> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'getAgreement',
      args: [agreementId as Hex],
    })) as [
      Hex,
      Hex,
      Address,
      Hex,
      number,
      string,
      string,
      Address,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]

    if (result[17] === 0n) return null // createdAt == 0 means not found

    return {
      agreementId: result[0],
      daoId: result[1],
      contributor: result[2],
      contributorId: result[3],
      agreementType: AGREEMENT_TYPE_MAP[result[4]] || 'CONTRACT',
      title: result[5],
      scopeUri: result[6],
      compensation: { token: result[7], amount: result[8] },
      paymentPeriod: Number(result[9]),
      duration: Number(result[10]),
      startDate: Number(result[11]),
      endDate: Number(result[12]),
      status: AGREEMENT_STATUS_MAP[result[13]] || 'DRAFT',
      lastPaymentAt: Number(result[14]),
      totalPaid: result[15],
      paymentsCompleted: Number(result[16]),
      createdAt: Number(result[17]),
      signedAt: Number(result[18]),
    }
  }

  async getMilestones(agreementId: string): Promise<Milestone[]> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'getMilestones',
      args: [agreementId as Hex],
    })) as Array<{
      milestoneId: Hex
      agreementId: Hex
      title: string
      description: string
      dueDate: bigint
      payment: bigint
      completed: boolean
      completedAt: bigint
      deliverableUri: string
    }>

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
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'getDispute',
      args: [disputeId as Hex],
    })) as [
      Hex,
      Hex,
      Address,
      string,
      string,
      number,
      bigint,
      bigint,
      bigint,
      Hex,
      bigint,
      bigint,
      boolean,
    ]

    if (result[10] === 0n) return null // createdAt == 0

    return {
      disputeId: result[0],
      agreementId: result[1],
      initiator: result[2],
      reason: result[3],
      evidenceUri: result[4],
      status: DISPUTE_STATUS_MAP[result[5]] || 'NONE',
      councilDeadline: Number(result[6]),
      councilApprovals: Number(result[7]),
      councilRejections: Number(result[8]),
      futarchyCaseId: result[9],
      createdAt: Number(result[10]),
      resolvedAt: Number(result[11]),
      inFavorOfContributor: result[12],
    }
  }

  async getDAOAgreements(daoId: string): Promise<string[]> {
    return (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'getDAOAgreements',
      args: [daoId as Hex],
    })) as string[]
  }

  async getContributorAgreements(contributor: Address): Promise<string[]> {
    return (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'getContributorAgreements',
      args: [contributor],
    })) as string[]
  }

  async getLinkedBounties(agreementId: string): Promise<string[]> {
    return (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'getLinkedBounties',
      args: [agreementId as Hex],
    })) as string[]
  }

  async getLinkedPaymentRequests(agreementId: string): Promise<string[]> {
    return (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: WORK_AGREEMENT_REGISTRY_ABI,
      functionName: 'getLinkedPaymentRequests',
      args: [agreementId as Hex],
    })) as string[]
  }
}

// ============ Singleton ============

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
