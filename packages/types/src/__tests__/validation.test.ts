/**
 * @fileoverview Comprehensive tests for validation.ts
 * 
 * Tests cover:
 * - Zod schemas for Ethereum primitives (addresses, hex, hashes)
 * - BigInt schemas with transformations
 * - Fail-fast validation helpers
 * - Schema validation functions
 */

import { describe, test, expect } from 'bun:test';
import {
  // Schemas
  AddressSchema,
  HexSchema,
  HashSchema,
  BigIntSchema,
  PositiveBigIntSchema,
  NonNegativeBigIntSchema,
  TimestampSchema,
  CidSchema,
  UrlSchema,
  EmailSchema,
  IsoDateSchema,
  PaginationSchema,
  NonEmptyStringSchema,
  PositiveNumberStringSchema,
  NonNegativeNumberStringSchema,
  PositiveNumberSchema,
  NonNegativeNumberSchema,
  PositiveIntSchema,
  NonNegativeIntSchema,
  PercentageSchema,
  ChainIdSchema,
  // Fail-fast helpers
  expect as expectValue,
  expectTrue,
  expectDefined,
  expectNonEmpty,
  expectPositive,
  expectNonNegative,
  expectValid,
  validateOrThrow,
  validateOrNull,
  expectAddress,
  expectHex,
  expectChainId,
  expectBigInt,
  expectNonEmptyString,
  expectJson,
} from '../validation';
import { z } from 'zod';

// ============================================================================
// AddressSchema Tests
// ============================================================================

describe('AddressSchema', () => {
  // Use valid addresses that viem will accept (lowercase or proper checksum)
  const validAddresses = [
    '0x0000000000000000000000000000000000000000', // Zero address is valid
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // All lowercase is valid
    '0xffffffffffffffffffffffffffffffffffffffff', // All lowercase is valid
  ];

  const invalidAddresses = [
    '',
    '0x',
    '0x0',
    '0x00000000000000000000000000000000000000', // 38 chars, not 40
    '0x000000000000000000000000000000000000000000', // 42 chars
    '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid hex chars
    'dead000000000000000000000000000000000000', // Missing 0x prefix
    '0xdead', // Too short
    null,
    undefined,
    123,
  ];

  test.each(validAddresses)('accepts valid address: %s', (address) => {
    const result = AddressSchema.safeParse(address);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(address);
    }
  });

  test.each(invalidAddresses)('rejects invalid address: %s', (address) => {
    const result = AddressSchema.safeParse(address);
    expect(result.success).toBe(false);
  });

  test('accepts lowercase addresses', () => {
    const lowercase = '0x0000000000000000000000000000000000000000';
    const result = AddressSchema.safeParse(lowercase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(lowercase);
    }
  });
});

// ============================================================================
// HexSchema Tests
// ============================================================================

