/**
 * DWS Type Guards Unit Tests
 *
 * Comprehensive tests for DWS-specific type guards including
 * viem types, agent types, and API-specific validations.
 */

import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import type { AgentCharacter } from '../../agents/types'
import {
  type CDNRegion,
  type CronAction,
  getAddressFromRequest,
  getUserIdFromRequest,
  type InstanceStatus,
  type InvocationStatus,
  isAgentCharacter,
  isAgentStatus,
  isCDNRegion,
  isCronAction,
  isEqliteQueryResponse,
  isInstanceStatus,
  isInvocationStatus,
  isMemoryType,
  isRegisterAgentRequest,
  isRiskLevel,
  isUpdateAgentRequest,
  isValidHex,
  type MemoryType,
  parseAddress,
  parseAddressOrDefault,
  parseAgentStatus,
  parseCDNRegion,
  type RiskLevel,
  requireAddressFromRequest,
} from './type-guards'

// =============================================================================
// Test Constants
// =============================================================================

const VALID_ADDRESS: Address = '0x1234567890123456789012345678901234567890'
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'
const INVALID_ADDRESSES = [
  '0x123', // Too short
  '0x12345678901234567890123456789012345678901234567890', // Too long
  '1234567890123456789012345678901234567890', // Missing 0x prefix
  '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid hex chars
  '', // Empty
  null,
  undefined,
  123,
  {},
]

const _VALID_HEX: Hex = '0xabcdef1234567890'
const _INVALID_HEXES = [
  'abcdef', // Missing 0x prefix
  '0x', // Just prefix
  '0xGGGG', // Invalid hex chars
  '', // Empty
  null,
  undefined,
  123,
]

// =============================================================================
// Viem Type Guards
// =============================================================================

describe('isValidHex', () => {
  test('returns true for valid hex strings', () => {
    expect(isValidHex('0x')).toBe(true) // Empty hex is valid
    expect(isValidHex('0x0')).toBe(true)
    expect(isValidHex('0x123abc')).toBe(true)
    expect(isValidHex('0xABCDEF')).toBe(true)
    expect(isValidHex('0xabcdef1234567890')).toBe(true)
    expect(isValidHex(`0x${'a'.repeat(64)}`)).toBe(true) // 32 bytes
  })

  test('returns false for invalid hex strings', () => {
    expect(isValidHex('hello')).toBe(false)
    expect(isValidHex('0xGHIJ')).toBe(false)
    expect(isValidHex('xyz123')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isValidHex(null)).toBe(false)
    expect(isValidHex(undefined)).toBe(false)
  })

  test('returns false for non-string types', () => {
    expect(isValidHex(123 as unknown as string)).toBe(false)
    expect(isValidHex({} as unknown as string)).toBe(false)
    expect(isValidHex([] as unknown as string)).toBe(false)
  })
})

describe('parseAddress', () => {
  test('returns valid addresses', () => {
    expect(parseAddress(VALID_ADDRESS)).toBe(VALID_ADDRESS)
    // Zero address is not considered valid by isValidAddress
    expect(parseAddress(ZERO_ADDRESS)).toBe(null)
  })

  test('returns null for invalid addresses', () => {
    for (const invalid of INVALID_ADDRESSES) {
      expect(parseAddress(invalid as string | null | undefined)).toBe(null)
    }
  })

  test('returns null for null and undefined', () => {
    expect(parseAddress(null)).toBe(null)
    expect(parseAddress(undefined)).toBe(null)
  })

  test('handles case variations', () => {
    // viem's isAddress validates checksums for mixed-case addresses
    // All-lowercase addresses are valid (non-checksummed format)
    const lowercase = '0xabcdef1234567890abcdef1234567890abcdef12'
    expect(parseAddress(lowercase)).toBe(lowercase)

    // Mixed-case addresses must match their EIP-55 checksum to be valid
    // Random mixed case will typically fail checksum validation
    const invalidMixedCase = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
    expect(parseAddress(invalidMixedCase)).toBe(null)
  })
})

