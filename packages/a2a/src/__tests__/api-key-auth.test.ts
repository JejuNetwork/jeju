/**
 * API Key Authentication Tests
 *
 * Tests for API key validation utilities
 */

import { describe, expect, it } from 'bun:test'
import {
  A2A_API_KEY_HEADER,
  type AuthRequest,
  isLocalHost,
  validateApiKey,
} from '../utils/api-key-auth'

describe('A2A_API_KEY_HEADER', () => {
  it('should be lowercase x-a2a-api-key', () => {
    expect(A2A_API_KEY_HEADER).toBe('x-a2a-api-key')
  })
})

describe('isLocalHost', () => {
  it('should return true for localhost', () => {
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('localhost:3000')).toBe(true)
    expect(isLocalHost('LOCALHOST')).toBe(true)
  })

  it('should return true for 127.0.0.1', () => {
    expect(isLocalHost('127.0.0.1')).toBe(true)
    expect(isLocalHost('127.0.0.1:8080')).toBe(true)
  })

  it('should return true for ::1 (IPv6 localhost)', () => {
    expect(isLocalHost('::1')).toBe(true)
    expect(isLocalHost('::1:3000')).toBe(true)
  })

  it('should return false for remote hosts', () => {
    expect(isLocalHost('example.com')).toBe(false)
    expect(isLocalHost('api.example.com')).toBe(false)
    expect(isLocalHost('192.168.1.1')).toBe(false)
  })

  it('should return false for undefined/null', () => {
    expect(isLocalHost(undefined)).toBe(false)
    expect(isLocalHost(null)).toBe(false)
  })

  it('should return false for empty string', () => {
    expect(isLocalHost('')).toBe(false)
  })
})

describe('validateApiKey', () => {
  function createMockRequest(
    headerValue: string | null,
    host?: string,
  ): AuthRequest {
    return {
      headers: {
        get(name: string): string | null {
          if (name === A2A_API_KEY_HEADER) return headerValue
          if (name === 'host') return host ?? null
          return null
        },
      },
      host,
    }
  }

  describe('localhost bypass', () => {
    it('should authenticate localhost requests by default', () => {
      const request = createMockRequest(null, 'localhost:3000')

      const result = validateApiKey(request, { requiredApiKey: 'secret-key' })

      expect(result.authenticated).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should authenticate 127.0.0.1 requests by default', () => {
      const request = createMockRequest(null, '127.0.0.1')

      const result = validateApiKey(request, { requiredApiKey: 'secret-key' })

      expect(result.authenticated).toBe(true)
    })

    it('should not bypass localhost when allowLocalhost is false', () => {
      const request = createMockRequest(null, 'localhost:3000')

      const result = validateApiKey(request, {
        requiredApiKey: 'secret-key',
        allowLocalhost: false,
      })

      expect(result.authenticated).toBe(false)
      expect(result.statusCode).toBe(401)
    })
  })

  describe('API key validation', () => {
    it('should authenticate with valid API key', () => {
      const request = createMockRequest('my-secret-key', 'api.example.com')

      const result = validateApiKey(request, {
        requiredApiKey: 'my-secret-key',
        allowLocalhost: false,
      })

      expect(result.authenticated).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject invalid API key', () => {
      const request = createMockRequest('wrong-key', 'api.example.com')

      const result = validateApiKey(request, {
        requiredApiKey: 'correct-key',
        allowLocalhost: false,
      })

      expect(result.authenticated).toBe(false)
      expect(result.statusCode).toBe(401)
      expect(result.error).toContain('Unauthorized')
    })

    it('should reject missing API key', () => {
      const request = createMockRequest(null, 'api.example.com')

      const result = validateApiKey(request, {
        requiredApiKey: 'secret-key',
        allowLocalhost: false,
      })

      expect(result.authenticated).toBe(false)
      expect(result.statusCode).toBe(401)
    })

    it('should reject empty API key', () => {
      const request = createMockRequest('', 'api.example.com')

      const result = validateApiKey(request, {
        requiredApiKey: 'secret-key',
        allowLocalhost: false,
      })

      expect(result.authenticated).toBe(false)
      expect(result.statusCode).toBe(401)
    })
  })

  describe('missing configuration', () => {
    it('should return 503 when requiredApiKey is not configured', () => {
      const request = createMockRequest('any-key', 'api.example.com')

      const result = validateApiKey(request, { allowLocalhost: false })

      expect(result.authenticated).toBe(false)
      expect(result.statusCode).toBe(503)
      expect(result.error).toContain('not configured')
    })

    it('should still allow localhost when API key is not configured', () => {
      const request = createMockRequest(null, 'localhost')

      const result = validateApiKey(request, {})

      expect(result.authenticated).toBe(true)
    })
  })

  describe('custom header name', () => {
    it('should use custom header name when provided', () => {
      const customHeaderName = 'x-custom-auth'
      const request: AuthRequest = {
        headers: {
          get(name: string): string | null {
            if (name === customHeaderName) return 'my-key'
            return null
          },
        },
        host: 'api.example.com',
      }

      const result = validateApiKey(request, {
        requiredApiKey: 'my-key',
        headerName: customHeaderName,
        allowLocalhost: false,
      })

      expect(result.authenticated).toBe(true)
    })
  })

  describe('timing attack prevention', () => {
    it('should use constant-time comparison for keys', () => {
      // This test verifies the behavior, not actual timing
      // Real timing attack tests would require precise measurements
      const request1 = createMockRequest('wrong-first-char', 'api.example.com')
      const request2 = createMockRequest(
        'correct-wrong-last',
        'api.example.com',
      )

      const result1 = validateApiKey(request1, {
        requiredApiKey: 'correct-key-here',
        allowLocalhost: false,
      })
      const result2 = validateApiKey(request2, {
        requiredApiKey: 'correct-key-here',
        allowLocalhost: false,
      })

      // Both should fail authentication
      expect(result1.authenticated).toBe(false)
      expect(result2.authenticated).toBe(false)
    })

    it('should handle keys of different lengths securely', () => {
      const shortKey = createMockRequest('abc', 'api.example.com')
      const longKey = createMockRequest(
        'abcdefghijklmnopqrstuvwxyz',
        'api.example.com',
      )

      const result1 = validateApiKey(shortKey, {
        requiredApiKey: 'the-actual-secret-key',
        allowLocalhost: false,
      })
      const result2 = validateApiKey(longKey, {
        requiredApiKey: 'the-actual-secret-key',
        allowLocalhost: false,
      })

      expect(result1.authenticated).toBe(false)
      expect(result2.authenticated).toBe(false)
    })
  })

  describe('host from headers fallback', () => {
    it('should use host header when request.host is undefined', () => {
      const request: AuthRequest = {
        headers: {
          get(name: string): string | null {
            if (name === 'host') return 'localhost:3000'
            return null
          },
        },
      }

      const result = validateApiKey(request, { requiredApiKey: 'secret' })

      expect(result.authenticated).toBe(true) // localhost bypass
    })
  })
})
