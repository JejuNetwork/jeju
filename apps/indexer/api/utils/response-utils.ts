/**
 * Response mapping utilities
 * Shared utilities for mapping database entities to API responses
 */

import type {
  Account,
  Contract,
  CrossServiceRequest,
  OracleDispute,
  OracleFeed,
  OracleOperator,
  OracleReport,
  TokenTransfer,
} from '../model'

export interface AccountResponse {
  address: string
  isContract: boolean
  transactionCount: number
  totalValueSent: string
  totalValueReceived: string
  firstSeenBlock: number
  lastSeenBlock: number
  labels: string[]
}

export function mapAccountResponse(account: Account): AccountResponse {
  if (!account) {
    throw new Error('Account is required')
  }
  return {
    address: account.address,
    isContract: account.isContract,
    transactionCount: account.transactionCount,
    totalValueSent: account.totalValueSent.toString(),
    totalValueReceived: account.totalValueReceived.toString(),
    firstSeenBlock: account.firstSeenBlock,
    lastSeenBlock: account.lastSeenBlock,
    labels: account.labels,
  }
}

export interface ContractResponse {
  address: string
  contractType: string | null
  isERC20: boolean
  isERC721: boolean
  isERC1155: boolean
  creator: string | null
  firstSeenAt: string
}

export function mapContractResponse(contract: Contract): ContractResponse {
  if (!contract) {
    throw new Error('Contract is required')
  }
  return {
    address: contract.address,
    contractType: contract.contractType || null,
    isERC20: contract.isERC20,
    isERC721: contract.isERC721,
    isERC1155: contract.isERC1155,
    creator: contract.creator?.address || null,
    firstSeenAt: contract.firstSeenAt.toISOString(),
  }
}

export interface TokenTransferResponse {
  id: string
  token: string | null
  from: string | null
  to: string | null
  value: string | null
  tokenId: string | null
  tokenStandard: string
  timestamp: string
}

export function mapTokenTransferResponse(
  transfer: TokenTransfer,
): TokenTransferResponse {
  if (!transfer) {
    throw new Error('TokenTransfer is required')
  }
  return {
    id: transfer.id,
    token: transfer.token?.address || null,
    from: transfer.from.address || null,
    to: transfer.to.address || null,
    value: transfer.value?.toString() || null,
    tokenId: transfer.tokenId || null,
    tokenStandard: transfer.tokenStandard,
    timestamp: transfer.timestamp.toISOString(),
  }
}

export interface OracleFeedResponse {
  feedId: string
  symbol: string
  baseToken: string
  quoteToken: string
  decimals: number
  heartbeatSeconds: number
  category: string
  isActive: boolean
  minOracles: number
  quorumThreshold: number
  latestPrice: string | null
  latestConfidence: string | null
  latestTimestamp: string | null
  latestRound: string | null
  totalReports: number
  totalDisputes: number
  createdAt: string
  lastUpdated: string
}

export function mapOracleFeedResponse(feed: OracleFeed): OracleFeedResponse {
  if (!feed) {
    throw new Error('OracleFeed is required')
  }
  return {
    feedId: feed.feedId,
    symbol: feed.symbol,
    baseToken: feed.baseToken,
    quoteToken: feed.quoteToken,
    decimals: feed.decimals,
    heartbeatSeconds: feed.heartbeatSeconds,
    category: feed.category,
    isActive: feed.isActive,
    minOracles: feed.minOracles,
    quorumThreshold: feed.quorumThreshold,
    latestPrice: feed.latestPrice?.toString() || null,
    latestConfidence: feed.latestConfidence?.toString() || null,
    latestTimestamp: feed.latestTimestamp?.toISOString() || null,
    latestRound: feed.latestRound?.toString() || null,
    totalReports: feed.totalReports,
    totalDisputes: feed.totalDisputes,
    createdAt: feed.createdAt.toISOString(),
    lastUpdated: feed.lastUpdated.toISOString(),
  }
}

export interface OracleOperatorResponse {
  address: string
  identityId: string | null
  isActive: boolean
  isJailed: boolean
  stakedAmount: string
  delegatedAmount: string
  totalSlashed: string
  reportsSubmitted: number
  reportsAccepted: number
  disputesAgainst: number
  disputesLost: number
  participationScore: number
  accuracyScore: number
  uptimeScore: number
  totalEarnings: string
  pendingRewards: string
  registeredAt: string
  lastActiveAt: string
}

