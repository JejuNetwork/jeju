/**
 * Tests for eliza-plugin validation utilities
 */

import { describe, expect, test } from 'bun:test'
import {
  MAX_JSON_DEPTH,
  MAX_JSON_SIZE,
  MAX_MESSAGE_LENGTH,
  appealContentSchema,
  bountyContentSchema,
  bountyIdSchema,
  caseContentSchema,
  caseIdSchema,
  evidenceContentSchema,
  evidenceSupportSchema,
  expect as expectValue,
  expectArray,
  expectResponseData,
  extractAddress,
  formatNumberedList,
  getMessageText,
  getMessageTextSecure,
  getOptionalMessageText,
  guardianContentSchema,
  isUrlSafeToFetch,
  isValidAddress,
  isValidHex,
  labelContentSchema,
  projectContentSchema,
  safeJsonParse,
  safeJsonParseUnknown,
  sanitizeAgentResponse,
  sanitizeText,
  submissionActionSchema,
  taskContentSchema,
  truncateOutput,
  validateIntentInfo,
  validateIntentQuote,
  validateNodeStats,
  validatePoolStats,
  validateProvider,
  workSubmissionSchema,
} from '../validation'
import { z } from 'zod'

// ============ Message Extraction Tests ============

describe('getMessageText', () => {
  test('should extract text from message', () => {
    const message = { content: { text: 'Hello world' } }
    expect(getMessageText(message as never)).toBe('Hello world')
  })

  test('should throw for missing text', () => {
    expect(() => getMessageText({ content: {} } as never)).toThrow(
      'Message text is required',
    )
  })

  test('should throw for empty text', () => {
    expect(() => getMessageText({ content: { text: '   ' } } as never)).toThrow(
      'Message text is required',
    )
  })
})

describe('getOptionalMessageText', () => {
  test('should return text if present', () => {
    const message = { content: { text: 'Hello' } }
    expect(getOptionalMessageText(message as never)).toBe('Hello')
  })

  test('should return empty string for missing text', () => {
    expect(getOptionalMessageText({ content: {} } as never)).toBe('')
    expect(getOptionalMessageText({ content: { text: undefined } } as never)).toBe('')
  })
})

// ============ Response Validation Tests ============

describe('expectResponseData', () => {
  test('should return data if present', () => {
    expect(expectResponseData({ data: { value: 1 } })).toEqual({ value: 1 })
  })

  test('should throw for null data', () => {
    expect(() => expectResponseData({ data: null })).toThrow(
      'API response missing data',
    )
  })

  test('should throw for undefined data', () => {
    expect(() => expectResponseData({})).toThrow('API response missing data')
  })

  test('should use custom error message', () => {
    expect(() =>
      expectResponseData({ data: null }, 'Custom error'),
    ).toThrow('Custom error')
  })
})

describe('expectArray', () => {
  test('should return array if valid', () => {
    expect(expectArray({ items: [1, 2, 3] }, 'items')).toEqual([1, 2, 3])
  })

  test('should throw for non-array', () => {
    expect(() => expectArray({ items: 'not array' }, 'items')).toThrow()
  })

  test('should throw for missing field', () => {
    expect(() => expectArray({}, 'items')).toThrow()
  })
})

describe('expect function', () => {
  test('should return value if defined', () => {
    expect(expectValue('test', 'name')).toBe('test')
    expect(expectValue(0, 'count')).toBe(0)
  })

  test('should throw for null', () => {
    expect(() => expectValue(null, 'value')).toThrow('Expected value to be defined')
  })

  test('should throw for undefined', () => {
    expect(() => expectValue(undefined, 'value')).toThrow(
      'Expected value to be defined',
    )
  })
})

// ============ Content Schema Tests ============

describe('evidenceContentSchema', () => {
  test('should accept valid evidence content', () => {
    const content = {
      caseId: '0x1234abcd',
      ipfsHash: 'QmTest',
      summary: 'Test evidence',
      position: 'for' as const,
      stake: '1.5',
    }
    expect(evidenceContentSchema.parse(content)).toMatchObject(content)
  })

  test('should accept empty content', () => {
    expect(evidenceContentSchema.parse({})).toEqual({})
  })
})

describe('caseContentSchema', () => {
  test('should accept valid case content', () => {
    const content = {
      entity: '0x1234567890123456789012345678901234567890',
      reportType: 'spam' as const,
      description: 'Test case',
      stake: '0.1',
    }
    const result = caseContentSchema.parse(content)
    expect(result.entity).toBe(content.entity)
    expect(result.reportType).toBe('spam')
  })

  test('should reject invalid address', () => {
    expect(() =>
      caseContentSchema.parse({ entity: 'not-an-address' }),
    ).toThrow()
  })
})