describe('HexSchema', () => {
  const validHexStrings = [
    '0x',
    '0x0',
    '0x00',
    '0xdeadbeef',
    '0xDEADBEEF',
    '0x1234567890abcdef',
    '0x' + 'f'.repeat(64),
  ];

  const invalidHexStrings = [
    '',
    '0',
    'deadbeef', // Missing 0x prefix
    '0xgg', // Invalid hex chars
    '0x0g',
    '0x-1',
    null,
    undefined,
    123,
  ];

  test.each(validHexStrings)('accepts valid hex: %s', (hex) => {
    const result = HexSchema.safeParse(hex);
    expect(result.success).toBe(true);
  });

  test.each(invalidHexStrings)('rejects invalid hex: %s', (hex) => {
    const result = HexSchema.safeParse(hex);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// HashSchema Tests (32-byte hash)
// ============================================================================

describe('HashSchema', () => {
  const validHashes = [
    '0x' + '0'.repeat(64),
    '0x' + 'f'.repeat(64),
    '0x' + 'a'.repeat(64),
    '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
  ];

  const invalidHashes = [
    '0x',
    '0x0',
    '0x' + '0'.repeat(63), // 63 chars, not 64
    '0x' + '0'.repeat(65), // 65 chars
    '0x' + 'g'.repeat(64), // Invalid hex chars
    'deadbeef'.repeat(8), // Missing 0x prefix
    '',
    null,
  ];

  test.each(validHashes)('accepts valid 32-byte hash: %s', (hash) => {
    const result = HashSchema.safeParse(hash);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(66); // 0x + 64 chars
    }
  });

  test.each(invalidHashes)('rejects invalid hash: %s', (hash) => {
    const result = HashSchema.safeParse(hash);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// BigIntSchema Tests
// ============================================================================

describe('BigIntSchema', () => {
  test('transforms string to bigint', () => {
    const result = BigIntSchema.safeParse('12345678901234567890');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(12345678901234567890n);
    }
  });

  test('transforms number to bigint', () => {
    const result = BigIntSchema.safeParse(12345);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(12345n);
    }
  });

  test('accepts bigint directly', () => {
    const result = BigIntSchema.safeParse(999999999999999999999n);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(999999999999999999999n);
    }
  });

  test('transforms negative string to negative bigint', () => {
    const result = BigIntSchema.safeParse('-12345');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(-12345n);
    }
  });

  test('handles zero', () => {
    const stringResult = BigIntSchema.safeParse('0');
    const numberResult = BigIntSchema.safeParse(0);
    const bigintResult = BigIntSchema.safeParse(0n);
    
    expect(stringResult.success).toBe(true);
    expect(numberResult.success).toBe(true);
    expect(bigintResult.success).toBe(true);
  });

  test('throws on invalid string', () => {
    // BigInt() throws on invalid strings, so safeParse will fail
    expect(() => BigIntSchema.parse('not-a-number')).toThrow();
  });

  test('throws on float values (BigInt conversion fails)', () => {
    // BigInt() throws for floats
    expect(() => BigIntSchema.parse(1.5)).toThrow();
  });
});

// ============================================================================
// PositiveBigIntSchema Tests
// ============================================================================

describe('PositiveBigIntSchema', () => {
  test('accepts positive bigint', () => {
    const result = PositiveBigIntSchema.safeParse(100n);
    expect(result.success).toBe(true);
  });

  test('accepts positive string', () => {
    const result = PositiveBigIntSchema.safeParse('100');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(100n);
    }
  });

  test('rejects zero bigint', () => {
    const bigintResult = PositiveBigIntSchema.safeParse(0n);
    expect(bigintResult.success).toBe(false);
  });

  test('throws for zero string', () => {
    // String transform throws on invalid values
    expect(() => PositiveBigIntSchema.parse('0')).toThrow();
  });

  test('rejects negative bigint', () => {
    const bigintResult = PositiveBigIntSchema.safeParse(-1n);
    expect(bigintResult.success).toBe(false);
  });

  test('throws for negative string', () => {
    // String transform throws on invalid values
    expect(() => PositiveBigIntSchema.parse('-1')).toThrow();
  });
});

// ============================================================================
// NonNegativeBigIntSchema Tests
// ============================================================================

describe('NonNegativeBigIntSchema', () => {
  test('accepts positive bigint', () => {
    const result = NonNegativeBigIntSchema.safeParse(100n);
    expect(result.success).toBe(true);
  });

  test('accepts zero', () => {
    const bigintResult = NonNegativeBigIntSchema.safeParse(0n);
    const stringResult = NonNegativeBigIntSchema.safeParse('0');
    expect(bigintResult.success).toBe(true);
    expect(stringResult.success).toBe(true);
  });

  test('rejects negative bigint', () => {
    const bigintResult = NonNegativeBigIntSchema.safeParse(-1n);
    expect(bigintResult.success).toBe(false);
  });

  test('throws for negative string', () => {
    // String transform throws on invalid values
    expect(() => NonNegativeBigIntSchema.parse('-1')).toThrow();
  });
});

// ============================================================================
// TimestampSchema Tests
// ============================================================================

describe('TimestampSchema', () => {
  test('accepts positive integer timestamps', () => {
    expect(TimestampSchema.safeParse(1609459200).success).toBe(true);
    expect(TimestampSchema.safeParse(Date.now()).success).toBe(true);
  });

  test('rejects zero', () => {
    expect(TimestampSchema.safeParse(0).success).toBe(false);
  });

  test('rejects negative timestamps', () => {
    expect(TimestampSchema.safeParse(-1).success).toBe(false);
  });

  test('rejects float timestamps', () => {
    expect(TimestampSchema.safeParse(1609459200.5).success).toBe(false);
  });
});

// ============================================================================
// String Validation Schemas
// ============================================================================

describe('UrlSchema', () => {
  test('accepts valid URLs', () => {
    expect(UrlSchema.safeParse('https://example.com').success).toBe(true);
    expect(UrlSchema.safeParse('http://localhost:3000').success).toBe(true);
    expect(UrlSchema.safeParse('https://api.example.com/v1/endpoint').success).toBe(true);
  });

  test('rejects invalid URLs', () => {
    expect(UrlSchema.safeParse('not-a-url').success).toBe(false);
    expect(UrlSchema.safeParse('').success).toBe(false);
    expect(UrlSchema.safeParse('example.com').success).toBe(false);
  });
});

describe('EmailSchema', () => {
  test('accepts valid emails', () => {
    expect(EmailSchema.safeParse('test@example.com').success).toBe(true);
    expect(EmailSchema.safeParse('user.name@domain.co.uk').success).toBe(true);
  });

  test('rejects invalid emails', () => {
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
    expect(EmailSchema.safeParse('@example.com').success).toBe(false);
    expect(EmailSchema.safeParse('').success).toBe(false);
  });
});

describe('IsoDateSchema', () => {
  test('accepts valid ISO 8601 dates', () => {
    expect(IsoDateSchema.safeParse('2024-01-15T12:30:00Z').success).toBe(true);
    expect(IsoDateSchema.safeParse('2024-01-15T12:30:00.000Z').success).toBe(true);
  });

  test('rejects invalid dates', () => {
    expect(IsoDateSchema.safeParse('2024-01-15').success).toBe(false);
    expect(IsoDateSchema.safeParse('not-a-date').success).toBe(false);
  });
});

describe('NonEmptyStringSchema', () => {
  test('accepts non-empty strings', () => {
    expect(NonEmptyStringSchema.safeParse('hello').success).toBe(true);
    expect(NonEmptyStringSchema.safeParse(' ').success).toBe(true); // Whitespace is still a char
  });

  test('rejects empty string', () => {
    expect(NonEmptyStringSchema.safeParse('').success).toBe(false);
  });
});

describe('PositiveNumberStringSchema', () => {
  test('accepts positive number strings', () => {
    expect(PositiveNumberStringSchema.safeParse('100').success).toBe(true);
    expect(PositiveNumberStringSchema.safeParse('0.001').success).toBe(true);
  });

  test('rejects zero', () => {
    expect(PositiveNumberStringSchema.safeParse('0').success).toBe(false);
  });

  test('rejects negative numbers', () => {
    expect(PositiveNumberStringSchema.safeParse('-1').success).toBe(false);
  });

  test('rejects non-numeric strings', () => {
    expect(PositiveNumberStringSchema.safeParse('abc').success).toBe(false);
  });
});

describe('NonNegativeNumberStringSchema', () => {
  test('accepts zero and positive', () => {
    expect(NonNegativeNumberStringSchema.safeParse('0').success).toBe(true);
    expect(NonNegativeNumberStringSchema.safeParse('100').success).toBe(true);
  });

  test('rejects negative numbers', () => {
    expect(NonNegativeNumberStringSchema.safeParse('-1').success).toBe(false);
  });
});

// ============================================================================
// Number Validation Schemas
// ============================================================================

describe('PositiveNumberSchema', () => {
  test('accepts positive numbers', () => {
    expect(PositiveNumberSchema.safeParse(1).success).toBe(true);
    expect(PositiveNumberSchema.safeParse(0.001).success).toBe(true);
  });

  test('rejects zero and negative', () => {
    expect(PositiveNumberSchema.safeParse(0).success).toBe(false);
    expect(PositiveNumberSchema.safeParse(-1).success).toBe(false);
  });
});

describe('NonNegativeNumberSchema', () => {
  test('accepts zero and positive', () => {
    expect(NonNegativeNumberSchema.safeParse(0).success).toBe(true);
    expect(NonNegativeNumberSchema.safeParse(100).success).toBe(true);
  });

  test('rejects negative', () => {
    expect(NonNegativeNumberSchema.safeParse(-0.001).success).toBe(false);
  });
});

describe('PositiveIntSchema', () => {
  test('accepts positive integers', () => {
    expect(PositiveIntSchema.safeParse(1).success).toBe(true);
    expect(PositiveIntSchema.safeParse(1000).success).toBe(true);
  });

  test('rejects floats', () => {
    expect(PositiveIntSchema.safeParse(1.5).success).toBe(false);
  });

  test('rejects zero and negative', () => {
    expect(PositiveIntSchema.safeParse(0).success).toBe(false);
    expect(PositiveIntSchema.safeParse(-1).success).toBe(false);
  });
});

describe('NonNegativeIntSchema', () => {
  test('accepts zero and positive integers', () => {
    expect(NonNegativeIntSchema.safeParse(0).success).toBe(true);
    expect(NonNegativeIntSchema.safeParse(100).success).toBe(true);
  });

  test('rejects negative and floats', () => {
    expect(NonNegativeIntSchema.safeParse(-1).success).toBe(false);
    expect(NonNegativeIntSchema.safeParse(1.5).success).toBe(false);
  });
});

describe('PercentageSchema', () => {
  test('accepts values 0-100', () => {
    expect(PercentageSchema.safeParse(0).success).toBe(true);
    expect(PercentageSchema.safeParse(50).success).toBe(true);
    expect(PercentageSchema.safeParse(100).success).toBe(true);
    expect(PercentageSchema.safeParse(33.33).success).toBe(true);
  });

  test('rejects values outside 0-100', () => {
    expect(PercentageSchema.safeParse(-1).success).toBe(false);
    expect(PercentageSchema.safeParse(101).success).toBe(false);
  });
});

describe('ChainIdSchema', () => {
  const validChainIds = [1, 10, 137, 42161, 8453, 84532];
  const invalidChainIds = [0, -1, 1.5];

  test.each(validChainIds)('accepts valid chain ID: %d', (chainId) => {
    expect(ChainIdSchema.safeParse(chainId).success).toBe(true);
  });

  test.each(invalidChainIds)('rejects invalid chain ID: %d', (chainId) => {
    expect(ChainIdSchema.safeParse(chainId).success).toBe(false);
  });
});

// ============================================================================
// PaginationSchema Tests
// ============================================================================

describe('PaginationSchema', () => {
  test('applies defaults', () => {
    const result = PaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
      expect(result.data.sortOrder).toBe('desc');
    }
  });

  test('coerces string numbers', () => {
    const result = PaginationSchema.safeParse({ page: '5', pageSize: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(5);
      expect(result.data.pageSize).toBe(50);
    }
  });

  test('rejects invalid page values', () => {
    expect(PaginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ page: -1 }).success).toBe(false);
  });

  test('respects pageSize limits', () => {
    expect(PaginationSchema.safeParse({ pageSize: 0 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ pageSize: 100 }).success).toBe(true);
  });

  test('validates sortOrder enum', () => {
    expect(PaginationSchema.safeParse({ sortOrder: 'asc' }).success).toBe(true);
    expect(PaginationSchema.safeParse({ sortOrder: 'desc' }).success).toBe(true);
    expect(PaginationSchema.safeParse({ sortOrder: 'invalid' }).success).toBe(false);
  });
});

