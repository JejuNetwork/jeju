/**
 * Unit tests for JNS (Jeju Name Service) library functions
 */

import { describe, expect, test } from 'bun:test'
import {
  calculateRegistrationPriceWei,
  computeLabelhash,
  formatFullName,
  formatTimeRemaining,
  getNameLengthCategory,
  isExpired,
  MAX_NAME_LENGTH,
  normalizeName,
  SECONDS_PER_DAY,
  validateName,
} from '../../lib/jns'

describe('JNS Name Normalization', () => {
  test('converts to lowercase', () => {
    expect(normalizeName('HelloWorld')).toBe('helloworld')
  })

  test('trims whitespace', () => {
    expect(normalizeName('  name  ')).toBe('name')
  })

  test('handles already normalized names', () => {
    expect(normalizeName('myname')).toBe('myname')
  })

  test('handles empty string', () => {
    expect(normalizeName('')).toBe('')
  })

  test('removes .jeju suffix', () => {
    expect(normalizeName('myname.jeju')).toBe('myname')
  })
})

describe('JNS Name Validation', () => {
  test('accepts valid 3+ character names', () => {
    const result = validateName('abc')
    expect(result.valid).toBe(true)
  })

  test('accepts alphanumeric names', () => {
    const result = validateName('user123')
    expect(result.valid).toBe(true)
  })

  test('rejects names shorter than 3 characters', () => {
    const result = validateName('ab')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('3')
    }
  })

  test('rejects names with special characters', () => {
    const result = validateName('user@name')
    expect(result.valid).toBe(false)
  })

  test('rejects empty names', () => {
    const result = validateName('')
    expect(result.valid).toBe(false)
  })

  test('rejects names with spaces', () => {
    const result = validateName('hello world')
    expect(result.valid).toBe(false)
  })

  test('accepts hyphenated names in the middle', () => {
    const result = validateName('my-name')
    expect(result.valid).toBe(true)
  })

  test('rejects names starting with hyphen', () => {
    const result = validateName('-myname')
    expect(result.valid).toBe(false)
  })

  test('rejects names ending with hyphen', () => {
    const result = validateName('myname-')
    expect(result.valid).toBe(false)
  })
})

describe('JNS Full Name Formatting', () => {
  test('appends .jeju suffix', () => {
    expect(formatFullName('myname')).toBe('myname.jeju')
  })

  test('normalizes and appends suffix', () => {
    expect(formatFullName('MyName.jeju')).toBe('myname.jeju')
  })
})

describe('JNS Registration Price Calculation', () => {
  test('calculates price for 365 days', () => {
    const price = calculateRegistrationPriceWei('testname', 365)
    // Base price is 0.01 ETH/year = 10000000000000000 wei
    expect(price).toBe(10000000000000000n)
  })

  test('3-char names cost 100x more', () => {
    const price3char = calculateRegistrationPriceWei('abc', 365)
    const price6char = calculateRegistrationPriceWei('abcdef', 365)
    expect(price3char).toBe(price6char * 100n)
  })

  test('4-char names cost 10x more', () => {
    const price4char = calculateRegistrationPriceWei('abcd', 365)
    const price6char = calculateRegistrationPriceWei('abcdef', 365)
    expect(price4char).toBe(price6char * 10n)
  })

  test('5-char names cost 2x more', () => {
    const price5char = calculateRegistrationPriceWei('abcde', 365)
    const price6char = calculateRegistrationPriceWei('abcdef', 365)
    expect(price5char).toBe(price6char * 2n)
  })

  test('longer duration costs more', () => {
    const price1year = calculateRegistrationPriceWei('test', 365)
    const price2years = calculateRegistrationPriceWei('test', 730)
    expect(price2years).toBeGreaterThan(price1year)
  })

  test('zero duration returns zero', () => {
    const price = calculateRegistrationPriceWei('test', 0)
    expect(price).toBe(0n)
  })

  test('SECONDS_PER_DAY constant is correct', () => {
    expect(SECONDS_PER_DAY).toBe(86400)
  })
})

describe('JNS Labelhash', () => {
  test('computes deterministic labelhash', () => {
    const hash1 = computeLabelhash('test')
    const hash2 = computeLabelhash('test')
    expect(hash1).toBe(hash2)
  })

  test('different names have different hashes', () => {
    const hash1 = computeLabelhash('test1')
    const hash2 = computeLabelhash('test2')
    expect(hash1).not.toBe(hash2)
  })

  test('normalizes before hashing', () => {
    const hash1 = computeLabelhash('Test')
    const hash2 = computeLabelhash('test')
    expect(hash1).toBe(hash2)
  })
})

describe('JNS Name Length Category', () => {
  test('3-char names are premium', () => {
    expect(getNameLengthCategory('abc')).toBe('premium')
  })

  test('4-char names are semi-premium', () => {
    expect(getNameLengthCategory('abcd')).toBe('semi-premium')
  })

  test('5+ char names are standard', () => {
    expect(getNameLengthCategory('abcde')).toBe('standard')
    expect(getNameLengthCategory('abcdefgh')).toBe('standard')
  })
})

describe('JNS Expiry Functions', () => {
  test('isExpired returns true for past timestamps', () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 1000
    expect(isExpired(pastTimestamp)).toBe(true)
  })

  test('isExpired returns false for future timestamps', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 1000
    expect(isExpired(futureTimestamp)).toBe(false)
  })

  test('formatTimeRemaining shows Expired for past', () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 1000
    expect(formatTimeRemaining(pastTimestamp)).toBe('Expired')
  })

  test('formatTimeRemaining shows days for long durations', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 5 * SECONDS_PER_DAY
    const result = formatTimeRemaining(futureTimestamp)
    expect(result).toContain('day')
  })
})

describe('JNS Edge Cases', () => {
  test('rejects names exceeding max length', () => {
    const longName = 'a'.repeat(MAX_NAME_LENGTH + 1)
    const result = validateName(longName)
    expect(result.valid).toBe(false)
  })

  test('accepts names at max length', () => {
    const maxName = 'a'.repeat(MAX_NAME_LENGTH)
    const result = validateName(maxName)
    expect(result.valid).toBe(true)
  })
})
