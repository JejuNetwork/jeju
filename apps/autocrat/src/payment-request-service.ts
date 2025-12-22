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

import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  parseAbi,
} from 'viem';

// ============ Types ============

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
  | 'OTHER';

export type PaymentRequestStatus =
  | 'SUBMITTED'
  | 'COUNCIL_REVIEW'
  | 'CEO_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'DISPUTED'
  | 'CANCELLED';

export type VoteType = 'APPROVE' | 'REJECT' | 'ABSTAIN';

export interface PaymentRequest {
  requestId: string;
  daoId: string;
  requester: Address;
  contributorId: string;
  category: PaymentCategory;
  title: string;
  description: string;
  evidenceUri: string;
  paymentToken: Address;
  requestedAmount: bigint;
  approvedAmount: bigint;
  status: PaymentRequestStatus;
  isRetroactive: boolean;
  workStartDate: number;
  workEndDate: number;
  submittedAt: number;
  reviewedAt: number;
  paidAt: number;
  rejectionReason: string;
  disputeCaseId: string;
}

export interface CouncilVote {
  voter: Address;
  vote: VoteType;
  reason: string;
  votedAt: number;
}

export interface CEODecision {
  approved: boolean;
  modifiedAmount: bigint;
  reason: string;
  decidedAt: number;
}

export interface DAOPaymentConfig {
  requiresCouncilApproval: boolean;
  minCouncilVotes: number;
  councilSupermajorityBps: number;
  ceoCanOverride: boolean;
  maxAutoApproveAmount: bigint;
  reviewPeriod: number;
  disputePeriod: number;
  treasuryToken: Address;
  allowRetroactive: boolean;
  retroactiveMaxAge: number;
}

export interface PaymentRequestServiceConfig {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  registryAddress: Address;
}

export interface SubmitPaymentRequestParams {
  daoId: string;
  contributorId: string;
  category: PaymentCategory;
  title: string;
  description: string;
  evidenceUri: string;
  requestedAmount: bigint;
  isRetroactive?: boolean;
  workStartDate?: number;
  workEndDate?: number;
}

// ============ Contract ABI ============

const PAYMENT_REQUEST_REGISTRY_ABI = parseAbi([
  // Submission
  'function submitRequest(bytes32 daoId, bytes32 contributorId, uint8 category, string title, string description, string evidenceUri, uint256 requestedAmount, bool isRetroactive, uint256 workStartDate, uint256 workEndDate) external returns (bytes32 requestId)',
  'function updateEvidence(bytes32 requestId, string evidenceUri) external',
  'function cancelRequest(bytes32 requestId) external',

  // Council Review
  'function councilVote(bytes32 requestId, uint8 vote, string reason) external',
  'function escalateToCEO(bytes32 requestId) external',

  // CEO Review
  'function ceoDecision(bytes32 requestId, bool approved, uint256 modifiedAmount, string reason) external',

  // Dispute
  'function fileDispute(bytes32 requestId, string evidenceUri) external',
  'function resolveDispute(bytes32 requestId, bool inFavorOfRequester, uint256 awardedAmount) external',

  // Payment
  'function executePayment(bytes32 requestId) external',

  // Configuration
  'function setDAOConfig(bytes32 daoId, tuple(bool requiresCouncilApproval, uint256 minCouncilVotes, uint256 councilSupermajorityBps, bool ceoCanOverride, uint256 maxAutoApproveAmount, uint256 reviewPeriod, uint256 disputePeriod, address treasuryToken, bool allowRetroactive, uint256 retroactiveMaxAge) config) external',

  // View Functions
  'function getRequest(bytes32 requestId) external view returns (tuple(bytes32 requestId, bytes32 daoId, address requester, bytes32 contributorId, uint8 category, string title, string description, string evidenceUri, address paymentToken, uint256 requestedAmount, uint256 approvedAmount, uint8 status, bool isRetroactive, uint256 workStartDate, uint256 workEndDate, uint256 submittedAt, uint256 reviewedAt, uint256 paidAt, string rejectionReason, bytes32 disputeCaseId))',
  'function getCouncilVotes(bytes32 requestId) external view returns (tuple(address voter, uint8 vote, string reason, uint256 votedAt)[])',
  'function getCEODecision(bytes32 requestId) external view returns (tuple(bool approved, uint256 modifiedAmount, string reason, uint256 decidedAt))',
  'function getDAORequests(bytes32 daoId) external view returns (bytes32[])',
  'function getRequesterRequests(address requester) external view returns (bytes32[])',
  'function getContributorRequests(bytes32 contributorId) external view returns (bytes32[])',
  'function getDAOConfig(bytes32 daoId) external view returns (tuple(bool requiresCouncilApproval, uint256 minCouncilVotes, uint256 councilSupermajorityBps, bool ceoCanOverride, uint256 maxAutoApproveAmount, uint256 reviewPeriod, uint256 disputePeriod, address treasuryToken, bool allowRetroactive, uint256 retroactiveMaxAge))',
  'function getPendingRequests(bytes32 daoId) external view returns (tuple(bytes32 requestId, bytes32 daoId, address requester, bytes32 contributorId, uint8 category, string title, string description, string evidenceUri, address paymentToken, uint256 requestedAmount, uint256 approvedAmount, uint8 status, bool isRetroactive, uint256 workStartDate, uint256 workEndDate, uint256 submittedAt, uint256 reviewedAt, uint256 paidAt, string rejectionReason, bytes32 disputeCaseId)[])',

  // Events
  'event PaymentRequestSubmitted(bytes32 indexed requestId, bytes32 indexed daoId, address indexed requester, uint8 category, uint256 amount, bool isRetroactive)',
  'event CouncilVoteCast(bytes32 indexed requestId, address indexed voter, uint8 vote)',
  'event CEODecisionMade(bytes32 indexed requestId, bool approved, uint256 modifiedAmount)',
  'event PaymentRequestApproved(bytes32 indexed requestId, uint256 approvedAmount)',
  'event PaymentRequestRejected(bytes32 indexed requestId, string reason)',
  'event PaymentRequestPaid(bytes32 indexed requestId, uint256 amount, address token)',
  'event PaymentRequestDisputed(bytes32 indexed requestId, bytes32 indexed caseId)',
]);