// ============================================================================
// Fail-Fast Helper Tests
// ============================================================================

describe('expect (expectValue)', () => {
  test('returns value when defined', () => {
    expect(expectValue('hello', 'value required')).toBe('hello');
    expect(expectValue(0, 'value required')).toBe(0);
    expect(expectValue(false, 'value required')).toBe(false);
    expect(expectValue('', 'value required')).toBe('');
  });

  test('throws when null', () => {
    expect(() => expectValue(null, 'value is null')).toThrow('value is null');
  });

  test('throws when undefined', () => {
    expect(() => expectValue(undefined, 'value is undefined')).toThrow('value is undefined');
  });
});

describe('expectTrue', () => {
  test('does not throw when true', () => {
    expect(() => expectTrue(true, 'should be true')).not.toThrow();
    expect(() => expectTrue(1 === 1, 'should be true')).not.toThrow();
  });

  test('throws when false', () => {
    expect(() => expectTrue(false, 'was false')).toThrow('was false');
    expect(() => expectTrue(1 === 2, 'one is not two')).toThrow('one is not two');
  });
});

describe('expectDefined', () => {
  test('does not throw when defined', () => {
    let value: string | null | undefined = 'hello';
    expect(() => expectDefined(value, 'value required')).not.toThrow();
    
    value = '';
    expect(() => expectDefined(value, 'value required')).not.toThrow();
  });

  test('throws when null or undefined', () => {
    const nullValue: string | null = null;
    const undefinedValue: string | undefined = undefined;
    
    expect(() => expectDefined(nullValue, 'was null')).toThrow('was null');
    expect(() => expectDefined(undefinedValue, 'was undefined')).toThrow('was undefined');
  });
});

