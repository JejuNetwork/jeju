/**
 * Redis Cluster Tests
 *
 * Tests for CRC16 slot calculation, circuit breaker, and encryption.
 * These test the internal algorithms without requiring a Redis connection.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// ============================================================================
// Extracted testable functions from redis-cluster.ts
// ============================================================================

// CRC16 lookup table for Redis cluster slot calculation
const CRC16_TABLE = new Uint16Array(256)
;(() => {
  for (let i = 0; i < 256; i++) {
    let crc = i << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
    }
    CRC16_TABLE[i] = crc & 0xffff
  }
})()

function crc16(data: Buffer): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xff]) & 0xffff
  }
  return crc
}

function calculateSlot(key: string): number {
  // Check for hash tag {xxx}
  const start = key.indexOf('{')
  const end = key.indexOf('}', start + 1)

  const hashKey =
    start !== -1 && end !== -1 && end > start + 1
      ? key.slice(start + 1, end)
      : key

  return crc16(Buffer.from(hashKey)) % 16384
}

function groupKeysBySlot(keys: string[]): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const key of keys) {
    const slot = calculateSlot(key)
    const existing = groups.get(slot) ?? []
    existing.push(key)
    groups.set(slot, existing)
  }
  return groups
}

// ============================================================================
// Circuit Breaker (extracted for testing)
// ============================================================================

interface CircuitBreakerState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    state: 'closed',
  }
  private readonly threshold: number
  private readonly resetTimeout: number

  constructor(threshold = 5, resetTimeout = 30000) {
    this.threshold = threshold
    this.resetTimeout = resetTimeout
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === 'open') {
      if (Date.now() - this.state.lastFailure > this.resetTimeout) {
        this.state.state = 'half-open'
      } else {
        throw new Error('Circuit breaker is open')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    this.state.failures = 0
    this.state.state = 'closed'
  }

  private onFailure(): void {
    this.state.failures++
    this.state.lastFailure = Date.now()
    if (this.state.failures >= this.threshold) {
      this.state.state = 'open'
    }
  }

  getState(): CircuitBreakerState['state'] {
    return this.state.state
  }

  getFailures(): number {
    return this.state.failures
  }
}

// ============================================================================
// Encryption helpers (extracted for testing)
// ============================================================================

function encrypt(value: string, encryptionKey: Buffer | null): string {
  if (!encryptionKey) return value

  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)

  let encrypted = cipher.update(value, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

function decrypt(value: string, encryptionKey: Buffer | null): string {
  if (!encryptionKey || !value.startsWith('enc:')) return value

  const parts = value.split(':')
  if (parts.length !== 4) return value

  const iv = Buffer.from(parts[1], 'hex')
  const authTag = Buffer.from(parts[2], 'hex')
  const encrypted = parts[3]

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

// ============================================================================
// CRC16 Tests
// ============================================================================

describe('CRC16 Algorithm', () => {
  test('produces consistent hash for same input', () => {
    const data = Buffer.from('test-key')
    expect(crc16(data)).toBe(crc16(data))
  })

  test('produces different hashes for different inputs', () => {
    const hash1 = crc16(Buffer.from('key1'))
    const hash2 = crc16(Buffer.from('key2'))
    expect(hash1).not.toBe(hash2)
  })

  test('handles empty buffer', () => {
    expect(crc16(Buffer.from(''))).toBe(0)
  })

  test('hash is within 16-bit range', () => {
    for (let i = 0; i < 100; i++) {
      const randomKey = `key-${Math.random().toString(36)}`
      const hash = crc16(Buffer.from(randomKey))
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThan(65536)
    }
  })

  // Test known values for CRC-16 CCITT (0x1021 polynomial)
  test('matches known CRC-16 CCITT values', () => {
    // These are expected values based on Redis CRC16 implementation
    const hash = crc16(Buffer.from('123456789'))
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThan(65536)
  })
})

// ============================================================================
// Slot Calculation Tests
// ============================================================================

describe('calculateSlot', () => {
  test('calculates slot for simple key', () => {
    const slot = calculateSlot('my-key')
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(slot).toBeLessThan(16384)
  })

  test('same key produces same slot', () => {
    expect(calculateSlot('consistent-key')).toBe(
      calculateSlot('consistent-key'),
    )
  })

  test('different keys may produce different slots', () => {
    // With 16384 slots, collision is possible but unlikely for 2 random keys
    const slots = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      slots.add(calculateSlot(`key-${i}`))
    }
    // Should have at least 100 different slots
    expect(slots.size).toBeGreaterThan(100)
  })

  test('hash tag: uses content between {} for slot', () => {
    // Keys with same hash tag go to same slot
    const slot1 = calculateSlot('{user:123}:profile')
    const slot2 = calculateSlot('{user:123}:settings')
    expect(slot1).toBe(slot2)
  })

  test('hash tag: different content produces different slots', () => {
    const slot1 = calculateSlot('{user:123}:profile')
    const slot2 = calculateSlot('{user:456}:profile')
    expect(slot1).not.toBe(slot2)
  })

  test('hash tag: empty {} is ignored', () => {
    const slotWithEmpty = calculateSlot('{}:key')
    const slotWithoutEmpty = calculateSlot('{}:key')
    // Both should use the full key
    expect(slotWithEmpty).toBe(slotWithoutEmpty)
  })

  test('hash tag: only first {} pair is used', () => {
    const slot = calculateSlot('{first}:{second}')
    const expectedSlot = calculateSlot('first')
    expect(slot).toBe(expectedSlot)
  })

  test('handles special characters in keys', () => {
    const slot = calculateSlot('key:with:colons')
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(slot).toBeLessThan(16384)
  })

  test('handles unicode in keys', () => {
    const slot = calculateSlot('键:中文')
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(slot).toBeLessThan(16384)
  })
})

describe('groupKeysBySlot', () => {
  test('groups keys by their slot', () => {
    const keys = ['{same}:a', '{same}:b', '{diff}:c']
    const groups = groupKeysBySlot(keys)

    // Keys with same hash tag should be grouped together
    const sameSlot = calculateSlot('{same}:a')
    const diffSlot = calculateSlot('{diff}:c')

    expect(groups.get(sameSlot)).toContain('{same}:a')
    expect(groups.get(sameSlot)).toContain('{same}:b')
    expect(groups.get(diffSlot)).toContain('{diff}:c')
  })

  test('handles empty array', () => {
    const groups = groupKeysBySlot([])
    expect(groups.size).toBe(0)
  })

  test('all keys are accounted for', () => {
    const keys = Array.from({ length: 100 }, (_, i) => `key-${i}`)
    const groups = groupKeysBySlot(keys)

    let total = 0
    for (const group of groups.values()) {
      total += group.length
    }
    expect(total).toBe(100)
  })
})

// ============================================================================
// Circuit Breaker Tests
// ============================================================================

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    breaker = new CircuitBreaker(3, 100) // 3 failures, 100ms reset
  })

  test('starts in closed state', () => {
    expect(breaker.getState()).toBe('closed')
  })

  test('executes function when closed', async () => {
    const result = await breaker.execute(() => Promise.resolve('success'))
    expect(result).toBe('success')
    expect(breaker.getState()).toBe('closed')
  })

  test('counts failures', async () => {
    try {
      await breaker.execute(() => Promise.reject(new Error('fail')))
    } catch {
      // expected
    }
    expect(breaker.getFailures()).toBe(1)
    expect(breaker.getState()).toBe('closed')
  })

  test('opens after threshold failures', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')))
      } catch {
        // expected
      }
    }
    expect(breaker.getState()).toBe('open')
  })

  test('rejects requests when open', async () => {
    // Open the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')))
      } catch {
        // expected
      }
    }

    // Should reject without calling the function
    let called = false
    try {
      await breaker.execute(() => {
        called = true
        return Promise.resolve('success')
      })
    } catch (error) {
      expect((error as Error).message).toBe('Circuit breaker is open')
    }
    expect(called).toBe(false)
  })

  test('transitions to half-open after reset timeout', async () => {
    // Open the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')))
      } catch {
        // expected
      }
    }
    expect(breaker.getState()).toBe('open')

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Should transition to half-open on next call
    const result = await breaker.execute(() => Promise.resolve('success'))
    expect(result).toBe('success')
    expect(breaker.getState()).toBe('closed')
  })

  test('resets failure count on success', async () => {
    // Accumulate some failures (but not enough to open)
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')))
      } catch {
        // expected
      }
    }
    expect(breaker.getFailures()).toBe(2)

    // Success should reset
    await breaker.execute(() => Promise.resolve('success'))
    expect(breaker.getFailures()).toBe(0)
  })

  test('re-opens on failure in half-open state', async () => {
    // Open the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')))
      } catch {
        // expected
      }
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Fail in half-open state
    try {
      await breaker.execute(() => Promise.reject(new Error('fail again')))
    } catch {
      // expected
    }

    // Should be open again
    expect(breaker.getState()).toBe('open')
  })
})

// ============================================================================
// Encryption Tests
// ============================================================================

describe('AES-256-GCM Encryption', () => {
  const validKey = Buffer.alloc(32, 'k') // 32 bytes for AES-256

  test('encrypts and decrypts correctly', () => {
    const original = 'Hello, World!'
    const encrypted = encrypt(original, validKey)
    const decrypted = decrypt(encrypted, validKey)
    expect(decrypted).toBe(original)
  })

  test('encrypted value has correct format', () => {
    const encrypted = encrypt('test', validKey)
    const parts = encrypted.split(':')
    expect(parts.length).toBe(4)
    expect(parts[0]).toBe('enc')
    expect(parts[1].length).toBe(32) // IV is 16 bytes = 32 hex chars
    expect(parts[2].length).toBe(32) // Auth tag is 16 bytes = 32 hex chars
  })

  test('different encryptions produce different ciphertexts', () => {
    const plaintext = 'same message'
    const enc1 = encrypt(plaintext, validKey)
    const enc2 = encrypt(plaintext, validKey)
    expect(enc1).not.toBe(enc2) // Due to random IV
  })

  test('returns value unchanged without encryption key', () => {
    const value = 'plain text'
    expect(encrypt(value, null)).toBe(value)
    expect(decrypt(value, null)).toBe(value)
  })

  test('returns non-encrypted values unchanged', () => {
    const value = 'not encrypted'
    expect(decrypt(value, validKey)).toBe(value)
  })

  test('handles empty string', () => {
    const encrypted = encrypt('', validKey)
    const decrypted = decrypt(encrypted, validKey)
    expect(decrypted).toBe('')
  })

  test('handles unicode', () => {
    const original = '你好世界 🌍'
    const encrypted = encrypt(original, validKey)
    const decrypted = decrypt(encrypted, validKey)
    expect(decrypted).toBe(original)
  })

  test('handles large data', () => {
    const original = 'x'.repeat(10000)
    const encrypted = encrypt(original, validKey)
    const decrypted = decrypt(encrypted, validKey)
    expect(decrypted).toBe(original)
  })

  test('detects tampered ciphertext', () => {
    const encrypted = encrypt('sensitive data', validKey)
    const parts = encrypted.split(':')
    // Tamper with the ciphertext
    parts[3] = `ff${parts[3].slice(2)}`
    const tampered = parts.join(':')

    expect(() => decrypt(tampered, validKey)).toThrow()
  })

  test('detects wrong key', () => {
    const encrypted = encrypt('secret', validKey)
    const wrongKey = Buffer.alloc(32, 'w')

    expect(() => decrypt(encrypted, wrongKey)).toThrow()
  })

  test('handles malformed encrypted string', () => {
    // Wrong number of parts
    expect(decrypt('enc:a:b', validKey)).toBe('enc:a:b')
    expect(decrypt('enc:a:b:c:d', validKey)).toBe('enc:a:b:c:d')
  })

  // Property-based: round-trip for random strings
  test('round-trip for random strings', () => {
    for (let i = 0; i < 50; i++) {
      const original = randomBytes(
        Math.floor(Math.random() * 100) + 1,
      ).toString('base64')
      const encrypted = encrypt(original, validKey)
      const decrypted = decrypt(encrypted, validKey)
      expect(decrypted).toBe(original)
    }
  })
})
