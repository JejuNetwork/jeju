/**
 * Entity Mappers Tests
 *
 * Tests for all entity-to-response mapping functions.
 * These mappers transform database entities into API response formats.
 */

import { describe, expect, it } from 'bun:test'

// Type Definitions

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

interface MockAgent {
  agentId: bigint
  name: string | null
  description: string | null
  tags: string[] | null
  stakeTier: number
  stakeAmount: bigint
  active: boolean
  isBanned: boolean
  a2aEndpoint: string | null
  mcpEndpoint: string | null
  a2aSkills: string[] | null
  mcpTools: string[] | null
  registeredAt: Date
}

interface MockBlock {
  number: number
  hash: string
  parentHash: string
  timestamp: Date
  transactionCount: number
  gasUsed: bigint
  gasLimit: bigint
}

interface MockTransaction {
  hash: string
  blockNumber: number
  from: { address: string } | null
  to: { address: string } | null
  value: bigint
  gasPrice: bigint | null
  gasUsed: bigint | null
  status: string
}

interface MockProvider {
  address: string
  name: string | null
  endpoint: string
  agentId: number | null
  providerType?: string
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

// Mapper Functions

function mapAccountResponse(account: MockAccount) {
  if (!account) throw new Error('Account is required')
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
  if (!contract) throw new Error('Contract is required')
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
  if (!transfer) throw new Error('TokenTransfer is required')
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

function mapAgentSummary(agent: MockAgent) {
  if (!agent) throw new Error('Agent is required')
  if (agent.agentId === undefined || agent.agentId === null) {
    throw new Error('Agent agentId is required')
  }
  if (!agent.registeredAt) throw new Error('Agent registeredAt is required')

  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    description: agent.description,
    tags: agent.tags,
    stakeTier: agent.stakeTier,
    stakeAmount: agent.stakeAmount.toString(),
    active: agent.active,
    isBanned: agent.isBanned,
    a2aEndpoint: agent.a2aEndpoint,
    mcpEndpoint: agent.mcpEndpoint,
    registeredAt: agent.registeredAt.toISOString(),
  }
}

function mapAgentWithSkills(agent: MockAgent) {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    a2aEndpoint: agent.a2aEndpoint,
    skills: agent.a2aSkills,
    stakeTier: agent.stakeTier,
  }
}

function mapAgentWithTools(agent: MockAgent) {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    mcpEndpoint: agent.mcpEndpoint,
    tools: agent.mcpTools,
    stakeTier: agent.stakeTier,
  }
}

function mapBlockSummary(block: MockBlock) {
  if (!block) throw new Error('Block is required')
  if (typeof block.number !== 'number' || block.number < 0) {
    throw new Error(`Invalid block number: ${block.number}`)
  }
  if (!block.hash || typeof block.hash !== 'string') {
    throw new Error(`Invalid block hash: ${block.hash}`)
  }
  if (!block.timestamp) throw new Error('Block timestamp is required')

  return {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
  }
}

function mapBlockDetail(block: MockBlock) {
  if (!block) throw new Error('Block is required')
  if (typeof block.number !== 'number' || block.number < 0) {
    throw new Error(`Invalid block number: ${block.number}`)
  }
  if (!block.hash || typeof block.hash !== 'string') {
    throw new Error(`Invalid block hash: ${block.hash}`)
  }
  if (!block.timestamp) throw new Error('Block timestamp is required')

  return {
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
    gasLimit: block.gasLimit.toString(),
  }
}

function mapTransactionSummary(tx: MockTransaction) {
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    from: tx.from?.address,
    to: tx.to?.address,
    value: tx.value.toString(),
    status: tx.status,
  }
}

function mapTransactionDetail(tx: MockTransaction) {
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    from: tx.from?.address,
    to: tx.to?.address,
    value: tx.value.toString(),
    gasPrice: tx.gasPrice?.toString(),
    gasUsed: tx.gasUsed?.toString(),
    status: tx.status,
  }
}

