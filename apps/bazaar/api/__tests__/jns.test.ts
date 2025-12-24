/**
 * Unit tests for JNS (Jeju Name Service) business logic
 * Tests name validation, price calculation, expiry, and normalization
 */

import { describe, expect, test } from 'bun:test'
import { parseEther } from 'viem'
import {
  BASE_REGISTRATION_PRICE_ETH,
  CurrencyTypeSchema,
  calculateExpiryDate,
  // Expiry calculations
  calculateExpiryTimestamp,
  // Price calculations
  calculateRegistrationPrice,
  calculateRegistrationPriceWei,
  // Labelhash
  computeLabelhash,
  computeNameIdentifiers,
  formatExpiryDate,
  formatFullName,
  // Listing utilities
  formatListingPrice,
  formatRegistrationPrice,
  formatTimeRemaining,
  getAnnualPrice,
  getNameLengthCategory,
  getRemainingSeconds,
  isExpired,
  isValidNameFormat,
  JNS_SUFFIX,
  // Schemas
  JNSNameSchema,
  ListingDurationSchema,
  ListingPriceSchema,
  ListingStatusSchema,
  labelhashToTokenId,
  listingDurationToSeconds,
  MAX_NAME_LENGTH,
  // Constants
  MIN_NAME_LENGTH,
  NameListingInputSchema,
  NameRegistrationInputSchema,
  // Name normalization
  normalizeName,
  parseEthToWei,
  RegistrationDurationSchema,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  SHORT_NAME_MULTIPLIERS,
  validateListingDuration,
  validateListingInput,
  // Name validation
  validateName,
  // Validation helpers
  validateRegistrationInput,
} from '../jns'

// CONSTANTS TESTS

describe('JNS Constants', () => {
  test('MIN_NAME_LENGTH is 3', () => {
    expect(MIN_NAME_LENGTH).toBe(3)
  })

  test('MAX_NAME_LENGTH is 63', () => {
    expect(MAX_NAME_LENGTH).toBe(63)
  })

  test('BASE_REGISTRATION_PRICE_ETH is 0.01', () => {
    expect(BASE_REGISTRATION_PRICE_ETH).toBe(0.01)
  })

  test('SHORT_NAME_MULTIPLIERS has correct values', () => {
    expect(SHORT_NAME_MULTIPLIERS[3]).toBe(100)
    expect(SHORT_NAME_MULTIPLIERS[4]).toBe(10)
    expect(SHORT_NAME_MULTIPLIERS[5]).toBe(2)
    expect(SHORT_NAME_MULTIPLIERS[6]).toBeUndefined()
  })

  test('JNS_SUFFIX is .jeju', () => {
    expect(JNS_SUFFIX).toBe('.jeju')
  })

  test('SECONDS_PER_DAY is correct', () => {
    expect(SECONDS_PER_DAY).toBe(86400)
  })

  test('SECONDS_PER_YEAR is correct', () => {
    expect(SECONDS_PER_YEAR).toBe(365 * 86400)
  })
})

// SCHEMA TESTS

describe('JNSNameSchema', () => {
  test('accepts valid 3-char name', () => {
    const result = JNSNameSchema.safeParse('abc')
    expect(result.success).toBe(true)
  })

  test('accepts valid alphanumeric name', () => {
    const result = JNSNameSchema.safeParse('alice123')
    expect(result.success).toBe(true)
  })

  test('accepts name with hyphens in middle', () => {
    const result = JNSNameSchema.safeParse('my-cool-name')
    expect(result.success).toBe(true)
  })

  test('accepts max length name (63 chars)', () => {
    const name = 'a'.repeat(63)
    const result = JNSNameSchema.safeParse(name)
    expect(result.success).toBe(true)
  })

  test('rejects name shorter than 3 chars', () => {
    const result = JNSNameSchema.safeParse('ab')
    expect(result.success).toBe(false)
  })

  test('rejects name longer than 63 chars', () => {
    const name = 'a'.repeat(64)
    const result = JNSNameSchema.safeParse(name)
    expect(result.success).toBe(false)
  })

  test('rejects name starting with hyphen', () => {
    const result = JNSNameSchema.safeParse('-myname')
    expect(result.success).toBe(false)
  })

  test('rejects name ending with hyphen', () => {
    const result = JNSNameSchema.safeParse('myname-')
    expect(result.success).toBe(false)
  })

  test('rejects uppercase letters', () => {
    const result = JNSNameSchema.safeParse('MyName')
    expect(result.success).toBe(false)
  })

  test('rejects special characters', () => {
    const result = JNSNameSchema.safeParse('my_name')
    expect(result.success).toBe(false)
    const result2 = JNSNameSchema.safeParse('my.name')
    expect(result2.success).toBe(false)
    const result3 = JNSNameSchema.safeParse('my@name')
    expect(result3.success).toBe(false)
  })

  test('rejects spaces', () => {
    const result = JNSNameSchema.safeParse('my name')
    expect(result.success).toBe(false)
  })

  test('rejects empty string', () => {
    const result = JNSNameSchema.safeParse('')
    expect(result.success).toBe(false)
  })
})