export function mapOracleOperatorResponse(
  operator: OracleOperator,
): OracleOperatorResponse {
  if (!operator) {
    throw new Error('OracleOperator is required')
  }
  return {
    address: operator.address,
    identityId: operator.identityId?.toString() || null,
    isActive: operator.isActive,
    isJailed: operator.isJailed,
    stakedAmount: operator.stakedAmount.toString(),
    delegatedAmount: operator.delegatedAmount.toString(),
    totalSlashed: operator.totalSlashed.toString(),
    reportsSubmitted: operator.reportsSubmitted,
    reportsAccepted: operator.reportsAccepted,
    disputesAgainst: operator.disputesAgainst,
    disputesLost: operator.disputesLost,
    participationScore: operator.participationScore,
    accuracyScore: operator.accuracyScore,
    uptimeScore: operator.uptimeScore,
    totalEarnings: operator.totalEarnings.toString(),
    pendingRewards: operator.pendingRewards.toString(),
    registeredAt: operator.registeredAt.toISOString(),
    lastActiveAt: operator.lastActiveAt.toISOString(),
  }
}

export interface OracleReportResponse {
  reportId: string
  feedId: string | null
  symbol: string | null
  round: string
  price: string
  confidence: string
  timestamp: string
  isDisputed: boolean
  isValid: boolean
  submittedBy: string | null
  submittedAt: string
  txHash: string | null
  blockNumber: number | null
}

export function mapOracleReportResponse(
  report: OracleReport,
): OracleReportResponse {
  if (!report) {
    throw new Error('OracleReport is required')
  }
  return {
    reportId: report.reportId,
    feedId: report.feed.feedId || null,
    symbol: report.feed.symbol || null,
    round: report.round.toString(),
    price: report.price.toString(),
    confidence: report.confidence.toString(),
    timestamp: report.timestamp.toISOString(),
    isDisputed: report.isDisputed,
    isValid: report.isValid,
    submittedBy: report.submittedBy.address || null,
    submittedAt: report.submittedAt.toISOString(),
    txHash: report.txHash || null,
    blockNumber: report.blockNumber || null,
  }
}

export interface OracleDisputeResponse {
  disputeId: string
  reportId: string | null
  feedId: string | null
  disputer: string | null
  bond: string
  reason: string
  status: string
  challenger: string | null
  challengeBond: string | null
  outcome: string | null
  slashedAmount: string | null
  openedAt: string
  challengeDeadline: string
  resolvedAt: string | null
  txHash: string | null
  blockNumber: number | null
}

export function mapOracleDisputeResponse(
  dispute: OracleDispute,
): OracleDisputeResponse {
  if (!dispute) {
    throw new Error('OracleDispute is required')
  }
  return {
    disputeId: dispute.disputeId,
    reportId: dispute.report.reportId || null,
    feedId: dispute.feed.feedId || null,
    disputer: dispute.disputer.address || null,
    bond: dispute.bond.toString(),
    reason: dispute.reason,
    status: dispute.status,
    challenger: dispute.challenger?.address || null,
    challengeBond: dispute.challengeBond?.toString() || null,
    outcome: dispute.outcome || null,
    slashedAmount: dispute.slashedAmount?.toString() || null,
    openedAt: dispute.openedAt.toISOString(),
    challengeDeadline: dispute.challengeDeadline.toISOString(),
    resolvedAt: dispute.resolvedAt?.toISOString() || null,
    txHash: dispute.txHash || null,
    blockNumber: dispute.blockNumber || null,
  }
}

export interface CrossServiceRequestResponse {
  requestId: string
  requester: string | null
  type: string
  sourceCid: string
  sourceProvider: string | null
  destinationProvider: string | null
  status: string
  createdAt: string
  completedAt: string | null
  storageCost: string
  bandwidthCost: string
  totalCost: string
  error: string | null
  txHash: string | null
  blockNumber: number | null
}

export function mapCrossServiceRequestResponse(
  request: CrossServiceRequest,
): CrossServiceRequestResponse {
  if (!request) {
    throw new Error('CrossServiceRequest is required')
  }
  return {
    requestId: request.requestId,
    requester: request.requester.address || null,
    type: request.requestType,
    sourceCid: request.sourceCid,
    sourceProvider: request.sourceProvider?.address || null,
    destinationProvider: request.destinationProvider?.address || null,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    completedAt: request.completedAt?.toISOString() || null,
    storageCost: request.storageCost.toString(),
    bandwidthCost: request.bandwidthCost.toString(),
    totalCost: request.totalCost.toString(),
    error: request.error || null,
    txHash: request.txHash || null,
    blockNumber: request.blockNumber || null,
  }
}
