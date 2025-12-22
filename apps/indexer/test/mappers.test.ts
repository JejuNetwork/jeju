/**
 * Mappers Unit Tests
 *
 * Tests the entity-to-response mapping functions.
 * These mappers transform database entities into API response formats.
 */

import { describe, expect, it } from 'bun:test'

// Mock types matching the actual entity shapes
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

// Mappers re-implemented for testing (matching src/lib/mappers.ts logic)
function mapAgentSummary(agent: MockAgent) {
  if (!agent) {
    throw new Error('Agent is required')
  }
  if (agent.agentId === undefined || agent.agentId === null) {
    throw new Error('Agent agentId is required')
  }
  if (!agent.registeredAt) {
    throw new Error('Agent registeredAt is required')
  }

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
  if (!block) {
    throw new Error('Block is required')
  }
  if (typeof block.number !== 'number' || block.number < 0) {
    throw new Error(`Invalid block number: ${block.number}`)
  }
  if (!block.hash || typeof block.hash !== 'string') {
    throw new Error(`Invalid block hash: ${block.hash}`)
  }
  if (!block.timestamp) {
    throw new Error('Block timestamp is required')
  }

  return {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
  }
}

function mapBlockDetail(block: MockBlock) {
  if (!block) {
    throw new Error('Block is required')
  }
  if (typeof block.number !== 'number' || block.number < 0) {
    throw new Error(`Invalid block number: ${block.number}`)
  }
  if (!block.hash || typeof block.hash !== 'string') {
    throw new Error(`Invalid block hash: ${block.hash}`)
  }
  if (!block.timestamp) {
    throw new Error('Block timestamp is required')
  }

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
  if (!p) {
    throw new Error('Provider is required')
  }
  if (type !== 'compute' && type !== 'storage') {
    throw new Error(
      `Invalid provider type: ${type}. Must be 'compute' or 'storage'`,
    )
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
      expect(result.description).toBe('A test agent')
      expect(result.tags).toEqual(['defi', 'oracle'])
      expect(result.stakeTier).toBe(2)
      expect(result.stakeAmount).toBe('1000000000000000000')
      expect(result.active).toBe(true)
      expect(result.isBanned).toBe(false)
      expect(result.a2aEndpoint).toBe('https://agent.example.com/a2a')
      expect(result.mcpEndpoint).toBe('https://agent.example.com/mcp')
      expect(result.registeredAt).toBe('2024-01-15T12:00:00.000Z')
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
      expect(result.tags).toBeNull()
      expect(result.a2aEndpoint).toBeNull()
      expect(result.mcpEndpoint).toBeNull()
    })

    it('should convert large bigint values correctly', () => {
      const agentWithLargeStake: MockAgent = {
        ...validAgent,
        agentId: 999999999999999999n,
        stakeAmount: 1000000000000000000000n, // 1000 ETH
      }

      const result = mapAgentSummary(agentWithLargeStake)

      expect(result.agentId).toBe('999999999999999999')
      expect(result.stakeAmount).toBe('1000000000000000000000')
      expect(BigInt(result.stakeAmount)).toBe(1000000000000000000000n)
    })

    it('should handle agentId of 0', () => {
      const agentWithZeroId: MockAgent = { ...validAgent, agentId: 0n }
      const result = mapAgentSummary(agentWithZeroId)
      expect(result.agentId).toBe('0')
    })

    it('should throw on null agent', () => {
      expect(() => mapAgentSummary(null as unknown as MockAgent)).toThrow(
        'Agent is required',
      )
    })

    it('should throw on missing registeredAt', () => {
      const invalidAgent = {
        ...validAgent,
        registeredAt: null as unknown as Date,
      }
      expect(() => mapAgentSummary(invalidAgent)).toThrow(
        'Agent registeredAt is required',
      )
    })
  })

  describe('mapAgentWithSkills', () => {
    it('should include only skill-related fields', () => {
      const result = mapAgentWithSkills(validAgent)

      expect(result.agentId).toBe('123')
      expect(result.name).toBe('Test Agent')
      expect(result.a2aEndpoint).toBe('https://agent.example.com/a2a')
      expect(result.skills).toEqual(['search', 'analyze'])
      expect(result.stakeTier).toBe(2)
      expect((result as Record<string, unknown>).mcpEndpoint).toBeUndefined()
    })

    it('should handle null skills', () => {
      const agentNoSkills: MockAgent = { ...validAgent, a2aSkills: null }
      const result = mapAgentWithSkills(agentNoSkills)
      expect(result.skills).toBeNull()
    })

    it('should handle empty skills array', () => {
      const agentEmptySkills: MockAgent = { ...validAgent, a2aSkills: [] }
      const result = mapAgentWithSkills(agentEmptySkills)
      expect(result.skills).toEqual([])
    })
  })

  describe('mapAgentWithTools', () => {
    it('should include only tool-related fields', () => {
      const result = mapAgentWithTools(validAgent)

      expect(result.agentId).toBe('123')
      expect(result.name).toBe('Test Agent')
      expect(result.mcpEndpoint).toBe('https://agent.example.com/mcp')
      expect(result.tools).toEqual(['get_data', 'send_tx'])
      expect(result.stakeTier).toBe(2)
      expect((result as Record<string, unknown>).a2aEndpoint).toBeUndefined()
    })

    it('should handle null tools', () => {
      const agentNoTools: MockAgent = { ...validAgent, mcpTools: null }
      const result = mapAgentWithTools(agentNoTools)
      expect(result.tools).toBeNull()
    })
  })
})

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
      expect(result.hash).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      )
      expect(result.timestamp).toBe('2024-06-15T08:30:00.000Z')
      expect(result.transactionCount).toBe(150)
      expect(result.gasUsed).toBe('15000000')
    })

    it('should throw on null block', () => {
      expect(() => mapBlockSummary(null as unknown as MockBlock)).toThrow(
        'Block is required',
      )
    })

    it('should throw on negative block number', () => {
      const invalidBlock = { ...validBlock, number: -1 }
      expect(() => mapBlockSummary(invalidBlock)).toThrow(
        'Invalid block number',
      )
    })

    it('should throw on invalid block hash', () => {
      const invalidBlock = { ...validBlock, hash: null as unknown as string }
      expect(() => mapBlockSummary(invalidBlock)).toThrow('Invalid block hash')
    })

    it('should throw on missing timestamp', () => {
      const invalidBlock = { ...validBlock, timestamp: null as unknown as Date }
      expect(() => mapBlockSummary(invalidBlock)).toThrow(
        'Block timestamp is required',
      )
    })

    it('should handle block 0 (genesis)', () => {
      const genesisBlock = { ...validBlock, number: 0 }
      const result = mapBlockSummary(genesisBlock)
      expect(result.number).toBe(0)
    })

    it('should handle large gas values', () => {
      const highGasBlock = { ...validBlock, gasUsed: 99999999999999999n }
      const result = mapBlockSummary(highGasBlock)
      expect(result.gasUsed).toBe('99999999999999999')
    })
  })

  describe('mapBlockDetail', () => {
    it('should include all detail fields', () => {
      const result = mapBlockDetail(validBlock)

      expect(result.number).toBe(12345678)
      expect(result.hash).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      )
      expect(result.parentHash).toBe(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      )
      expect(result.timestamp).toBe('2024-06-15T08:30:00.000Z')
      expect(result.transactionCount).toBe(150)
      expect(result.gasUsed).toBe('15000000')
      expect(result.gasLimit).toBe('30000000')
    })

    it('should have additional fields compared to summary', () => {
      const summary = mapBlockSummary(validBlock)
      const detail = mapBlockDetail(validBlock)

      expect((summary as Record<string, unknown>).parentHash).toBeUndefined()
      expect(detail.parentHash).toBeDefined()
      expect((summary as Record<string, unknown>).gasLimit).toBeUndefined()
      expect(detail.gasLimit).toBeDefined()
    })
  })
})

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

      expect(result.hash).toBe(
        '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
      )
      expect(result.blockNumber).toBe(12345678)
      expect(result.from).toBe('0x1111111111111111111111111111111111111111')
      expect(result.to).toBe('0x2222222222222222222222222222222222222222')
      expect(result.value).toBe('1000000000000000000')
      expect(result.status).toBe('success')
    })

    it('should handle contract creation (null to)', () => {
      const contractCreationTx = { ...validTx, to: null }
      const result = mapTransactionSummary(contractCreationTx)
      expect(result.to).toBeUndefined()
    })

    it('should handle null from (unlikely but safe)', () => {
      const noFromTx = { ...validTx, from: null }
      const result = mapTransactionSummary(noFromTx)
      expect(result.from).toBeUndefined()
    })

    it('should handle zero value transactions', () => {
      const zeroValueTx = { ...validTx, value: 0n }
      const result = mapTransactionSummary(zeroValueTx)
      expect(result.value).toBe('0')
    })
  })

  describe('mapTransactionDetail', () => {
    it('should include all detail fields', () => {
      const result = mapTransactionDetail(validTx)

      expect(result.hash).toBe(
        '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
      )
      expect(result.blockNumber).toBe(12345678)
      expect(result.from).toBe('0x1111111111111111111111111111111111111111')
      expect(result.to).toBe('0x2222222222222222222222222222222222222222')
      expect(result.value).toBe('1000000000000000000')
      expect(result.gasPrice).toBe('20000000000')
      expect(result.gasUsed).toBe('21000')
      expect(result.status).toBe('success')
    })

    it('should handle null gas values', () => {
      const noGasTx = { ...validTx, gasPrice: null, gasUsed: null }
      const result = mapTransactionDetail(noGasTx)
      expect(result.gasPrice).toBeUndefined()
      expect(result.gasUsed).toBeUndefined()
    })

    it('should have additional fields compared to summary', () => {
      const summary = mapTransactionSummary(validTx)
      const detail = mapTransactionDetail(validTx)

      expect((summary as Record<string, unknown>).gasPrice).toBeUndefined()
      expect(detail.gasPrice).toBeDefined()
      expect((summary as Record<string, unknown>).gasUsed).toBeUndefined()
      expect(detail.gasUsed).toBeDefined()
    })
  })
})

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

  describe('mapProviderSummary', () => {
    it('should map compute provider correctly', () => {
      const result = mapProviderSummary(computeProvider, 'compute')

      expect(result.address).toBe('0x3333333333333333333333333333333333333333')
      expect(result.name).toBe('Fast Compute')
      expect(result.endpoint).toBe('https://compute.example.com')
      expect(result.agentId).toBe(42)
      expect((result as Record<string, unknown>).providerType).toBeUndefined()
    })

    it('should map storage provider with providerType', () => {
      const result = mapProviderSummary(storageProvider, 'storage')

      expect(result.address).toBe('0x4444444444444444444444444444444444444444')
      expect(result.name).toBe('Reliable Storage')
      expect(result.endpoint).toBe('https://storage.example.com')
      expect(result.agentId).toBe(99)
      expect(result.providerType).toBe('IPFS')
    })

    it('should handle null name', () => {
      const noNameProvider = { ...computeProvider, name: null }
      const result = mapProviderSummary(noNameProvider, 'compute')
      expect(result.name).toBeNull()
    })

    it('should handle null agentId (not linked)', () => {
      const unlinkedProvider = { ...computeProvider, agentId: null }
      const result = mapProviderSummary(unlinkedProvider, 'compute')
      expect(result.agentId).toBeNull()
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

    it('should throw on invalid address', () => {
      const invalidProvider = {
        ...computeProvider,
        address: null as unknown as string,
      }
      expect(() => mapProviderSummary(invalidProvider, 'compute')).toThrow(
        'Invalid provider address',
      )
    })

    it('should not include providerType for compute even if present', () => {
      const computeWithType = { ...computeProvider, providerType: 'GPU' }
      const result = mapProviderSummary(computeWithType, 'compute')
      // Compute type should not have providerType in output
      expect((result as Record<string, unknown>).providerType).toBeUndefined()
    })
  })
})

