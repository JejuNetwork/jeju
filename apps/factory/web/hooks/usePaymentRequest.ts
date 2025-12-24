import { paymentRequestRegistryAbi } from '@jejunetwork/contracts'
import { isRecord } from '@jejunetwork/types'
import type { Address } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { addresses } from '../config/contracts'
import { type Hex, toHex } from '../lib/contract-types'
import type {
  CEODecision,
  CouncilVote,
  DAOPaymentConfig,
  PaymentCategory,
  PaymentRequest,
  VoteType,
} from '../types/funding'
import {
  getPaymentCategoryIndex,
  getVoteTypeIndex,
  parsePaymentCategory,
  parsePaymentStatus,
  parseVoteType,
} from '../types/funding'

function getAddress(): Address {
  return addresses.paymentRequestRegistry
}

// Typed return from contract - matches the tuple structure
interface RawPaymentRequest {
  requestId: Hex
  daoId: Hex
  requester: Address
  contributorId: Hex
  category: number
  title: string
  description: string
  evidenceUri: string
  paymentToken: Address
  requestedAmount: bigint
  approvedAmount: bigint
  status: number
  isRetroactive: boolean
  workStartDate: bigint
  workEndDate: bigint
  submittedAt: bigint
  reviewedAt: bigint
  paidAt: bigint
  rejectionReason: string
  disputeCaseId: Hex
}

interface RawCouncilVote {
  voter: Address
  vote: number
  reason: string
  votedAt: bigint
}

interface RawCEODecision {
  approved: boolean
  modifiedAmount: bigint
  reason: string
  decidedAt: bigint
}

interface RawDAOPaymentConfig {
  requiresCouncilApproval: boolean
  minCouncilVotes: bigint
  councilSupermajorityBps: bigint
  ceoCanOverride: boolean
  maxAutoApproveAmount: bigint
  reviewPeriod: bigint
  disputePeriod: bigint
  treasuryToken: Address
  allowRetroactive: boolean
  retroactiveMaxAge: bigint
}

function parseRequest(raw: RawPaymentRequest): PaymentRequest {
  return {
    requestId: raw.requestId,
    daoId: raw.daoId,
    requester: raw.requester,
    contributorId: raw.contributorId,
    category: parsePaymentCategory(raw.category),
    title: raw.title,
    description: raw.description,
    evidenceUri: raw.evidenceUri,
    paymentToken: raw.paymentToken,
    requestedAmount: raw.requestedAmount,
    approvedAmount: raw.approvedAmount,
    status: parsePaymentStatus(raw.status),
    isRetroactive: raw.isRetroactive,
    workStartDate: Number(raw.workStartDate),
    workEndDate: Number(raw.workEndDate),
    submittedAt: Number(raw.submittedAt),
    reviewedAt: Number(raw.reviewedAt),
    paidAt: Number(raw.paidAt),
    rejectionReason: raw.rejectionReason,
    disputeCaseId: raw.disputeCaseId,
  }
}

function parseCouncilVote(raw: RawCouncilVote): CouncilVote {
  return {
    voter: raw.voter,
    vote: parseVoteType(raw.vote),
    reason: raw.reason,
    votedAt: Number(raw.votedAt),
  }
}

function parseCEODecision(raw: RawCEODecision): CEODecision {
  return {
    approved: raw.approved,
    modifiedAmount: raw.modifiedAmount,
    reason: raw.reason,
    decidedAt: Number(raw.decidedAt),
  }
}

function parseDAOPaymentConfig(raw: RawDAOPaymentConfig): DAOPaymentConfig {
  return {
    requiresCouncilApproval: raw.requiresCouncilApproval,
    minCouncilVotes: Number(raw.minCouncilVotes),
    councilSupermajorityBps: Number(raw.councilSupermajorityBps),
    ceoCanOverride: raw.ceoCanOverride,
    maxAutoApproveAmount: raw.maxAutoApproveAmount,
    reviewPeriod: Number(raw.reviewPeriod),
    disputePeriod: Number(raw.disputePeriod),
    treasuryToken: raw.treasuryToken,
    allowRetroactive: raw.allowRetroactive,
    retroactiveMaxAge: Number(raw.retroactiveMaxAge),
  }
}

function isRawPaymentRequest(data: unknown): data is RawPaymentRequest {
  return (
    isRecord(data) &&
    typeof data.requestId === 'string' &&
    typeof data.title === 'string'
  )
}

function isRawPaymentRequestArray(data: unknown): data is RawPaymentRequest[] {
  return Array.isArray(data)
}

function isRawCouncilVoteArray(data: unknown): data is RawCouncilVote[] {
  return Array.isArray(data)
}

function isRawCEODecision(data: unknown): data is RawCEODecision {
  return isRecord(data) && typeof data.approved === 'boolean'
}

function isRawDAOPaymentConfig(data: unknown): data is RawDAOPaymentConfig {
  return isRecord(data) && typeof data.requiresCouncilApproval === 'boolean'
}

export function usePaymentRequest(requestId: string | undefined) {
  const requestIdHex = requestId ? toHex(requestId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: paymentRequestRegistryAbi,
    functionName: 'getRequest',
    args: requestIdHex ? [requestIdHex] : undefined,
    query: { enabled: !!requestIdHex },
  })

  const request =
    isRawPaymentRequest(data) && data.submittedAt !== 0n
      ? parseRequest(data)
      : null

  return { request, isLoading, error, refetch }
}

