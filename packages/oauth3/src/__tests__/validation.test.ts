/**
 * Tests for OAuth3 validation utilities and schemas
 */

import { describe, expect, test } from 'bun:test'
import {
  AddressSchema,
  Bytes32Schema,
  HexSchema,
  OAuth3ConfigSchema,
  expect as expectValue,
  expectEndpoint,
  expectJson,
  extractError,
  generateOTP,
  getEndpointWithDevFallback,
  isAddress,
  isHex,
  safeParseJson,
  validateConfig,
  validateResponse,
} from '../validation'
import { z } from 'zod'

// ============ Hex and Address Schema Tests ============

describe('HexSchema', () => {
  test('should accept valid hex strings', () => {
    expect(HexSchema.parse('0x1234')).toBe('0x1234')
    expect(HexSchema.parse('0xabcdef')).toBe('0xabcdef')
    expect(HexSchema.parse('0xABCDEF')).toBe('0xABCDEF')
  })

  test('should reject invalid hex strings', () => {
    expect(() => HexSchema.parse('1234')).toThrow()
    expect(() => HexSchema.parse('0xGHI')).toThrow()
    expect(() => HexSchema.parse('')).toThrow()
  })
})

describe('AddressSchema', () => {
  test('should accept valid addresses', () => {
    const validAddress = '0x1234567890123456789012345678901234567890'
    expect(AddressSchema.parse(validAddress)).toBe(validAddress)
  })

  test('should reject short addresses', () => {
    expect(() => AddressSchema.parse('0x1234')).toThrow()
  })

  test('should reject long addresses', () => {
    expect(() =>
      AddressSchema.parse('0x12345678901234567890123456789012345678901234'),
    ).toThrow()
  })
})

describe('Bytes32Schema', () => {
  test('should accept valid bytes32', () => {
    const valid =
      '0x1234567890123456789012345678901234567890123456789012345678901234'
    expect(Bytes32Schema.parse(valid)).toBe(valid)
  })

  test('should reject invalid bytes32', () => {
    expect(() => Bytes32Schema.parse('0x1234')).toThrow()
  })
})

// ============ OAuth3ConfigSchema Tests ============

describe('OAuth3ConfigSchema', () => {
  test('should accept minimal valid config', () => {
    const config = {
      appId: '0x1234',
      redirectUri: 'https://example.com/callback',
    }
    expect(OAuth3ConfigSchema.parse(config)).toEqual(config)
  })

  test('should accept full config', () => {
    const config = {
      appId: 'my-app-id',
      redirectUri: 'https://example.com/callback',
      teeAgentUrl: 'https://tee.example.com',
      rpcUrl: 'https://rpc.example.com',
      chainId: 1,
      decentralized: true,
    }
    const result = OAuth3ConfigSchema.parse(config)
    expect(result.appId).toBe('my-app-id')
    expect(result.decentralized).toBe(true)
  })

  test('should reject missing appId', () => {
    expect(() =>
      OAuth3ConfigSchema.parse({ redirectUri: 'https://example.com' }),
    ).toThrow()
  })

  test('should reject invalid redirectUri', () => {
    expect(() =>
      OAuth3ConfigSchema.parse({ appId: 'test', redirectUri: 'not-a-url' }),
    ).toThrow()
  })
})

// ============ Helper Function Tests ============

describe('expect function', () => {
  test('should return value if defined', () => {
    expect(expectValue('hello', 'value')).toBe('hello')
    expect(expectValue(0, 'value')).toBe(0)
    expect(expectValue(false, 'value')).toBe(false)
  })

  test('should throw for null', () => {
    expect(() => expectValue(null, 'test')).toThrow('test')
  })

  test('should throw for undefined', () => {
    expect(() => expectValue(undefined, 'test')).toThrow('test')
  })
})

describe('expectEndpoint', () => {
  test('should return endpoint if valid', () => {
    const node = { endpoint: 'https://tee.example.com' }
    expect(expectEndpoint(node)).toBe('https://tee.example.com')
  })

  test('should throw for null node', () => {
    expect(() => expectEndpoint(null)).toThrow('TEE node not initialized')
  })

  test('should throw for undefined node', () => {
    expect(() => expectEndpoint(undefined)).toThrow('TEE node not initialized')
  })

  test('should throw for empty endpoint', () => {
    expect(() => expectEndpoint({ endpoint: '' })).toThrow('no endpoint')
  })
})

