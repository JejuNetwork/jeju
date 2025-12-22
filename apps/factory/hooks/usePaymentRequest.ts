'use client';

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseAbi } from 'viem';
import type { Address } from 'viem';
import type { 
  PaymentRequest, 
  PaymentCategory, 
  PaymentRequestStatus,
  VoteType,
  CouncilVote,
  CEODecision,
  DAOPaymentConfig,
} from '../../../types/funding';
import { 
  parsePaymentCategory, 
  parsePaymentStatus, 
  getPaymentCategoryIndex,
  getVoteTypeIndex,
  parseVoteType,
} from '../../../types/funding';

// ============ Contract ABI ============

const PAYMENT_REQUEST_REGISTRY_ABI = parseAbi([
  'function submitRequest(bytes32 daoId, bytes32 contributorId, uint8 category, string title, string description, string evidenceUri, uint256 requestedAmount, bool isRetroactive, uint256 workStartDate, uint256 workEndDate) external returns (bytes32 requestId)',
  'function updateEvidence(bytes32 requestId, string evidenceUri) external',
  'function cancelRequest(bytes32 requestId) external',
  'function councilVote(bytes32 requestId, uint8 vote, string reason) external',
  'function escalateToCEO(bytes32 requestId) external',
  'function ceoDecision(bytes32 requestId, bool approved, uint256 modifiedAmount, string reason) external',
  'function fileDispute(bytes32 requestId, string evidenceUri) external',
  'function executePayment(bytes32 requestId) external',
  'function getRequest(bytes32 requestId) external view returns (tuple(bytes32 requestId, bytes32 daoId, address requester, bytes32 contributorId, uint8 category, string title, string description, string evidenceUri, address paymentToken, uint256 requestedAmount, uint256 approvedAmount, uint8 status, bool isRetroactive, uint256 workStartDate, uint256 workEndDate, uint256 submittedAt, uint256 reviewedAt, uint256 paidAt, string rejectionReason, bytes32 disputeCaseId))',
  'function getCouncilVotes(bytes32 requestId) external view returns (tuple(address voter, uint8 vote, string reason, uint256 votedAt)[])',
  'function getCEODecision(bytes32 requestId) external view returns (tuple(bool approved, uint256 modifiedAmount, string reason, uint256 decidedAt))',
  'function getDAORequests(bytes32 daoId) external view returns (bytes32[])',
  'function getRequesterRequests(address requester) external view returns (bytes32[])',
  'function getPendingRequests(bytes32 daoId) external view returns (tuple(bytes32 requestId, bytes32 daoId, address requester, bytes32 contributorId, uint8 category, string title, string description, string evidenceUri, address paymentToken, uint256 requestedAmount, uint256 approvedAmount, uint8 status, bool isRetroactive, uint256 workStartDate, uint256 workEndDate, uint256 submittedAt, uint256 reviewedAt, uint256 paidAt, string rejectionReason, bytes32 disputeCaseId)[])',
  'function getDAOConfig(bytes32 daoId) external view returns (tuple(bool requiresCouncilApproval, uint256 minCouncilVotes, uint256 councilSupermajorityBps, bool ceoCanOverride, uint256 maxAutoApproveAmount, uint256 reviewPeriod, uint256 disputePeriod, address treasuryToken, bool allowRetroactive, uint256 retroactiveMaxAge))',
]);

// ============ Config ============

interface PaymentRequestHooksConfig {
  registryAddress: Address;
}

let config: PaymentRequestHooksConfig | null = null;

export function configurePaymentRequestHooks(cfg: PaymentRequestHooksConfig) {
  config = cfg;
}

function getAddress(): Address {
  if (!config) throw new Error('PaymentRequestHooks not configured. Call configurePaymentRequestHooks first.');
  return config.registryAddress;
}

// ============ Parse Helpers ============

type RawPaymentRequest = [
  string, string, Address, string, number, string, string, string,
  Address, bigint, bigint, number, boolean, bigint, bigint,
  bigint, bigint, bigint, string, string
];

function parseRequest(raw: RawPaymentRequest): PaymentRequest {
  return {
    requestId: raw[0],
    daoId: raw[1],
    requester: raw[2],
    contributorId: raw[3],
    category: parsePaymentCategory(raw[4]),
    title: raw[5],
    description: raw[6],
    evidenceUri: raw[7],
    paymentToken: raw[8],
    requestedAmount: raw[9],
    approvedAmount: raw[10],
    status: parsePaymentStatus(raw[11]),
    isRetroactive: raw[12],
    workStartDate: Number(raw[13]),
    workEndDate: Number(raw[14]),
    submittedAt: Number(raw[15]),
    reviewedAt: Number(raw[16]),
    paidAt: Number(raw[17]),
    rejectionReason: raw[18],
    disputeCaseId: raw[19],
  };
}

// ============ Read Hooks ============

export function usePaymentRequest(requestId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: PAYMENT_REQUEST_REGISTRY_ABI,
    functionName: 'getRequest',
    args: requestId ? [requestId as `0x${string}`] : undefined,
    query: { enabled: !!requestId },
  });

  const request = data && (data as RawPaymentRequest)[15] !== 0n 
    ? parseRequest(data as RawPaymentRequest) 
    : null;

  return { request, isLoading, error, refetch };
}

export function usePendingRequests(daoId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: PAYMENT_REQUEST_REGISTRY_ABI,
    functionName: 'getPendingRequests',
    args: daoId ? [daoId as `0x${string}`] : undefined,
    query: { enabled: !!daoId },
  });

  const requests: PaymentRequest[] = data 
    ? (data as RawPaymentRequest[]).map(parseRequest)
    : [];

  return { requests, isLoading, error, refetch };
}

