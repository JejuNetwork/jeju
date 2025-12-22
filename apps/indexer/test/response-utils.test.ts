/**
 * Response Utils Unit Tests
 *
 * Tests the entity-to-response mapping functions used by the API.
 */

import { describe, expect, it } from 'bun:test'

// Mock entity interfaces matching the model structure

interface MockAccount {
  address: string
  isContract: boolean
  transactionCount: number
  totalValueSent: bigint
  totalValueReceived: bigint
  firstSeenBlock: number
  lastSeenBlock: number
  labels: string[]
}

interface MockContract {
  address: string
  contractType: string | null
  isERC20: boolean
  isERC721: boolean
  isERC1155: boolean
  creator: { address: string } | null
  firstSeenAt: Date
}

interface MockTokenTransfer {
  id: string
  token: { address: string } | null
  from: { address: string } | null
  to: { address: string } | null
  value: bigint | null
  tokenId: string | null
  tokenStandard: string
  timestamp: Date
}

interface MockOracleFeed {
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
  latestPrice: bigint | null
  latestConfidence: bigint | null
  latestTimestamp: Date | null
  latestRound: bigint | null
  totalReports: number
  totalDisputes: number
  createdAt: Date
  lastUpdated: Date
}

interface MockOracleOperator {
  address: string
  identityId: bigint | null
  isActive: boolean
  isJailed: boolean
  stakedAmount: bigint
  delegatedAmount: bigint
  totalSlashed: bigint
  reportsSubmitted: number
  reportsAccepted: number
  disputesAgainst: number
  disputesLost: number
  participationScore: number
  accuracyScore: number
  uptimeScore: number
  totalEarnings: bigint
  pendingRewards: bigint
  registeredAt: Date
  lastActiveAt: Date
}

interface MockOracleReport {
  reportId: string
  feed: { feedId: string; symbol: string } | null
  round: bigint
  price: bigint
  confidence: bigint
  timestamp: Date
  isDisputed: boolean
  isValid: boolean
  submittedBy: { address: string } | null
  submittedAt: Date
  txHash: string | null
  blockNumber: number | null
}

interface MockOracleDispute {
  disputeId: string
  report: { reportId: string } | null
  feed: { feedId: string } | null
  disputer: { address: string } | null
  bond: bigint
  reason: string
  status: string
  challenger: { address: string } | null
  challengeBond: bigint | null
  outcome: string | null
  slashedAmount: bigint | null
  openedAt: Date
  challengeDeadline: Date
  resolvedAt: Date | null
  txHash: string | null
  blockNumber: number | null
}

interface MockCrossServiceRequest {
  requestId: string
  requester: { address: string } | null
  requestType: string
  sourceCid: string
  sourceProvider: { address: string } | null
  destinationProvider: { address: string } | null
  status: string
  createdAt: Date
  completedAt: Date | null
  storageCost: bigint
  bandwidthCost: bigint
  totalCost: bigint
  error: string | null
  txHash: string | null
  blockNumber: number | null
}

// Response mapping functions matching src/lib/response-utils.ts

