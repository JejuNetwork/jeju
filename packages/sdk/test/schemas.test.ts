/**
 * Schema Validation Unit Tests
 *
 * Tests Zod schemas used for API response validation:
 * - Valid data passes
 * - Invalid data fails with appropriate errors
 * - Edge cases handled correctly
 * - Type transformations work
 */

import { describe, expect, test } from 'bun:test'
import {
  A2AResponseSchema,
  AddressSchema,
  AgentCardSchema,
  AgentSkillSchema,
  BigIntStringSchema,
  ContentInfoSchema,
  IntentStatusSchema,
  JobSchema,
  NameInfoSchema,
  NameRecordsSchema,
  PinInfoSchema,
  PoolInfoResponseSchema,
  ProposalInfoSchema,
  StorageStatsSchema,
  SwapQuoteResponseSchema,
  TokenSchema,
  TriggerSchema,
  TxHashSchema,
  WorkflowSchema,
} from '../src/shared/schemas'

describe('Schema Validation', () => {
  describe('AddressSchema', () => {
    test('accepts valid checksummed address', () => {
      const result = AddressSchema.safeParse(
        '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      )
      expect(result.success).toBe(true)
    })

    test('accepts valid lowercase address', () => {
      const result = AddressSchema.safeParse(
        '0x742d35cc6634c0532925a3b844bc454e4438f44e',
      )
      expect(result.success).toBe(true)
    })

    test('accepts zero address', () => {
      const result = AddressSchema.safeParse(
        '0x0000000000000000000000000000000000000000',
      )
      expect(result.success).toBe(true)
    })

    test('rejects address without 0x prefix', () => {
      const result = AddressSchema.safeParse(
        '742d35Cc6634C0532925a3b844Bc454e4438f44e',
      )
      expect(result.success).toBe(false)
    })

    test('rejects short address', () => {
      const result = AddressSchema.safeParse('0x742d35Cc6634C0532925a3b844Bc')
      expect(result.success).toBe(false)
    })

    test('rejects long address', () => {
      const result = AddressSchema.safeParse(
        '0x742d35Cc6634C0532925a3b844Bc454e4438f44e00',
      )
      expect(result.success).toBe(false)
    })

    test('rejects non-hex characters', () => {
      const result = AddressSchema.safeParse(
        '0x742d35Cc6634C0532925a3b844Bc454e4438fXYZ',
      )
      expect(result.success).toBe(false)
    })

    test('rejects empty string', () => {
      const result = AddressSchema.safeParse('')
      expect(result.success).toBe(false)
    })

    test('rejects null/undefined', () => {
      expect(AddressSchema.safeParse(null).success).toBe(false)
      expect(AddressSchema.safeParse(undefined).success).toBe(false)
    })
  })

  describe('TxHashSchema', () => {
    test('accepts valid tx hash', () => {
      const result = TxHashSchema.safeParse(`0x${'a'.repeat(64)}`)
      expect(result.success).toBe(true)
    })

    test('accepts mixed case hex', () => {
      const result = TxHashSchema.safeParse(`0xaAbBcCdDeEfF${'1'.repeat(52)}`)
      expect(result.success).toBe(true)
    })

    test('rejects short hash', () => {
      const result = TxHashSchema.safeParse(`0x${'a'.repeat(63)}`)
      expect(result.success).toBe(false)
    })

    test('rejects long hash', () => {
      const result = TxHashSchema.safeParse(`0x${'a'.repeat(65)}`)
      expect(result.success).toBe(false)
    })
  })

  describe('BigIntStringSchema', () => {
    test('transforms string to bigint', () => {
      const result = BigIntStringSchema.parse('1000000000000000000')
      expect(result).toBe(1000000000000000000n)
    })

    test('handles zero', () => {
      const result = BigIntStringSchema.parse('0')
      expect(result).toBe(0n)
    })

    test('handles very large numbers', () => {
      const largeNum = `1${'0'.repeat(50)}`
      const result = BigIntStringSchema.parse(largeNum)
      expect(result).toBe(BigInt(largeNum))
    })

    test('handles negative numbers', () => {
      const result = BigIntStringSchema.parse('-12345')
      expect(result).toBe(-12345n)
    })

    test('throws on non-numeric string', () => {
      // BigInt() throws SyntaxError, which propagates through the schema
      expect(() => BigIntStringSchema.parse('not a number')).toThrow()
    })

    test('throws on float string', () => {
      // BigInt() throws SyntaxError for floats
      expect(() => BigIntStringSchema.parse('1.5')).toThrow()
    })
  })

  describe('SwapQuoteResponseSchema', () => {
    test('accepts valid swap quote', () => {
      const result = SwapQuoteResponseSchema.safeParse({
        amountOut: '1000000000000000000',
        priceImpact: 0.005,
        route: [
          '0x0000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000002',
        ],
        fee: '3000000000000000',
      })
      expect(result.success).toBe(true)
    })

    test('rejects missing fields', () => {
      const result = SwapQuoteResponseSchema.safeParse({
        amountOut: '1000000000000000000',
      })
      expect(result.success).toBe(false)
    })

    test('rejects invalid address in route', () => {
      const result = SwapQuoteResponseSchema.safeParse({
        amountOut: '1000000000000000000',
        priceImpact: 0.005,
        route: ['invalid-address'],
        fee: '3000000000000000',
      })
      expect(result.success).toBe(false)
    })

    test('rejects non-numeric priceImpact', () => {
      const result = SwapQuoteResponseSchema.safeParse({
        amountOut: '1000000000000000000',
        priceImpact: 'high',
        route: [],
        fee: '0',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('TokenSchema', () => {
    test('accepts valid token', () => {
      const result = TokenSchema.safeParse({
        address: '0x0000000000000000000000000000000000000001',
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
      })
      expect(result.success).toBe(true)
    })

    test('accepts 6 decimal token', () => {
      const result = TokenSchema.safeParse({
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      })
      expect(result.success).toBe(true)
    })

    test('rejects invalid decimals type', () => {
      const result = TokenSchema.safeParse({
        address: '0x0000000000000000000000000000000000000001',
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: '18', // Should be number
      })
      expect(result.success).toBe(false)
    })
  })

  describe('PoolInfoResponseSchema', () => {
    test('accepts valid pool list', () => {
      const result = PoolInfoResponseSchema.safeParse({
        pools: [
          {
            poolId: `0x${'a'.repeat(64)}`,
            token0: {
              address: '0x0000000000000000000000000000000000000001',
              symbol: 'WETH',
              name: 'Wrapped Ether',
              decimals: 18,
            },
            token1: {
              address: '0x0000000000000000000000000000000000000002',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
            },
            fee: 3000,
            liquidity: '1000000000000000000',
            sqrtPriceX96: '79228162514264337593543950336',
            tick: 0,
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('accepts empty pool list', () => {
      const result = PoolInfoResponseSchema.safeParse({ pools: [] })
      expect(result.success).toBe(true)
    })
  })

  describe('StorageStatsSchema', () => {
    test('accepts valid stats', () => {
      const result = StorageStatsSchema.safeParse({
        totalPins: 100,
        totalSizeBytes: 1073741824,
        totalSizeGB: 1.0,
      })
      expect(result.success).toBe(true)
    })

    test('accepts zero stats', () => {
      const result = StorageStatsSchema.safeParse({
        totalPins: 0,
        totalSizeBytes: 0,
        totalSizeGB: 0,
      })
      expect(result.success).toBe(true)
    })

    test('accepts negative values (schema allows any number)', () => {
      // Current schema uses z.number() which allows negatives - tests actual behavior
      const result = StorageStatsSchema.safeParse({
        totalPins: -1,
        totalSizeBytes: -1000,
        totalSizeGB: -0.001,
      })
      expect(result.success).toBe(true)
    })

    test('rejects non-numeric values', () => {
      const result = StorageStatsSchema.safeParse({
        totalPins: '100',
        totalSizeBytes: 1000,
        totalSizeGB: 0.001,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('PinInfoSchema', () => {
    test('accepts valid pin info', () => {
      const result = PinInfoSchema.safeParse({
        cid: 'QmTest123456789abcdefghijklmnopqrstuvwxyz',
        name: 'test-file.txt',
        status: 'pinned',
        sizeBytes: 1024,
        createdAt: Date.now(),
        tier: 'hot',
      })
      expect(result.success).toBe(true)
    })

    test('accepts all status values', () => {
      const statuses = ['queued', 'pinning', 'pinned', 'failed'] as const
      for (const status of statuses) {
        const result = PinInfoSchema.safeParse({
          cid: 'QmTest',
          name: 'test',
          status,
          sizeBytes: 0,
          createdAt: 0,
          tier: 'hot',
        })
        expect(result.success).toBe(true)
      }
    })

    test('accepts all tier values', () => {
      const tiers = ['hot', 'warm', 'cold', 'permanent'] as const
      for (const tier of tiers) {
        const result = PinInfoSchema.safeParse({
          cid: 'QmTest',
          name: 'test',
          status: 'pinned',
          sizeBytes: 0,
          createdAt: 0,
          tier,
        })
        expect(result.success).toBe(true)
      }
    })

    test('rejects invalid status', () => {
      const result = PinInfoSchema.safeParse({
        cid: 'QmTest',
        name: 'test',
        status: 'unknown',
        sizeBytes: 0,
        createdAt: 0,
        tier: 'hot',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('ContentInfoSchema', () => {
    test('accepts valid content info', () => {
      const result = ContentInfoSchema.safeParse({
        cid: 'QmTest123',
        name: 'test.jpg',
        size: 1048576,
        tier: 'popular',
        category: 'media',
        backends: ['ipfs', 'arweave'],
        createdAt: Date.now(),
        accessCount: 100,
      })
      expect(result.success).toBe(true)
    })

    test('accepts optional fields', () => {
      const result = ContentInfoSchema.safeParse({
        cid: 'QmTest123',
        size: 1024,
        tier: 'system',
        category: 'app-bundle',
        backends: ['local'],
        createdAt: Date.now(),
        accessCount: 0,
        magnetUri: 'magnet:?xt=...',
        arweaveTxId: 'abc123',
        encrypted: true,
      })
      expect(result.success).toBe(true)
    })

    test('accepts all category values', () => {
      const categories = [
        'app-bundle',
        'contract-abi',
        'user-content',
        'media',
        'data',
      ] as const
      for (const category of categories) {
        const result = ContentInfoSchema.safeParse({
          cid: 'Qm',
          size: 0,
          tier: 'system',
          category,
          backends: [],
          createdAt: 0,
          accessCount: 0,
        })
        expect(result.success).toBe(true)
      }
    })
  })

  describe('AgentSkillSchema', () => {
    test('accepts valid skill', () => {
      const result = AgentSkillSchema.safeParse({
        id: 'code-review',
        name: 'Code Review',
        description: 'Reviews code for bugs and style',
        tags: ['code', 'review', 'security'],
      })
      expect(result.success).toBe(true)
    })

    test('accepts skill with input schema', () => {
      const result = AgentSkillSchema.safeParse({
        id: 'translate',
        name: 'Translate',
        description: 'Translates text',
        tags: ['translation'],
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to translate' },
            targetLang: { type: 'string', description: 'Target language' },
          },
          required: ['text', 'targetLang'],
        },
      })
      expect(result.success).toBe(true)
    })

    test('accepts skill with outputs', () => {
      const result = AgentSkillSchema.safeParse({
        id: 'analyze',
        name: 'Analyze',
        description: 'Analyzes data',
        tags: [],
        outputs: {
          result: 'Analysis results',
          confidence: 'Confidence score',
        },
      })
      expect(result.success).toBe(true)
    })
  })

  describe('AgentCardSchema', () => {
    test('accepts valid agent card', () => {
      const result = AgentCardSchema.safeParse({
        protocolVersion: '1.0',
        name: 'Test Agent',
        description: 'A test agent',
        url: 'https://agent.example.com',
        provider: {
          organization: 'Test Org',
          url: 'https://example.com',
        },
        version: '0.1.0',
        capabilities: {
          streaming: true,
          pushNotifications: false,
          stateTransitionHistory: true,
        },
        skills: [
          {
            id: 'test',
            name: 'Test Skill',
            description: 'A test skill',
            tags: [],
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('accepts agent with no skills', () => {
      const result = AgentCardSchema.safeParse({
        protocolVersion: '1.0',
        name: 'Empty Agent',
        description: 'An agent with no skills',
        url: 'https://agent.example.com',
        provider: {
          organization: 'Test',
          url: 'https://test.com',
        },
        version: '0.0.1',
        capabilities: {
          streaming: false,
          pushNotifications: false,
          stateTransitionHistory: false,
        },
        skills: [],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('A2AResponseSchema', () => {
    test('accepts successful response', () => {
      const result = A2AResponseSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          parts: [
            { kind: 'text', text: 'Hello, world!' },
            { kind: 'data', data: { key: 'value' } },
          ],
        },
      })
      expect(result.success).toBe(true)
    })

    test('accepts error response', () => {
      const result = A2AResponseSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      })
      expect(result.success).toBe(true)
    })

    test('accepts error with data', () => {
      const result = A2AResponseSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'Server error',
          data: { details: 'More information' },
        },
      })
      expect(result.success).toBe(true)
    })
  })

  describe('IntentStatusSchema', () => {
    test('accepts all status values', () => {
      const statuses = [
        'open',
        'pending',
        'filled',
        'expired',
        'cancelled',
        'failed',
      ] as const
      for (const status of statuses) {
        const result = IntentStatusSchema.safeParse({
          intentId: `0x${'a'.repeat(64)}`,
          status,
          createdAt: Date.now(),
        })
        expect(result.success).toBe(true)
      }
    })

    test('accepts filled intent with solver', () => {
      const result = IntentStatusSchema.safeParse({
        intentId: `0x${'b'.repeat(64)}`,
        status: 'filled',
        solver: `0x${'1'.repeat(40)}`,
        fillTxHash: `0x${'c'.repeat(64)}`,
        createdAt: 1000000,
        filledAt: 1000100,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('ProposalInfoSchema', () => {
    test('accepts valid proposal', () => {
      const result = ProposalInfoSchema.safeParse({
        proposalId: `0x${'a'.repeat(64)}`,
        proposer: `0x${'1'.repeat(40)}`,
        proposerAgentId: '1',
        type: 0,
        status: 1,
        qualityScore: 85,
        createdAt: Date.now(),
        boardVoteEnd: Date.now() + 86400000,
        gracePeriodEnd: Date.now() + 172800000,
        contentHash: 'ipfs://Qm...',
        targetContract: `0x${'2'.repeat(40)}`,
        callData: `0x${'d'.repeat(64)}`,
        value: '0',
        totalStaked: '1000000000000000000',
        backerCount: 5,
        hasResearch: true,
        directorApproved: false,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('NameInfoSchema', () => {
    test('accepts valid name info', () => {
      const result = NameInfoSchema.safeParse({
        name: 'alice.jeju',
        owner: `0x${'1'.repeat(40)}`,
        resolver: `0x${'2'.repeat(40)}`,
        expiresAt: Date.now() + 31536000000,
        registeredAt: Date.now() - 86400000,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('NameRecordsSchema', () => {
    test('accepts empty records', () => {
      const result = NameRecordsSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    test('accepts full records', () => {
      const result = NameRecordsSchema.safeParse({
        address: `0x${'1'.repeat(40)}`,
        contentHash: 'ipfs://Qm...',
        text: {
          'com.twitter': '@alice',
          'com.github': 'alice',
        },
        a2aEndpoint: 'https://agent.alice.com',
        mcpEndpoint: 'https://mcp.alice.com',
        avatar: 'ipfs://Qm.../avatar.png',
        url: 'https://alice.com',
        description: "Alice's profile",
      })
      expect(result.success).toBe(true)
    })
  })

  describe('TriggerSchema', () => {
    test('accepts cron trigger', () => {
      const result = TriggerSchema.safeParse({
        triggerId: 'trigger-001',
        type: 'cron',
        name: 'Daily Job',
        config: {
          cronExpression: '0 0 * * *',
          timezone: 'UTC',
        },
        workflowId: 'workflow-001',
        owner: `0x${'1'.repeat(40)}`,
        isActive: true,
        createdAt: Date.now(),
        lastTriggeredAt: Date.now() - 86400000,
        triggerCount: 100,
      })
      expect(result.success).toBe(true)
    })

    test('accepts webhook trigger', () => {
      const result = TriggerSchema.safeParse({
        triggerId: 'trigger-002',
        type: 'webhook',
        name: 'Webhook Handler',
        config: {
          webhookSecret: 'secret123',
          allowedOrigins: ['https://example.com'],
        },
        workflowId: 'workflow-002',
        owner: `0x${'1'.repeat(40)}`,
        isActive: true,
        createdAt: Date.now(),
        lastTriggeredAt: 0,
        triggerCount: 0,
      })
      expect(result.success).toBe(true)
    })

    test('accepts chain_event trigger', () => {
      const result = TriggerSchema.safeParse({
        triggerId: 'trigger-003',
        type: 'chain_event',
        name: 'Transfer Watcher',
        config: {
          contractAddress: `0x${'1'.repeat(40)}`,
          eventSignature: 'Transfer(address,address,uint256)',
          chainId: 1,
        },
        workflowId: 'workflow-003',
        owner: `0x${'1'.repeat(40)}`,
        isActive: true,
        createdAt: Date.now(),
        lastTriggeredAt: 0,
        triggerCount: 0,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('WorkflowSchema', () => {
    test('accepts valid workflow', () => {
      const result = WorkflowSchema.safeParse({
        workflowId: 'wf-001',
        name: 'Data Pipeline',
        description: 'Fetches and processes data',
        owner: `0x${'1'.repeat(40)}`,
        status: 'active',
        steps: [
          {
            stepId: 'step-1',
            name: 'Fetch Data',
            type: 'http',
            config: { url: 'https://api.example.com' },
            dependencies: [],
            timeout: 30000,
            retries: 3,
          },
          {
            stepId: 'step-2',
            name: 'Process',
            type: 'compute',
            config: { script: 'process.js' },
            dependencies: ['step-1'],
            timeout: 60000,
            retries: 1,
          },
        ],
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
        totalExecutions: 500,
        successfulExecutions: 495,
      })
      expect(result.success).toBe(true)
    })

    test('accepts all status values', () => {
      const statuses = ['active', 'paused', 'disabled'] as const
      for (const status of statuses) {
        const result = WorkflowSchema.safeParse({
          workflowId: 'wf',
          name: 'Test',
          description: 'Test',
          owner: `0x${'1'.repeat(40)}`,
          status,
          steps: [],
          createdAt: 0,
          updatedAt: 0,
          totalExecutions: 0,
          successfulExecutions: 0,
        })
        expect(result.success).toBe(true)
      }
    })
  })

  describe('JobSchema', () => {
    test('accepts completed job', () => {
      const result = JobSchema.safeParse({
        jobId: 'job-001',
        workflowId: 'wf-001',
        triggerId: 'trigger-001',
        status: 'completed',
        startedAt: Date.now() - 10000,
        completedAt: Date.now(),
        duration: 10000,
        input: { data: [1, 2, 3] },
        output: { result: 'success' },
        error: null,
        logs: ['Starting job...', 'Processing...', 'Done.'],
        stepResults: [
          {
            stepId: 'step-1',
            status: 'completed',
            startedAt: Date.now() - 10000,
            completedAt: Date.now() - 5000,
            output: { fetched: true },
            error: null,
          },
          {
            stepId: 'step-2',
            status: 'completed',
            startedAt: Date.now() - 5000,
            completedAt: Date.now(),
            output: { processed: true },
            error: null,
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('accepts failed job with error', () => {
      const result = JobSchema.safeParse({
        jobId: 'job-002',
        workflowId: 'wf-001',
        triggerId: 'trigger-001',
        status: 'failed',
        startedAt: Date.now() - 5000,
        completedAt: Date.now(),
        duration: 5000,
        input: {},
        output: {},
        error: 'Connection timeout',
        logs: ['Starting...', 'Error: Connection timeout'],
        stepResults: [
          {
            stepId: 'step-1',
            status: 'failed',
            startedAt: Date.now() - 5000,
            completedAt: Date.now(),
            output: {},
            error: 'Connection timeout',
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('accepts all job status values', () => {
      const statuses = [
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ] as const
      for (const status of statuses) {
        const result = JobSchema.safeParse({
          jobId: 'job',
          workflowId: 'wf',
          triggerId: 'trigger',
          status,
          startedAt: 0,
          completedAt: 0,
          duration: 0,
          input: {},
          output: {},
          error: null,
          logs: [],
          stepResults: [],
        })
        expect(result.success).toBe(true)
      }
    })
  })

  describe('Edge Cases', () => {
    test('handles deeply nested JSON in A2A response', () => {
      const result = A2AResponseSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          parts: [
            {
              kind: 'data',
              data: {
                level1: {
                  level2: {
                    level3: {
                      array: [1, 2, { nested: true }],
                    },
                  },
                },
              },
            },
          ],
        },
      })
      expect(result.success).toBe(true)
    })

    test('handles unicode in text fields', () => {
      const result = AgentSkillSchema.safeParse({
        id: 'translate-中文',
        name: '翻译 🌍',
        description: 'Übersetzung von Texten 日本語 → English',
        tags: ['翻译', 'übersetzung', '翻訳'],
      })
      expect(result.success).toBe(true)
    })

    test('handles very long strings', () => {
      const longString = 'a'.repeat(10000)
      const result = AgentSkillSchema.safeParse({
        id: 'long',
        name: 'Long',
        description: longString,
        tags: [],
      })
      expect(result.success).toBe(true)
    })

    test('handles many tags', () => {
      const manyTags = Array(1000)
        .fill(0)
        .map((_, i) => `tag-${i}`)
      const result = AgentSkillSchema.safeParse({
        id: 'many-tags',
        name: 'Many Tags',
        description: 'Has many tags',
        tags: manyTags,
      })
      expect(result.success).toBe(true)
    })
  })
})
