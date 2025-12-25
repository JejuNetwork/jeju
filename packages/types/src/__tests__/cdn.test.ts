/**
 * @fileoverview Comprehensive tests for cdn.ts
 *
 * Tests cover:
 * - CDNRegionSchema: Region validation
 * - CDNProviderTypeSchema: Provider type validation
 * - ContentTypeSchema: Content type validation
 * - CacheStrategySchema: Cache strategy validation
 * - CacheStatusSchema: Cache status validation
 * - EdgeNodeStatusSchema: Node status validation
 * - Default configurations: DEFAULT_TTL_CONFIG, DEFAULT_CACHE_RULES
 */

import { describe, expect, test } from 'bun:test'
import {
  CacheStatusSchema,
  CacheStrategySchema,
  type CDNProviderType,
  CDNProviderTypeSchema,
  type CDNRegion,
  CDNRegionSchema,
  type CDNSiteConfig,
  ContentTypeSchema,
  DEFAULT_CACHE_RULES,
  DEFAULT_TTL_CONFIG,
  type EdgeNode,
  EdgeNodeStatusSchema,
  type InvalidationRequest,
} from '../cdn'

describe('CDNRegionSchema', () => {
  const validRegions: CDNRegion[] = [
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
    'global',
  ]

  const invalidRegions = ['us-central', 'europe', 'asia', '']

  test.each(validRegions)('accepts valid region: %s', (region) => {
    expect(CDNRegionSchema.safeParse(region).success).toBe(true)
  })

  test.each(invalidRegions)('rejects invalid region: %s', (region) => {
    expect(CDNRegionSchema.safeParse(region).success).toBe(false)
  })

  test('covers all AWS-style regions plus global', () => {
    expect(validRegions.length).toBe(16)
  })
})

describe('CDNProviderTypeSchema', () => {
  const validProviderTypes: CDNProviderType[] = [
    'decentralized',
    'cloudfront',
    'cloudflare',
    'fastly',
    'fleek',
    'pipe',
    'aioz',
    'ipfs-gateway',
    'residential',
  ]

  const invalidProviderTypes = ['aws', 'azure', 'gcp', '']

  test.each(validProviderTypes)('accepts valid provider type: %s', (type) => {
    expect(CDNProviderTypeSchema.safeParse(type).success).toBe(true)
  })

  test.each(
    invalidProviderTypes,
  )('rejects invalid provider type: %s', (type) => {
    expect(CDNProviderTypeSchema.safeParse(type).success).toBe(false)
  })
})

describe('ContentTypeSchema', () => {
  const validContentTypes = [
    'static',
    'image',
    'video',
    'audio',
    'document',
    'api',
    'manifest',
    'wasm',
    'other',
  ]

  test.each(validContentTypes)('accepts valid content type: %s', (type) => {
    expect(ContentTypeSchema.safeParse(type).success).toBe(true)
  })

  test('rejects invalid content types', () => {
    expect(ContentTypeSchema.safeParse('binary').success).toBe(false)
    expect(ContentTypeSchema.safeParse('html').success).toBe(false)
  })
})

describe('CacheStrategySchema', () => {
  const validStrategies = [
    'immutable',
    'static',
    'dynamic',
    'streaming',
    'stale-revalidate',
  ]

  test.each(validStrategies)('accepts valid strategy: %s', (strategy) => {
    expect(CacheStrategySchema.safeParse(strategy).success).toBe(true)
  })

  test('rejects invalid strategies', () => {
    expect(CacheStrategySchema.safeParse('no-cache').success).toBe(false)
    expect(CacheStrategySchema.safeParse('private').success).toBe(false)
  })
})