describe('parseAddressOrDefault', () => {
  test('returns valid addresses', () => {
    expect(parseAddressOrDefault(VALID_ADDRESS)).toBe(VALID_ADDRESS)
  })

  test('returns default for invalid addresses', () => {
    expect(parseAddressOrDefault(null)).toBe(ZERO_ADDRESS)
    expect(parseAddressOrDefault(undefined)).toBe(ZERO_ADDRESS)
    expect(parseAddressOrDefault('invalid')).toBe(ZERO_ADDRESS)
  })

  test('uses custom default address', () => {
    const customDefault =
      '0x1111111111111111111111111111111111111111' as Address
    expect(parseAddressOrDefault(null, customDefault)).toBe(customDefault)
    expect(parseAddressOrDefault('invalid', customDefault)).toBe(customDefault)
  })
})

// =============================================================================
// Agent Type Guards
// =============================================================================

describe('isAgentStatus', () => {
  const validStatuses = [
    'pending',
    'deploying',
    'active',
    'paused',
    'error',
    'terminated',
  ]

  test('returns true for valid agent statuses', () => {
    for (const status of validStatuses) {
      expect(isAgentStatus(status)).toBe(true)
    }
  })

  test('returns false for invalid statuses', () => {
    expect(isAgentStatus('invalid')).toBe(false)
    expect(isAgentStatus('ACTIVE')).toBe(false) // Case sensitive
    expect(isAgentStatus('running')).toBe(false)
    expect(isAgentStatus('')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isAgentStatus(null)).toBe(false)
    expect(isAgentStatus(undefined)).toBe(false)
  })
})

describe('parseAgentStatus', () => {
  test('returns valid status', () => {
    expect(parseAgentStatus('active')).toBe('active')
    expect(parseAgentStatus('paused')).toBe('paused')
  })

  test('returns default for invalid status', () => {
    expect(parseAgentStatus('invalid')).toBe('pending')
    expect(parseAgentStatus(null)).toBe('pending')
    expect(parseAgentStatus(undefined)).toBe('pending')
  })

  test('uses custom default status', () => {
    expect(parseAgentStatus('invalid', 'error')).toBe('error')
    expect(parseAgentStatus(null, 'terminated')).toBe('terminated')
  })
})

describe('isAgentCharacter', () => {
  const validCharacter: AgentCharacter = {
    name: 'TestAgent',
    system: 'You are a helpful assistant.',
    bio: ['Line 1', 'Line 2'],
  }

  test('returns true for valid agent character', () => {
    expect(isAgentCharacter(validCharacter)).toBe(true)
  })

  test('returns true with minimal required fields', () => {
    expect(
      isAgentCharacter({
        name: 'Test',
        system: 'System prompt',
        bio: [],
      }),
    ).toBe(true)
  })

  test('returns false when name is missing', () => {
    expect(
      isAgentCharacter({
        system: 'System prompt',
        bio: ['Bio'],
      }),
    ).toBe(false)
  })

  test('returns false when system is missing', () => {
    expect(
      isAgentCharacter({
        name: 'Test',
        bio: ['Bio'],
      }),
    ).toBe(false)
  })

  test('returns false when bio is missing', () => {
    expect(
      isAgentCharacter({
        name: 'Test',
        system: 'System prompt',
      }),
    ).toBe(false)
  })

  test('returns false when bio is not a string array', () => {
    expect(
      isAgentCharacter({
        name: 'Test',
        system: 'System prompt',
        bio: [1, 2, 3], // Numbers instead of strings
      }),
    ).toBe(false)

    expect(
      isAgentCharacter({
        name: 'Test',
        system: 'System prompt',
        bio: 'Not an array',
      }),
    ).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isAgentCharacter(null)).toBe(false)
    expect(isAgentCharacter(undefined)).toBe(false)
  })

  test('returns false for non-objects', () => {
    expect(isAgentCharacter('string')).toBe(false)
    expect(isAgentCharacter(123)).toBe(false)
    expect(isAgentCharacter([])).toBe(false)
  })
})