describe('getEndpointWithDevFallback', () => {
  test('should return endpoint if provided', () => {
    const node = { endpoint: 'https://tee.example.com' }
    expect(getEndpointWithDevFallback(node)).toBe('https://tee.example.com')
  })

  test('should return localhost in dev/test', () => {
    // We're in test environment
    expect(getEndpointWithDevFallback(null)).toBe('http://localhost:4200')
  })
})

describe('extractError', () => {
  test('should extract error message', () => {
    expect(extractError({ error: 'Something failed' })).toBe('Something failed')
  })

  test('should extract message field', () => {
    expect(extractError({ message: 'Error message' })).toBe('Error message')
  })

  test('should return Unknown error for empty object', () => {
    expect(extractError({})).toBe('Unknown error')
  })

  test('should return Unknown error for invalid input', () => {
    expect(extractError('not an object')).toBe('Unknown error')
    expect(extractError(null)).toBe('Unknown error')
  })
})

describe('isHex', () => {
  test('should return true for valid hex', () => {
    expect(isHex('0x1234')).toBe(true)
    expect(isHex('0xabcdef')).toBe(true)
  })

  test('should return false for invalid hex', () => {
    expect(isHex('1234')).toBe(false)
    expect(isHex('0xggg')).toBe(false)
    expect(isHex('')).toBe(false)
    expect(isHex(123)).toBe(false)
  })
})

describe('isAddress', () => {
  test('should return true for valid address', () => {
    expect(isAddress('0x1234567890123456789012345678901234567890')).toBe(true)
  })

  test('should return false for invalid address', () => {
    expect(isAddress('0x1234')).toBe(false)
    expect(isAddress('1234567890123456789012345678901234567890')).toBe(false)
    expect(isAddress('')).toBe(false)
  })
})

describe('validateConfig', () => {
  test('should validate and return config', () => {
    const config = {
      appId: 'test',
      redirectUri: 'https://example.com/callback',
    }
    const result = validateConfig(config)
    expect(result.appId).toBe('test')
  })

  test('should throw for invalid config', () => {
    expect(() => validateConfig({})).toThrow()
  })
})

describe('validateResponse', () => {
  test('should return data for valid response', () => {
    const schema = z.object({ name: z.string() })
    const result = validateResponse(schema, { name: 'test' }, 'test data')
    expect(result.name).toBe('test')
  })

  test('should throw with context for invalid response', () => {
    const schema = z.object({ name: z.string() })
    expect(() => validateResponse(schema, { name: 123 }, 'user data')).toThrow(
      'Invalid user data',
    )
  })
})

describe('expectJson', () => {
  test('should parse and validate JSON', () => {
    const schema = z.object({ value: z.number() })
    const result = expectJson('{"value": 42}', schema)
    expect(result.value).toBe(42)
  })

  test('should throw for invalid JSON', () => {
    const schema = z.object({ value: z.number() })
    expect(() => expectJson('not json', schema, 'config')).toThrow(
      'Invalid config',
    )
  })

  test('should throw for valid JSON failing schema', () => {
    const schema = z.object({ value: z.number() })
    expect(() => expectJson('{"value": "string"}', schema, 'config')).toThrow()
  })
})

describe('safeParseJson', () => {
  test('should return parsed data for valid JSON', () => {
    const schema = z.object({ name: z.string() })
    const result = safeParseJson(schema, '{"name": "test"}')
    expect(result).toEqual({ name: 'test' })
  })

  test('should return null for invalid JSON', () => {
    const schema = z.object({ name: z.string() })
    expect(safeParseJson(schema, 'not json')).toBeNull()
  })

  test('should return null for JSON failing validation', () => {
    const schema = z.object({ name: z.string() })
    expect(safeParseJson(schema, '{"name": 123}')).toBeNull()
  })
})

describe('generateOTP', () => {
  test('should generate OTP of specified length', () => {
    const otp6 = generateOTP(6)
    expect(otp6).toHaveLength(6)
    expect(/^\d{6}$/.test(otp6)).toBe(true)

    const otp4 = generateOTP(4)
    expect(otp4).toHaveLength(4)
    expect(/^\d{4}$/.test(otp4)).toBe(true)
  })

  test('should generate different OTPs', () => {
    const otps = new Set([
      generateOTP(6),
      generateOTP(6),
      generateOTP(6),
      generateOTP(6),
      generateOTP(6),
    ])
    // Should have at least 2 unique values (very unlikely to get 5 identical)
    expect(otps.size).toBeGreaterThanOrEqual(2)
  })
})