function mapProviderSummary(p: MockProvider, type: 'compute' | 'storage') {
  if (!p) throw new Error('Provider is required')
  if (type !== 'compute' && type !== 'storage') {
    throw new Error(`Invalid provider type: ${type}`)
  }
  if (!p.address || typeof p.address !== 'string') {
    throw new Error(`Invalid provider address: ${p.address}`)
  }

  return {
    address: p.address,
    name: p.name,
    endpoint: p.endpoint,
    agentId: p.agentId,
    ...(type === 'storage' && 'providerType' in p
      ? { providerType: p.providerType }
      : {}),
  }
}

function mapOracleFeedResponse(feed: MockOracleFeed) {
  if (!feed) throw new Error('OracleFeed is required')
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
  if (!operator) throw new Error('OracleOperator is required')
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
  if (!report) throw new Error('OracleReport is required')
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
  if (!dispute) throw new Error('OracleDispute is required')
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
  if (!request) throw new Error('CrossServiceRequest is required')
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

// Account Mapper Tests

describe('Account Mappers', () => {
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
    expect(result.transactionCount).toBe(100)
    expect(result.totalValueSent).toBe('5000000000000000000')
    expect(result.labels).toEqual(['active', 'whale'])
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
    expect(result.totalValueSent).toBe('0')
    expect(result.labels).toEqual([])
  })

  it('should throw on null account', () => {
    expect(() => mapAccountResponse(null as unknown as MockAccount)).toThrow(
      'Account is required',
    )
  })
})

// Contract Mapper Tests

describe('Contract Mappers', () => {
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
    expect(result.contractType).toBe('ERC20')
    expect(result.isERC20).toBe(true)
    expect(result.creator).toBe('0x1111111111111111111111111111111111111111')
    expect(result.firstSeenAt).toBe('2024-01-15T10:30:00.000Z')
  })

  it('should handle null creator', () => {
    const noCreator = { ...validContract, creator: null }
    const result = mapContractResponse(noCreator)
    expect(result.creator).toBeNull()
  })

  it('should throw on null contract', () => {
    expect(() => mapContractResponse(null as unknown as MockContract)).toThrow(
      'Contract is required',
    )
  })
})

// Token Transfer Mapper Tests

describe('Token Transfer Mappers', () => {
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
    expect(result.value).toBe('1000000000000000000')
    expect(result.tokenStandard).toBe('ERC20')
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
  })

  it('should handle minting (from is null)', () => {
    const result = mapTokenTransferResponse({ ...validTransfer, from: null })
    expect(result.from).toBeNull()
  })

  it('should throw on null transfer', () => {
    expect(() =>
      mapTokenTransferResponse(null as unknown as MockTokenTransfer),
    ).toThrow('TokenTransfer is required')
  })
})

// Agent Mapper Tests