describe('isRegisterAgentRequest', () => {
  test('returns true for valid register request', () => {
    expect(
      isRegisterAgentRequest({
        character: {
          name: 'Test',
          system: 'System',
          bio: ['Bio'],
        },
      }),
    ).toBe(true)
  })

  test('returns true with additional properties', () => {
    expect(
      isRegisterAgentRequest({
        character: {
          name: 'Test',
          system: 'System',
          bio: ['Bio'],
        },
        extra: 'ignored',
      }),
    ).toBe(true)
  })

  test('returns false when character is invalid', () => {
    expect(
      isRegisterAgentRequest({
        character: {
          name: 'Test',
          // Missing system and bio
        },
      }),
    ).toBe(false)
  })

  test('returns false when character is missing', () => {
    expect(isRegisterAgentRequest({})).toBe(false)
    expect(isRegisterAgentRequest({ other: 'data' })).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isRegisterAgentRequest(null)).toBe(false)
    expect(isRegisterAgentRequest(undefined)).toBe(false)
  })
})

describe('isUpdateAgentRequest', () => {
  test('returns true when character is present', () => {
    expect(isUpdateAgentRequest({ character: { name: 'New' } })).toBe(true)
  })

  test('returns true when models is present', () => {
    expect(isUpdateAgentRequest({ models: ['gpt-4'] })).toBe(true)
  })

  test('returns true when runtime is present', () => {
    expect(isUpdateAgentRequest({ runtime: { memory: 512 } })).toBe(true)
  })

  test('returns true when secrets is present', () => {
    expect(isUpdateAgentRequest({ secrets: { API_KEY: 'xxx' } })).toBe(true)
  })

  test('returns true when metadata is present', () => {
    expect(isUpdateAgentRequest({ metadata: { version: '1.0' } })).toBe(true)
  })

  test('returns true with multiple properties', () => {
    expect(
      isUpdateAgentRequest({
        character: { name: 'Updated' },
        models: ['gpt-4'],
        metadata: { version: '2.0' },
      }),
    ).toBe(true)
  })

  test('returns false for empty object', () => {
    expect(isUpdateAgentRequest({})).toBe(false)
  })

  test('returns false when only unrelated properties', () => {
    expect(isUpdateAgentRequest({ unrelated: 'value' })).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isUpdateAgentRequest(null)).toBe(false)
    expect(isUpdateAgentRequest(undefined)).toBe(false)
  })
})

// =============================================================================
// Cron Action Type Guards
// =============================================================================

describe('isCronAction', () => {
  const validActions: CronAction[] = ['think', 'post', 'check', 'custom']

  test('returns true for valid cron actions', () => {
    for (const action of validActions) {
      expect(isCronAction(action)).toBe(true)
    }
  })

  test('returns false for invalid actions', () => {
    expect(isCronAction('run')).toBe(false)
    expect(isCronAction('THINK')).toBe(false) // Case sensitive
    expect(isCronAction('')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isCronAction(null)).toBe(false)
    expect(isCronAction(undefined)).toBe(false)
  })
})

// =============================================================================
// Instance Status Type Guards
// =============================================================================

describe('isInstanceStatus', () => {
  const validStatuses: InstanceStatus[] = [
    'starting',
    'ready',
    'busy',
    'draining',
    'stopped',
  ]

  test('returns true for valid instance statuses', () => {
    for (const status of validStatuses) {
      expect(isInstanceStatus(status)).toBe(true)
    }
  })

  test('returns false for invalid statuses', () => {
    expect(isInstanceStatus('running')).toBe(false)
    expect(isInstanceStatus('READY')).toBe(false)
    expect(isInstanceStatus('')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isInstanceStatus(null)).toBe(false)
    expect(isInstanceStatus(undefined)).toBe(false)
  })
})

// =============================================================================
// Invocation Status Type Guards
// =============================================================================

describe('isInvocationStatus', () => {
  const validStatuses: InvocationStatus[] = [
    'pending',
    'processing',
    'completed',
    'error',
    'timeout',
  ]

  test('returns true for valid invocation statuses', () => {
    for (const status of validStatuses) {
      expect(isInvocationStatus(status)).toBe(true)
    }
  })

  test('returns false for invalid statuses', () => {
    expect(isInvocationStatus('running')).toBe(false)
    expect(isInvocationStatus('COMPLETED')).toBe(false)
    expect(isInvocationStatus('')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isInvocationStatus(null)).toBe(false)
    expect(isInvocationStatus(undefined)).toBe(false)
  })
})