describe('RegistrationDurationSchema', () => {
  test('accepts 1 day', () => {
    expect(RegistrationDurationSchema.safeParse(1).success).toBe(true)
  })

  test('accepts 365 days', () => {
    expect(RegistrationDurationSchema.safeParse(365).success).toBe(true)
  })

  test('accepts max 3650 days (10 years)', () => {
    expect(RegistrationDurationSchema.safeParse(3650).success).toBe(true)
  })

  test('rejects 0 days', () => {
    expect(RegistrationDurationSchema.safeParse(0).success).toBe(false)
  })

  test('rejects negative days', () => {
    expect(RegistrationDurationSchema.safeParse(-1).success).toBe(false)
  })

  test('rejects over 10 years', () => {
    expect(RegistrationDurationSchema.safeParse(3651).success).toBe(false)
  })

  test('rejects non-integer', () => {
    expect(RegistrationDurationSchema.safeParse(1.5).success).toBe(false)
  })
})

describe('ListingPriceSchema', () => {
  test('accepts positive price', () => {
    expect(ListingPriceSchema.safeParse('0.1').success).toBe(true)
  })

  test('accepts integer price', () => {
    expect(ListingPriceSchema.safeParse('1').success).toBe(true)
  })

  test('accepts large price', () => {
    expect(ListingPriceSchema.safeParse('1000').success).toBe(true)
  })

  test('rejects zero price', () => {
    expect(ListingPriceSchema.safeParse('0').success).toBe(false)
  })

  test('rejects negative price', () => {
    expect(ListingPriceSchema.safeParse('-1').success).toBe(false)
  })

  test('rejects non-numeric string', () => {
    expect(ListingPriceSchema.safeParse('abc').success).toBe(false)
  })
})

describe('ListingDurationSchema', () => {
  test('accepts 7 days', () => {
    expect(ListingDurationSchema.safeParse(7).success).toBe(true)
  })

  test('accepts 30 days', () => {
    expect(ListingDurationSchema.safeParse(30).success).toBe(true)
  })

  test('accepts max 365 days', () => {
    expect(ListingDurationSchema.safeParse(365).success).toBe(true)
  })

  test('rejects 0 days', () => {
    expect(ListingDurationSchema.safeParse(0).success).toBe(false)
  })

  test('rejects over 365 days', () => {
    expect(ListingDurationSchema.safeParse(366).success).toBe(false)
  })
})

describe('ListingStatusSchema', () => {
  test('accepts active', () => {
    expect(ListingStatusSchema.safeParse('active').success).toBe(true)
  })

  test('accepts sold', () => {
    expect(ListingStatusSchema.safeParse('sold').success).toBe(true)
  })

  test('accepts cancelled', () => {
    expect(ListingStatusSchema.safeParse('cancelled').success).toBe(true)
  })

  test('rejects invalid status', () => {
    expect(ListingStatusSchema.safeParse('pending').success).toBe(false)
  })
})

describe('CurrencyTypeSchema', () => {
  test('accepts ETH', () => {
    expect(CurrencyTypeSchema.safeParse('ETH').success).toBe(true)
  })

  test('accepts HG', () => {
    expect(CurrencyTypeSchema.safeParse('HG').success).toBe(true)
  })

  test('accepts USDC', () => {
    expect(CurrencyTypeSchema.safeParse('USDC').success).toBe(true)
  })

  test('rejects invalid currency', () => {
    expect(CurrencyTypeSchema.safeParse('BTC').success).toBe(false)
  })
})

// NAME VALIDATION TESTS

describe('validateName', () => {
  test('returns valid for correct name', () => {
    const result = validateName('alice')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.normalizedName).toBe('alice')
    }
  })

  test('normalizes uppercase to lowercase', () => {
    const result = validateName('ALICE')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.normalizedName).toBe('alice')
    }
  })

  test('strips .jeju suffix', () => {
    const result = validateName('alice.jeju')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.normalizedName).toBe('alice')
    }
  })

  test('returns error for invalid name', () => {
    const result = validateName('ab')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('at least')
    }
  })

  test('returns error for name starting with hyphen', () => {
    const result = validateName('-test')
    expect(result.valid).toBe(false)
  })
})