describe('Agent Mappers', () => {
  const validAgent: MockAgent = {
    agentId: 123n,
    name: 'Test Agent',
    description: 'A test agent',
    tags: ['defi', 'oracle'],
    stakeTier: 2,
    stakeAmount: 1000000000000000000n,
    active: true,
    isBanned: false,
    a2aEndpoint: 'https://agent.example.com/a2a',
    mcpEndpoint: 'https://agent.example.com/mcp',
    a2aSkills: ['search', 'analyze'],
    mcpTools: ['get_data', 'send_tx'],
    registeredAt: new Date('2024-01-15T12:00:00Z'),
  }

  describe('mapAgentSummary', () => {
    it('should map all fields correctly', () => {
      const result = mapAgentSummary(validAgent)
      expect(result.agentId).toBe('123')
      expect(result.name).toBe('Test Agent')
      expect(result.stakeTier).toBe(2)
      expect(result.stakeAmount).toBe('1000000000000000000')
    })

    it('should handle null optional fields', () => {
      const agentWithNulls: MockAgent = {
        ...validAgent,
        name: null,
        description: null,
        tags: null,
        a2aEndpoint: null,
        mcpEndpoint: null,
      }
      const result = mapAgentSummary(agentWithNulls)
      expect(result.name).toBeNull()
      expect(result.description).toBeNull()
    })

    it('should throw on null agent', () => {
      expect(() => mapAgentSummary(null as unknown as MockAgent)).toThrow(
        'Agent is required',
      )
    })
  })

  describe('mapAgentWithSkills', () => {
    it('should include only skill-related fields', () => {
      const result = mapAgentWithSkills(validAgent)
      expect(result.skills).toEqual(['search', 'analyze'])
      expect((result as Record<string, unknown>).mcpEndpoint).toBeUndefined()
    })

    it('should handle null skills', () => {
      const result = mapAgentWithSkills({ ...validAgent, a2aSkills: null })
      expect(result.skills).toBeNull()
    })
  })

  describe('mapAgentWithTools', () => {
    it('should include only tool-related fields', () => {
      const result = mapAgentWithTools(validAgent)
      expect(result.tools).toEqual(['get_data', 'send_tx'])
      expect((result as Record<string, unknown>).a2aEndpoint).toBeUndefined()
    })
  })
})

// Block Mapper Tests

describe('Block Mappers', () => {
  const validBlock: MockBlock = {
    number: 12345678,
    hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    parentHash:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    timestamp: new Date('2024-06-15T08:30:00Z'),
    transactionCount: 150,
    gasUsed: 15000000n,
    gasLimit: 30000000n,
  }

  describe('mapBlockSummary', () => {
    it('should map all summary fields correctly', () => {
      const result = mapBlockSummary(validBlock)
      expect(result.number).toBe(12345678)
      expect(result.transactionCount).toBe(150)
      expect(result.gasUsed).toBe('15000000')
    })

    it('should throw on negative block number', () => {
      expect(() => mapBlockSummary({ ...validBlock, number: -1 })).toThrow(
        'Invalid block number',
      )
    })

    it('should handle block 0 (genesis)', () => {
      const result = mapBlockSummary({ ...validBlock, number: 0 })
      expect(result.number).toBe(0)
    })
  })

  describe('mapBlockDetail', () => {
    it('should include parentHash and gasLimit', () => {
      const result = mapBlockDetail(validBlock)
      expect(result.parentHash).toBeDefined()
      expect(result.gasLimit).toBe('30000000')
    })
  })
})

// Transaction Mapper Tests

describe('Transaction Mappers', () => {
  const validTx: MockTransaction = {
    hash: '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    blockNumber: 12345678,
    from: { address: '0x1111111111111111111111111111111111111111' },
    to: { address: '0x2222222222222222222222222222222222222222' },
    value: 1000000000000000000n,
    gasPrice: 20000000000n,
    gasUsed: 21000n,
    status: 'success',
  }

  describe('mapTransactionSummary', () => {
    it('should map all summary fields correctly', () => {
      const result = mapTransactionSummary(validTx)
      expect(result.value).toBe('1000000000000000000')
      expect(result.status).toBe('success')
    })

    it('should handle contract creation (null to)', () => {
      const result = mapTransactionSummary({ ...validTx, to: null })
      expect(result.to).toBeUndefined()
    })
  })

  describe('mapTransactionDetail', () => {
    it('should include gas fields', () => {
      const result = mapTransactionDetail(validTx)
      expect(result.gasPrice).toBe('20000000000')
      expect(result.gasUsed).toBe('21000')
    })

    it('should handle null gas values', () => {
      const result = mapTransactionDetail({
        ...validTx,
        gasPrice: null,
        gasUsed: null,
      })
      expect(result.gasPrice).toBeUndefined()
      expect(result.gasUsed).toBeUndefined()
    })
  })
})

// Provider Mapper Tests

