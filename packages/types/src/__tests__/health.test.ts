import { describe, expect, it } from 'bun:test'
import {
  HealthStatusSchema,
  HealthResponseSchema,
  DependencyTypeSchema,
  DependencyHealthSchema,
  ReadinessResponseSchema,
  MemoryUsageSchema,
  LivenessResponseSchema,
  HealthResourceTypeSchema,
  ResourceHealthDetailsSchema,
  ResourceHealthSchema,
  FundingStatusSchema,
  ResourceHealthResponseSchema,
  KeepaliveResourceSchema,
  KeepaliveConfigSchema,
  KeepaliveStatusSchema,
  KeepaliveHealthCheckRequestSchema,
  ResourceCheckResultSchema,
  KeepaliveHealthCheckResultSchema,
  WakePageDataSchema,
  ENSMirrorConfigSchema,
  ENSMirrorStatusSchema,
  isHealthy,
  combineHealthStatuses,
} from '../health'

describe('Health Types', () => {
  describe('HealthStatusSchema', () => {
    it('validates all health statuses', () => {
      const statuses = ['healthy', 'degraded', 'unhealthy']
      for (const status of statuses) {
        expect(HealthStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('HealthResponseSchema', () => {
    it('validates basic health response', () => {
      const response = {
        status: 'healthy',
        timestamp: Date.now(),
      }
      expect(() => HealthResponseSchema.parse(response)).not.toThrow()
    })

    it('validates health response with version', () => {
      const response = {
        status: 'healthy',
        timestamp: Date.now(),
        version: '1.2.3',
      }
      expect(() => HealthResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('DependencyTypeSchema', () => {
    it('validates all dependency types', () => {
      const types = ['database', 'cache', 'queue', 'rpc', 'api', 'other']
      for (const type of types) {
        expect(DependencyTypeSchema.parse(type)).toBe(type)
      }
    })
  })

  describe('DependencyHealthSchema', () => {
    it('validates dependency health', () => {
      const health = {
        name: 'postgres',
        type: 'database',
        status: 'healthy',
        latencyMs: 5,
      }
      expect(() => DependencyHealthSchema.parse(health)).not.toThrow()
    })

    it('validates unhealthy dependency with error', () => {
      const health = {
        name: 'redis',
        type: 'cache',
        status: 'unhealthy',
        error: 'Connection refused',
      }
      expect(() => DependencyHealthSchema.parse(health)).not.toThrow()
    })
  })

  describe('ReadinessResponseSchema', () => {
    it('validates readiness response', () => {
      const response = {
        status: 'healthy',
        timestamp: Date.now(),
        dependencies: [
          { name: 'postgres', type: 'database', status: 'healthy', latencyMs: 5 },
          { name: 'redis', type: 'cache', status: 'healthy', latencyMs: 1 },
        ],
      }
      expect(() => ReadinessResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('MemoryUsageSchema', () => {
    it('validates memory usage', () => {
      const usage = {
        heapUsed: 50000000,
        heapTotal: 100000000,
        external: 1000000,
        rss: 120000000,
      }
      expect(() => MemoryUsageSchema.parse(usage)).not.toThrow()
    })
  })

  describe('LivenessResponseSchema', () => {
    it('validates liveness response', () => {
      const response = {
        status: 'healthy',
        timestamp: Date.now(),
        uptime: 86400,
        memory: {
          heapUsed: 50000000,
          heapTotal: 100000000,
          external: 1000000,
          rss: 120000000,
        },
      }
      expect(() => LivenessResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('HealthResourceTypeSchema', () => {
    it('validates all resource types', () => {
      const types = ['rpc_endpoint', 'api_service', 'database', 'indexer', 'contract']
      for (const type of types) {
        expect(HealthResourceTypeSchema.parse(type)).toBe(type)
      }
    })
  })

  describe('ResourceHealthDetailsSchema', () => {
    it('validates resource health details', () => {
      const details = {
        blockNumber: 12345678,
        latency: 50,
        lastSuccessfulRequest: Date.now(),
        errorRate: 0.01,
      }
      expect(() => ResourceHealthDetailsSchema.parse(details)).not.toThrow()
    })
  })

  describe('ResourceHealthSchema', () => {
    it('validates resource health', () => {
      const health = {
        name: 'Ethereum RPC',
        type: 'rpc_endpoint',
        url: 'https://eth-mainnet.example.com',
        status: 'healthy',
        lastChecked: Date.now(),
        details: {
          blockNumber: 12345678,
          latency: 50,
        },
      }
      expect(() => ResourceHealthSchema.parse(health)).not.toThrow()
    })
  })

  describe('FundingStatusSchema', () => {
    it('validates funding status', () => {
      const status = {
        hasDeposit: true,
        balance: '1000000000000000000',
        minimumRequired: '100000000000000000',
        sufficientForOperation: true,
      }
      expect(() => FundingStatusSchema.parse(status)).not.toThrow()
    })
  })

  describe('ResourceHealthResponseSchema', () => {
    it('validates resource health response', () => {
      const response = {
        status: 'healthy',
        timestamp: Date.now(),
        resources: [
          {
            name: 'Ethereum RPC',
            type: 'rpc_endpoint',
            url: 'https://eth-mainnet.example.com',
            status: 'healthy',
            lastChecked: Date.now(),
          },
        ],
        funding: {
          hasDeposit: true,
          balance: '1000000000000000000',
          minimumRequired: '100000000000000000',
          sufficientForOperation: true,
        },
      }
      expect(() => ResourceHealthResponseSchema.parse(response)).not.toThrow()
    })
  })

  describe('KeepaliveResourceSchema', () => {
    it('validates keepalive resource', () => {
      const resource = {
        id: 'resource-1',
        name: 'Main API',
        url: 'https://api.example.com/health',
        intervalMs: 30000,
        timeoutMs: 5000,
        enabled: true,
      }
      expect(() => KeepaliveResourceSchema.parse(resource)).not.toThrow()
    })
  })

  describe('KeepaliveConfigSchema', () => {
    it('validates keepalive config', () => {
      const config = {
        resources: [
          {
            id: 'resource-1',
            name: 'Main API',
            url: 'https://api.example.com/health',
            intervalMs: 30000,
            timeoutMs: 5000,
            enabled: true,
          },
        ],
        defaultIntervalMs: 30000,
        defaultTimeoutMs: 5000,
        retryAttempts: 3,
        retryDelayMs: 1000,
      }
      expect(() => KeepaliveConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('KeepaliveStatusSchema', () => {
    it('validates keepalive status', () => {
      const status = {
        resourceId: 'resource-1',
        status: 'healthy',
        lastCheck: Date.now(),
        consecutiveFailures: 0,
        latencyMs: 50,
      }
      expect(() => KeepaliveStatusSchema.parse(status)).not.toThrow()
    })

    it('validates unhealthy status with error', () => {
      const status = {
        resourceId: 'resource-1',
        status: 'unhealthy',
        lastCheck: Date.now(),
        consecutiveFailures: 3,
        lastError: 'Connection timeout',
      }
      expect(() => KeepaliveStatusSchema.parse(status)).not.toThrow()
    })
  })

  describe('KeepaliveHealthCheckRequestSchema', () => {
    it('validates health check request', () => {
      const request = {
        resourceIds: ['resource-1', 'resource-2'],
        forceCheck: true,
      }
      expect(() => KeepaliveHealthCheckRequestSchema.parse(request)).not.toThrow()
    })

    it('validates request without optional fields', () => {
      const request = {}
      expect(() => KeepaliveHealthCheckRequestSchema.parse(request)).not.toThrow()
    })
  })

  describe('ResourceCheckResultSchema', () => {
    it('validates resource check result', () => {
      const result = {
        resourceId: 'resource-1',
        success: true,
        latencyMs: 50,
        checkedAt: Date.now(),
      }
      expect(() => ResourceCheckResultSchema.parse(result)).not.toThrow()
    })

    it('validates failed check result', () => {
      const result = {
        resourceId: 'resource-1',
        success: false,
        error: 'Connection refused',
        checkedAt: Date.now(),
      }
      expect(() => ResourceCheckResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('KeepaliveHealthCheckResultSchema', () => {
    it('validates health check result', () => {
      const result = {
        status: 'healthy',
        results: [
          {
            resourceId: 'resource-1',
            success: true,
            latencyMs: 50,
            checkedAt: Date.now(),
          },
        ],
        checkedAt: Date.now(),
      }
      expect(() => KeepaliveHealthCheckResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('WakePageDataSchema', () => {
    it('validates wake page data', () => {
      const data = {
        title: 'Service Wake Page',
        message: 'Service is waking up...',
        estimatedWaitSeconds: 30,
        resourceId: 'resource-1',
        refreshIntervalMs: 5000,
      }
      expect(() => WakePageDataSchema.parse(data)).not.toThrow()
    })
  })

  describe('ENSMirrorConfigSchema', () => {
    it('validates ENS mirror config', () => {
      const config = {
        enabled: true,
        primaryDomain: 'example.eth',
        mirrorDomains: ['example.com', 'example.org'],
        refreshIntervalMs: 3600000,
      }
      expect(() => ENSMirrorConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('ENSMirrorStatusSchema', () => {
    it('validates ENS mirror status', () => {
      const status = {
        synced: true,
        lastSync: Date.now(),
        primaryResolver: '0x1234567890123456789012345678901234567890',
        records: {
          a: '192.168.1.1',
          aaaa: '::1',
          txt: 'v=spf1 include:_spf.example.com ~all',
        },
      }
      expect(() => ENSMirrorStatusSchema.parse(status)).not.toThrow()
    })
  })

  describe('Utility Functions', () => {
    describe('isHealthy', () => {
      it('returns true for healthy status', () => {
        expect(isHealthy('healthy')).toBe(true)
      })

      it('returns false for degraded status', () => {
        expect(isHealthy('degraded')).toBe(false)
      })

      it('returns false for unhealthy status', () => {
        expect(isHealthy('unhealthy')).toBe(false)
      })
    })

    describe('combineHealthStatuses', () => {
      it('returns healthy when all are healthy', () => {
        expect(combineHealthStatuses(['healthy', 'healthy', 'healthy'])).toBe('healthy')
      })

      it('returns degraded when any is degraded', () => {
        expect(combineHealthStatuses(['healthy', 'degraded', 'healthy'])).toBe('degraded')
      })

      it('returns unhealthy when any is unhealthy', () => {
        expect(combineHealthStatuses(['healthy', 'unhealthy', 'healthy'])).toBe('unhealthy')
      })

      it('returns unhealthy when mixed with degraded', () => {
        expect(combineHealthStatuses(['degraded', 'unhealthy', 'healthy'])).toBe('unhealthy')
      })

      it('returns healthy for empty array', () => {
        expect(combineHealthStatuses([])).toBe('healthy')
      })
    })
  })
})