describe('isValidNameFormat', () => {
  test('returns true for valid name', () => {
    expect(isValidNameFormat('alice')).toBe(true)
  })

  test('returns true for name with numbers', () => {
    expect(isValidNameFormat('alice123')).toBe(true)
  })

  test('returns true for name with hyphens', () => {
    expect(isValidNameFormat('my-name')).toBe(true)
  })

  test('returns false for too short', () => {
    expect(isValidNameFormat('ab')).toBe(false)
  })

  test('returns false for invalid chars', () => {
    expect(isValidNameFormat('my_name')).toBe(false)
  })
})

describe('getNameLengthCategory', () => {
  test('returns premium for 3-char names', () => {
    expect(getNameLengthCategory('abc')).toBe('premium')
  })

  test('returns semi-premium for 4-char names', () => {
    expect(getNameLengthCategory('abcd')).toBe('semi-premium')
  })

  test('returns standard for 5+ char names', () => {
    expect(getNameLengthCategory('abcde')).toBe('standard')
    expect(getNameLengthCategory('alice')).toBe('standard')
    expect(getNameLengthCategory('verylongname')).toBe('standard')
  })
})

// NAME NORMALIZATION TESTS

describe('normalizeName', () => {
  test('converts to lowercase', () => {
    expect(normalizeName('ALICE')).toBe('alice')
    expect(normalizeName('Alice')).toBe('alice')
    expect(normalizeName('aLiCe')).toBe('alice')
  })

  test('trims whitespace', () => {
    expect(normalizeName('  alice  ')).toBe('alice')
    expect(normalizeName('\talice\n')).toBe('alice')
  })

  test('removes .jeju suffix', () => {
    expect(normalizeName('alice.jeju')).toBe('alice')
    expect(normalizeName('ALICE.JEJU')).toBe('alice')
  })

  test('handles already normalized name', () => {
    expect(normalizeName('alice')).toBe('alice')
  })
})

describe('formatFullName', () => {
  test('adds .jeju suffix', () => {
    expect(formatFullName('alice')).toBe('alice.jeju')
  })

  test('normalizes and adds suffix', () => {
    expect(formatFullName('ALICE')).toBe('alice.jeju')
  })

  test('does not double suffix', () => {
    expect(formatFullName('alice.jeju')).toBe('alice.jeju')
  })
})

// LABELHASH TESTS

describe('computeLabelhash', () => {
  test('returns 0x-prefixed hex string', () => {
    const hash = computeLabelhash('alice')
    expect(hash.startsWith('0x')).toBe(true)
    expect(hash.length).toBe(66) // 0x + 64 hex chars
  })

  test('normalizes before hashing', () => {
    const hash1 = computeLabelhash('alice')
    const hash2 = computeLabelhash('ALICE')
    expect(hash1).toBe(hash2)
  })

  test('different names produce different hashes', () => {
    const hash1 = computeLabelhash('alice')
    const hash2 = computeLabelhash('bob')
    expect(hash1).not.toBe(hash2)
  })

  test('same name produces same hash', () => {
    const hash1 = computeLabelhash('alice')
    const hash2 = computeLabelhash('alice')
    expect(hash1).toBe(hash2)
  })
})

describe('labelhashToTokenId', () => {
  test('converts hex to bigint', () => {
    const hash = computeLabelhash('alice')
    const tokenId = labelhashToTokenId(hash)
    expect(typeof tokenId).toBe('bigint')
    expect(tokenId > 0n).toBe(true)
  })
})

describe('computeNameIdentifiers', () => {
  test('returns both labelhash and tokenId', () => {
    const { labelhash, tokenId } = computeNameIdentifiers('alice')
    expect(labelhash.startsWith('0x')).toBe(true)
    expect(typeof tokenId).toBe('bigint')
    expect(BigInt(labelhash)).toBe(tokenId)
  })
})

// PRICE CALCULATION TESTS

describe('calculateRegistrationPrice', () => {
  test('calculates 3-char premium price (100x)', () => {
    const price = calculateRegistrationPrice('abc', 365)
    expect(price).toBe(1) // 0.01 * 100 * 1 year
  })

  test('calculates 4-char semi-premium price (10x)', () => {
    const price = calculateRegistrationPrice('abcd', 365)
    expect(price).toBe(0.1) // 0.01 * 10 * 1 year
  })

  test('calculates 5-char price (2x)', () => {
    const price = calculateRegistrationPrice('abcde', 365)
    expect(price).toBe(0.02) // 0.01 * 2 * 1 year
  })

  test('calculates 6+ char standard price', () => {
    const price = calculateRegistrationPrice('abcdef', 365)
    expect(price).toBe(0.01) // 0.01 * 1 * 1 year
  })

  test('scales with duration', () => {
    const price1 = calculateRegistrationPrice('alice', 365)
    const price2 = calculateRegistrationPrice('alice', 730)
    expect(price2).toBe(price1 * 2)
  })

  test('handles partial years', () => {
    const price = calculateRegistrationPrice('alice', 182) // ~0.5 years
    expect(price).toBeCloseTo(0.01 * 2 * (182 / 365), 6)
  })
})