describe('expectNonEmpty', () => {
  test('returns non-empty array', () => {
    const arr = [1, 2, 3];
    expect(expectNonEmpty(arr, 'array required')).toBe(arr);
  });

  test('throws on empty array', () => {
    expect(() => expectNonEmpty([], 'array')).toThrow('array: array is empty');
  });

  test('throws on null/undefined', () => {
    expect(() => expectNonEmpty(null, 'array')).toThrow('array');
    expect(() => expectNonEmpty(undefined, 'array')).toThrow('array');
  });
});

describe('expectPositive', () => {
  test('returns positive number', () => {
    expect(expectPositive(1, 'value')).toBe(1);
    expect(expectPositive(0.001, 'value')).toBe(0.001);
  });

  test('returns positive bigint', () => {
    expect(expectPositive(1n, 'value')).toBe(1n);
    expect(expectPositive(1000000000000000000n, 'value')).toBe(1000000000000000000n);
  });

  test('throws on zero', () => {
    expect(() => expectPositive(0, 'value')).toThrow('value: must be positive');
    expect(() => expectPositive(0n, 'value')).toThrow('value: must be positive');
  });

  test('throws on negative', () => {
    expect(() => expectPositive(-1, 'value')).toThrow('value: must be positive');
    expect(() => expectPositive(-1n, 'value')).toThrow('value: must be positive');
  });
});

