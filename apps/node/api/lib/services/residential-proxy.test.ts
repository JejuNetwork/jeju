import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

// Proxy Config Schema
const ProxyConfigSchema = z.object({
  listenPort: z.number().int().min(1024).max(65535),
  metricsPort: z.number().int().min(1024).max(65535).optional(),
  coordinatorUrl: z.string().url(),
  regionCode: z.string().min(2).max(10).optional(),
  maxConnections: z.number().int().positive(),
  connectionTimeoutMs: z.number().int().positive(),
})

type ProxyConfig = z.infer<typeof ProxyConfigSchema>

// Proxy State Schema
const ProxyStateSchema = z.object({
  isRegistered: z.boolean(),
  nodeId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  status: z.enum(['online', 'offline', 'draining']),
  activeConnections: z.number().int().nonnegative(),
  requestsServed: z.number().int().nonnegative(),
  bytesTransferred: z.bigint(),
  region: z.string().optional(),
})

type ProxyState = z.infer<typeof ProxyStateSchema>

function validateProxyConfig(data: unknown): ProxyConfig {
  return ProxyConfigSchema.parse(data)
}

function validateProxyState(data: unknown): ProxyState {
  return ProxyStateSchema.parse(data)
}

describe('Residential Proxy Configuration', () => {
  describe('validateProxyConfig', () => {
    test('validates valid config', () => {
      const config: ProxyConfig = {
        listenPort: 8080,
        metricsPort: 9090,
        coordinatorUrl: 'wss://coordinator.jeju.network',
        regionCode: 'US-CA',
        maxConnections: 1000,
        connectionTimeoutMs: 30000,
      }

      const result = validateProxyConfig(config)
      expect(result.listenPort).toBe(8080)
      expect(result.regionCode).toBe('US-CA')
    })

    test('validates config without optional fields', () => {
      const config: ProxyConfig = {
        listenPort: 8080,
        coordinatorUrl: 'wss://coordinator.jeju.network',
        maxConnections: 100,
        connectionTimeoutMs: 30000,
      }

      const result = validateProxyConfig(config)
      expect(result.metricsPort).toBeUndefined()
      expect(result.regionCode).toBeUndefined()
    })

    test('rejects invalid listen port', () => {
      const config = {
        listenPort: 80, // Below 1024
        coordinatorUrl: 'wss://coordinator.jeju.network',
        maxConnections: 100,
        connectionTimeoutMs: 30000,
      }

      expect(() => validateProxyConfig(config)).toThrow()
    })

    test('rejects invalid coordinator URL', () => {
      const config = {
        listenPort: 8080,
        coordinatorUrl: 'not-a-valid-url',
        maxConnections: 100,
        connectionTimeoutMs: 30000,
      }

      expect(() => validateProxyConfig(config)).toThrow()
    })

    test('rejects zero max connections', () => {
      const config = {
        listenPort: 8080,
        coordinatorUrl: 'wss://coordinator.jeju.network',
        maxConnections: 0,
        connectionTimeoutMs: 30000,
      }

      expect(() => validateProxyConfig(config)).toThrow()
    })

    test('rejects negative timeout', () => {
      const config = {
        listenPort: 8080,
        coordinatorUrl: 'wss://coordinator.jeju.network',
        maxConnections: 100,
        connectionTimeoutMs: -1,
      }

      expect(() => validateProxyConfig(config)).toThrow()
    })
  })

  describe('validateProxyState', () => {
    test('validates online state', () => {
      const state: ProxyState = {
        isRegistered: true,
        nodeId: '0x1234567890abcdef',
        status: 'online',
        activeConnections: 50,
        requestsServed: 10000,
        bytesTransferred: 1073741824n, // 1 GB
        region: 'US-CA',
      }

      const result = validateProxyState(state)
      expect(result.status).toBe('online')
      expect(result.activeConnections).toBe(50)
    })

    test('validates draining state', () => {
      const state: ProxyState = {
        isRegistered: true,
        nodeId: '0xabcdef',
        status: 'draining',
        activeConnections: 10,
        requestsServed: 5000,
        bytesTransferred: 500000000n,
      }

      const result = validateProxyState(state)
      expect(result.status).toBe('draining')
    })

    test('validates offline state', () => {
      const state: ProxyState = {
        isRegistered: false,
        status: 'offline',
        activeConnections: 0,
        requestsServed: 0,
        bytesTransferred: 0n,
      }

      const result = validateProxyState(state)
      expect(result.status).toBe('offline')
      expect(result.nodeId).toBeUndefined()
    })

    test('rejects invalid status', () => {
      const state = {
        isRegistered: true,
        status: 'invalid',
        activeConnections: 0,
        requestsServed: 0,
        bytesTransferred: 0n,
      }

      expect(() => validateProxyState(state)).toThrow()
    })

    test('rejects negative connections', () => {
      const state = {
        isRegistered: true,
        status: 'online',
        activeConnections: -1,
        requestsServed: 0,
        bytesTransferred: 0n,
      }

      expect(() => validateProxyState(state)).toThrow()
    })
  })
})

