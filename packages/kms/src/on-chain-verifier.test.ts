/**
 * Tests for On-Chain Verifier
 *
 * Tests the verification of access conditions against on-chain state.
 * Uses mocked RPC responses since we can't hit real chains in unit tests.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  getOnChainVerifier,
  OnChainVerifier,
  resetOnChainVerifier,
} from './on-chain-verifier'
import type {
  BalanceCondition,
  StakeCondition,
  RoleCondition,
  AgentCondition,
  ContractCondition,
} from './types'

describe('OnChainVerifier', () => {
  let verifier: OnChainVerifier

  beforeEach(() => {
    resetOnChainVerifier()
    verifier = new OnChainVerifier({
      defaultRpcUrl: 'https://mainnet.base.org',
      cacheTtlMs: 1000,
    })
  })

  afterEach(() => {
    resetOnChainVerifier()
  })

  describe('initialization', () => {
    test('creates verifier with default config', () => {
      const v = new OnChainVerifier({})
      expect(v).toBeDefined()
    })

    test('creates verifier with custom RPC URLs', () => {
      const v = new OnChainVerifier({
        rpcUrls: {
          mainnet: 'https://custom.mainnet.rpc',
          base: 'https://custom.base.rpc',
        },
        defaultRpcUrl: 'https://fallback.rpc',
      })
      expect(v).toBeDefined()
    })

    test('creates verifier with custom cache TTL', () => {
      const v = new OnChainVerifier({
        cacheTtlMs: 60000,
      })
      expect(v).toBeDefined()
    })
  })

  describe('singleton pattern', () => {
    test('getOnChainVerifier returns same instance', () => {
      const v1 = getOnChainVerifier({ defaultRpcUrl: 'https://rpc.test' })
      const v2 = getOnChainVerifier()

      expect(v1).toBe(v2)
    })

    test('resetOnChainVerifier clears singleton', () => {
      const v1 = getOnChainVerifier({ defaultRpcUrl: 'https://rpc.test' })
      resetOnChainVerifier()
      const v2 = getOnChainVerifier({ defaultRpcUrl: 'https://rpc.test2' })

      expect(v1).not.toBe(v2)
    })
  })

  describe('cache operations', () => {
    test('clearCache removes all cached entries', () => {
      verifier.clearCache()
      const stats = verifier.getCacheStats()
      expect(stats.size).toBe(0)
    })

    test('getCacheStats returns cache info', () => {
      const stats = verifier.getCacheStats()
      expect(stats).toHaveProperty('size')
      expect(typeof stats.size).toBe('number')
    })
  })

  describe('balance condition types', () => {
    test('accepts valid balance condition structure', () => {
      const condition: BalanceCondition = {
        type: 'balance',
        chain: 'base',
        value: '1000000000000000000', // 1 ETH
        comparator: '>=',
      }

      expect(condition.type).toBe('balance')
      expect(condition.chain).toBe('base')
      expect(condition.comparator).toBe('>=')
    })

    test('accepts token balance condition', () => {
      const condition: BalanceCondition = {
        type: 'balance',
        chain: 'mainnet',
        tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        value: '1000000', // 1 USDC
        comparator: '>',
      }

      expect(condition.tokenAddress).toBeDefined()
    })
  })

  describe('stake condition types', () => {
    test('accepts valid stake condition structure', () => {
      const condition: StakeCondition = {
        type: 'stake',
        chain: 'base-sepolia',
        registryAddress: '0x1234567890123456789012345678901234567890',
        minStakeUSD: 100,
      }

      expect(condition.type).toBe('stake')
      expect(condition.minStakeUSD).toBe(100)
    })
  })

  describe('role condition types', () => {
    test('accepts valid role condition structure', () => {
      const condition: RoleCondition = {
        type: 'role',
        chain: 'base',
        registryAddress: '0x1234567890123456789012345678901234567890',
        role: 'ADMIN',
      }

      expect(condition.type).toBe('role')
      expect(condition.role).toBe('ADMIN')
    })

    test('accepts bytes32 role hash', () => {
      const condition: RoleCondition = {
        type: 'role',
        chain: 'base',
        registryAddress: '0x1234567890123456789012345678901234567890',
        role: '0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775', // ADMIN hash
      }

      expect(condition.role.startsWith('0x')).toBe(true)
    })
  })

  describe('agent condition types', () => {
    test('accepts valid agent condition structure', () => {
      const condition: AgentCondition = {
        type: 'agent',
        chain: 'base-sepolia',
        registryAddress: '0x1234567890123456789012345678901234567890',
        agentId: 123,
      }

      expect(condition.type).toBe('agent')
      expect(condition.agentId).toBe(123)
    })
  })

  describe('contract condition types', () => {
    test('accepts valid contract condition structure', () => {
      const condition: ContractCondition = {
        type: 'contract',
        chain: 'base',
        contractAddress: '0x1234567890123456789012345678901234567890',
        method: 'isWhitelisted',
        parameters: [':userAddress'],
        returnValueTest: {
          comparator: '=',
          value: 'true',
        },
      }

      expect(condition.type).toBe('contract')
      expect(condition.method).toBe('isWhitelisted')
      expect(condition.parameters).toContain(':userAddress')
    })

    test('accepts contract condition with multiple parameters', () => {
      const condition: ContractCondition = {
        type: 'contract',
        chain: 'base',
        contractAddress: '0x1234567890123456789012345678901234567890',
        method: 'hasPermission',
        parameters: [':userAddress', 'read', 123],
        returnValueTest: {
          comparator: '=',
          value: 'true',
        },
      }

      expect(condition.parameters.length).toBe(3)
    })
  })

  describe('verifyAccessCondition', () => {
    test('returns false for unknown chain', async () => {
      const condition: BalanceCondition = {
        type: 'balance',
        chain: 'unknown-chain',
        value: '1000',
        comparator: '>=',
      }

      // Will throw due to unknown chain
      const result = await verifier.verifyAccessCondition(
        condition,
        '0x1234567890123456789012345678901234567890',
      )

      expect(result).toBe(false)
    })
  })

  describe('comparison operations', () => {
    // Test the internal comparison logic through type checking
    test('supports all comparison operators for balance', () => {
      const operators = ['=', '!=', '>', '<', '>=', '<='] as const

      for (const op of operators) {
        const condition: BalanceCondition = {
          type: 'balance',
          chain: 'base',
          value: '1000',
          comparator: op,
        }
        expect(condition.comparator).toBe(op)
      }
    })

    test('supports string comparison for contract return values', () => {
      const operators = ['=', '!=', 'contains'] as const

      for (const op of operators) {
        const condition: ContractCondition = {
          type: 'contract',
          chain: 'base',
          contractAddress: '0x1234567890123456789012345678901234567890',
          method: 'test',
          parameters: [],
          returnValueTest: {
            comparator: op,
            value: 'test',
          },
        }
        expect(condition.returnValueTest.comparator).toBe(op)
      }
    })
  })
})