describe('expectNonNegative', () => {
  test('returns zero and positive numbers', () => {
    expect(expectNonNegative(0, 'value')).toBe(0);
    expect(expectNonNegative(100, 'value')).toBe(100);
  });

  test('returns zero and positive bigints', () => {
    expect(expectNonNegative(0n, 'value')).toBe(0n);
    expect(expectNonNegative(100n, 'value')).toBe(100n);
  });

  test('throws on negative', () => {
    expect(() => expectNonNegative(-1, 'value')).toThrow('value: must be non-negative');
    expect(() => expectNonNegative(-1n, 'value')).toThrow('value: must be non-negative');
  });
});

// ============================================================================
// Schema Validation Functions
// ============================================================================

describe('expectValid', () => {
  const TestSchema = z.object({
    name: z.string(),
    age: z.number().int().positive(),
  });

  test('returns validated data on success', () => {
    const data = { name: 'Alice', age: 30 };
    const result = expectValid(TestSchema, data);
    expect(result).toEqual(data);
  });

  test('throws on validation failure', () => {
    expect(() => expectValid(TestSchema, { name: 'Bob', age: -1 }))
      .toThrow('Validation failed');
  });

  test('includes context in error message', () => {
    expect(() => expectValid(TestSchema, { name: 'Bob', age: -1 }, 'user input'))
      .toThrow('Validation failed in user input');
  });

  test('includes field path in error', () => {
    expect(() => expectValid(TestSchema, { name: 123, age: 30 }))
      .toThrow(/name/);
  });
});

describe('validateOrThrow', () => {
  test('is alias for expectValid', () => {
    const schema = z.number();
    expect(validateOrThrow(schema, 42)).toBe(42);
    expect(() => validateOrThrow(schema, 'not a number')).toThrow();
  });
});