describe('Circuit Breaker', () => {
  interface CircuitBreaker {
    failures: number
    threshold: number
    resetTimeout: number
    state: 'closed' | 'open' | 'half-open'
    lastFailure: number
  }

  function createCircuitBreaker(
    threshold: number,
    resetTimeout: number,
  ): CircuitBreaker {
    return {
      failures: 0,
      threshold,
      resetTimeout,
      state: 'closed',
      lastFailure: 0,
    }
  }

  function recordFailure(breaker: CircuitBreaker): void {
    breaker.failures++
    breaker.lastFailure = Date.now()
    if (breaker.failures >= breaker.threshold) {
      breaker.state = 'open'
    }
  }

  function recordSuccess(breaker: CircuitBreaker): void {
    breaker.failures = 0
    breaker.state = 'closed'
  }

  function canRequest(breaker: CircuitBreaker): boolean {
    if (breaker.state === 'closed') return true

    if (breaker.state === 'open') {
      const elapsed = Date.now() - breaker.lastFailure
      if (elapsed >= breaker.resetTimeout) {
        breaker.state = 'half-open'
        return true
      }
      return false
    }

    // half-open: allow one request
    return true
  }

  test('starts in closed state', () => {
    const breaker = createCircuitBreaker(5, 30000)
    expect(breaker.state).toBe('closed')
    expect(canRequest(breaker)).toBe(true)
  })

  test('opens after threshold failures', () => {
    const breaker = createCircuitBreaker(3, 30000)

    recordFailure(breaker)
    recordFailure(breaker)
    expect(breaker.state).toBe('closed')

    recordFailure(breaker)
    expect(breaker.state).toBe('open')
    expect(canRequest(breaker)).toBe(false)
  })

  test('resets after success', () => {
    const breaker = createCircuitBreaker(3, 30000)

    recordFailure(breaker)
    recordFailure(breaker)
    expect(breaker.failures).toBe(2)

    recordSuccess(breaker)
    expect(breaker.failures).toBe(0)
    expect(breaker.state).toBe('closed')
  })
})

describe('Auth Token Validation', () => {
  interface AuthToken {
    nodeId: string
    requestId: string
    targetHost: string
    expiry: number
    signature: string
  }

  const AuthTokenSchema = z.object({
    nodeId: z.string().regex(/^0x[a-fA-F0-9]+$/),
    requestId: z.string().uuid(),
    targetHost: z.string().min(1),
    expiry: z.number().int().positive(),
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  })

  function validateAuthToken(data: unknown): AuthToken {
    return AuthTokenSchema.parse(data)
  }

  function isTokenExpired(token: AuthToken): boolean {
    return Date.now() > token.expiry
  }

  test('validates valid auth token', () => {
    const token = {
      nodeId: '0x1234567890abcdef',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      targetHost: 'api.example.com',
      expiry: Date.now() + 60000,
      signature: `0x${'a'.repeat(130)}`,
    }

    const result = validateAuthToken(token)
    expect(result.targetHost).toBe('api.example.com')
  })

  test('rejects invalid node ID', () => {
    const token = {
      nodeId: 'invalid',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      targetHost: 'api.example.com',
      expiry: Date.now() + 60000,
      signature: `0x${'a'.repeat(130)}`,
    }

    expect(() => validateAuthToken(token)).toThrow()
  })

  test('rejects invalid UUID', () => {
    const token = {
      nodeId: '0x1234567890abcdef',
      requestId: 'not-a-uuid',
      targetHost: 'api.example.com',
      expiry: Date.now() + 60000,
      signature: `0x${'a'.repeat(130)}`,
    }

    expect(() => validateAuthToken(token)).toThrow()
  })

  test('detects expired token', () => {
    const token = {
      nodeId: '0x1234567890abcdef',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      targetHost: 'api.example.com',
      expiry: Date.now() - 1000, // 1 second ago
      signature: `0x${'a'.repeat(130)}`,
    }

    expect(isTokenExpired(validateAuthToken(token))).toBe(true)
  })

  test('valid token not expired', () => {
    const token = {
      nodeId: '0x1234567890abcdef',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      targetHost: 'api.example.com',
      expiry: Date.now() + 60000,
      signature: `0x${'a'.repeat(130)}`,
    }

    expect(isTokenExpired(validateAuthToken(token))).toBe(false)
  })
})

describe('Domain Blocking', () => {
  const BLOCKED_DOMAINS = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal',
  ])

  const BLOCKED_PORTS = new Set([22, 23, 25, 3389]) // SSH, Telnet, SMTP, RDP

  function isDomainBlocked(domain: string): boolean {
    const lowerDomain = domain.toLowerCase()
    if (BLOCKED_DOMAINS.has(lowerDomain)) return true
    if (lowerDomain.includes('internal')) return true
    if (lowerDomain.includes('metadata')) return true
    return false
  }

  function isPortBlocked(port: number): boolean {
    return BLOCKED_PORTS.has(port)
  }

  test('blocks localhost', () => {
    expect(isDomainBlocked('localhost')).toBe(true)
    expect(isDomainBlocked('LOCALHOST')).toBe(true)
  })

  test('blocks metadata endpoints', () => {
    expect(isDomainBlocked('169.254.169.254')).toBe(true)
    expect(isDomainBlocked('metadata.google.internal')).toBe(true)
    expect(isDomainBlocked('some.internal.service')).toBe(true)
  })

  test('allows public domains', () => {
    expect(isDomainBlocked('google.com')).toBe(false)
    expect(isDomainBlocked('api.example.com')).toBe(false)
  })

  test('blocks restricted ports', () => {
    expect(isPortBlocked(22)).toBe(true)
    expect(isPortBlocked(23)).toBe(true)
    expect(isPortBlocked(25)).toBe(true)
    expect(isPortBlocked(3389)).toBe(true)
  })

  test('allows common ports', () => {
    expect(isPortBlocked(80)).toBe(false)
    expect(isPortBlocked(443)).toBe(false)
    expect(isPortBlocked(8080)).toBe(false)
  })
})
