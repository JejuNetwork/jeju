/**
 * Auth Core Tests - Live Integration
 *
 * Tests authentication without mocks where possible.
 * OAuth3 tests use live TEE agent when available, skip otherwise.
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  authenticate,
  type CombinedAuthConfig,
  constantTimeCompare,
  createWalletAuthMessage,
  extractAuthHeaders,
  parseWalletAuthMessage,
  requireAuth,
  validateAPIKey,
  validateAPIKeyFromHeaders,
  validateOAuth3FromHeaders,
  validateOAuth3Session,
  validateWalletSignature,
  validateWalletSignatureFromHeaders,
} from '../auth/core'
import {
  type APIKeyConfig,
  AuthError,
  AuthErrorCode,
  AuthMethod,
  type OAuth3Config,
  type WalletSignatureConfig,
} from '../auth/types'
import {
  describeWithInfra,
  hasInfra,
} from '@jeju/tests/shared/live-infrastructure'

// Check if OAuth3 TEE service is available for live tests
const OAUTH3_AVAILABLE = await hasInfra({ gateway: true })
const OAUTH3_TEE_URL = process.env.OAUTH3_TEE_URL || 'https://oauth3.jeju.ai'

// Valid hex session ID (32 bytes = 64 hex chars + 0x prefix)
const validSessionId =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

describeWithInfra(
  'OAuth3 Validation with Live TEE',
  { gateway: true },
  () => {
    const oauth3Config: OAuth3Config = {
      teeAgentUrl: OAUTH3_TEE_URL,
      appId: '0x1234',
    }

    test('rejects invalid session ID format', async () => {
      const result = await validateOAuth3Session('not-a-hex', oauth3Config)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid session ID format')
    })

    test('rejects non-existent session', async () => {
      // A valid format but non-existent session should return session not found
      const result = await validateOAuth3Session(validSessionId, oauth3Config)
      expect(result.valid).toBe(false)
      // Either "Session not found" or network error depending on TEE availability
    })
  },
  OAUTH3_AVAILABLE,
)

describe('OAuth3 Validation Unit Tests', () => {
  const oauth3Config: OAuth3Config = {
    teeAgentUrl: 'https://tee.example.com',
    appId: '0x1234',
  }

  test('rejects invalid session ID format immediately', async () => {
    // This doesn't require network - validates format locally
    const result = await validateOAuth3Session('not-a-hex', oauth3Config)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid session ID format')
  })

  test('rejects too-short session ID', async () => {
    const result = await validateOAuth3Session('0x1234', oauth3Config)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid session ID format')
  })

  test('rejects malformed hex', async () => {
    const result = await validateOAuth3Session(
      '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
      oauth3Config,
    )
    expect(result.valid).toBe(false)
  })
})

describe('validateOAuth3FromHeaders', () => {
  const oauth3Config: OAuth3Config = {
    teeAgentUrl: 'https://tee.example.com',
    appId: '0x1234',
  }

  test('rejects missing header', async () => {
    const result = await validateOAuth3FromHeaders({}, oauth3Config)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Missing x-oauth3-session header')
  })

  test('rejects invalid session ID format in header', async () => {
    const headers = { 'x-oauth3-session': 'invalid-format' }
    const result = await validateOAuth3FromHeaders(headers, oauth3Config)
    expect(result.valid).toBe(false)
  })
})

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

  describe('validateAPIKeyFromHeaders', () => {
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
      ]),
    }

    test('validates API key from x-api-key header', () => {
      const headers = { 'x-api-key': 'valid-key-123' }
      const result = validateAPIKeyFromHeaders(headers, config)

      expect(result.valid).toBe(true)
      if (!result.valid || !result.user) {
        throw new Error('Expected valid result')
      }
      expect(result.user.address).toBe(
        '0x1234567890123456789012345678901234567890',
      )
    })

    test('validates API key from Bearer authorization header', () => {
      const headers = { authorization: 'Bearer valid-key-123' }
      const result = validateAPIKeyFromHeaders(headers, config)

      expect(result.valid).toBe(true)
      if (!result.valid || !result.user) {
        throw new Error('Expected valid result')
      }
      expect(result.user.address).toBe(
        '0x1234567890123456789012345678901234567890',
      )
    })

    test('prefers x-api-key over authorization header', () => {
      const headers = {
        'x-api-key': 'valid-key-123',
        authorization: 'Bearer invalid-key',
      }
      const result = validateAPIKeyFromHeaders(headers, config)

      expect(result.valid).toBe(true)
    })

    test('rejects missing API key', () => {
      const result = validateAPIKeyFromHeaders({}, config)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Missing')
    })

    test('rejects invalid Bearer format', () => {
      const headers = { authorization: 'Basic invalid' }
      const result = validateAPIKeyFromHeaders(headers, config)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Missing')
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

describe('Wallet Signature Validation', () => {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const walletConfig: WalletSignatureConfig = {
    validityWindowMs: 5 * 60 * 1000, // 5 minutes
    messagePrefix: 'test-app',
  }

  test('validates correct wallet signature', async () => {
    const timestamp = Date.now()
    const message = `test-app:${timestamp}`
    const signature = await account.signMessage({ message })

    const result = await validateWalletSignature(
      account.address,
      timestamp,
      signature,
      walletConfig,
    )

    expect(result.valid).toBe(true)
    if (!result.valid || !result.user) {
      throw new Error('Expected valid result')
    }
    expect(result.user.address).toBe(account.address)
    expect(result.user.method).toBe(AuthMethod.WALLET_SIGNATURE)
  })

  test('rejects future timestamp', async () => {
    const futureTimestamp = Date.now() + 60000
    const message = `test-app:${futureTimestamp}`
    const signature = await account.signMessage({ message })

    const result = await validateWalletSignature(
      account.address,
      futureTimestamp,
      signature,
      walletConfig,
    )

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Timestamp is in the future')
  })

  test('rejects expired signature', async () => {
    const oldTimestamp = Date.now() - 10 * 60 * 1000 // 10 minutes ago
    const message = `test-app:${oldTimestamp}`
    const signature = await account.signMessage({ message })

    const result = await validateWalletSignature(
      account.address,
      oldTimestamp,
      signature,
      walletConfig,
    )

    expect(result.valid).toBe(false)
    expect(result.expired).toBe(true)
    expect(result.error).toBe('Signature expired')
  })

  test('rejects invalid signature', async () => {
    const timestamp = Date.now()
    const wrongMessage = `wrong-prefix:${timestamp}`
    const signature = await account.signMessage({ message: wrongMessage })

    const result = await validateWalletSignature(
      account.address,
      timestamp,
      signature,
      walletConfig,
    )

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid signature')
  })

  test('uses domain as fallback for messagePrefix', async () => {
    const domainConfig: WalletSignatureConfig = {
      domain: 'my-domain.com',
      validityWindowMs: 5 * 60 * 1000,
    }

    const timestamp = Date.now()
    const message = `my-domain.com:${timestamp}`
    const signature = await account.signMessage({ message })

    const result = await validateWalletSignature(
      account.address,
      timestamp,
      signature,
      domainConfig,
    )

    expect(result.valid).toBe(true)
  })

  test('uses default prefix when no domain or messagePrefix', async () => {
    const minimalConfig: WalletSignatureConfig = {
      validityWindowMs: 5 * 60 * 1000,
    }

    const timestamp = Date.now()
    const message = `jeju-dapp:${timestamp}`
    const signature = await account.signMessage({ message })

    const result = await validateWalletSignature(
      account.address,
      timestamp,
      signature,
      minimalConfig,
    )

    expect(result.valid).toBe(true)
  })
})

describe('validateWalletSignatureFromHeaders', () => {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const walletConfig: WalletSignatureConfig = {
    validityWindowMs: 5 * 60 * 1000,
    messagePrefix: 'test-app',
  }

  test('validates correct headers', async () => {
    const timestamp = Date.now()
    const message = `test-app:${timestamp}`
    const signature = await account.signMessage({ message })

    const headers = {
      'x-jeju-address': account.address,
      'x-jeju-timestamp': String(timestamp),
      'x-jeju-signature': signature,
    }

    const result = await validateWalletSignatureFromHeaders(
      headers,
      walletConfig,
    )

    expect(result.valid).toBe(true)
    if (!result.valid || !result.user) {
      throw new Error('Expected valid result')
    }
    expect(result.user.address).toBe(account.address)
  })

  test('rejects missing headers', async () => {
    const result = await validateWalletSignatureFromHeaders({}, walletConfig)

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Missing wallet signature headers')
  })

  test('rejects invalid address format', async () => {
    const headers = {
      'x-jeju-address': 'invalid-address',
      'x-jeju-timestamp': String(Date.now()),
      'x-jeju-signature': '0x1234',
    }

    const result = await validateWalletSignatureFromHeaders(
      headers,
      walletConfig,
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid headers')
  })

  test('rejects invalid timestamp format', async () => {
    const headers = {
      'x-jeju-address': account.address,
      'x-jeju-timestamp': 'not-a-number',
      'x-jeju-signature': '0x1234',
    }

    const result = await validateWalletSignatureFromHeaders(
      headers,
      walletConfig,
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid headers')
  })
})

describe('requireAuth', () => {
  const apiKeyConfig: APIKeyConfig = {
    keys: new Map([
      [
        'valid-key',
        {
          address: '0x1234567890123456789012345678901234567890' as Address,
          permissions: ['read'],
          rateLimitTier: 'basic',
        },
      ],
    ]),
  }

  test('returns user for valid credentials', async () => {
    const config: CombinedAuthConfig = { apiKey: apiKeyConfig }
    const headers = { 'x-api-key': 'valid-key' }

    const user = await requireAuth(headers, config)

    expect(user.address).toBe('0x1234567890123456789012345678901234567890')
    expect(user.method).toBe(AuthMethod.API_KEY)
  })

  test('throws AuthError for missing credentials', async () => {
    const config: CombinedAuthConfig = { apiKey: apiKeyConfig }

    await expect(requireAuth({}, config)).rejects.toThrow(AuthError)
  })

  test('throws AuthError with SESSION_EXPIRED for expired credentials', async () => {
    const expiredConfig: APIKeyConfig = {
      keys: new Map([
        [
          'expired-key',
          {
            address: '0x1234567890123456789012345678901234567890' as Address,
            permissions: ['read'],
            rateLimitTier: 'basic',
            expiresAt: Date.now() - 1000,
          },
        ],
      ]),
    }

    const config: CombinedAuthConfig = { apiKey: expiredConfig }
    const headers = { 'x-api-key': 'expired-key' }

    try {
      await requireAuth(headers, config)
      throw new Error('Expected to throw')
    } catch (error) {
      if (!(error instanceof AuthError)) {
        throw new Error('Expected AuthError')
      }
      expect(error.code).toBe(AuthErrorCode.SESSION_EXPIRED)
    }
  })

  test('throws AuthError for invalid credentials', async () => {
    const config: CombinedAuthConfig = { apiKey: apiKeyConfig }
    const headers = { 'x-api-key': 'wrong-key' }

    await expect(requireAuth(headers, config)).rejects.toThrow(AuthError)
  })
})