// ============ Category Mapping ============

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
];

const STATUS_NAMES: PaymentRequestStatus[] = [
  'SUBMITTED',
  'COUNCIL_REVIEW',
  'CEO_REVIEW',
  'APPROVED',
  'REJECTED',
  'PAID',
  'DISPUTED',
  'CANCELLED',
];

const VOTE_NAMES: VoteType[] = ['APPROVE', 'REJECT', 'ABSTAIN'];

function getCategoryIndex(category: PaymentCategory): number {
  return CATEGORY_NAMES.indexOf(category);
}

function getVoteIndex(vote: VoteType): number {
  return VOTE_NAMES.indexOf(vote);
}

// ============ Service Class ============

export class PaymentRequestService {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null;
  private registryAddress: Address;

  constructor(config: PaymentRequestServiceConfig) {
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient || null;
    this.registryAddress = config.registryAddress;
  }

  // ============ Submission ============

  async submitRequest(params: SubmitPaymentRequestParams): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'submitRequest',
      args: [
        params.daoId as `0x${string}`,
        params.contributorId as `0x${string}`,
        getCategoryIndex(params.category),
        params.title,
        params.description,
        params.evidenceUri,
        params.requestedAmount,
        params.isRetroactive || false,
        BigInt(params.workStartDate || 0),
        BigInt(params.workEndDate || 0),
      ],
    });

    return hash;
  }

  async updateEvidence(requestId: string, evidenceUri: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'updateEvidence',
      args: [requestId as `0x${string}`, evidenceUri],
    });

    return hash;
  }

  async cancelRequest(requestId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'cancelRequest',
      args: [requestId as `0x${string}`],
    });

    return hash;
  }

  // ============ Council Review ============

  async councilVote(requestId: string, vote: VoteType, reason: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'councilVote',
      args: [requestId as `0x${string}`, getVoteIndex(vote), reason],
    });

    return hash;
  }

  async escalateToCEO(requestId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'escalateToCEO',
      args: [requestId as `0x${string}`],
    });

    return hash;
  }

  // ============ CEO Review ============

  async ceoDecision(
    requestId: string,
    approved: boolean,
    modifiedAmount: bigint,
    reason: string
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'ceoDecision',
      args: [requestId as `0x${string}`, approved, modifiedAmount, reason],
    });

    return hash;
  }

  // ============ Dispute ============

  async fileDispute(requestId: string, evidenceUri: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'fileDispute',
      args: [requestId as `0x${string}`, evidenceUri],
    });

    return hash;
  }

  // ============ Payment ============

  async executePayment(requestId: string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'executePayment',
      args: [requestId as `0x${string}`],
    });

    return hash;
  }

  // ============ Configuration ============

  async setDAOConfig(daoId: string, config: DAOPaymentConfig): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'setDAOConfig',
      args: [
        daoId as `0x${string}`,
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
    });

    return hash;
  }

  // ============ View Functions ============

  async getRequest(requestId: string): Promise<PaymentRequest | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getRequest',
      args: [requestId as `0x${string}`],
    }) as [
      string, string, Address, string, number, string, string, string,
      Address, bigint, bigint, number, boolean, bigint, bigint,
      bigint, bigint, bigint, string, string
    ];

    if (!result || result[15] === 0n) return null;

    return {
      requestId: result[0],
      daoId: result[1],
      requester: result[2],
      contributorId: result[3],
      category: CATEGORY_NAMES[result[4]] || 'OTHER',
      title: result[5],
      description: result[6],
      evidenceUri: result[7],
      paymentToken: result[8],
      requestedAmount: result[9],
      approvedAmount: result[10],
      status: STATUS_NAMES[result[11]] || 'SUBMITTED',
      isRetroactive: result[12],
      workStartDate: Number(result[13]),
      workEndDate: Number(result[14]),
      submittedAt: Number(result[15]),
      reviewedAt: Number(result[16]),
      paidAt: Number(result[17]),
      rejectionReason: result[18],
      disputeCaseId: result[19],
    };
  }

  async getCouncilVotes(requestId: string): Promise<CouncilVote[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getCouncilVotes',
      args: [requestId as `0x${string}`],
    }) as Array<[Address, number, string, bigint]>;

    return result.map((v) => ({
      voter: v[0],
      vote: VOTE_NAMES[v[1]] || 'ABSTAIN',
      reason: v[2],
      votedAt: Number(v[3]),
    }));
  }

  async getCEODecision(requestId: string): Promise<CEODecision | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getCEODecision',
      args: [requestId as `0x${string}`],
    }) as [boolean, bigint, string, bigint];

    if (result[3] === 0n) return null;

    return {
      approved: result[0],
      modifiedAmount: result[1],
      reason: result[2],
      decidedAt: Number(result[3]),
    };
  }

  async getDAORequests(daoId: string): Promise<string[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getDAORequests',
      args: [daoId as `0x${string}`],
    }) as string[];

    return result;
  }

  async getRequesterRequests(requester: Address): Promise<string[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getRequesterRequests',
      args: [requester],
    }) as string[];

    return result;
  }

  async getContributorRequests(contributorId: string): Promise<string[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getContributorRequests',
      args: [contributorId as `0x${string}`],
    }) as string[];

    return result;
  }

  async getDAOConfig(daoId: string): Promise<DAOPaymentConfig> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getDAOConfig',
      args: [daoId as `0x${string}`],
    }) as [boolean, bigint, bigint, boolean, bigint, bigint, bigint, Address, boolean, bigint];

    return {
      requiresCouncilApproval: result[0],
      minCouncilVotes: Number(result[1]),
      councilSupermajorityBps: Number(result[2]),
      ceoCanOverride: result[3],
      maxAutoApproveAmount: result[4],
      reviewPeriod: Number(result[5]),
      disputePeriod: Number(result[6]),
      treasuryToken: result[7],
      allowRetroactive: result[8],
      retroactiveMaxAge: Number(result[9]),
    };
  }

  async getPendingRequests(daoId: string): Promise<PaymentRequest[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getPendingRequests',
      args: [daoId as `0x${string}`],
    }) as Array<[
      string, string, Address, string, number, string, string, string,
      Address, bigint, bigint, number, boolean, bigint, bigint,
      bigint, bigint, bigint, string, string
    ]>;

    return result.map((r) => ({
      requestId: r[0],
      daoId: r[1],
      requester: r[2],
      contributorId: r[3],
      category: CATEGORY_NAMES[r[4]] || 'OTHER',
      title: r[5],
      description: r[6],
      evidenceUri: r[7],
      paymentToken: r[8],
      requestedAmount: r[9],
      approvedAmount: r[10],
      status: STATUS_NAMES[r[11]] || 'SUBMITTED',
      isRetroactive: r[12],
      workStartDate: Number(r[13]),
      workEndDate: Number(r[14]),
      submittedAt: Number(r[15]),
      reviewedAt: Number(r[16]),
      paidAt: Number(r[17]),
      rejectionReason: r[18],
      disputeCaseId: r[19],
    }));
  }

  // ============ Helpers ============

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
    };
    return names[category];
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
    };
    return names[status];
  }
}

// ============ Singleton Export ============

let service: PaymentRequestService | null = null;

export function getPaymentRequestService(
  config?: PaymentRequestServiceConfig
): PaymentRequestService {
  if (!service && config) {
    service = new PaymentRequestService(config);
  }
  if (!service) {
    throw new Error('PaymentRequestService not initialized');
  }
  return service;
}

export function resetPaymentRequestService(): void {
  service = null;
}

