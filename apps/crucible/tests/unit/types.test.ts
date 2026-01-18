import { describe, expect, it } from 'bun:test'
import {
  getCoreAppUrl,
  getIndexerGraphqlUrl,
  getL2RpcUrl,
} from '@jejunetwork/config'
import type {
  AgentCharacter,
  AgentDefinition,
  AgentSearchFilter,
  AgentState,
  AgentTrigger,
  AgentVault,
  CrucibleConfig,
  ExecutionCost,
  ExecutionInput,
  ExecutionMetadata,
  ExecutionOptions,
  ExecutionRequest,
  ExecutionResult,
  MemoryEntry,
  Room,
  RoomConfig,
  RoomMember,
  RoomMessage,
  RoomState,
  SearchResult,
  Team,
  TradingBotChain,
  TradingBotConfig,
  TradingBotMetrics,
  TradingBotOpportunity,
  TradingBotStrategy,
  VaultTransaction,
} from '../../lib/types'

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as const

describe('Agent Types', () => {
  it('AgentDefinition has required fields', () => {
    const agent: AgentDefinition = {
      agentId: 1n,
      owner: TEST_ADDRESS,
      name: 'Test Agent',
      botType: 'ai_agent',
      characterCid: 'QmCharacterCid',
      stateCid: 'QmStateCid',
      vaultAddress: TEST_ADDRESS,
      active: true,
      registeredAt: Date.now(),
      lastExecutedAt: Date.now(),
      executionCount: 10,
    }

    expect(typeof agent.agentId).toBe('bigint')
    expect(agent.active).toBe(true)
    expect(agent.botType).toBe('ai_agent')
  })

  it('AgentState tracks version correctly', () => {
    const state: AgentState = {
      agentId: 'agent-1',
      version: 5,
      memories: [],
      rooms: ['room-1', 'room-2'],
      context: { lastTopic: 'testing' },
      updatedAt: Date.now(),
    }

    expect(state.version).toBe(5)
    expect(state.rooms.length).toBe(2)
    expect(state.context.lastTopic).toBe('testing')
  })

  it('MemoryEntry stores embeddings correctly', () => {
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
    const memory: MemoryEntry = {
      id: 'mem-1',
      content: 'User mentioned they like TypeScript',
      embedding,
      importance: 0.8,
      createdAt: Date.now(),
      roomId: 'room-1',
      userId: 'user-123',
    }

    expect(memory.embedding).toEqual(embedding)
    expect(memory.importance).toBeGreaterThan(0)
    expect(memory.importance).toBeLessThanOrEqual(1)
  })

  it('AgentCharacter validates style structure', () => {
    const character: AgentCharacter = {
      id: 'test-char',
      name: 'Test Character',
      description: 'A test character for validation',
      system: 'You are a helpful assistant',
      bio: ['Line 1', 'Line 2'],
      messageExamples: [],
      topics: ['testing', 'validation'],
      adjectives: ['helpful', 'precise'],
      style: {
        all: ['Be helpful'],
        chat: ['Be concise'],
        post: ['Be engaging'],
      },
    }

    expect(character.style.all.length).toBeGreaterThan(0)
    expect(character.style.chat.length).toBeGreaterThan(0)
    expect(character.style.post.length).toBeGreaterThan(0)
  })
})

describe('Room Types', () => {
  it('Room types are valid string unions', () => {
    const roomTypes = ['collaboration', 'adversarial', 'debate', 'board']
    const roles = [
      'participant',
      'moderator',
      'red_team',
      'blue_team',
      'observer',
    ]
    const phases = ['setup', 'active', 'paused', 'completed', 'archived']

    roomTypes.forEach((type) => {
      expect(typeof type).toBe('string')
    })
    roles.forEach((role) => {
      expect(typeof role).toBe('string')
    })
    phases.forEach((phase) => {
      expect(typeof phase).toBe('string')
    })
  })

  it('Room has valid configuration', () => {
    const config: RoomConfig = {
      maxMembers: 10,
      turnBased: true,
      turnTimeout: 300,
      visibility: 'members_only',
    }

    const room: Room = {
      roomId: 1n,
      name: 'Security Review',
      description: 'Red vs Blue security challenge',
      owner: TEST_ADDRESS,
      stateCid: 'QmRoomState',
      members: [],
      roomType: 'adversarial',
      config,
      active: true,
      createdAt: Date.now(),
    }

    expect(room.config.maxMembers).toBe(10)
    expect(room.config.turnBased).toBe(true)
    expect(room.roomType).toBe('adversarial')
  })

  it('RoomMember tracks scores', () => {
    const member: RoomMember = {
      agentId: 1n,
      role: 'red_team',
      joinedAt: Date.now() - 1000,
      lastActiveAt: Date.now(),
      score: 50,
    }

    expect(member.score).toBe(50)
    expect(member.lastActiveAt).toBeGreaterThan(member.joinedAt)
  })

  it('RoomState tracks messages and scores', () => {
    const message: RoomMessage = {
      id: 'msg-1',
      agentId: 'agent-1',
      content: 'Hello team',
      timestamp: Date.now(),
    }

    const state: RoomState = {
      roomId: 'room-1',
      version: 3,
      messages: [message],
      scores: { 'agent-1': 10, 'agent-2': 15 },
      phase: 'active',
      metadata: { topic: 'testing' },
      updatedAt: Date.now(),
    }

    expect(state.messages.length).toBe(1)
    expect(state.scores['agent-1']).toBe(10)
    expect(state.scores['agent-2']).toBe(15)
  })
})