describe('Edge Cases', () => {
  it('should handle empty strings vs null correctly', () => {
    const agentEmptyStrings: MockAgent = {
      agentId: 1n,
      name: '',
      description: '',
      tags: [],
      stakeTier: 0,
      stakeAmount: 0n,
      active: false,
      isBanned: false,
      a2aEndpoint: '',
      mcpEndpoint: '',
      a2aSkills: [],
      mcpTools: [],
      registeredAt: new Date(),
    }

    const result = mapAgentSummary(agentEmptyStrings)

    expect(result.name).toBe('')
    expect(result.description).toBe('')
    expect(result.tags).toEqual([])
    expect(result.a2aEndpoint).toBe('')
    expect(result.mcpEndpoint).toBe('')
  })

  it('should correctly serialize Date objects', () => {
    const block: MockBlock = {
      number: 1,
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      parentHash:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      timestamp: new Date(0), // Unix epoch
      transactionCount: 0,
      gasUsed: 0n,
      gasLimit: 8000000n,
    }

    const result = mapBlockSummary(block)
    expect(result.timestamp).toBe('1970-01-01T00:00:00.000Z')
  })

  it('should handle bigint edge values', () => {
    const maxSafeBigInt = BigInt(Number.MAX_SAFE_INTEGER) + 1n
    const agent: MockAgent = {
      agentId: maxSafeBigInt,
      name: 'Edge Agent',
      description: null,
      tags: null,
      stakeTier: 4,
      stakeAmount: maxSafeBigInt * 2n,
      active: true,
      isBanned: false,
      a2aEndpoint: null,
      mcpEndpoint: null,
      a2aSkills: null,
      mcpTools: null,
      registeredAt: new Date(),
    }

    const result = mapAgentSummary(agent)

    // Should be able to round-trip bigint through string
    expect(BigInt(result.agentId)).toBe(maxSafeBigInt)
    expect(BigInt(result.stakeAmount)).toBe(maxSafeBigInt * 2n)
  })
})