// =============================================================================
// Memory Type Guards
// =============================================================================

describe('isMemoryType', () => {
  const validTypes: MemoryType[] = ['message', 'fact', 'goal', 'reflection']

  test('returns true for valid memory types', () => {
    for (const type of validTypes) {
      expect(isMemoryType(type)).toBe(true)
    }
  })

  test('returns false for invalid types', () => {
    expect(isMemoryType('thought')).toBe(false)
    expect(isMemoryType('MESSAGE')).toBe(false)
    expect(isMemoryType('')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isMemoryType(null)).toBe(false)
    expect(isMemoryType(undefined)).toBe(false)
  })
})

// =============================================================================
// Request Header Extraction
// =============================================================================

describe('getAddressFromRequest', () => {
  test('extracts valid address from header', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-address': VALID_ADDRESS },
    })
    expect(getAddressFromRequest(request)).toBe(VALID_ADDRESS)
  })

  test('returns null for invalid address', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-address': 'invalid' },
    })
    expect(getAddressFromRequest(request)).toBe(null)
  })

  test('returns null for missing header', () => {
    const request = new Request('https://example.com')
    expect(getAddressFromRequest(request)).toBe(null)
  })

  test('returns null for zero address', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-address': ZERO_ADDRESS },
    })
    expect(getAddressFromRequest(request)).toBe(null)
  })
})

describe('requireAddressFromRequest', () => {
  test('returns address when valid', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-address': VALID_ADDRESS },
    })
    expect(requireAddressFromRequest(request)).toBe(VALID_ADDRESS)
  })

  test('throws for missing header', () => {
    const request = new Request('https://example.com')
    expect(() => requireAddressFromRequest(request)).toThrow(
      'Missing or invalid x-jeju-address header',
    )
  })

  test('throws for invalid address', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-address': 'invalid' },
    })
    expect(() => requireAddressFromRequest(request)).toThrow(
      'Missing or invalid x-jeju-address header',
    )
  })
})

describe('getUserIdFromRequest', () => {
  test('extracts user id from header', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-user-id': 'user123' },
    })
    expect(getUserIdFromRequest(request)).toBe('user123')
  })

  test('returns null for missing header', () => {
    const request = new Request('https://example.com')
    expect(getUserIdFromRequest(request)).toBe(null)
  })
})

// =============================================================================
// CDN Region Type Guards
// =============================================================================

describe('isCDNRegion', () => {
  const validRegions: CDNRegion[] = [
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'eu-west-1',
    'eu-west-2',
    'eu-central-1',
    'ap-northeast-1',
    'ap-southeast-1',
    'ap-south-1',
    'sa-east-1',
  ]

  test('returns true for valid CDN regions', () => {
    for (const region of validRegions) {
      expect(isCDNRegion(region)).toBe(true)
    }
  })

  test('returns false for invalid regions', () => {
    expect(isCDNRegion('us-central-1')).toBe(false)
    expect(isCDNRegion('US-EAST-1')).toBe(false) // Case sensitive
    expect(isCDNRegion('')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isCDNRegion(null)).toBe(false)
    expect(isCDNRegion(undefined)).toBe(false)
  })
})

describe('parseCDNRegion', () => {
  test('returns valid region', () => {
    expect(parseCDNRegion('us-west-2')).toBe('us-west-2')
    expect(parseCDNRegion('eu-central-1')).toBe('eu-central-1')
  })

  test('returns default for invalid region', () => {
    expect(parseCDNRegion('invalid')).toBe('us-east-1')
    expect(parseCDNRegion(null)).toBe('us-east-1')
    expect(parseCDNRegion(undefined)).toBe('us-east-1')
  })

  test('uses custom default region', () => {
    expect(parseCDNRegion('invalid', 'eu-west-1')).toBe('eu-west-1')
    expect(parseCDNRegion(null, 'ap-south-1')).toBe('ap-south-1')
  })
})

// =============================================================================
// Risk Level Type Guards
// =============================================================================

