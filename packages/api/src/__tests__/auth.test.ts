import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import {
  authenticate,
  type CombinedAuthConfig,
  constantTimeCompare,
  createWalletAuthMessage,
  extractAuthHeaders,
  parseWalletAuthMessage,
  validateAPIKey,
} from '../auth/core'
import {
  type APIKeyConfig,
  AuthError,
  AuthErrorCode,
  AuthMethod,
  type WalletSignatureConfig,
} from '../auth/types'

describe('Auth Core', () => {
  describe('constantTimeCompare', () => {
    test('returns true for equal strings', () => {
      expect(constantTimeCompare('hello', 'hello')).toBe(true)
      expect(constantTimeCompare('0xABCDEF', '0xabcdef')).toBe(true)
    })

    test('returns false for different strings', () => {
      expect(constantTimeCompare('hello', 'world')).toBe(false)
      expect(constantTimeCompare('hello', 'hello!')).toBe(false)
    })

    test('returns false for different lengths', () => {
      expect(constantTimeCompare('short', 'longer string')).toBe(false)
    })
  })

  describe('extractAuthHeaders', () => {
    test('extracts headers from object', () => {
      const headers = {
        'x-oauth3-session': '0x123',
        'x-jeju-address': '0xabc',
        'x-jeju-timestamp': '12345',
        'x-jeju-signature': '0xsig',
        'x-api-key': 'key123',
        authorization: 'Bearer token',
      }

      const extracted = extractAuthHeaders(headers)

      expect(extracted['x-oauth3-session']).toBe('0x123')
      expect(extracted['x-jeju-address']).toBe('0xabc')
      expect(extracted['x-jeju-timestamp']).toBe('12345')
      expect(extracted['x-jeju-signature']).toBe('0xsig')
      expect(extracted['x-api-key']).toBe('key123')
      expect(extracted.authorization).toBe('Bearer token')
    })

    test('extracts headers from Headers object', () => {
      const headers = new Headers()
      headers.set('x-oauth3-session', '0x456')
      headers.set('x-api-key', 'apikey')

      const extracted = extractAuthHeaders(headers)

      expect(extracted['x-oauth3-session']).toBe('0x456')
      expect(extracted['x-api-key']).toBe('apikey')
    })

    test('handles missing headers', () => {
      const extracted = extractAuthHeaders({})

      expect(extracted['x-oauth3-session']).toBeUndefined()
      expect(extracted['x-api-key']).toBeUndefined()
    })
  })

  describe('createWalletAuthMessage', () => {
    test('creates message with default prefix', () => {
      const message = createWalletAuthMessage(1234567890)
      expect(message).toBe('jeju-dapp:1234567890')
    })

    test('creates message with custom prefix', () => {
      const message = createWalletAuthMessage(1234567890, 'my-app')
      expect(message).toBe('my-app:1234567890')
    })
  })

  describe('parseWalletAuthMessage', () => {
    test('parses valid message', () => {
      const result = parseWalletAuthMessage('jeju-dapp:1234567890')
      expect(result).toEqual({ timestamp: 1234567890 })
    })

    test('parses message with custom prefix', () => {
      const result = parseWalletAuthMessage('my-app:1234567890', 'my-app')
      expect(result).toEqual({ timestamp: 1234567890 })
    })

    test('returns null for invalid message', () => {
      expect(parseWalletAuthMessage('invalid')).toBeNull()
      expect(parseWalletAuthMessage('jeju-dapp:')).toBeNull()
      expect(parseWalletAuthMessage('wrong-prefix:123')).toBeNull()
    })
  })

  describe('validateAPIKey', () => {
    const config: APIKeyConfig = {
      keys: new Map([
        [
          'valid-key-123',
          {
            address: '0x1234567890123456789012345678901234567890' as Address,
            permissions: ['read', 'write'],
            rateLimitTier: 'premium',
          },
        ],
        [
          'expired-key-456',
          {
            address: '0x0987654321098765432109876543210987654321' as Address,
            permissions: ['read'],
            rateLimitTier: 'basic',
            expiresAt: Date.now() - 1000, // Already expired
          },
        ],
      ]),
    }

    test('validates correct API key', () => {
      const result = validateAPIKey('valid-key-123', config)

      expect(result.valid).toBe(true)
      if (!result.valid || !result.user) {
        throw new Error('Expected valid API key result')
      }
      expect(result.user.address).toBe(
        '0x1234567890123456789012345678901234567890',
      )
      expect(result.user.method).toBe(AuthMethod.API_KEY)
      expect(result.user.permissions).toEqual(['read', 'write'])
      expect(result.rateLimitTier).toBe('premium')
    })

    test('rejects invalid API key', () => {
      const result = validateAPIKey('invalid-key', config)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid API key')
    })

    test('rejects expired API key', () => {
      const result = validateAPIKey('expired-key-456', config)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('API key expired')
    })
  })

  describe('authenticate', () => {
    const apiKeyConfig: APIKeyConfig = {
      keys: new Map([
        [
          'test-api-key',
          {
            address: '0x1234567890123456789012345678901234567890' as Address,
            permissions: ['read'],
            rateLimitTier: 'basic',
          },
        ],
      ]),
    }

    const walletConfig: WalletSignatureConfig = {
      domain: 'test.example.com',
      validityWindowMs: 5 * 60 * 1000,
    }

    test('authenticates with API key', async () => {
      const config: CombinedAuthConfig = {
        apiKey: apiKeyConfig,
      }

      const headers = {
        'x-api-key': 'test-api-key',
      }

      const result = await authenticate(headers, config)

      expect(result.authenticated).toBe(true)
      if (!result.authenticated || !result.user) {
        throw new Error('Expected authenticated result')
      }
      expect(result.user.address).toBe(
        '0x1234567890123456789012345678901234567890',
      )
      expect(result.method).toBe(AuthMethod.API_KEY)
    })

    test('returns error for invalid credentials', async () => {
      const config: CombinedAuthConfig = {
        apiKey: apiKeyConfig,
      }

      const headers = {
        'x-api-key': 'wrong-key',
      }

      const result = await authenticate(headers, config)

      expect(result.authenticated).toBe(false)
      expect(result.error).toBe('Invalid API key')
    })

    test('returns error when no credentials provided', async () => {
      const config: CombinedAuthConfig = {
        apiKey: apiKeyConfig,
      }

      const result = await authenticate({}, config)

      expect(result.authenticated).toBe(false)
      expect(result.error).toBe('No authentication credentials provided')
    })

    test('tries methods in priority order', async () => {
      const config: CombinedAuthConfig = {
        apiKey: apiKeyConfig,
        walletSignature: walletConfig,
        priority: [AuthMethod.API_KEY, AuthMethod.WALLET_SIGNATURE],
      }

      // Only API key provided
      const headers = {
        'x-api-key': 'test-api-key',
      }

      const result = await authenticate(headers, config)

      expect(result.authenticated).toBe(true)
      expect(result.method).toBe(AuthMethod.API_KEY)
    })
  })
})

describe('Auth Types', () => {
  test('AuthError has correct properties', () => {
    const error = new AuthError(
      'Test error',
      AuthErrorCode.INVALID_SESSION,
      401,
    )

    expect(error.message).toBe('Test error')
    expect(error.code).toBe(AuthErrorCode.INVALID_SESSION)
    expect(error.statusCode).toBe(401)
    expect(error.name).toBe('AuthError')
  })

  test('AuthMethod enum has expected values', () => {
    expect(AuthMethod.OAUTH3).toBe('oauth3')
    expect(AuthMethod.WALLET_SIGNATURE).toBe('wallet-signature')
    expect(AuthMethod.API_KEY).toBe('api-key')
  })
})