describe('Execution Types', () => {
  it('ExecutionRequest has proper structure', () => {
    const input: ExecutionInput = {
      message: 'Hello agent',
      roomId: 'room-1',
      userId: 'user-456',
      context: { source: 'discord' },
    }

    const options: ExecutionOptions = {
      maxTokens: 1024,
      temperature: 0.7,
      requireTee: true,
      maxCost: 1000000000000000n,
      timeout: 30,
    }

    const request: ExecutionRequest = {
      agentId: 1n,
      triggerId: 'trigger-123',
      input,
      options,
    }

    expect(request.input.message).toBe('Hello agent')
    expect(request.options?.maxTokens).toBe(1024)
  })

  it('ExecutionResult tracks costs correctly', () => {
    const cost: ExecutionCost = {
      total: 1000000000000000n,
      inference: 800000000000000n,
      storage: 100000000000000n,
      executionFee: 100000000000000n,
      currency: 'ETH',
      txHash: '0x123abc',
    }

    const metadata: ExecutionMetadata = {
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      latencyMs: 5000,
      model: 'llama-3.1-8b',
      tokensUsed: { input: 100, output: 50 },
      executor: TEST_ADDRESS,
      attestationHash: '0xabcd',
    }

    const result: ExecutionResult = {
      executionId: 'exec-123',
      agentId: 1n,
      status: 'completed',
      output: {
        response: 'Hello! How can I help?',
        actions: [],
        stateUpdates: {},
        roomMessages: [],
      },
      newStateCid: 'QmNewState',
      cost,
      metadata,
    }

    expect(result.cost.total).toBe(1000000000000000n)
    expect(
      result.cost.inference + result.cost.storage + result.cost.executionFee,
    ).toBe(result.cost.total)
    expect(result.metadata.latencyMs).toBe(5000)
  })
})

describe('Trigger Types', () => {
  it('AgentTrigger supports multiple trigger types', () => {
    const cronTrigger: AgentTrigger = {
      triggerId: 'trigger-cron',
      agentId: 1n,
      type: 'cron',
      config: {
        cronExpression: '0 9 * * 1-5',
        paymentMode: 'vault',
        pricePerExecution: 100000000000000n,
      },
      active: true,
      fireCount: 42,
    }

    const webhookTrigger: AgentTrigger = {
      triggerId: 'trigger-webhook',
      agentId: 2n,
      type: 'webhook',
      config: {
        webhookPath: '/api/webhook/agent-2',
        paymentMode: 'x402',
        pricePerExecution: 50000000000000n,
      },
      active: true,
      fireCount: 100,
    }

    expect(cronTrigger.type).toBe('cron')
    expect(cronTrigger.config.cronExpression).toBeDefined()
    expect(webhookTrigger.type).toBe('webhook')
    expect(webhookTrigger.config.webhookPath).toBeDefined()
  })
})

describe('Vault Types', () => {
  it('AgentVault tracks balance and spending', () => {
    const vault: AgentVault = {
      address: TEST_ADDRESS,
      agentId: 1n,
      balance: 1000000000000000000n, // 1 ETH
      spendLimit: 100000000000000000n, // 0.1 ETH
      approvedSpenders: [TEST_ADDRESS],
      totalSpent: 500000000000000000n, // 0.5 ETH
      lastFundedAt: Date.now(),
    }

    expect(vault.balance).toBe(1000000000000000000n)
    expect(vault.totalSpent).toBeLessThan(vault.balance)
    expect(vault.approvedSpenders.length).toBe(1)
  })

  it('VaultTransaction records transaction types', () => {
    const deposit: VaultTransaction = {
      txHash: '0x111',
      type: 'deposit',
      amount: 1000000000000000000n,
      timestamp: Date.now(),
    }

    const spend: VaultTransaction = {
      txHash: '0x222',
      type: 'spend',
      amount: 100000000000000n,
      spender: TEST_ADDRESS,
      description: 'Inference cost for execution exec-123',
      timestamp: Date.now(),
    }

    expect(deposit.type).toBe('deposit')
    expect(spend.type).toBe('spend')
    expect(spend.spender).toBeDefined()
  })
})