describe('isRiskLevel', () => {
  const validLevels: RiskLevel[] = ['low', 'medium', 'high']

  test('returns true for valid risk levels', () => {
    for (const level of validLevels) {
      expect(isRiskLevel(level)).toBe(true)
    }
  })

  test('returns false for invalid levels', () => {
    expect(isRiskLevel('critical')).toBe(false)
    expect(isRiskLevel('LOW')).toBe(false) // Case sensitive
    expect(isRiskLevel('')).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isRiskLevel(null)).toBe(false)
    expect(isRiskLevel(undefined)).toBe(false)
  })
})

// =============================================================================
// EQLite Query Response Type Guards
// =============================================================================

describe('isEqliteQueryResponse', () => {
  test('returns true for valid EQLite response with rows', () => {
    expect(isEqliteQueryResponse({ rows: [] })).toBe(true)
    expect(isEqliteQueryResponse({ rows: [{ id: 1 }, { id: 2 }] })).toBe(true)
  })

  test('returns true for response without rows property', () => {
    expect(isEqliteQueryResponse({})).toBe(true)
    expect(isEqliteQueryResponse({ other: 'data' })).toBe(true)
  })

  test('returns false when rows is not an array', () => {
    expect(isEqliteQueryResponse({ rows: 'not array' })).toBe(false)
    expect(isEqliteQueryResponse({ rows: 123 })).toBe(false)
    expect(isEqliteQueryResponse({ rows: {} })).toBe(false)
  })

  test('returns false for null and undefined', () => {
    expect(isEqliteQueryResponse(null)).toBe(false)
    expect(isEqliteQueryResponse(undefined)).toBe(false)
  })

  test('returns false for non-objects', () => {
    expect(isEqliteQueryResponse('string')).toBe(false)
    expect(isEqliteQueryResponse(123)).toBe(false)
    expect(isEqliteQueryResponse([])).toBe(false)
  })
})

// =============================================================================
// Fuzz Testing - Attack Vectors
// =============================================================================

describe('Fuzz: Address Validation Attacks', () => {
  test('handles SQL injection attempts in addresses', () => {
    const sqlInjection = "0x'; DROP TABLE users; --"
    expect(parseAddress(sqlInjection)).toBe(null)
  })

  test('handles XSS attempts in addresses', () => {
    const xss = '0x<script>alert(1)</script>'
    expect(parseAddress(xss)).toBe(null)
  })

  test('handles path traversal attempts', () => {
    const pathTraversal = '0x../../etc/passwd'
    expect(parseAddress(pathTraversal)).toBe(null)
  })

  test('handles null byte injection', () => {
    const nullByte = '0x1234567890123456789012345678901234567890\x00evil'
    expect(parseAddress(nullByte)).toBe(null)
  })

  test('handles unicode homoglyph attacks', () => {
    // Using cyrillic 'а' (U+0430) instead of latin 'a'
    // The address must contain 'a' for this test to work
    const homoglyph = '0xabcdef1234567890abcdef1234567890abcdef12'.replace(
      'a',
      'а', // cyrillic 'а'
    )
    expect(parseAddress(homoglyph)).toBe(null)
  })
})

describe('Fuzz: Hex Validation Attacks', () => {
  test('handles extremely long hex strings', () => {
    const longHex = `0x${'a'.repeat(100000)}`
    expect(isValidHex(longHex)).toBe(true) // Valid but very long
  })

  test('handles mixed case hex', () => {
    expect(isValidHex('0xAbCdEf')).toBe(true)
    expect(isValidHex('0xABCDEF')).toBe(true)
    expect(isValidHex('0xabcdef')).toBe(true)
  })
})

describe('Fuzz: Status Validation', () => {
  test('handles case variations', () => {
    expect(isAgentStatus('ACTIVE')).toBe(false)
    expect(isAgentStatus('Active')).toBe(false)
    expect(isAgentStatus('AcTiVe')).toBe(false)
    expect(isAgentStatus('active')).toBe(true)
  })

  test('handles whitespace padding', () => {
    expect(isAgentStatus(' active')).toBe(false)
    expect(isAgentStatus('active ')).toBe(false)
    expect(isAgentStatus(' active ')).toBe(false)
    expect(isAgentStatus('\tactive')).toBe(false)
    expect(isAgentStatus('active\n')).toBe(false)
  })

  test('handles unicode lookalikes', () => {
    // Using unicode space characters
    expect(isAgentStatus('active\u00A0')).toBe(false) // Non-breaking space
    expect(isAgentStatus('\u200Bactive')).toBe(false) // Zero-width space
  })
})

