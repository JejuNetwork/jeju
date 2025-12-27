import { describe, expect, test } from 'bun:test'
import {
  validateDatabaseServiceConfig,
  validateDatabaseServiceState,
  validateDatabaseStats,
} from './database'

describe('DatabaseService', () => {
  describe('validateDatabaseServiceConfig', () => {
    test('validates valid config', () => {
      const config = {
        blockProducerEndpoint: 'https://cql.example.com',
        minerEndpoint: 'http://localhost:4661',
        privateKey:
          '0x1234567890123456789012345678901234567890123456789012345678901234',
        capacityGB: 100,
        pricePerGBMonth: 1000000000000000n,
        stakeAmount: 100000000000000000n,
        hostedDatabases: ['db1', 'db2'],
        enableBackups: true,
        backupRetentionDays: 30,
        maxConcurrentQueries: 100,
        queryTimeoutMs: 30000,
      }

      const result = validateDatabaseServiceConfig(config)
      expect(result.blockProducerEndpoint).toBe('https://cql.example.com')
      expect(result.capacityGB).toBe(100)
      expect(result.enableBackups).toBe(true)
    })

    test('rejects invalid endpoint', () => {
      const config = {
        blockProducerEndpoint: 'not-a-url',
        minerEndpoint: 'http://localhost:4661',
        privateKey:
          '0x1234567890123456789012345678901234567890123456789012345678901234',
        capacityGB: 100,
        pricePerGBMonth: 1000000000000000n,
        stakeAmount: 100000000000000000n,
      }

      expect(() => validateDatabaseServiceConfig(config)).toThrow()
    })

    test('rejects invalid private key format', () => {
      const config = {
        blockProducerEndpoint: 'https://cql.example.com',
        minerEndpoint: 'http://localhost:4661',
        privateKey: 'invalid-key',
        capacityGB: 100,
        pricePerGBMonth: 1000000000000000n,
        stakeAmount: 100000000000000000n,
      }

      expect(() => validateDatabaseServiceConfig(config)).toThrow()
    })

    test('rejects negative capacity', () => {
      const config = {
        blockProducerEndpoint: 'https://cql.example.com',
        minerEndpoint: 'http://localhost:4661',
        privateKey:
          '0x1234567890123456789012345678901234567890123456789012345678901234',
        capacityGB: -100,
        pricePerGBMonth: 1000000000000000n,
        stakeAmount: 100000000000000000n,
      }

      expect(() => validateDatabaseServiceConfig(config)).toThrow()
    })
  })

  describe('validateDatabaseServiceState', () => {
    test('validates valid state', () => {
      const state = {
        isRegistered: true,
        operatorAddress: '0x1234567890123456789012345678901234567890',
        minerEndpoint: 'http://localhost:4661',
        capacityGB: 100,
        usedGB: 50,
        pricePerGBMonth: 1000000000000000n,
        stake: 100000000000000000n,
        hostedDatabases: 5,
        totalQueriesServed: 1000,
        uptime: 3600000,
        rewardsEarned: 500000000000000n,
        rewardsPending: 100000000000000n,
      }

      const result = validateDatabaseServiceState(state)
      expect(result.isRegistered).toBe(true)
      expect(result.hostedDatabases).toBe(5)
    })

    test('rejects invalid address format', () => {
      const state = {
        isRegistered: true,
        operatorAddress: 'invalid-address',
        minerEndpoint: 'http://localhost:4661',
        capacityGB: 100,
        usedGB: 50,
        pricePerGBMonth: 1000000000000000n,
        stake: 100000000000000000n,
        hostedDatabases: 5,
        totalQueriesServed: 1000,
        uptime: 3600000,
        rewardsEarned: 500000000000000n,
        rewardsPending: 100000000000000n,
      }

      expect(() => validateDatabaseServiceState(state)).toThrow()
    })
  })

  describe('validateDatabaseStats', () => {
    test('validates valid stats', () => {
      const stats = {
        queriesPerSecond: 10.5,
        avgQueryLatencyMs: 15.3,
        activeConnections: 50,
        replicationLag: 0.1,
        blockHeight: 1000,
        consensusHealth: 'healthy' as const,
      }

      const result = validateDatabaseStats(stats)
      expect(result.queriesPerSecond).toBe(10.5)
      expect(result.consensusHealth).toBe('healthy')
    })

    test('rejects invalid consensus health', () => {
      const stats = {
        queriesPerSecond: 10.5,
        avgQueryLatencyMs: 15.3,
        activeConnections: 50,
        replicationLag: 0.1,
        blockHeight: 1000,
        consensusHealth: 'invalid' as const,
      }

      expect(() => validateDatabaseStats(stats)).toThrow()
    })

    test('rejects negative values', () => {
      const stats = {
        queriesPerSecond: -10.5,
        avgQueryLatencyMs: 15.3,
        activeConnections: 50,
        replicationLag: 0.1,
        blockHeight: 1000,
        consensusHealth: 'healthy' as const,
      }

      expect(() => validateDatabaseStats(stats)).toThrow()
    })
  })
})