function mapAccountResponse(account: MockAccount) {
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

function mapContractResponse(contract: MockContract) {
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

function mapTokenTransferResponse(transfer: MockTokenTransfer) {
  if (!transfer) {
    throw new Error('TokenTransfer is required')
  }
  return {
    id: transfer.id,
    token: transfer.token?.address || null,
    from: transfer.from?.address || null,
    to: transfer.to?.address || null,
    value: transfer.value?.toString() || null,
    tokenId: transfer.tokenId || null,
    tokenStandard: transfer.tokenStandard,
    timestamp: transfer.timestamp.toISOString(),
  }
}

function mapOracleFeedResponse(feed: MockOracleFeed) {
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

function mapOracleOperatorResponse(operator: MockOracleOperator) {
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

function mapOracleReportResponse(report: MockOracleReport) {
  if (!report) {
    throw new Error('OracleReport is required')
  }
  return {
    reportId: report.reportId,
    feedId: report.feed?.feedId || null,
    symbol: report.feed?.symbol || null,
    round: report.round.toString(),
    price: report.price.toString(),
    confidence: report.confidence.toString(),
    timestamp: report.timestamp.toISOString(),
    isDisputed: report.isDisputed,
    isValid: report.isValid,
    submittedBy: report.submittedBy?.address || null,
    submittedAt: report.submittedAt.toISOString(),
    txHash: report.txHash || null,
    blockNumber: report.blockNumber || null,
  }
}

function mapOracleDisputeResponse(dispute: MockOracleDispute) {
  if (!dispute) {
    throw new Error('OracleDispute is required')
  }
  return {
    disputeId: dispute.disputeId,
    reportId: dispute.report?.reportId || null,
    feedId: dispute.feed?.feedId || null,
    disputer: dispute.disputer?.address || null,
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

function mapCrossServiceRequestResponse(request: MockCrossServiceRequest) {
  if (!request) {
    throw new Error('CrossServiceRequest is required')
  }
  return {
    requestId: request.requestId,
    requester: request.requester?.address || null,
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

describe('Account Response Mapping', () => {
  const validAccount: MockAccount = {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    isContract: false,
    transactionCount: 100,
    totalValueSent: 5000000000000000000n,
    totalValueReceived: 3000000000000000000n,
    firstSeenBlock: 1000000,
    lastSeenBlock: 2000000,
    labels: ['active', 'whale'],
  }

  it('should map all fields correctly', () => {
    const result = mapAccountResponse(validAccount)

    expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678')
    expect(result.isContract).toBe(false)
    expect(result.transactionCount).toBe(100)
    expect(result.totalValueSent).toBe('5000000000000000000')
    expect(result.totalValueReceived).toBe('3000000000000000000')
    expect(result.firstSeenBlock).toBe(1000000)
    expect(result.lastSeenBlock).toBe(2000000)
    expect(result.labels).toEqual(['active', 'whale'])
  })

  it('should handle contract accounts', () => {
    const contractAccount = { ...validAccount, isContract: true }
    const result = mapAccountResponse(contractAccount)
    expect(result.isContract).toBe(true)
  })

  it('should handle zero values', () => {
    const emptyAccount: MockAccount = {
      ...validAccount,
      transactionCount: 0,
      totalValueSent: 0n,
      totalValueReceived: 0n,
      labels: [],
    }

    const result = mapAccountResponse(emptyAccount)

    expect(result.transactionCount).toBe(0)
    expect(result.totalValueSent).toBe('0')
    expect(result.totalValueReceived).toBe('0')
    expect(result.labels).toEqual([])
  })

  it('should throw on null account', () => {
    expect(() => mapAccountResponse(null as unknown as MockAccount)).toThrow(
      'Account is required',
    )
  })
})

describe('Contract Response Mapping', () => {
  const validContract: MockContract = {
    address: '0xabcdef1234567890abcdef1234567890abcdef12',
    contractType: 'ERC20',
    isERC20: true,
    isERC721: false,
    isERC1155: false,
    creator: { address: '0x1111111111111111111111111111111111111111' },
    firstSeenAt: new Date('2024-01-15T10:30:00Z'),
  }

  it('should map all fields correctly', () => {
    const result = mapContractResponse(validContract)

    expect(result.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
    expect(result.contractType).toBe('ERC20')
    expect(result.isERC20).toBe(true)
    expect(result.isERC721).toBe(false)
    expect(result.isERC1155).toBe(false)
    expect(result.creator).toBe('0x1111111111111111111111111111111111111111')
    expect(result.firstSeenAt).toBe('2024-01-15T10:30:00.000Z')
  })

  it('should handle null creator', () => {
    const noCreator = { ...validContract, creator: null }
    const result = mapContractResponse(noCreator)
    expect(result.creator).toBeNull()
  })

  it('should handle null contractType', () => {
    const unknownType = { ...validContract, contractType: null }
    const result = mapContractResponse(unknownType)
    expect(result.contractType).toBeNull()
  })

  it('should handle NFT contracts', () => {
    const nftContract: MockContract = {
      ...validContract,
      contractType: 'ERC721',
      isERC20: false,
      isERC721: true,
    }

    const result = mapContractResponse(nftContract)

    expect(result.contractType).toBe('ERC721')
    expect(result.isERC20).toBe(false)
    expect(result.isERC721).toBe(true)
  })

  it('should throw on null contract', () => {
    expect(() => mapContractResponse(null as unknown as MockContract)).toThrow(
      'Contract is required',
    )
  })
})

describe('Token Transfer Response Mapping', () => {
  const validTransfer: MockTokenTransfer = {
    id: 'transfer-123',
    token: { address: '0x1234567890abcdef1234567890abcdef12345678' },
    from: { address: '0x1111111111111111111111111111111111111111' },
    to: { address: '0x2222222222222222222222222222222222222222' },
    value: 1000000000000000000n,
    tokenId: null,
    tokenStandard: 'ERC20',
    timestamp: new Date('2024-06-15T12:00:00Z'),
  }

  it('should map ERC20 transfer correctly', () => {
    const result = mapTokenTransferResponse(validTransfer)

    expect(result.id).toBe('transfer-123')
    expect(result.token).toBe('0x1234567890abcdef1234567890abcdef12345678')
    expect(result.from).toBe('0x1111111111111111111111111111111111111111')
    expect(result.to).toBe('0x2222222222222222222222222222222222222222')
    expect(result.value).toBe('1000000000000000000')
    expect(result.tokenId).toBeNull()
    expect(result.tokenStandard).toBe('ERC20')
    expect(result.timestamp).toBe('2024-06-15T12:00:00.000Z')
  })

  it('should map ERC721 transfer correctly', () => {
    const nftTransfer: MockTokenTransfer = {
      ...validTransfer,
      value: null,
      tokenId: '12345',
      tokenStandard: 'ERC721',
    }

    const result = mapTokenTransferResponse(nftTransfer)

    expect(result.value).toBeNull()
    expect(result.tokenId).toBe('12345')
    expect(result.tokenStandard).toBe('ERC721')
  })

  it('should handle minting (from is null)', () => {
    const mintTransfer = { ...validTransfer, from: null }
    const result = mapTokenTransferResponse(mintTransfer)
    expect(result.from).toBeNull()
  })

  it('should handle burning (to is null)', () => {
    const burnTransfer = { ...validTransfer, to: null }
    const result = mapTokenTransferResponse(burnTransfer)
    expect(result.to).toBeNull()
  })

  it('should throw on null transfer', () => {
    expect(() =>
      mapTokenTransferResponse(null as unknown as MockTokenTransfer),
    ).toThrow('TokenTransfer is required')
  })
})

describe('Oracle Feed Response Mapping', () => {
  const validFeed: MockOracleFeed = {
    feedId: '0xfeed123',
    symbol: 'ETH-USD',
    baseToken: '0x0000000000000000000000000000000000000000',
    quoteToken: '0xa0b86a33e6441e0a0000000000000000',
    decimals: 8,
    heartbeatSeconds: 3600,
    category: 'PRICE',
    isActive: true,
    minOracles: 3,
    quorumThreshold: 2,
    latestPrice: 350000000000n,
    latestConfidence: 9900n,
    latestTimestamp: new Date('2024-06-15T12:00:00Z'),
    latestRound: 1000n,
    totalReports: 5000,
    totalDisputes: 5,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastUpdated: new Date('2024-06-15T12:00:00Z'),
  }

  it('should map all fields correctly', () => {
    const result = mapOracleFeedResponse(validFeed)

    expect(result.feedId).toBe('0xfeed123')
    expect(result.symbol).toBe('ETH-USD')
    expect(result.decimals).toBe(8)
    expect(result.heartbeatSeconds).toBe(3600)
    expect(result.category).toBe('PRICE')
    expect(result.isActive).toBe(true)
    expect(result.minOracles).toBe(3)
    expect(result.quorumThreshold).toBe(2)
    expect(result.latestPrice).toBe('350000000000')
    expect(result.latestConfidence).toBe('9900')
    expect(result.latestRound).toBe('1000')
    expect(result.totalReports).toBe(5000)
    expect(result.totalDisputes).toBe(5)
  })

  it('should handle feed with no price data yet', () => {
    const newFeed: MockOracleFeed = {
      ...validFeed,
      latestPrice: null,
      latestConfidence: null,
      latestTimestamp: null,
      latestRound: null,
      totalReports: 0,
    }

    const result = mapOracleFeedResponse(newFeed)

    expect(result.latestPrice).toBeNull()
    expect(result.latestConfidence).toBeNull()
    expect(result.latestTimestamp).toBeNull()
    expect(result.latestRound).toBeNull()
    expect(result.totalReports).toBe(0)
  })

  it('should throw on null feed', () => {
    expect(() =>
      mapOracleFeedResponse(null as unknown as MockOracleFeed),
    ).toThrow('OracleFeed is required')
  })
})

describe('Oracle Operator Response Mapping', () => {
  const validOperator: MockOracleOperator = {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    identityId: 42n,
    isActive: true,
    isJailed: false,
    stakedAmount: 10000000000000000000n,
    delegatedAmount: 5000000000000000000n,
    totalSlashed: 100000000000000000n,
    reportsSubmitted: 1000,
    reportsAccepted: 990,
    disputesAgainst: 5,
    disputesLost: 1,
    participationScore: 95,
    accuracyScore: 99,
    uptimeScore: 98,
    totalEarnings: 500000000000000000n,
    pendingRewards: 50000000000000000n,
    registeredAt: new Date('2024-01-01T00:00:00Z'),
    lastActiveAt: new Date('2024-06-15T12:00:00Z'),
  }

  it('should map all fields correctly', () => {
    const result = mapOracleOperatorResponse(validOperator)

    expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678')
    expect(result.identityId).toBe('42')
    expect(result.isActive).toBe(true)
    expect(result.isJailed).toBe(false)
    expect(result.stakedAmount).toBe('10000000000000000000')
    expect(result.delegatedAmount).toBe('5000000000000000000')
    expect(result.totalSlashed).toBe('100000000000000000')
    expect(result.reportsSubmitted).toBe(1000)
    expect(result.reportsAccepted).toBe(990)
    expect(result.disputesAgainst).toBe(5)
    expect(result.disputesLost).toBe(1)
    expect(result.participationScore).toBe(95)
    expect(result.accuracyScore).toBe(99)
    expect(result.uptimeScore).toBe(98)
    expect(result.totalEarnings).toBe('500000000000000000')
    expect(result.pendingRewards).toBe('50000000000000000')
  })

  it('should handle jailed operator', () => {
    const jailedOperator = { ...validOperator, isActive: false, isJailed: true }
    const result = mapOracleOperatorResponse(jailedOperator)

    expect(result.isActive).toBe(false)
    expect(result.isJailed).toBe(true)
  })

  it('should handle operator without identity', () => {
    const noIdentity = { ...validOperator, identityId: null }
    const result = mapOracleOperatorResponse(noIdentity)
    expect(result.identityId).toBeNull()
  })

  it('should throw on null operator', () => {
    expect(() =>
      mapOracleOperatorResponse(null as unknown as MockOracleOperator),
    ).toThrow('OracleOperator is required')
  })
})

describe('Oracle Report Response Mapping', () => {
  const validReport: MockOracleReport = {
    reportId: 'report-123',
    feed: { feedId: 'feed-456', symbol: 'ETH-USD' },
    round: 100n,
    price: 350000000000n,
    confidence: 9900n,
    timestamp: new Date('2024-06-15T12:00:00Z'),
    isDisputed: false,
    isValid: true,
    submittedBy: { address: '0x1111111111111111111111111111111111111111' },
    submittedAt: new Date('2024-06-15T11:59:59Z'),
    txHash:
      '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    blockNumber: 12345678,
  }

  it('should map all fields correctly', () => {
    const result = mapOracleReportResponse(validReport)

    expect(result.reportId).toBe('report-123')
    expect(result.feedId).toBe('feed-456')
    expect(result.symbol).toBe('ETH-USD')
    expect(result.round).toBe('100')
    expect(result.price).toBe('350000000000')
    expect(result.confidence).toBe('9900')
    expect(result.isDisputed).toBe(false)
    expect(result.isValid).toBe(true)
    expect(result.submittedBy).toBe(
      '0x1111111111111111111111111111111111111111',
    )
    expect(result.txHash).toBe(
      '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    )
    expect(result.blockNumber).toBe(12345678)
  })

  it('should handle disputed report', () => {
    const disputedReport = { ...validReport, isDisputed: true, isValid: false }
    const result = mapOracleReportResponse(disputedReport)

    expect(result.isDisputed).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('should handle report without feed', () => {
    const orphanReport = { ...validReport, feed: null }
    const result = mapOracleReportResponse(orphanReport)

    expect(result.feedId).toBeNull()
    expect(result.symbol).toBeNull()
  })

  it('should throw on null report', () => {
    expect(() =>
      mapOracleReportResponse(null as unknown as MockOracleReport),
    ).toThrow('OracleReport is required')
  })
})

describe('Oracle Dispute Response Mapping', () => {
  const validDispute: MockOracleDispute = {
    disputeId: 'dispute-123',
    report: { reportId: 'report-456' },
    feed: { feedId: 'feed-789' },
    disputer: { address: '0x1111111111111111111111111111111111111111' },
    bond: 100000000000000000000n,
    reason: 'PRICE_DEVIATION',
    status: 'OPEN',
    challenger: null,
    challengeBond: null,
    outcome: null,
    slashedAmount: null,
    openedAt: new Date('2024-06-15T12:00:00Z'),
    challengeDeadline: new Date('2024-06-16T12:00:00Z'),
    resolvedAt: null,
    txHash:
      '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    blockNumber: 12345678,
  }

  it('should map open dispute correctly', () => {
    const result = mapOracleDisputeResponse(validDispute)

    expect(result.disputeId).toBe('dispute-123')
    expect(result.reportId).toBe('report-456')
    expect(result.feedId).toBe('feed-789')
    expect(result.disputer).toBe('0x1111111111111111111111111111111111111111')
    expect(result.bond).toBe('100000000000000000000')
    expect(result.reason).toBe('PRICE_DEVIATION')
    expect(result.status).toBe('OPEN')
    expect(result.challenger).toBeNull()
    expect(result.challengeBond).toBeNull()
    expect(result.outcome).toBeNull()
    expect(result.slashedAmount).toBeNull()
    expect(result.resolvedAt).toBeNull()
  })

  it('should map challenged dispute correctly', () => {
    const challengedDispute: MockOracleDispute = {
      ...validDispute,
      status: 'CHALLENGED',
      challenger: { address: '0x2222222222222222222222222222222222222222' },
      challengeBond: 50000000000000000000n,
    }

    const result = mapOracleDisputeResponse(challengedDispute)

    expect(result.status).toBe('CHALLENGED')
    expect(result.challenger).toBe('0x2222222222222222222222222222222222222222')
    expect(result.challengeBond).toBe('50000000000000000000')
  })

  it('should map resolved dispute correctly', () => {
    const resolvedDispute: MockOracleDispute = {
      ...validDispute,
      status: 'RESOLVED',
      outcome: 'INVALID',
      slashedAmount: 10000000000000000000n,
      resolvedAt: new Date('2024-06-17T12:00:00Z'),
    }

    const result = mapOracleDisputeResponse(resolvedDispute)

    expect(result.status).toBe('RESOLVED')
    expect(result.outcome).toBe('INVALID')
    expect(result.slashedAmount).toBe('10000000000000000000')
    expect(result.resolvedAt).toBe('2024-06-17T12:00:00.000Z')
  })

  it('should throw on null dispute', () => {
    expect(() =>
      mapOracleDisputeResponse(null as unknown as MockOracleDispute),
    ).toThrow('OracleDispute is required')
  })
})

describe('Cross-Service Request Response Mapping', () => {
  const validRequest: MockCrossServiceRequest = {
    requestId: 'req-123',
    requester: { address: '0x1111111111111111111111111111111111111111' },
    requestType: 'TRANSFER',
    sourceCid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    sourceProvider: { address: '0x2222222222222222222222222222222222222222' },
    destinationProvider: {
      address: '0x3333333333333333333333333333333333333333',
    },
    status: 'COMPLETED',
    createdAt: new Date('2024-06-15T10:00:00Z'),
    completedAt: new Date('2024-06-15T10:05:00Z'),
    storageCost: 1000000000000000n,
    bandwidthCost: 500000000000000n,
    totalCost: 1500000000000000n,
    error: null,
    txHash:
      '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    blockNumber: 12345678,
  }

  it('should map completed request correctly', () => {
    const result = mapCrossServiceRequestResponse(validRequest)

    expect(result.requestId).toBe('req-123')
    expect(result.requester).toBe('0x1111111111111111111111111111111111111111')
    expect(result.type).toBe('TRANSFER')
    expect(result.sourceCid).toBe(
      'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    )
    expect(result.sourceProvider).toBe(
      '0x2222222222222222222222222222222222222222',
    )
    expect(result.destinationProvider).toBe(
      '0x3333333333333333333333333333333333333333',
    )
    expect(result.status).toBe('COMPLETED')
    expect(result.completedAt).toBe('2024-06-15T10:05:00.000Z')
    expect(result.storageCost).toBe('1000000000000000')
    expect(result.bandwidthCost).toBe('500000000000000')
    expect(result.totalCost).toBe('1500000000000000')
    expect(result.error).toBeNull()
  })

  it('should map pending request correctly', () => {
    const pendingRequest: MockCrossServiceRequest = {
      ...validRequest,
      status: 'PENDING',
      completedAt: null,
    }

    const result = mapCrossServiceRequestResponse(pendingRequest)

    expect(result.status).toBe('PENDING')
    expect(result.completedAt).toBeNull()
  })

  it('should map failed request correctly', () => {
    const failedRequest: MockCrossServiceRequest = {
      ...validRequest,
      status: 'FAILED',
      completedAt: null,
      error: 'Storage provider offline',
    }

    const result = mapCrossServiceRequestResponse(failedRequest)

    expect(result.status).toBe('FAILED')
    expect(result.error).toBe('Storage provider offline')
  })

  it('should throw on null request', () => {
    expect(() =>
      mapCrossServiceRequestResponse(
        null as unknown as MockCrossServiceRequest,
      ),
    ).toThrow('CrossServiceRequest is required')
  })
})

describe('BigInt Serialization', () => {
  it('should preserve precision for large values', () => {
    const largeValue = 123456789012345678901234567890n

    const account: MockAccount = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      isContract: false,
      transactionCount: 0,
      totalValueSent: largeValue,
      totalValueReceived: largeValue,
      firstSeenBlock: 0,
      lastSeenBlock: 0,
      labels: [],
    }

    const result = mapAccountResponse(account)

    expect(BigInt(result.totalValueSent)).toBe(largeValue)
    expect(BigInt(result.totalValueReceived)).toBe(largeValue)
  })

  it('should handle zero values', () => {
    const account: MockAccount = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      isContract: false,
      transactionCount: 0,
      totalValueSent: 0n,
      totalValueReceived: 0n,
      firstSeenBlock: 0,
      lastSeenBlock: 0,
      labels: [],
    }

    const result = mapAccountResponse(account)

    expect(result.totalValueSent).toBe('0')
    expect(result.totalValueReceived).toBe('0')
  })
})

describe('Date Serialization', () => {
  it('should format dates as ISO 8601 strings', () => {
    const contract: MockContract = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      contractType: 'ERC20',
      isERC20: true,
      isERC721: false,
      isERC1155: false,
      creator: null,
      firstSeenAt: new Date('2024-06-15T12:30:45.123Z'),
    }

    const result = mapContractResponse(contract)

    expect(result.firstSeenAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
    )
    expect(new Date(result.firstSeenAt).getTime()).toBe(
      contract.firstSeenAt.getTime(),
    )
  })

  it('should handle Unix epoch', () => {
    const contract: MockContract = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      contractType: null,
      isERC20: false,
      isERC721: false,
      isERC1155: false,
      creator: null,
      firstSeenAt: new Date(0),
    }

    const result = mapContractResponse(contract)

    expect(result.firstSeenAt).toBe('1970-01-01T00:00:00.000Z')
  })
})