export function usePendingRequests(daoId: string | undefined) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: paymentRequestRegistryAbi,
    functionName: 'getPendingRequests',
    args: daoIdHex ? [daoIdHex] : undefined,
    query: { enabled: !!daoIdHex },
  })

  const requests: PaymentRequest[] = isRawPaymentRequestArray(data)
    ? data.map(parseRequest)
    : []

  return { requests, isLoading, error, refetch }
}

export function useDAORequests(daoId: string | undefined) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: paymentRequestRegistryAbi,
    functionName: 'getDAORequests',
    args: daoIdHex ? [daoIdHex] : undefined,
    query: { enabled: !!daoIdHex },
  })

  return { requestIds: data ?? [], isLoading, error, refetch }
}

export function useRequesterRequests(requester: Address | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: paymentRequestRegistryAbi,
    functionName: 'getRequesterRequests',
    args: requester ? [requester] : undefined,
    query: { enabled: !!requester },
  })

  return { requestIds: data ?? [], isLoading, error, refetch }
}

export function useCouncilVotes(requestId: string | undefined) {
  const requestIdHex = requestId ? toHex(requestId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: paymentRequestRegistryAbi,
    functionName: 'getCouncilVotes',
    args: requestIdHex ? [requestIdHex] : undefined,
    query: { enabled: !!requestIdHex },
  })

  const votes: CouncilVote[] = isRawCouncilVoteArray(data)
    ? data.map(parseCouncilVote)
    : []

  return { votes, isLoading, error, refetch }
}

export function useCEODecision(requestId: string | undefined) {
  const requestIdHex = requestId ? toHex(requestId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: paymentRequestRegistryAbi,
    functionName: 'getCEODecision',
    args: requestIdHex ? [requestIdHex] : undefined,
    query: { enabled: !!requestIdHex },
  })

  const decision: CEODecision | null =
    isRawCEODecision(data) && data.decidedAt !== 0n
      ? parseCEODecision(data)
      : null

  return { decision, isLoading, error, refetch }
}

export function useDAOPaymentConfig(daoId: string | undefined) {
  const daoIdHex = daoId ? toHex(daoId) : undefined
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: paymentRequestRegistryAbi,
    functionName: 'getDAOConfig',
    args: daoIdHex ? [daoIdHex] : undefined,
    query: { enabled: !!daoIdHex },
  })

  const config: DAOPaymentConfig | null = isRawDAOPaymentConfig(data)
    ? parseDAOPaymentConfig(data)
    : null

  return { config, isLoading, error }
}

export function useSubmitPaymentRequest() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const submit = (params: {
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
  }) => {
    writeContract({
      address: getAddress(),
      abi: paymentRequestRegistryAbi,
      functionName: 'submitRequest',
      args: [
        toHex(params.daoId),
        toHex(params.contributorId),
        getPaymentCategoryIndex(params.category),
        params.title,
        params.description,
        params.evidenceUri,
        params.requestedAmount,
        params.isRetroactive || false,
        BigInt(params.workStartDate || 0),
        BigInt(params.workEndDate || 0),
      ],
    })
  }

  return { submit, hash, isPending, isConfirming, isSuccess, error }
}

export function useCouncilVote() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const vote = (requestId: string, voteType: VoteType, reason: string) => {
    writeContract({
      address: getAddress(),
      abi: paymentRequestRegistryAbi,
      functionName: 'councilVote',
      args: [toHex(requestId), getVoteTypeIndex(voteType), reason],
    })
  }

  return { vote, hash, isPending, isConfirming, isSuccess, error }
}

export function useCEODecisionAction() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const decide = (
    requestId: string,
    approved: boolean,
    modifiedAmount: bigint,
    reason: string,
  ) => {
    writeContract({
      address: getAddress(),
      abi: paymentRequestRegistryAbi,
      functionName: 'ceoDecision',
      args: [toHex(requestId), approved, modifiedAmount, reason],
    })
  }

  return { decide, hash, isPending, isConfirming, isSuccess, error }
}

export function useEscalateToCEO() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const escalate = (requestId: string) => {
    writeContract({
      address: getAddress(),
      abi: paymentRequestRegistryAbi,
      functionName: 'escalateToCEO',
      args: [toHex(requestId)],
    })
  }

  return { escalate, hash, isPending, isConfirming, isSuccess, error }
}

export function useFileDispute() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const fileDispute = (requestId: string, evidenceUri: string) => {
    writeContract({
      address: getAddress(),
      abi: paymentRequestRegistryAbi,
      functionName: 'fileDispute',
      args: [toHex(requestId), evidenceUri],
    })
  }

  return { fileDispute, hash, isPending, isConfirming, isSuccess, error }
}

export function useExecutePayment() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const execute = (requestId: string) => {
    writeContract({
      address: getAddress(),
      abi: paymentRequestRegistryAbi,
      functionName: 'executePayment',
      args: [toHex(requestId)],
    })
  }

  return { execute, hash, isPending, isConfirming, isSuccess, error }
}

export function useCancelRequest() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const cancel = (requestId: string) => {
    writeContract({
      address: getAddress(),
      abi: paymentRequestRegistryAbi,
      functionName: 'cancelRequest',
      args: [toHex(requestId)],
    })
  }

  return { cancel, hash, isPending, isConfirming, isSuccess, error }
}