describe('CacheStatusSchema', () => {
  const validStatuses = [
    'HIT',
    'MISS',
    'STALE',
    'BYPASS',
    'EXPIRED',
    'REVALIDATED',
    'DYNAMIC',
    'ERROR',
  ]

  test.each(validStatuses)('accepts valid status: %s', (status) => {
    expect(CacheStatusSchema.safeParse(status).success).toBe(true)
  })

  test('rejects lowercase versions', () => {
    expect(CacheStatusSchema.safeParse('hit').success).toBe(false)
    expect(CacheStatusSchema.safeParse('miss').success).toBe(false)
  })
})

describe('EdgeNodeStatusSchema', () => {
  const validStatuses = [
    'healthy',
    'degraded',
    'unhealthy',
    'maintenance',
    'offline',
  ]

  test.each(validStatuses)('accepts valid status: %s', (status) => {
    expect(EdgeNodeStatusSchema.safeParse(status).success).toBe(true)
  })

  test('rejects invalid statuses', () => {
    expect(EdgeNodeStatusSchema.safeParse('online').success).toBe(false)
    expect(EdgeNodeStatusSchema.safeParse('down').success).toBe(false)
  })
})

describe('DEFAULT_TTL_CONFIG', () => {
  test('has correct structure', () => {
    expect(typeof DEFAULT_TTL_CONFIG.immutableAssets).toBe('number')
    expect(typeof DEFAULT_TTL_CONFIG.html).toBe('number')
    expect(typeof DEFAULT_TTL_CONFIG.api).toBe('number')
    expect(typeof DEFAULT_TTL_CONFIG.fonts).toBe('number')
    expect(typeof DEFAULT_TTL_CONFIG.images).toBe('number')
    expect(typeof DEFAULT_TTL_CONFIG.data).toBe('number')
    expect(typeof DEFAULT_TTL_CONFIG.serviceWorker).toBe('number')
    expect(typeof DEFAULT_TTL_CONFIG.manifest).toBe('number')
  })

  test('has sensible default values', () => {
    // Immutable assets should be cached for 1 year
    expect(DEFAULT_TTL_CONFIG.immutableAssets).toBe(31536000)

    // HTML should not be cached by default
    expect(DEFAULT_TTL_CONFIG.html).toBe(0)

    // API should have short TTL
    expect(DEFAULT_TTL_CONFIG.api).toBe(60)

    // Fonts should be immutable
    expect(DEFAULT_TTL_CONFIG.fonts).toBe(31536000)

    // Service worker should not be cached
    expect(DEFAULT_TTL_CONFIG.serviceWorker).toBe(0)
  })
})

describe('DEFAULT_CACHE_RULES', () => {
  test('is an array of cache rules', () => {
    expect(Array.isArray(DEFAULT_CACHE_RULES)).toBe(true)
    expect(DEFAULT_CACHE_RULES.length).toBeGreaterThan(0)
  })

  test('each rule has required fields', () => {
    for (const rule of DEFAULT_CACHE_RULES) {
      expect(typeof rule.pattern).toBe('string')
      expect(typeof rule.strategy).toBe('string')
      expect(typeof rule.ttl).toBe('number')
    }
  })

  test('includes immutable assets rule', () => {
    const assetsRule = DEFAULT_CACHE_RULES.find(
      (r) => r.pattern === '/assets/**',
    )
    expect(assetsRule).toBeDefined()
    if (assetsRule) {
      expect(assetsRule.strategy).toBe('immutable')
      expect(assetsRule.ttl).toBe(31536000)
    }
  })

  test('includes service worker rule', () => {
    const swRule = DEFAULT_CACHE_RULES.find((r) => r.pattern === '/sw.js')
    expect(swRule).toBeDefined()
    if (swRule) {
      expect(swRule.strategy).toBe('dynamic')
      expect(swRule.ttl).toBe(0)
    }
  })

  test('includes API rule with vary headers', () => {
    const apiRule = DEFAULT_CACHE_RULES.find((r) => r.pattern === '/api/**')
    expect(apiRule).toBeDefined()
    if (apiRule) {
      expect(apiRule.strategy).toBe('dynamic')
      expect(apiRule.varyHeaders).toContain('Authorization')
    }
  })
})

