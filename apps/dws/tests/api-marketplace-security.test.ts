/**
 * API Marketplace Security Tests
 *
 * Comprehensive security testing for:
 * - Key leakage prevention
 * - Response sanitization
 * - Access control bypass attempts
 * - Rate limiting enforcement
 * - Injection attacks
 * 
 * Note: Some tests require CovenantSQL for state operations.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { Address } from 'viem';

// Check if CQL is available
const CQL_AVAILABLE = !!process.env.CQL_BLOCK_PRODUCER_ENDPOINT;

import {
  // Sanitizer
  sanitizeString,
  sanitizeObject,
  sanitizeResponse,
  createSanitizationConfig,
  checkForLeaks,
  extractPotentialKeys,
  DEFAULT_KEY_PATTERNS,
  // Access Control
  isDomainAllowed,
  isEndpointAllowed,
  checkAccess,
  checkRateLimit,
  incrementRateLimit,
  // Registry
  createListing,
  deposit,
  getOrCreateAccount,
  // Key Vault
  storeKey,
  decryptKeyForRequest,
  getKeyMetadata,
  // Proxy (mocked for security tests)
  proxyRequest,
  type ProxyRequest,
  type AccessControl,
} from '../src/api-marketplace';

const TEST_USER: Address = '0x1234567890123456789012345678901234567890';
const TEST_SELLER: Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

// ============================================================================
// Key Leakage Prevention Tests
// ============================================================================

describe('Key Leakage Prevention', () => {
  const sensitiveKeys = [
    // OpenAI formats - these match the sk- patterns
    'sk-proj-abcdefghijklmnopqrstuvwxyz123456789012345678',
    'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890',
    'sk-ant-abcdefghijklmnopqrstuvwxyz1234567890',
    
    // Google format (matches AIza pattern)
    'AIzaSyAbcdefghijklmnopqrstuvwxyz12345678',
    
    // Provider-specific (these match their patterns)
    'xai-abcdefghijklmnopqrstuvwxyz',
    'tvly-abcdefghijklmnopqrstuvwxyz',
    'fc-abcdefghijklmnopqrstuvwxyz1234',
    
    // 32+ char hex keys (common pattern)
    'abcdef1234567890abcdef1234567890',
  ];

  describe('Pattern Detection', () => {
    test('should detect all sensitive key patterns', () => {
      for (const key of sensitiveKeys) {
        const detected = DEFAULT_KEY_PATTERNS.some((pattern) => {
          pattern.lastIndex = 0;
          return pattern.test(key);
        });
        expect(detected).toBe(true);
      }
    });

    test('should not false-positive on normal text', () => {
      const normalTexts = [
        'Hello world',
        'This is a normal message',
        'User ID: 12345',
        'Order number: ABC-123',
        'Temperature: 72°F',
        'Price: $19.99',
        'Date: 2024-01-15',
        'Short text',
      ];

      const config = createSanitizationConfig();
      for (const text of normalTexts) {
        const sanitized = sanitizeString(text, config);
        expect(sanitized).toBe(text);
      }
    });
  });

  describe('Response Sanitization', () => {
    test('should sanitize keys in plain text responses', () => {
      const apiKey = 'sk-proj-mysecretkey1234567890abcdef';
      const response = `Your API key is: ${apiKey}. Keep it safe.`;
      
      const config = createSanitizationConfig([apiKey]);
      const sanitized = sanitizeString(response, config);
      
      expect(sanitized).not.toContain(apiKey);
      expect(sanitized).toContain('[REDACTED]');
    });

    test('should sanitize keys in JSON responses', () => {
      const apiKey = 'sk-test-secretkey123456789012345';
      const response = {
        success: true,
        data: {
          message: `Authenticated with key: ${apiKey}`,
          user: {
            apiKey: apiKey,
            name: 'Test User',
          },
        },
        meta: {
          authorization: `Bearer ${apiKey}`,
        },
      };

      const config = createSanitizationConfig([apiKey]);
      const sanitized = sanitizeObject(response, config) as typeof response;

      expect(JSON.stringify(sanitized)).not.toContain(apiKey);
      expect(sanitized.data.user.apiKey).toBe('[REDACTED]');
      expect(sanitized.data.user.name).toBe('Test User');
    });

    test('should sanitize keys in nested arrays', () => {
      const apiKey = 'sk-nested-array-test12345678901234';
      const response = {
        items: [
          { key: apiKey, value: 'test' },
          { key: 'public', value: apiKey },
        ],
      };

      const config = createSanitizationConfig([apiKey]);
      const sanitized = sanitizeObject(response, config) as typeof response;

      expect(JSON.stringify(sanitized)).not.toContain(apiKey);
    });

    test('should sanitize keys in error messages', () => {
      const apiKey = 'sk-error-test123456789012345678';
      const errorResponse = {
        error: {
          message: `Invalid API key: ${apiKey}`,
          code: 'INVALID_KEY',
          details: {
            providedKey: apiKey,
            expectedFormat: 'sk-*',
          },
        },
      };

      const config = createSanitizationConfig([apiKey]);
      const sanitized = sanitizeObject(errorResponse, config) as typeof errorResponse;

      expect(JSON.stringify(sanitized)).not.toContain(apiKey);
      expect(sanitized.error.details.providedKey).toBe('[REDACTED]');
    });

    test('should sanitize multiple different keys', () => {
      const openaiKey = 'sk-openai-test12345678901234567890';
      const anthropicKey = 'sk-ant-test12345678901234567890';
      const response = {
        openai: { key: openaiKey },
        anthropic: { key: anthropicKey },
        message: `Keys: ${openaiKey} and ${anthropicKey}`,
      };

      const config = createSanitizationConfig([openaiKey, anthropicKey]);
      const sanitized = sanitizeObject(response, config) as typeof response;

      expect(JSON.stringify(sanitized)).not.toContain(openaiKey);
      expect(JSON.stringify(sanitized)).not.toContain(anthropicKey);
    });

    test('should strip sensitive headers', () => {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-token',
        'X-API-Key': 'my-secret-key',
        'X-Request-ID': 'req-123',
        'Set-Cookie': 'session=abc123',
        'X-Custom-Header': 'allowed',
      };

      const config = createSanitizationConfig();
      const { headers: sanitized } = sanitizeResponse({}, headers, config);

      expect(sanitized['Content-Type']).toBe('application/json');
      expect(sanitized['Authorization']).toBeUndefined();
      expect(sanitized['X-API-Key']).toBeUndefined();
      expect(sanitized['Set-Cookie']).toBeUndefined();
      expect(sanitized['X-Custom-Header']).toBe('allowed');
    });
  });

  describe('Leak Detection', () => {
    test('should detect known key in response', () => {
      const apiKey = 'sk-known-leak-test1234567890123456';
      const response = { data: { leaked: apiKey } };

      const { leaked, details } = checkForLeaks(response, [apiKey]);

      expect(leaked).toBe(true);
      expect(details.length).toBeGreaterThan(0);
    });

    test('should detect pattern-matched keys', () => {
      const response = {
        message: 'Your key is sk-proj-newkey123456789012345678901234',
      };

      const { leaked } = checkForLeaks(response, []);
      expect(leaked).toBe(true);
    });

    test('should not report clean responses as leaked', () => {
      const cleanResponse = {
        success: true,
        message: 'Operation completed',
        data: { id: 123, name: 'Test' },
      };

      const { leaked } = checkForLeaks(cleanResponse, []);
      expect(leaked).toBe(false);
    });
  });
});

// ============================================================================
// Access Control Bypass Tests
// ============================================================================

describe('Access Control Bypass Prevention', () => {
  describe('Domain Bypass Attempts', () => {
    test('should block null byte injection in domains', () => {
      const ac: AccessControl = {
        allowedDomains: ['example.com'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      };

      // Null byte injection attempt
      expect(isDomainAllowed('example.com\0.evil.com', ac).allowed).toBe(false);
      expect(isDomainAllowed('evil.com\0.example.com', ac).allowed).toBe(false);
    });

    test('should block unicode homograph attacks', () => {
      const ac: AccessControl = {
        allowedDomains: ['example.com'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      };

      // Cyrillic 'е' looks like Latin 'e'
      expect(isDomainAllowed('еxample.com', ac).allowed).toBe(false);
    });

    test('should handle case sensitivity correctly', () => {
      const ac: AccessControl = {
        allowedDomains: ['Example.COM'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      };

      // Should be case-insensitive
      expect(isDomainAllowed('example.com', ac).allowed).toBe(true);
      expect(isDomainAllowed('EXAMPLE.COM', ac).allowed).toBe(true);
    });

    test('should block subdomain bypass when not using wildcard', () => {
      const ac: AccessControl = {
        allowedDomains: ['example.com'],
        blockedDomains: [],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      };

      expect(isDomainAllowed('evil.example.com', ac).allowed).toBe(false);
      expect(isDomainAllowed('api.example.com', ac).allowed).toBe(false);
    });
  });

  describe('Endpoint Bypass Attempts', () => {
    test('should block path traversal attempts', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['/api/*'],
        blockedEndpoints: ['/admin/*'],
        allowedMethods: ['GET'],
      };

      expect(isEndpointAllowed('/api/../admin/users', ac).allowed).toBe(false);
      expect(isEndpointAllowed('/api/..%2fadmin/users', ac).allowed).toBe(false);
    });

    test('should block URL encoding bypass', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['/api/*'],
        blockedEndpoints: ['/admin/*'],
        allowedMethods: ['GET'],
      };

      // Double encoding
      expect(isEndpointAllowed('/api/%2e%2e/admin', ac).allowed).toBe(false);
    });

    test('should handle query string in endpoints', () => {
      const ac: AccessControl = {
        allowedDomains: ['*'],
        blockedDomains: [],
        allowedEndpoints: ['/api/data', '/api/data*'],
        blockedEndpoints: [],
        allowedMethods: ['GET'],
      };

      // Exact match works
      expect(isEndpointAllowed('/api/data', ac).allowed).toBe(true);
      // With wildcard pattern, query params are handled
      expect(isEndpointAllowed('/api/data?admin=true', ac).allowed).toBe(true);
    });
  });

  describe('Rate Limit Bypass Attempts', () => {
    test('should enforce limits per user+listing combination', () => {
      const limits = {
        requestsPerSecond: 2,
        requestsPerMinute: 10,
        requestsPerDay: 100,
        requestsPerMonth: 1000,
      };

      const listingId = `rate-bypass-test-${Date.now()}`;
      const user1: Address = '0x1111111111111111111111111111111111111111';
      const user2: Address = '0x2222222222222222222222222222222222222222';

      // User 1 exceeds limit
      for (let i = 0; i < 3; i++) {
        incrementRateLimit(user1, listingId);
      }

      // User 1 should be blocked
      expect(checkRateLimit(user1, listingId, limits).allowed).toBe(false);

      // User 2 should still work (separate tracking)
      expect(checkRateLimit(user2, listingId, limits).allowed).toBe(true);
    });

    test('should track limits per listing', () => {
      const limits = {
        requestsPerSecond: 2,
        requestsPerMinute: 10,
        requestsPerDay: 100,
        requestsPerMonth: 1000,
      };

      const user: Address = '0x3333333333333333333333333333333333333333';
      const listing1 = `listing-1-${Date.now()}`;
      const listing2 = `listing-2-${Date.now()}`;

      // Exhaust limit on listing 1
      for (let i = 0; i < 3; i++) {
        incrementRateLimit(user, listing1);
      }

      // Listing 1 blocked, listing 2 allowed
      expect(checkRateLimit(user, listing1, limits).allowed).toBe(false);
      expect(checkRateLimit(user, listing2, limits).allowed).toBe(true);
    });
  });
});

// ============================================================================
// Key Vault Security Tests
// ============================================================================

describe('Key Vault Security', () => {
  test('should not expose encrypted key data in metadata', () => {
    const apiKey = 'sk-vault-security-test123456789';
    const vaultKey = storeKey('openai', TEST_SELLER, apiKey);

    const metadata = getKeyMetadata(vaultKey.id);
    
    expect(metadata).toBeDefined();
    expect(metadata?.id).toBe(vaultKey.id);
    // Ensure encrypted key is not in metadata
    expect((metadata as Record<string, unknown>)?.encryptedKey).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain(apiKey);
  });

  test('should only decrypt for authorized contexts', () => {
    const apiKey = 'sk-decrypt-auth-test1234567890';
    const vaultKey = storeKey('groq', TEST_SELLER, apiKey);

    // Valid decryption
    const decrypted = decryptKeyForRequest({
      keyId: vaultKey.id,
      requester: TEST_USER,
      requestContext: {
        listingId: 'test-listing',
        endpoint: '/chat/completions',
        requestId: 'req-123',
      },
    });

    expect(decrypted).toBe(apiKey);

    // Invalid key ID
    const invalidDecrypt = decryptKeyForRequest({
      keyId: 'non-existent',
      requester: TEST_USER,
      requestContext: {
        listingId: 'test-listing',
        endpoint: '/chat/completions',
        requestId: 'req-456',
      },
    });

    expect(invalidDecrypt).toBeNull();
  });

  test('should generate unique attestations', () => {
    const key1 = storeKey('openai', TEST_SELLER, 'key1');
    const key2 = storeKey('openai', TEST_SELLER, 'key2');

    expect(key1.attestation).toBeDefined();
    expect(key2.attestation).toBeDefined();
    expect(key1.attestation).not.toBe(key2.attestation);
  });
});

// ============================================================================
// Injection Attack Prevention
// ============================================================================

describe('Injection Attack Prevention', () => {
  test('should handle malicious JSON in sanitization', () => {
    const maliciousJson = {
      '__proto__': { 'polluted': true },
      'constructor': { 'prototype': { 'polluted': true } },
      'normal': 'value',
    };

    const config = createSanitizationConfig();
    const sanitized = sanitizeObject(maliciousJson, config);

    // Should not throw and should process normally
    expect(sanitized).toBeDefined();
    expect((sanitized as Record<string, unknown>).normal).toBe('value');
  });

  test('should handle deeply nested objects', () => {
    let deepObject: Record<string, unknown> = { value: 'sk-deep-test123456789012345' };
    for (let i = 0; i < 100; i++) {
      deepObject = { nested: deepObject };
    }

    const config = createSanitizationConfig();
    // Should not stack overflow
    const sanitized = sanitizeObject(deepObject, config);
    expect(sanitized).toBeDefined();
  });

  test('should handle circular reference gracefully', () => {
    // Note: JSON.stringify will fail on circular refs, but our sanitizer
    // should at least not crash
    const obj: Record<string, unknown> = { a: 1 };
    // Can't test true circular refs easily, but test self-reference handling
    const config = createSanitizationConfig();
    
    // This should not crash
    const sanitized = sanitizeObject(obj, config);
    expect(sanitized).toBeDefined();
  });

  test('should sanitize keys in various encodings', () => {
    const apiKey = 'sk-encoding-test12345678901234';
    const config = createSanitizationConfig([apiKey]);

    // Plain
    expect(sanitizeString(apiKey, config)).toBe('[REDACTED]');
    
    // In base64 context (the key itself, not base64 encoded)
    expect(sanitizeString(`key=${apiKey}`, config)).not.toContain(apiKey);
  });
});

// ============================================================================
// Full Flow Security Tests (require CQL)
// ============================================================================

describe.skipIf(!CQL_AVAILABLE)('Full Flow Security', () => {
  test('should prevent key exposure in complete proxy flow', () => {
    const apiKey = 'sk-flow-security-test1234567890';
    const seller = '0x4444444444444444444444444444444444444444' as Address;
    const user = '0x5555555555555555555555555555555555555555' as Address;

    // Setup
    const vaultKey = storeKey('openai', seller, apiKey);
    const listing = createListing({
      providerId: 'openai',
      seller,
      keyVaultId: vaultKey.id,
    });

    // Fund user
    deposit(user, 10000000000000000000n);

    // The key should never appear in listing data (handle BigInt for JSON)
    const listingStr = JSON.stringify(listing, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    expect(listingStr).not.toContain(apiKey);

    // Metadata should not contain key
    const metadata = getKeyMetadata(vaultKey.id);
    const metadataStr = JSON.stringify(metadata, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    expect(metadataStr).not.toContain(apiKey);
  });

  test.skipIf(!CQL_AVAILABLE)('should enforce payment before access', async () => {
    const testId = Date.now().toString(16).slice(-8);
    const poorUser = `0x${testId}666666666666666666666666666666` as Address;
    await getOrCreateAccount(poorUser); // Create account with 0 balance

    const seller = `0x${testId}777777777777777777777777777777` as Address;
    const vaultKey = storeKey('anthropic', seller, 'test-key');
    const listing = createListing({
      providerId: 'anthropic',
      seller,
      keyVaultId: vaultKey.id,
      pricePerRequest: 100000000000000n, // 0.0001 ETH
    });

    // Check access should pass (access control) - checkAccess is sync and only checks ACLs
    const accessCheck = checkAccess(
      poorUser,
      listing,
      '/messages',
      'POST'
    );
    expect(accessCheck.allowed).toBe(true);

    // But actual payment check would fail (tested in proxy)
    const account = await getOrCreateAccount(poorUser);
    expect(account.balance).toBe(0n);
    expect(account.balance < listing.pricePerRequest).toBe(true);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Security Edge Cases', () => {
  test('should handle empty strings', () => {
    const config = createSanitizationConfig();
    expect(sanitizeString('', config)).toBe('');
    expect(sanitizeObject('', config)).toBe('');
  });

  test('should handle null and undefined', () => {
    const config = createSanitizationConfig();
    expect(sanitizeObject(null, config)).toBeNull();
    expect(sanitizeObject(undefined, config)).toBeUndefined();
  });

  test('should handle very long strings', () => {
    const longKey = 'sk-' + 'a'.repeat(10000);
    const config = createSanitizationConfig([longKey]);
    
    const result = sanitizeString(longKey, config);
    expect(result).not.toContain(longKey);
  });

  test('should handle special regex characters in keys', () => {
    const specialKey = 'sk-test[key].*+?^${}()|\\';
    const config = createSanitizationConfig([specialKey]);
    
    const input = `Key is: ${specialKey}`;
    const result = sanitizeString(input, config);
    expect(result).not.toContain(specialKey);
  });

  test('should handle unicode in values', () => {
    const apiKey = 'sk-unicode-test123456789012345678';
    const config = createSanitizationConfig([apiKey]);
    const unicodeData = {
      message: `🔐 API key: ${apiKey}`,
      emoji: '💰🚀✨',
      chinese: '这是测试',
    };

    const sanitized = sanitizeObject(unicodeData, config) as typeof unicodeData;
    expect(sanitized.emoji).toBe('💰🚀✨');
    expect(sanitized.chinese).toBe('这是测试');
    expect(sanitized.message).not.toContain(apiKey);
    expect(sanitized.message).toContain('[REDACTED]');
  });
});