describe('Provider Mappers', () => {
  const computeProvider: MockProvider = {
    address: '0x3333333333333333333333333333333333333333',
    name: 'Fast Compute',
    endpoint: 'https://compute.example.com',
    agentId: 42,
  }

  const storageProvider: MockProvider = {
    address: '0x4444444444444444444444444444444444444444',
    name: 'Reliable Storage',
    endpoint: 'https://storage.example.com',
    agentId: 99,
    providerType: 'IPFS',
  }

  it('should map compute provider correctly', () => {
    const result = mapProviderSummary(computeProvider, 'compute')
    expect(result.name).toBe('Fast Compute')
    expect((result as Record<string, unknown>).providerType).toBeUndefined()
  })

  it('should map storage provider with providerType', () => {
    const result = mapProviderSummary(storageProvider, 'storage')
    expect(result.providerType).toBe('IPFS')
  })

  it('should throw on null provider', () => {
    expect(() =>
      mapProviderSummary(null as unknown as MockProvider, 'compute'),
    ).toThrow('Provider is required')
  })

  it('should throw on invalid type', () => {
    expect(() =>
      mapProviderSummary(computeProvider, 'invalid' as 'compute'),
    ).toThrow('Invalid provider type')
  })
})

// Oracle Mapper Tests

describe('Oracle Feed Mappers', () => {
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
    expect(result.symbol).toBe('ETH-USD')
    expect(result.latestPrice).toBe('350000000000')
    expect(result.totalReports).toBe(5000)
  })

  it('should handle feed with no price data yet', () => {
    const newFeed: MockOracleFeed = {
      ...validFeed,
      latestPrice: null,
      latestConfidence: null,
      latestTimestamp: null,
      latestRound: null,
    }
    const result = mapOracleFeedResponse(newFeed)
    expect(result.latestPrice).toBeNull()
  })
})

describe('Oracle Operator Mappers', () => {
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
    expect(result.identityId).toBe('42')
    expect(result.stakedAmount).toBe('10000000000000000000')
    expect(result.reportsSubmitted).toBe(1000)
  })

  it('should handle jailed operator', () => {
    const result = mapOracleOperatorResponse({
      ...validOperator,
      isActive: false,
      isJailed: true,
    })
    expect(result.isJailed).toBe(true)
  })
})

describe('Oracle Report Mappers', () => {
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
    expect(result.feedId).toBe('feed-456')
    expect(result.price).toBe('350000000000')
    expect(result.isValid).toBe(true)
  })

  it('should handle report without feed', () => {
    const result = mapOracleReportResponse({ ...validReport, feed: null })
    expect(result.feedId).toBeNull()
  })
})

describe('Oracle Dispute Mappers', () => {
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
    expect(result.status).toBe('OPEN')
    expect(result.challenger).toBeNull()
  })

  it('should map resolved dispute correctly', () => {
    const resolved = {
      ...validDispute,
      status: 'RESOLVED',
      outcome: 'INVALID',
      slashedAmount: 10000000000000000000n,
      resolvedAt: new Date('2024-06-17T12:00:00Z'),
    }
    const result = mapOracleDisputeResponse(resolved)
    expect(result.outcome).toBe('INVALID')
    expect(result.slashedAmount).toBe('10000000000000000000')
  })
})

// Cross-Service Request Mapper Tests

describe('Cross-Service Request Mappers', () => {
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
    expect(result.status).toBe('COMPLETED')
    expect(result.totalCost).toBe('1500000000000000')
  })

  it('should map pending request correctly', () => {
    const pending = { ...validRequest, status: 'PENDING', completedAt: null }
    const result = mapCrossServiceRequestResponse(pending)
    expect(result.completedAt).toBeNull()
  })

  it('should map failed request correctly', () => {
    const failed = {
      ...validRequest,
      status: 'FAILED',
      completedAt: null,
      error: 'Storage provider offline',
    }
    const result = mapCrossServiceRequestResponse(failed)
    expect(result.error).toBe('Storage provider offline')
  })
})

// BigInt and Date Serialization Tests

describe('Serialization', () => {
  it('should preserve precision for large bigint values', () => {
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
  })

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