describe('calculateRegistrationPriceWei', () => {
  test('returns bigint', () => {
    const price = calculateRegistrationPriceWei('alice', 365)
    expect(typeof price).toBe('bigint')
  })

  test('matches ETH price in wei', () => {
    const priceWei = calculateRegistrationPriceWei('abcdef', 365)
    expect(priceWei).toBe(parseEther('0.01'))
  })

  test('handles premium pricing', () => {
    const priceWei = calculateRegistrationPriceWei('abc', 365)
    expect(priceWei).toBe(parseEther('1'))
  })
})

describe('getAnnualPrice', () => {
  test('returns premium annual price for 3-char', () => {
    expect(getAnnualPrice('abc')).toBe(1)
  })

  test('returns semi-premium annual price for 4-char', () => {
    expect(getAnnualPrice('abcd')).toBe(0.1)
  })

  test('returns standard annual price for 6+char', () => {
    expect(getAnnualPrice('abcdef')).toBe(0.01)
  })
})

describe('formatRegistrationPrice', () => {
  test('formats with ETH suffix', () => {
    const price = parseEther('0.01')
    expect(formatRegistrationPrice(price)).toBe('0.01 ETH')
  })

  test('formats 1 ETH correctly', () => {
    const price = parseEther('1')
    expect(formatRegistrationPrice(price)).toBe('1 ETH')
  })
})

// EXPIRY CALCULATION TESTS

describe('calculateExpiryTimestamp', () => {
  test('adds days to current time', () => {
    const now = Math.floor(Date.now() / 1000)
    const expiry = calculateExpiryTimestamp(30)
    const expected = now + 30 * SECONDS_PER_DAY
    // Allow 1 second tolerance for test execution time
    expect(Math.abs(expiry - expected)).toBeLessThan(2)
  })

  test('uses custom start timestamp', () => {
    const start = 1000000000
    const expiry = calculateExpiryTimestamp(365, start)
    expect(expiry).toBe(start + 365 * SECONDS_PER_DAY)
  })
})

describe('calculateExpiryDate', () => {
  test('returns Date object', () => {
    const expiry = calculateExpiryDate(30)
    expect(expiry instanceof Date).toBe(true)
  })

  test('calculates correct date', () => {
    const start = new Date('2024-01-01')
    const expiry = calculateExpiryDate(30, start)
    expect(expiry.getTime()).toBe(start.getTime() + 30 * SECONDS_PER_DAY * 1000)
  })
})

describe('isExpired', () => {
  test('returns true for past timestamp', () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    expect(isExpired(past)).toBe(true)
  })

  test('returns false for future timestamp', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    expect(isExpired(future)).toBe(false)
  })

  test('returns true for current timestamp', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isExpired(now)).toBe(true)
  })
})

describe('getRemainingSeconds', () => {
  test('returns 0 for expired', () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    expect(getRemainingSeconds(past)).toBe(0)
  })

  test('returns positive for future', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const remaining = getRemainingSeconds(future)
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(3600)
  })
})

describe('formatTimeRemaining', () => {
  test('returns Expired for past time', () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    expect(formatTimeRemaining(past)).toBe('Expired')
  })

  test('formats minutes', () => {
    const future = Math.floor(Date.now() / 1000) + 1800 // 30 mins
    const result = formatTimeRemaining(future)
    expect(result).toMatch(/\d+ minute/)
  })

  test('formats hours', () => {
    const future = Math.floor(Date.now() / 1000) + 7200 // 2 hours
    const result = formatTimeRemaining(future)
    expect(result).toMatch(/\d+ hour/)
  })

  test('formats days', () => {
    const future = Math.floor(Date.now() / 1000) + 7 * SECONDS_PER_DAY
    const result = formatTimeRemaining(future)
    expect(result).toMatch(/\d+ day/)
  })

  test('formats months for > 30 days', () => {
    const future = Math.floor(Date.now() / 1000) + 60 * SECONDS_PER_DAY
    const result = formatTimeRemaining(future)
    expect(result).toMatch(/\d+ month/)
  })

  test('uses singular for 1 unit', () => {
    const future = Math.floor(Date.now() / 1000) + SECONDS_PER_DAY
    expect(formatTimeRemaining(future)).toBe('1 day')
  })

  test('uses plural for > 1 unit', () => {
    const future = Math.floor(Date.now() / 1000) + 2 * SECONDS_PER_DAY
    expect(formatTimeRemaining(future)).toBe('2 days')
  })
})