describe('Search Types', () => {
  it('AgentSearchFilter supports pagination', () => {
    const filter: AgentSearchFilter = {
      name: 'Jimmy',
      owner: TEST_ADDRESS,
      active: true,
      capabilities: ['project-management'],
      roomId: 1n,
      limit: 20,
      offset: 0,
    }

    expect(filter.limit).toBe(20)
    expect(filter.offset).toBe(0)
  })

  it('SearchResult is generic', () => {
    const result: SearchResult<{ id: string; name: string }> = {
      items: [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' },
      ],
      total: 100,
      hasMore: true,
    }

    expect(result.items.length).toBe(2)
    expect(result.hasMore).toBe(true)
    expect(result.total).toBeGreaterThan(result.items.length)
  })
})

describe('Config Types', () => {
  it('CrucibleConfig uses centralized config', () => {
    const config: CrucibleConfig = {
      rpcUrl: getL2RpcUrl(),
      contracts: {
        agentVault: TEST_ADDRESS,
        roomRegistry: TEST_ADDRESS,
        triggerRegistry: TEST_ADDRESS,
        identityRegistry: TEST_ADDRESS,
        serviceRegistry: TEST_ADDRESS,
      },
      services: {
        computeMarketplace: getCoreAppUrl('COMPUTE'),
        storageApi: getCoreAppUrl('IPFS'),
        ipfsGateway: getCoreAppUrl('IPFS'),
        indexerGraphql: getIndexerGraphqlUrl(),
      },
      network: 'localnet',
    }

    expect(config.network).toBe('localnet')
    expect(config.rpcUrl).toMatch(/localhost|127\.0\.0\.1/)
  })
})

describe('Team Types', () => {
  it('Team tracks members and type', () => {
    const team: Team = {
      teamId: 1n,
      name: 'Red Squad',
      objective: 'Find security vulnerabilities',
      members: [1n, 2n, 3n],
      vaultAddress: TEST_ADDRESS,
      teamType: 'red',
      leaderId: 1n,
      active: true,
    }

    expect(team.members.length).toBe(3)
    expect(team.teamType).toBe('red')
    expect(team.leaderId).toBe(1n)
  })
})

describe('Trading Bot Types', () => {
  it('TradingBotStrategy validates configuration', () => {
    const strategy: TradingBotStrategy = {
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 50,
      maxGasGwei: 100,
      maxSlippageBps: 100,
      cooldownMs: 1000,
    }

    expect(strategy.minProfitBps).toBeGreaterThan(0)
    expect(strategy.maxSlippageBps).toBeLessThanOrEqual(1000)
  })

  it('TradingBotChain has network config', () => {
    const chain: TradingBotChain = {
      chainId: 8453,
      name: 'Base',
      rpcUrl: 'https://mainnet.base.org',
      blockTime: 2,
      isL2: true,
      nativeSymbol: 'ETH',
      explorerUrl: 'https://basescan.org',
    }

    expect(chain.isL2).toBe(true)
    expect(chain.blockTime).toBeGreaterThan(0)
  })

  it('TradingBotState tracks metrics', () => {
    const metrics: TradingBotMetrics = {
      opportunitiesDetected: 100,
      opportunitiesExecuted: 80,
      opportunitiesFailed: 5,
      totalProfitWei: '1000000000000000000',
      totalProfitUsd: '2500.00',
      totalGasSpent: '500000000000000000',
      avgExecutionTimeMs: 150,
      uptime: 99.9,
      lastUpdate: Date.now(),
      byStrategy: {
        DEX_ARBITRAGE: {
          detected: 50,
          executed: 45,
          failed: 2,
          profitWei: '600000000000000000',
        },
      },
    }

    expect(metrics.opportunitiesExecuted).toBeLessThanOrEqual(
      metrics.opportunitiesDetected,
    )
    expect(metrics.uptime).toBeGreaterThan(0)
  })

  it('TradingBotOpportunity tracks status', () => {
    const opportunity: TradingBotOpportunity = {
      id: 'opp-1',
      type: 'DEX_ARBITRAGE',
      chainId: 8453,
      expectedProfit: '10000000000000000',
      detectedAt: Date.now(),
      status: 'DETECTED',
    }

    expect(['DETECTED', 'EXECUTING', 'COMPLETED', 'FAILED']).toContain(
      opportunity.status,
    )
  })

  it('TradingBotConfig combines strategies and chains', () => {
    const config: TradingBotConfig = {
      strategies: [
        {
          type: 'DEX_ARBITRAGE',
          enabled: true,
          minProfitBps: 50,
          maxGasGwei: 100,
          maxSlippageBps: 100,
        },
      ],
      chains: [
        {
          chainId: 8453,
          name: 'Base',
          rpcUrl: 'https://mainnet.base.org',
          blockTime: 2,
          isL2: true,
          nativeSymbol: 'ETH',
        },
      ],
      treasuryAddress: TEST_ADDRESS,
      maxConcurrentExecutions: 3,
      useFlashbots: true,
    }

    expect(config.strategies.length).toBeGreaterThan(0)
    expect(config.chains.length).toBeGreaterThan(0)
    expect(config.maxConcurrentExecutions).toBeGreaterThan(0)
  })
})