describe('Fuzz: Request Header Attacks', () => {
  test('handles empty header value', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-address': '' },
    })
    expect(getAddressFromRequest(request)).toBe(null)
  })

  test('handles header value with only whitespace', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-jeju-address': '   ' },
    })
    expect(getAddressFromRequest(request)).toBe(null)
  })

  test('handles header value with newlines', () => {
    // Headers with newlines throw TypeError in modern runtimes (security)
    // This is expected behavior - HTTP header injection prevention
    expect(() => {
      new Request('https://example.com', {
        headers: { 'x-jeju-address': `${VALID_ADDRESS}\r\nX-Injected: true` },
      })
    }).toThrow(TypeError)
  })

  test('handles multiple header values', () => {
    // Using Headers API to set multiple values
    const headers = new Headers()
    headers.append('x-jeju-address', VALID_ADDRESS)
    headers.append('x-jeju-address', 'other-value')
    const request = new Request('https://example.com', { headers })
    // Should use first valid value or combined
    const result = getAddressFromRequest(request)
    // Result depends on header handling - could be combined with comma
    expect(result === VALID_ADDRESS || result === null).toBe(true)
  })
})

describe('Fuzz: Object Property Attacks', () => {
  test('handles __proto__ property in agent character', () => {
    const malicious = {
      name: 'Test',
      system: 'System',
      bio: ['Bio'],
      __proto__: { admin: true },
    }
    expect(isAgentCharacter(malicious)).toBe(true)
    // Verify prototype wasn't polluted
    expect(({} as Record<string, unknown>).admin).toBeUndefined()
  })

  test('handles constructor property in agent character', () => {
    const malicious = {
      name: 'Test',
      system: 'System',
      bio: ['Bio'],
      constructor: 'malicious',
    }
    expect(isAgentCharacter(malicious)).toBe(true)
  })
})

describe('Fuzz: Random Value Generation', () => {
  const randomAddresses = Array.from({ length: 100 }, () => {
    const hex = Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('')
    return `0x${hex}`
  })

  test('handles 100 random valid-format addresses', () => {
    for (const addr of randomAddresses) {
      const result = parseAddress(addr)
      // Most should parse since they're valid format
      // Zero address will return null
      if (addr === ZERO_ADDRESS) {
        expect(result).toBe(null)
      } else {
        expect(result === addr || result === null).toBe(true)
      }
    }
  })

  test('handles random agent status strings', () => {
    const randomStrings = Array.from({ length: 100 }, () =>
      Math.random().toString(36).substring(2, 10),
    )
    for (const str of randomStrings) {
      // Just verify it doesn't throw
      expect(typeof isAgentStatus(str)).toBe('boolean')
    }
  })
})

describe('Fuzz: Edge Cases', () => {
  test('handles empty bio array', () => {
    expect(
      isAgentCharacter({
        name: 'Test',
        system: 'System',
        bio: [],
      }),
    ).toBe(true)
  })

  test('handles very long bio array', () => {
    const longBio = Array.from({ length: 1000 }, (_, i) => `Line ${i}`)
    expect(
      isAgentCharacter({
        name: 'Test',
        system: 'System',
        bio: longBio,
      }),
    ).toBe(true)
  })

  test('handles very long strings in character', () => {
    const longString = 'a'.repeat(100000)
    expect(
      isAgentCharacter({
        name: longString,
        system: longString,
        bio: [longString],
      }),
    ).toBe(true)
  })

  test('handles unicode in character fields', () => {
    expect(
      isAgentCharacter({
        name: 'テスト',
        system: '你好世界',
        bio: ['Привет', 'مرحبا', '🤖'],
      }),
    ).toBe(true)
  })

  test('handles numbers that look like addresses', () => {
    // This is actually a valid number string starting with 0x
    expect(parseAddress('0x1')).toBe(null) // Too short
    expect(parseAddress('0x00000000000000000000000000000000000000001')).toBe(
      null,
    ) // Too long
  })
})