describe('formatExpiryDate', () => {
  test('formats date correctly', () => {
    const timestamp = new Date('2024-06-15').getTime() / 1000
    const formatted = formatExpiryDate(timestamp)
    expect(formatted).toContain('Jun')
    expect(formatted).toContain('15')
    expect(formatted).toContain('2024')
  })
})

// LISTING UTILITY TESTS

describe('formatListingPrice', () => {
  test('formats price with ETH suffix', () => {
    const price = parseEther('0.5')
    expect(formatListingPrice(price)).toBe('0.5 ETH')
  })
})

describe('parseEthToWei', () => {
  test('converts ETH string to wei', () => {
    expect(parseEthToWei('1')).toBe(parseEther('1'))
  })

  test('handles decimal values', () => {
    expect(parseEthToWei('0.5')).toBe(parseEther('0.5'))
  })
})

describe('listingDurationToSeconds', () => {
  test('converts days to seconds as bigint', () => {
    expect(listingDurationToSeconds(1)).toBe(BigInt(SECONDS_PER_DAY))
    expect(listingDurationToSeconds(30)).toBe(BigInt(30 * SECONDS_PER_DAY))
  })
})

describe('validateListingDuration', () => {
  test('accepts valid duration', () => {
    const result = validateListingDuration(30)
    expect(result.valid).toBe(true)
  })

  test('rejects zero duration', () => {
    const result = validateListingDuration(0)
    expect(result.valid).toBe(false)
  })

  test('rejects over 365 days', () => {
    const result = validateListingDuration(400)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('1 year')
    }
  })
})

// VALIDATION HELPER TESTS

describe('validateRegistrationInput', () => {
  test('validates correct input', () => {
    const result = validateRegistrationInput({
      name: 'alice',
      durationDays: 365,
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.name).toBe('alice')
      expect(result.data.durationDays).toBe(365)
    }
  })

  test('normalizes name in validation', () => {
    const result = validateRegistrationInput({
      name: 'ALICE.JEJU',
      durationDays: 365,
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.name).toBe('alice')
    }
  })

  test('rejects invalid name', () => {
    const result = validateRegistrationInput({ name: 'ab', durationDays: 365 })
    expect(result.valid).toBe(false)
  })

  test('rejects invalid duration', () => {
    const result = validateRegistrationInput({ name: 'alice', durationDays: 0 })
    expect(result.valid).toBe(false)
  })
})

describe('validateListingInput', () => {
  test('validates correct input', () => {
    const result = validateListingInput({
      name: 'alice',
      priceEth: '0.1',
      durationDays: 30,
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.name).toBe('alice')
      expect(result.data.priceEth).toBe('0.1')
      expect(result.data.durationDays).toBe(30)
    }
  })

  test('rejects invalid price', () => {
    const result = validateListingInput({
      name: 'alice',
      priceEth: '0',
      durationDays: 30,
    })
    expect(result.valid).toBe(false)
  })

  test('rejects invalid listing duration', () => {
    const result = validateListingInput({
      name: 'alice',
      priceEth: '0.1',
      durationDays: 500,
    })
    expect(result.valid).toBe(false)
  })
})

// COMPOSITE SCHEMA TESTS

describe('NameRegistrationInputSchema', () => {
  test('accepts valid registration input', () => {
    const result = NameRegistrationInputSchema.safeParse({
      name: 'alice',
      durationDays: 365,
    })
    expect(result.success).toBe(true)
  })

  test('rejects missing name', () => {
    const result = NameRegistrationInputSchema.safeParse({
      durationDays: 365,
    })
    expect(result.success).toBe(false)
  })

  test('rejects missing duration', () => {
    const result = NameRegistrationInputSchema.safeParse({
      name: 'alice',
    })
    expect(result.success).toBe(false)
  })
})

describe('NameListingInputSchema', () => {
  test('accepts valid listing input', () => {
    const result = NameListingInputSchema.safeParse({
      name: 'alice',
      priceEth: '0.1',
      durationDays: 30,
    })
    expect(result.success).toBe(true)
  })

  test('rejects missing fields', () => {
    const result = NameListingInputSchema.safeParse({
      name: 'alice',
    })
    expect(result.success).toBe(false)
  })
})