describe('bountyContentSchema', () => {
  test('should accept valid bounty content', () => {
    const content = {
      title: 'Test Bounty',
      description: 'Do something',
      reward: '10',
      deadline: 1234567890,
      tags: ['test', 'bounty'],
    }
    expect(bountyContentSchema.parse(content)).toMatchObject(content)
  })
})

describe('labelContentSchema', () => {
  test('should accept valid label content', () => {
    const content = {
      target: '0x1234567890123456789012345678901234567890',
      label: 'trusted',
      score: 5000,
      reason: 'Good actor',
    }
    expect(labelContentSchema.parse(content)).toMatchObject(content)
  })

  test('should reject score out of range', () => {
    expect(() =>
      labelContentSchema.parse({ score: 20000 }),
    ).toThrow()
  })
})

// ============ Provider Validation Tests ============

describe('validateProvider', () => {
  test('should validate complete provider', () => {
    const provider = {
      name: 'Test Provider',
      address: '0x1234',
      resources: { gpuType: 'A100', gpuCount: 4 },
      pricing: { pricePerHour: 100n, pricePerHourFormatted: '0.0001 ETH' },
    }
    const result = validateProvider(provider)
    expect(result.name).toBe('Test Provider')
    expect(result.resources.gpuType).toBe('A100')
    expect(result.pricing.pricePerHour).toBe(100n)
  })

  test('should throw for missing gpuType', () => {
    const provider = {
      name: 'Test',
      address: '0x1234',
      resources: { gpuCount: 4 },
      pricing: { pricePerHour: 100 },
    }
    expect(() => validateProvider(provider as never)).toThrow('missing gpuType')
  })

  test('should throw for missing pricing', () => {
    const provider = {
      name: 'Test',
      address: '0x1234',
      resources: { gpuType: 'A100', gpuCount: 4 },
    }
    expect(() => validateProvider(provider as never)).toThrow('missing pricing')
  })
})

// ============ API Response Validators ============

describe('validatePoolStats', () => {
  test('should validate pool stats', () => {
    const data = {
      tvl: 1000000,
      volume24h: 50000,
      totalPools: 10,
      totalSwaps: 100,
    }
    expect(validatePoolStats(data)).toEqual(data)
  })

  test('should throw for missing fields', () => {
    expect(() => validatePoolStats({ tvl: 1000 })).toThrow()
  })
})

describe('validateNodeStats', () => {
  test('should validate node stats', () => {
    const data = {
      totalNodes: 100,
      activeNodes: 80,
      totalStake: '1000000',
      averageUptime: 99.5,
      capacity: '500 GPU-hours',
    }
    expect(validateNodeStats(data)).toEqual(data)
  })
})

describe('validateIntentQuote', () => {
  test('should validate intent quote', () => {
    const data = {
      amountIn: '1000000000000000000',
      amountOut: '990000000000000000',
      fee: '10000000000000000',
      estimatedTimeSeconds: 60,
    }
    expect(validateIntentQuote(data)).toEqual(data)
  })
})

describe('validateIntentInfo', () => {
  test('should validate intent info', () => {
    const data = {
      intentId: '0x123',
      status: 'pending',
      sourceChain: 'ethereum',
      destChain: 'base',
      amountIn: '1000',
      amountOut: '990',
      solver: '0xabc',
    }
    expect(validateIntentInfo(data)).toEqual(data)
  })

  test('should accept optional txHash', () => {
    const data = {
      intentId: '0x123',
      status: 'completed',
      sourceChain: 'ethereum',
      destChain: 'base',
      amountIn: '1000',
      amountOut: '990',
      solver: '0xabc',
      txHash: '0xdef',
    }
    expect(validateIntentInfo(data).txHash).toBe('0xdef')
  })
})

// ============ Security Utility Tests ============

describe('isUrlSafeToFetch', () => {
  test('should allow valid public URLs', () => {
    expect(isUrlSafeToFetch('https://example.com')).toBe(true)
    expect(isUrlSafeToFetch('https://api.github.com')).toBe(true)
    expect(isUrlSafeToFetch('http://public.api.com/data')).toBe(true)
  })

  test('should block localhost', () => {
    expect(isUrlSafeToFetch('http://localhost')).toBe(false)
    expect(isUrlSafeToFetch('http://localhost:3000')).toBe(false)
    expect(isUrlSafeToFetch('http://127.0.0.1')).toBe(false)
    expect(isUrlSafeToFetch('http://0.0.0.0')).toBe(false)
  })

  test('should block cloud metadata endpoints', () => {
    expect(isUrlSafeToFetch('http://169.254.169.254')).toBe(false)
    expect(isUrlSafeToFetch('http://metadata.google.internal')).toBe(false)
  })

  test('should block private IP ranges', () => {
    expect(isUrlSafeToFetch('http://10.0.0.1')).toBe(false)
    expect(isUrlSafeToFetch('http://192.168.1.1')).toBe(false)
    expect(isUrlSafeToFetch('http://172.16.0.1')).toBe(false)
  })

  test('should block non-http protocols', () => {
    expect(isUrlSafeToFetch('file:///etc/passwd')).toBe(false)
    expect(isUrlSafeToFetch('ftp://example.com')).toBe(false)
  })

  test('should block invalid URLs', () => {
    expect(isUrlSafeToFetch('not-a-url')).toBe(false)
    expect(isUrlSafeToFetch('')).toBe(false)
  })
})