describe('validateOrNull', () => {
  const schema = z.number();

  test('returns validated data on success', () => {
    expect(validateOrNull(schema, 42)).toBe(42);
  });

  test('returns null on validation failure', () => {
    expect(validateOrNull(schema, 'not a number')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(validateOrNull(schema, null)).toBeNull();
  });
});

// ============================================================================
// Type-Specific Validators
// ============================================================================

describe('expectAddress', () => {
  const validAddress = '0x0000000000000000000000000000000000000000';

  test('returns valid address', () => {
    expect(expectAddress(validAddress)).toBe(validAddress);
  });

  test('throws on invalid address', () => {
    expect(() => expectAddress('0x123')).toThrow('Invalid address');
    expect(() => expectAddress('not-an-address')).toThrow('Invalid address');
  });

  test('throws on non-string', () => {
    expect(() => expectAddress(123)).toThrow('Invalid address');
    expect(() => expectAddress(null)).toThrow('Invalid address');
  });

  test('includes context in error', () => {
    expect(() => expectAddress('0x123', 'recipient')).toThrow('recipient: Invalid address');
  });
});

describe('expectHex', () => {
  test('returns valid hex', () => {
    expect(expectHex('0xdeadbeef')).toBe('0xdeadbeef');
    expect(expectHex('0x')).toBe('0x');
  });

  test('throws on invalid hex', () => {
    expect(() => expectHex('deadbeef')).toThrow('Invalid hex');
    expect(() => expectHex('0xgg')).toThrow('Invalid hex');
  });

  test('includes context in error', () => {
    expect(() => expectHex('invalid', 'calldata')).toThrow('calldata: Invalid hex');
  });
});

describe('expectChainId', () => {
  test('returns valid chain ID', () => {
    expect(expectChainId(1)).toBe(1);
    expect(expectChainId(8453)).toBe(8453);
  });

  test('throws on invalid chain ID', () => {
    expect(() => expectChainId(0)).toThrow('Invalid chain ID');
    expect(() => expectChainId(-1)).toThrow('Invalid chain ID');
    expect(() => expectChainId(1.5)).toThrow('Invalid chain ID');
    expect(() => expectChainId('1')).toThrow('Invalid chain ID');
  });

  test('includes context in error', () => {
    expect(() => expectChainId(0, 'source chain')).toThrow('source chain: Invalid chain ID');
  });
});

describe('expectBigInt', () => {
  test('returns bigint directly', () => {
    expect(expectBigInt(100n)).toBe(100n);
  });

  test('converts string to bigint', () => {
    expect(expectBigInt('12345678901234567890')).toBe(12345678901234567890n);
  });

  test('converts number to bigint', () => {
    expect(expectBigInt(100)).toBe(100n);
  });

  test('throws on invalid input', () => {
    expect(() => expectBigInt('not-a-number' as string)).toThrow('Invalid');
  });

  test('uses custom field name in error', () => {
    expect(() => expectBigInt('invalid' as string, 'amount')).toThrow('Invalid amount');
  });
});

describe('expectNonEmptyString', () => {
  test('returns non-empty strings', () => {
    expect(expectNonEmptyString('hello', 'name')).toBe('hello');
    expect(expectNonEmptyString('  spaces  ', 'name')).toBe('  spaces  ');
  });

  test('throws on empty string', () => {
    expect(() => expectNonEmptyString('', 'name')).toThrow('Invalid name');
  });

  test('throws on whitespace-only string', () => {
    expect(() => expectNonEmptyString('   ', 'name')).toThrow('Invalid name');
  });

  test('throws on null/undefined', () => {
    expect(() => expectNonEmptyString(null, 'name')).toThrow('Invalid name');
    expect(() => expectNonEmptyString(undefined, 'name')).toThrow('Invalid name');
  });
});

describe('expectJson', () => {
  const schema = z.object({
    name: z.string(),
    value: z.number(),
  });

  test('parses and validates JSON', () => {
    const json = '{"name": "test", "value": 42}';
    const result = expectJson(json, schema);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  test('throws on invalid JSON', () => {
    expect(() => expectJson('not-json', schema)).toThrow('failed to parse JSON');
  });

  test('throws on valid JSON that fails schema', () => {
    const json = '{"name": "test", "value": "not-a-number"}';
    expect(() => expectJson(json, schema)).toThrow('Validation failed');
  });

  test('uses custom field name', () => {
    expect(() => expectJson('invalid', schema, 'config')).toThrow('Invalid config');
  });
});

// ============================================================================
// CidSchema Tests
// ============================================================================

describe('CidSchema', () => {
  test('accepts non-empty CID strings', () => {
    expect(CidSchema.safeParse('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG').success).toBe(true);
    expect(CidSchema.safeParse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi').success).toBe(true);
  });

  test('rejects empty string', () => {
    expect(CidSchema.safeParse('').success).toBe(false);
  });
});