describe('CDN Type Structures', () => {
  test('EdgeNode type has correct structure', () => {
    const node: EdgeNode = {
      nodeId: 'node-123',
      address: '0x1234567890123456789012345678901234567890',
      endpoint: 'https://cdn.example.com',
      region: 'us-east-1',
      location: {
        latitude: 40.7128,
        longitude: -74.006,
        city: 'New York',
        country: 'United States',
        countryCode: 'US',
      },
      providerType: 'decentralized',
      capabilities: {
        maxBandwidthMbps: 10000,
        maxStorageGB: 1000,
        supportsSSL: true,
        supportsHTTP2: true,
        supportsHTTP3: false,
        supportsBrotli: true,
        supportsGzip: true,
        supportsWebP: true,
        supportsAVIF: false,
        supportsRangeRequests: true,
        supportsConditionalRequests: true,
        apiCaching: true,
        edgeCompute: false,
        ddosProtection: true,
        wafEnabled: false,
      },
      status: 'healthy',
      metrics: {
        currentLoad: 45,
        memoryUsage: 60,
        diskUsage: 30,
        bandwidthUsage: 25,
        activeConnections: 1500,
        requestsPerSecond: 500,
        bytesServedTotal: 1000000000000n,
        requestsTotal: 50000000n,
        cacheSize: 500000000,
        cacheEntries: 10000,
        cacheHitRate: 0.95,
        avgResponseTime: 15,
        errorRate: 0.001,
        lastUpdated: Date.now(),
      },
      registeredAt: Date.now() - 86400000,
      lastSeen: Date.now(),
      agentId: 123,
    }

    expect(node.nodeId).toBe('node-123')
    expect(node.status).toBe('healthy')
    expect(node.metrics.cacheHitRate).toBe(0.95)
  })

  test('InvalidationRequest type has correct structure', () => {
    const request: InvalidationRequest = {
      requestId: 'inv-123',
      type: 'prefix',
      targets: ['/images/', '/assets/'],
      regions: ['us-east-1', 'eu-west-1'],
      requestedBy: '0x1234567890123456789012345678901234567890',
      requestedAt: Date.now(),
      priority: 'high',
    }

    expect(request.type).toBe('prefix')
    expect(request.targets).toHaveLength(2)
    expect(request.priority).toBe('high')
  })

  test('CDNSiteConfig type has correct structure', () => {
    const config: CDNSiteConfig = {
      siteId: 'site-123',
      domain: 'example.com',
      aliases: ['www.example.com'],
      owner: '0x1234567890123456789012345678901234567890',
      origin: {
        name: 'ipfs-origin',
        type: 'ipfs',
        endpoint: 'https://gateway.ipfs.io',
        healthCheck: {
          enabled: true,
          path: '/health',
          interval: 30000,
          timeout: 5000,
          healthyThreshold: 2,
          unhealthyThreshold: 3,
        },
        timeout: 10000,
        retries: 3,
        retryDelay: 1000,
      },
      cacheConfig: {
        enabled: true,
        defaultTTL: 3600,
        maxAge: 86400,
        staleWhileRevalidate: 60,
        staleIfError: 300,
        rules: [],
        ttlConfig: DEFAULT_TTL_CONFIG,
        respectOriginHeaders: true,
        cachePrivate: false,
        cacheAuthenticated: false,
      },
      ssl: {
        enabled: true,
        minVersion: 'TLSv1.2',
        hsts: true,
        hstsMaxAge: 31536000,
        hstsIncludeSubdomains: true,
      },
      security: {
        waf: true,
        ddosProtection: true,
        botProtection: false,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    expect(config.siteId).toBe('site-123')
    expect(config.ssl.enabled).toBe(true)
    expect(config.security.waf).toBe(true)
  })
})
