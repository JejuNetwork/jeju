import { describe, expect, it } from 'bun:test'
import {
  IntentStatusSchema,
  IntentInputSchema,
  IntentOutputSchema,
  FillInstructionSchema,
  IntentSchema,
  GaslessCrossChainOrderSchema,
  ResolvedCrossChainOrderSchema,
  SolverStatusSchema,
  SolverLiquiditySchema,
  SolverSchema,
  OracleTypeSchema,
  IntentRouteSchema,
  IntentQuoteSchema,
  SettlementStatusSchema,
  SettlementSchema,
  OracleAttestationSchema,
  OIFConfigSchema,
  OIFStatsSchema,
  SolverLeaderboardEntrySchema,
  OIFEventTypeSchema,
  OIFEventSchema,
  OIFSkillSchema,
  SkillInputParamSchema,
} from '../oif'

describe('OIF Types', () => {
  describe('IntentStatusSchema', () => {
    it('validates all intent statuses', () => {
      const statuses = ['open', 'pending', 'filled', 'expired', 'cancelled', 'failed']
      for (const status of statuses) {
        expect(IntentStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('IntentInputSchema', () => {
    it('validates intent input', () => {
      const input = {
        token: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        chainId: 1,
      }
      expect(() => IntentInputSchema.parse(input)).not.toThrow()
    })
  })

  describe('IntentOutputSchema', () => {
    it('validates intent output', () => {
      const output = {
        token: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        recipient: '0x2345678901234567890123456789012345678901',
        chainId: 10,
      }
      expect(() => IntentOutputSchema.parse(output)).not.toThrow()
    })
  })

  describe('FillInstructionSchema', () => {
    it('validates fill instruction', () => {
      const instruction = {
        destinationChainId: 10,
        destinationSettler: '0x1234567890123456789012345678901234567890',
        originData: '0xencoded...',
      }
      expect(() => FillInstructionSchema.parse(instruction)).not.toThrow()
    })
  })

  describe('IntentSchema', () => {
    it('validates complete intent', () => {
      const intent = {
        intentId: 'intent-123',
        user: '0x1234567890123456789012345678901234567890',
        nonce: '1',
        sourceChainId: 1,
        openDeadline: Date.now() + 3600000,
        fillDeadline: Date.now() + 86400000,
        inputs: [
          {
            token: '0x1234567890123456789012345678901234567890',
            amount: '1000000000000000000',
            chainId: 1,
          },
        ],
        outputs: [
          {
            token: '0x2345678901234567890123456789012345678901',
            amount: '950000000000000000',
            recipient: '0x3456789012345678901234567890123456789012',
            chainId: 10,
          },
        ],
        signature: '0xsig...',
        status: 'open',
        createdAt: Date.now(),
      }
      expect(() => IntentSchema.parse(intent)).not.toThrow()
    })

    it('validates filled intent', () => {
      const intent = {
        intentId: 'intent-456',
        user: '0x1234567890123456789012345678901234567890',
        nonce: '2',
        sourceChainId: 1,
        openDeadline: Date.now(),
        fillDeadline: Date.now() + 3600000,
        inputs: [],
        outputs: [],
        signature: '0x...',
        status: 'filled',
        createdAt: Date.now() - 60000,
        filledAt: Date.now(),
        solver: '0x4567890123456789012345678901234567890123',
        txHash: '0xtx...',
        fee: '50000000000000000',
        executionTimeMs: 5000,
      }
      expect(() => IntentSchema.parse(intent)).not.toThrow()
    })
  })

  describe('GaslessCrossChainOrderSchema', () => {
    it('validates gasless cross-chain order', () => {
      const order = {
        originSettler: '0x1234567890123456789012345678901234567890',
        user: '0x2345678901234567890123456789012345678901',
        nonce: '1',
        originChainId: 1,
        openDeadline: Date.now() + 3600000,
        fillDeadline: Date.now() + 86400000,
        orderDataType: '0x1234567890123456789012345678901234567890123456789012345678901234',
        orderData: '0xencoded...',
      }
      expect(() => GaslessCrossChainOrderSchema.parse(order)).not.toThrow()
    })
  })

  describe('SolverStatusSchema', () => {
    it('validates all solver statuses', () => {
      const statuses = ['active', 'paused', 'slashed', 'inactive']
      for (const status of statuses) {
        expect(SolverStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('SolverSchema', () => {
    it('validates solver', () => {
      const solver = {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Top Solver',
        endpoint: 'https://solver.example.com/api',
        supportedChains: [1, 10, 42161],
        supportedTokens: {
          '1': [
            '0x1234567890123456789012345678901234567890',
            '0x2345678901234567890123456789012345678901',
          ],
        },
        liquidity: [
          {
            chainId: 1,
            token: '0x1234567890123456789012345678901234567890',
            amount: '1000000000000000000000',
            lastUpdated: Date.now(),
          },
        ],
        reputation: 95,
        totalFills: 10000,
        successfulFills: 9950,
        failedFills: 50,
        successRate: 99.5,
        avgResponseMs: 500,
        avgFillTimeMs: 30000,
        totalVolumeUsd: '50000000',
        totalFeesEarnedUsd: '250000',
        status: 'active',
        stakedAmount: '100000000000000000000000',
        registeredAt: Date.now() - 86400000 * 365,
        lastActiveAt: Date.now(),
      }
      expect(() => SolverSchema.parse(solver)).not.toThrow()
    })
  })

  describe('OracleTypeSchema', () => {
    it('validates all oracle types', () => {
      const types = ['hyperlane', 'optimism-native', 'superchain', 'layerzero', 'custom']
      for (const type of types) {
        expect(OracleTypeSchema.parse(type)).toBe(type)
      }
    })
  })

  describe('IntentRouteSchema', () => {
    it('validates intent route', () => {
      const route = {
        routeId: 'route-1-10-eth-usdc',
        sourceChainId: 1,
        destinationChainId: 10,
        sourceToken: '0x1234567890123456789012345678901234567890',
        destinationToken: '0x2345678901234567890123456789012345678901',
        inputSettler: '0x3456789012345678901234567890123456789012',
        outputSettler: '0x4567890123456789012345678901234567890123',
        oracle: 'hyperlane',
        isActive: true,
        totalVolume: '1000000000000000000000000',
        totalIntents: 50000,
        avgFeePercent: 25,
        avgFillTimeSeconds: 120,
        successRate: 99.8,
        activeSolvers: 15,
        totalLiquidity: '10000000000000000000000000',
        lastUpdated: Date.now(),
      }
      expect(() => IntentRouteSchema.parse(route)).not.toThrow()
    })
  })

  describe('IntentQuoteSchema', () => {
    it('validates intent quote', () => {
      const quote = {
        quoteId: 'quote-123',
        intentId: 'intent-456',
        sourceChainId: 1,
        destinationChainId: 10,
        sourceToken: '0x1234567890123456789012345678901234567890',
        destinationToken: '0x2345678901234567890123456789012345678901',
        inputAmount: '1000000000000000000',
        outputAmount: '970000000000000000',
        fee: '30000000000000000',
        feePercent: 300,
        priceImpact: 50,
        estimatedFillTimeSeconds: 60,
        validUntil: Date.now() + 60000,
        solver: '0x3456789012345678901234567890123456789012',
        solverReputation: 95,
      }
      expect(() => IntentQuoteSchema.parse(quote)).not.toThrow()
    })
  })

  describe('SettlementStatusSchema', () => {
    it('validates all settlement statuses', () => {
      const statuses = ['pending', 'attested', 'settled', 'disputed', 'slashed']
      for (const status of statuses) {
        expect(SettlementStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('SettlementSchema', () => {
    it('validates settlement', () => {
      const settlement = {
        settlementId: 'settlement-123',
        intentId: 'intent-456',
        solver: '0x1234567890123456789012345678901234567890',
        sourceChainId: 1,
        destinationChainId: 10,
        inputToken: '0x2345678901234567890123456789012345678901',
        outputToken: '0x3456789012345678901234567890123456789012',
        inputAmount: '1000000000000000000',
        outputAmount: '970000000000000000',
        fee: '30000000000000000',
        status: 'settled',
        inputSettlerTx: '0xtx1...',
        outputSettlerTx: '0xtx2...',
        attestationTx: '0xtx3...',
        claimTx: '0xtx4...',
        createdAt: Date.now() - 120000,
        attestedAt: Date.now() - 60000,
        settledAt: Date.now(),
      }
      expect(() => SettlementSchema.parse(settlement)).not.toThrow()
    })
  })

  describe('OracleAttestationSchema', () => {
    it('validates oracle attestation', () => {
      const attestation = {
        attestationId: 'attest-123',
        intentId: 'intent-456',
        orderId: 'order-789',
        oracleType: 'hyperlane',
        sourceChainId: 1,
        destinationChainId: 10,
        proof: '0xproof...',
        proofBlockNumber: 12345678,
        proofTimestamp: Date.now(),
        verified: true,
        verifiedAt: Date.now(),
        verificationTx: '0xtx...',
      }
      expect(() => OracleAttestationSchema.parse(attestation)).not.toThrow()
    })
  })

  describe('OIFConfigSchema', () => {
    it('validates OIF config', () => {
      const config = {
        inputSettlers: {
          '1': '0x1234567890123456789012345678901234567890',
          '10': '0x2345678901234567890123456789012345678901',
        },
        outputSettlers: {
          '1': '0x3456789012345678901234567890123456789012',
          '10': '0x4567890123456789012345678901234567890123',
        },
        solverRegistry: '0x5678901234567890123456789012345678901234',
        oracles: {
          hyperlane: {
            type: 'hyperlane',
            address: '0x6789012345678901234567890123456789012345',
            config: { mailbox: '0x7890123456789012345678901234567890123456' },
          },
        },
        minFee: '10000000000000',
        maxFee: '1000000000000000000',
        protocolFeePercent: 10,
        defaultOpenDeadline: 3600,
        defaultFillDeadline: 86400,
        claimDelay: 600,
        minSolverStake: '10000000000000000000000',
        slashingPercent: 10,
      }
      expect(() => OIFConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('OIFStatsSchema', () => {
    it('validates OIF stats', () => {
      const stats = {
        totalIntents: 100000,
        totalVolume: '1000000000000000000000000000',
        totalVolumeUsd: '1000000000',
        totalFees: '10000000000000000000000',
        totalFeesUsd: '10000000',
        totalSolvers: 50,
        activeSolvers: 35,
        totalSolverStake: '500000000000000000000000000',
        totalRoutes: 100,
        activeRoutes: 80,
        avgFillTimeSeconds: 90,
        successRate: 99.5,
        last24hIntents: 5000,
        last24hVolume: '50000000000000000000000000',
        last24hFees: '500000000000000000000',
        lastUpdated: Date.now(),
      }
      expect(() => OIFStatsSchema.parse(stats)).not.toThrow()
    })
  })

  describe('SolverLeaderboardEntrySchema', () => {
    it('validates solver leaderboard entry', () => {
      const entry = {
        rank: 1,
        solver: '0x1234567890123456789012345678901234567890',
        name: 'Top Solver',
        totalVolume: '100000000000000000000000000',
        totalFills: 25000,
        successRate: 99.9,
        avgFillTimeMs: 25000,
        reputation: 98,
        totalFeesEarned: '1000000000000000000000',
      }
      expect(() => SolverLeaderboardEntrySchema.parse(entry)).not.toThrow()
    })
  })

  describe('OIFEventTypeSchema', () => {
    it('validates all OIF event types', () => {
      const eventTypes = [
        'IntentCreated',
        'IntentClaimed',
        'IntentFilled',
        'IntentExpired',
        'IntentCancelled',
        'OrderOpened',
        'OrderFilled',
        'OrderRefunded',
        'FundsSettled',
        'SolverRegistered',
        'SolverStakeDeposited',
        'SolverSlashed',
        'SolverWithdrawn',
        'AttestationReceived',
        'AttestationVerified',
      ]
      for (const eventType of eventTypes) {
        expect(OIFEventTypeSchema.parse(eventType)).toBe(eventType)
      }
    })
  })

  describe('OIFSkillSchema', () => {
    it('validates OIF skill', () => {
      const skill = {
        id: 'skill-swap',
        name: 'Token Swap',
        description: 'Swap tokens across chains',
        tags: ['defi', 'swap', 'cross-chain'],
        inputs: {
          sourceToken: { type: 'address', required: true, description: 'Source token address' },
          amount: { type: 'uint256', required: true, description: 'Amount to swap' },
          destinationChain: { type: 'uint256', required: true },
        },
        outputs: {
          txHash: 'Transaction hash',
          receivedAmount: 'Amount received',
        },
      }
      expect(() => OIFSkillSchema.parse(skill)).not.toThrow()
    })
  })

  describe('SkillInputParamSchema', () => {
    it('validates skill input param with default', () => {
      const param = {
        type: 'string',
        required: false,
        default: 'ETH',
        description: 'Token symbol',
      }
      expect(() => SkillInputParamSchema.parse(param)).not.toThrow()
    })

    it('validates param with array default', () => {
      const param = {
        type: 'string[]',
        required: false,
        default: ['ETH', 'USDC'],
      }
      expect(() => SkillInputParamSchema.parse(param)).not.toThrow()
    })
  })
})