export function useDAORequests(daoId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: PAYMENT_REQUEST_REGISTRY_ABI,
    functionName: 'getDAORequests',
    args: daoId ? [daoId as `0x${string}`] : undefined,
    query: { enabled: !!daoId },
  });

  return { requestIds: data as string[] || [], isLoading, error, refetch };
}

export function useRequesterRequests(requester: Address | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: PAYMENT_REQUEST_REGISTRY_ABI,
    functionName: 'getRequesterRequests',
    args: requester ? [requester] : undefined,
    query: { enabled: !!requester },
  });

  return { requestIds: data as string[] || [], isLoading, error, refetch };
}

export function useCouncilVotes(requestId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: PAYMENT_REQUEST_REGISTRY_ABI,
    functionName: 'getCouncilVotes',
    args: requestId ? [requestId as `0x${string}`] : undefined,
    query: { enabled: !!requestId },
  });

  const votes: CouncilVote[] = data 
    ? (data as Array<[Address, number, string, bigint]>).map(v => ({
        voter: v[0],
        vote: parseVoteType(v[1]),
        reason: v[2],
        votedAt: Number(v[3]),
      }))
    : [];

  return { votes, isLoading, error, refetch };
}

export function useCEODecision(requestId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: PAYMENT_REQUEST_REGISTRY_ABI,
    functionName: 'getCEODecision',
    args: requestId ? [requestId as `0x${string}`] : undefined,
    query: { enabled: !!requestId },
  });

  const decision: CEODecision | null = data && (data as [boolean, bigint, string, bigint])[3] !== 0n
    ? {
        approved: (data as [boolean])[0],
        modifiedAmount: (data as [boolean, bigint])[1],
        reason: (data as [boolean, bigint, string])[2],
        decidedAt: Number((data as [boolean, bigint, string, bigint])[3]),
      }
    : null;

  return { decision, isLoading, error, refetch };
}

export function useDAOPaymentConfig(daoId: string | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: PAYMENT_REQUEST_REGISTRY_ABI,
    functionName: 'getDAOConfig',
    args: daoId ? [daoId as `0x${string}`] : undefined,
    query: { enabled: !!daoId },
  });

  const config: DAOPaymentConfig | null = data ? {
    requiresCouncilApproval: (data as [boolean])[0],
    minCouncilVotes: Number((data as [boolean, bigint])[1]),
    councilSupermajorityBps: Number((data as [boolean, bigint, bigint])[2]),
    ceoCanOverride: (data as [boolean, bigint, bigint, boolean])[3],
    maxAutoApproveAmount: (data as [boolean, bigint, bigint, boolean, bigint])[4],
    reviewPeriod: Number((data as [boolean, bigint, bigint, boolean, bigint, bigint])[5]),
    disputePeriod: Number((data as [boolean, bigint, bigint, boolean, bigint, bigint, bigint])[6]),
    treasuryToken: (data as [boolean, bigint, bigint, boolean, bigint, bigint, bigint, Address])[7],
    allowRetroactive: (data as [boolean, bigint, bigint, boolean, bigint, bigint, bigint, Address, boolean])[8],
    retroactiveMaxAge: Number((data as [boolean, bigint, bigint, boolean, bigint, bigint, bigint, Address, boolean, bigint])[9]),
  } : null;

  return { config, isLoading, error };
}

// ============ Write Hooks ============

export function useSubmitPaymentRequest() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const submit = (params: {
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
  }) => {
    writeContract({
      address: getAddress(),
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'submitRequest',
      args: [
        params.daoId as `0x${string}`,
        params.contributorId as `0x${string}`,
        getPaymentCategoryIndex(params.category),
        params.title,
        params.description,
        params.evidenceUri,
        params.requestedAmount,
        params.isRetroactive || false,
        BigInt(params.workStartDate || 0),
        BigInt(params.workEndDate || 0),
      ],
    });
  };

  return { submit, hash, isPending, isConfirming, isSuccess, error };
}

export function useCouncilVote() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const vote = (requestId: string, voteType: VoteType, reason: string) => {
    writeContract({
      address: getAddress(),
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'councilVote',
      args: [requestId as `0x${string}`, getVoteTypeIndex(voteType), reason],
    });
  };

  return { vote, hash, isPending, isConfirming, isSuccess, error };
}

export function useCEODecisionAction() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const decide = (requestId: string, approved: boolean, modifiedAmount: bigint, reason: string) => {
    writeContract({
      address: getAddress(),
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'ceoDecision',
      args: [requestId as `0x${string}`, approved, modifiedAmount, reason],
    });
  };

  return { decide, hash, isPending, isConfirming, isSuccess, error };
}

export function useEscalateToCEO() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const escalate = (requestId: string) => {
    writeContract({
      address: getAddress(),
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'escalateToCEO',
      args: [requestId as `0x${string}`],
    });
  };

  return { escalate, hash, isPending, isConfirming, isSuccess, error };
}

export function useFileDispute() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const fileDispute = (requestId: string, evidenceUri: string) => {
    writeContract({
      address: getAddress(),
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'fileDispute',
      args: [requestId as `0x${string}`, evidenceUri],
    });
  };

  return { fileDispute, hash, isPending, isConfirming, isSuccess, error };
}

export function useExecutePayment() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const execute = (requestId: string) => {
    writeContract({
      address: getAddress(),
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'executePayment',
      args: [requestId as `0x${string}`],
    });
  };

  return { execute, hash, isPending, isConfirming, isSuccess, error };
}

export function useCancelRequest() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const cancel = (requestId: string) => {
    writeContract({
      address: getAddress(),
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'cancelRequest',
      args: [requestId as `0x${string}`],
    });
  };

  return { cancel, hash, isPending, isConfirming, isSuccess, error };
}

