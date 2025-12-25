import { describe, expect, test } from 'bun:test'
import type { CDNNodeMetrics, CDNServiceConfig } from './cdn'
import {
  validateCDNEarnings,
  validateCDNNodeMetrics,
  validateCDNServiceConfig,
  validateCDNServiceState,
} from './cdn'

describe('CDN Service Validation', () => {
  describe('validateCDNServiceConfig', () => {
    test('validates valid config', () => {
      const config: CDNServiceConfig = {
        endpoint: 'https://cdn.example.com',
        region: 'us-east-1',
        maxCacheSizeMB: 1024,
        stakeAmount: 1000000000000000000n,
        supportedOrigins: ['https://origin1.com', 'https://origin2.com'],
      }

      const result = validateCDNServiceConfig(config)
      expect(result.endpoint).toBe('https://cdn.example.com')
      expect(result.region).toBe('us-east-1')
      expect(result.maxCacheSizeMB).toBe(1024)
    })

    test('rejects invalid region', () => {
      const config = {
        endpoint: 'https://cdn.example.com',
        region: 'invalid-region',
        maxCacheSizeMB: 1024,
        stakeAmount: 1000000000000000000n,
        supportedOrigins: [],
      }

      expect(() => validateCDNServiceConfig(config)).toThrow()
    })

    test('rejects invalid endpoint URL', () => {
      const config = {
        endpoint: 'not-a-url',
        region: 'us-east-1',
        maxCacheSizeMB: 1024,
        stakeAmount: 1000000000000000000n,
        supportedOrigins: [],
      }

      expect(() => validateCDNServiceConfig(config)).toThrow()
    })

    test('rejects negative cache size', () => {
      const config = {
        endpoint: 'https://cdn.example.com',
        region: 'us-east-1',
        maxCacheSizeMB: -100,
        stakeAmount: 1000000000000000000n,
        supportedOrigins: [],
      }

      expect(() => validateCDNServiceConfig(config)).toThrow()
    })
  })

  describe('validateCDNServiceState', () => {
    test('validates valid state', () => {
      const state = {
        isRegistered: true,
        nodeId: '0x1234567890abcdef' as `0x${string}`,
        endpoint: 'https://cdn.example.com',
        region: 'us-east-1',
        stake: 1000000000000000000n,
        status: 'healthy' as const,
        metrics: {
          requestsTotal: 1000,
          bytesServed: 1024000,
          cacheHitRate: 85,
          avgLatencyMs: 50,
          activeConnections: 10,
          cacheEntries: 500,
          cacheSizeBytes: 512000000,
        },
      }

      const result = validateCDNServiceState(state)
      expect(result.isRegistered).toBe(true)
      expect(result.status).toBe('healthy')
    })

    test('validates all status values', () => {
      const statuses = [
        'healthy',
        'degraded',
        'unhealthy',
        'maintenance',
        'offline',
      ] as const

      for (const status of statuses) {
        const state = {
          isRegistered: true,
          nodeId: '0x1234' as `0x${string}`,
          endpoint: 'https://cdn.example.com',
          region: 'us-east-1',
          stake: 0n,
          status,
          metrics: {
            requestsTotal: 0,
            bytesServed: 0,
            cacheHitRate: 0,
            avgLatencyMs: 0,
            activeConnections: 0,
            cacheEntries: 0,
            cacheSizeBytes: 0,
          },
        }

        const result = validateCDNServiceState(state)
        expect(result.status).toBe(status)
      }
    })

    test('rejects invalid status', () => {
      const state = {
        isRegistered: true,
        nodeId: '0x1234',
        endpoint: 'https://cdn.example.com',
        region: 'us-east-1',
        stake: 0n,
        status: 'invalid-status',
        metrics: {
          requestsTotal: 0,
          bytesServed: 0,
          cacheHitRate: 0,
          avgLatencyMs: 0,
          activeConnections: 0,
          cacheEntries: 0,
          cacheSizeBytes: 0,
        },
      }

      expect(() => validateCDNServiceState(state)).toThrow()
    })
  })

  describe('validateCDNNodeMetrics', () => {
    test('validates valid metrics', () => {
      const metrics: CDNNodeMetrics = {
        requestsTotal: 1000,
        bytesServed: 1024000,
        cacheHitRate: 85,
        avgLatencyMs: 50,
        activeConnections: 10,
        cacheEntries: 500,
        cacheSizeBytes: 512000000,
      }

      const result = validateCDNNodeMetrics(metrics)
      expect(result.requestsTotal).toBe(1000)
      expect(result.cacheHitRate).toBe(85)
    })

    test('rejects negative requests', () => {
      const metrics = {
        requestsTotal: -1,
        bytesServed: 0,
        cacheHitRate: 0,
        avgLatencyMs: 0,
        activeConnections: 0,
        cacheEntries: 0,
        cacheSizeBytes: 0,
      }

      expect(() => validateCDNNodeMetrics(metrics)).toThrow()
    })

    test('rejects cache hit rate over 100', () => {
      const metrics = {
        requestsTotal: 100,
        bytesServed: 0,
        cacheHitRate: 150,
        avgLatencyMs: 0,
        activeConnections: 0,
        cacheEntries: 0,
        cacheSizeBytes: 0,
      }

      expect(() => validateCDNNodeMetrics(metrics)).toThrow()
    })

    test('accepts cache hit rate at boundaries', () => {
      const metrics0 = validateCDNNodeMetrics({
        requestsTotal: 100,
        bytesServed: 0,
        cacheHitRate: 0,
        avgLatencyMs: 0,
        activeConnections: 0,
        cacheEntries: 0,
        cacheSizeBytes: 0,
      })
      expect(metrics0.cacheHitRate).toBe(0)

      const metrics100 = validateCDNNodeMetrics({
        requestsTotal: 100,
        bytesServed: 0,
        cacheHitRate: 100,
        avgLatencyMs: 0,
        activeConnections: 0,
        cacheEntries: 0,
        cacheSizeBytes: 0,
      })
      expect(metrics100.cacheHitRate).toBe(100)
    })
  })

  describe('validateCDNEarnings', () => {
    test('validates valid earnings', () => {
      const earnings = {
        pending: 1000000000000000000n,
        total: 5000000000000000000n,
        lastSettlement: 1704067200000,
      }

      const result = validateCDNEarnings(earnings)
      expect(result.pending).toBe(1000000000000000000n)
      expect(result.total).toBe(5000000000000000000n)
    })

    test('accepts zero pending earnings', () => {
      const earnings = {
        pending: 0n,
        total: 5000000000000000000n,
        lastSettlement: 1704067200000,
      }

      const result = validateCDNEarnings(earnings)
      expect(result.pending).toBe(0n)
    })
  })
})

describe('CDN Region Validation', () => {
  const validRegions: CDNServiceConfig['region'][] = [
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'eu-west-1',
    'eu-west-2',
    'eu-central-1',
    'ap-northeast-1',
    'ap-northeast-2',
    'ap-southeast-1',
    'ap-southeast-2',
    'ap-south-1',
    'sa-east-1',
    'af-south-1',
    'me-south-1',
  ]

  test.each(validRegions)('accepts valid region: %s', (region) => {
    const config: Parameters<typeof validateCDNServiceConfig>[0] = {
      endpoint: 'https://cdn.example.com',
      region,
      maxCacheSizeMB: 1024,
      stakeAmount: 0n,
      supportedOrigins: [],
    }

    const result = validateCDNServiceConfig(config)
    expect(result.region).toBe(region)
  })
})