describe('safeJsonParse', () => {
  test('should parse valid JSON with schema', () => {
    const schema = z.object({ name: z.string() })
    const result = safeJsonParse('{"name": "test"}', schema)
    expect(result.name).toBe('test')
  })

  test('should throw for oversized JSON', () => {
    const schema = z.object({ data: z.string() })
    const hugeJson = '{"data": "' + 'x'.repeat(MAX_JSON_SIZE + 1) + '"}'
    expect(() => safeJsonParse(hugeJson, schema)).toThrow('exceeds maximum size')
  })

  test('should throw for deeply nested JSON', () => {
    const schema = z.unknown()
    let nested = '{"a":'
    for (let i = 0; i < MAX_JSON_DEPTH + 5; i++) {
      nested += '{"b":'
    }
    nested += '1' + '}'.repeat(MAX_JSON_DEPTH + 6)
    expect(() => safeJsonParse(nested, schema)).toThrow('nesting depth')
  })
})

describe('safeJsonParseUnknown', () => {
  test('should parse valid JSON', () => {
    const result = safeJsonParseUnknown('{"key": "value"}')
    expect(result).toEqual({ key: 'value' })
  })

  test('should throw for oversized JSON', () => {
    const hugeJson = '{"data": "' + 'x'.repeat(MAX_JSON_SIZE + 1) + '"}'
    expect(() => safeJsonParseUnknown(hugeJson)).toThrow('exceeds maximum size')
  })
})

describe('truncateOutput', () => {
  test('should not truncate short text', () => {
    expect(truncateOutput('short text')).toBe('short text')
  })

  test('should truncate long text', () => {
    const longText = 'x'.repeat(60000)
    const result = truncateOutput(longText, 1000)
    expect(result.length).toBeLessThan(1005)
    expect(result).toContain('[truncated]')
  })
})

describe('sanitizeText', () => {
  test('should remove null bytes', () => {
    expect(sanitizeText('hello\0world')).toBe('helloworld')
  })

  test('should limit length', () => {
    const longText = 'x'.repeat(MAX_MESSAGE_LENGTH + 1000)
    const result = sanitizeText(longText)
    expect(result.length).toBe(MAX_MESSAGE_LENGTH)
  })
})

describe('sanitizeAgentResponse', () => {
  test('should sanitize and truncate response', () => {
    const response = 'Hello\0world' + 'x'.repeat(20000)
    const result = sanitizeAgentResponse(response)
    expect(result).not.toContain('\0')
    expect(result.length).toBeLessThanOrEqual(10020)
  })
})

describe('isValidAddress', () => {
  test('should accept valid addresses', () => {
    expect(isValidAddress('0x1234567890123456789012345678901234567890')).toBe(true)
  })

  test('should reject invalid addresses', () => {
    expect(isValidAddress('0x1234')).toBe(false)
    expect(isValidAddress('invalid')).toBe(false)
  })
})

describe('isValidHex', () => {
  test('should accept valid hex', () => {
    expect(isValidHex('0x1234')).toBe(true)
    expect(isValidHex('0xabcdef')).toBe(true)
  })

  test('should validate expected length', () => {
    expect(isValidHex('0x1234567890123456789012345678901234567890', 40)).toBe(true)
    expect(isValidHex('0x1234', 40)).toBe(false)
  })
})

describe('extractAddress', () => {
  test('should extract address from text', () => {
    const text = 'Send to 0x1234567890123456789012345678901234567890 please'
    expect(extractAddress(text)).toBe('0x1234567890123456789012345678901234567890')
  })

  test('should return null for no address', () => {
    expect(extractAddress('no address here')).toBeNull()
  })
})

describe('formatNumberedList', () => {
  test('should format items as numbered list', () => {
    const items = ['apple', 'banana', 'cherry']
    const result = formatNumberedList(items, (i) => i)
    expect(result).toBe('1. apple\n2. banana\n3. cherry')
  })

  test('should respect maxItems', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const result = formatNumberedList(items, (i) => i, 3)
    expect(result.split('\n')).toHaveLength(3)
  })
})

describe('getMessageTextSecure', () => {
  test('should sanitize message text', () => {
    const message = { content: { text: 'Hello\0world' } }
    expect(getMessageTextSecure(message as never)).toBe('Helloworld')
  })

  test('should throw for missing text', () => {
    expect(() => getMessageTextSecure({ content: {} } as never)).toThrow(
      'Message text is required',
    )
  })
})
