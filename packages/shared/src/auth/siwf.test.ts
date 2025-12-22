/**
 * SIWF (Sign In With Farcaster) Tests
 *
 * Tests for Farcaster authentication message formatting and parsing.
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import {
  createSIWFMessage,
  formatSIWFMessage,
  generateAuthKitUrl,
  parseSIWFMessage,
} from './siwf'
import type { SIWFMessage } from './types'

describe('createSIWFMessage', () => {
  test('creates a basic SIWF message', () => {
    const message = createSIWFMessage({
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
    })

    expect(message.domain).toBe('example.com')
    expect(message.fid).toBe(12345)
    expect(message.custody).toBe('0x1234567890123456789012345678901234567890')
    expect(message.nonce).toBeDefined()
    expect(message.issuedAt).toBeDefined()
  })

  test('uses provided nonce', () => {
    const message = createSIWFMessage({
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
      nonce: 'my-custom-nonce',
    })

    expect(message.nonce).toBe('my-custom-nonce')
  })

  test('sets expiration time when specified', () => {
    const message = createSIWFMessage({
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
      expirationMinutes: 10,
    })

    expect(message.expirationTime).toBeDefined()
    if (!message.expirationTime) throw new Error('expirationTime not set')

    const issuedAt = new Date(message.issuedAt).getTime()
    const expirationTime = new Date(message.expirationTime).getTime()
    const diffMinutes = (expirationTime - issuedAt) / (60 * 1000)

    expect(diffMinutes).toBeCloseTo(10, 0)
  })

  test('omits expiration time when not specified', () => {
    const message = createSIWFMessage({
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
    })

    expect(message.expirationTime).toBeUndefined()
  })
})

describe('formatSIWFMessage', () => {
  test('formats message correctly', () => {
    const message: SIWFMessage = {
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
      nonce: 'abc123',
      issuedAt: '2024-01-01T00:00:00.000Z',
    }

    const formatted = formatSIWFMessage(message)

    expect(formatted).toContain(
      'example.com wants you to sign in with your Farcaster account:',
    )
    expect(formatted).toContain('FID: 12345')
    expect(formatted).toContain(
      'Custody Address: 0x1234567890123456789012345678901234567890',
    )
    expect(formatted).toContain('Nonce: abc123')
    expect(formatted).toContain('Issued At: 2024-01-01T00:00:00.000Z')
  })

  test('includes expiration time when present', () => {
    const message: SIWFMessage = {
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
      nonce: 'abc123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      expirationTime: '2024-01-01T01:00:00.000Z',
    }

    const formatted = formatSIWFMessage(message)
    expect(formatted).toContain('Expiration Time: 2024-01-01T01:00:00.000Z')
  })

  test('omits expiration time when not present', () => {
    const message: SIWFMessage = {
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
      nonce: 'abc123',
      issuedAt: '2024-01-01T00:00:00.000Z',
    }

    const formatted = formatSIWFMessage(message)
    expect(formatted).not.toContain('Expiration Time:')
  })
})

describe('parseSIWFMessage', () => {
  test('parses a formatted message correctly', () => {
    const original: SIWFMessage = {
      domain: 'example.com',
      fid: 12345,
      custody: '0x1234567890123456789012345678901234567890' as Address,
      nonce: 'abc123',
      issuedAt: '2024-01-01T00:00:00.000Z',
    }

    const formatted = formatSIWFMessage(original)
    const parsed = parseSIWFMessage(formatted)

    expect(parsed.domain).toBe(original.domain)
    expect(parsed.fid).toBe(original.fid)
    expect(parsed.custody).toBe(original.custody)
    expect(parsed.nonce).toBe(original.nonce)
    expect(parsed.issuedAt).toBe(original.issuedAt)
  })

  test('parses message with expiration time', () => {
    const original: SIWFMessage = {
      domain: 'myapp.com',
      fid: 99999,
      custody: '0xabcdef1234567890abcdef1234567890abcdef12' as Address,
      nonce: 'xyz789',
      issuedAt: '2024-06-15T12:00:00.000Z',
      expirationTime: '2024-06-15T13:00:00.000Z',
    }

    const formatted = formatSIWFMessage(original)
    const parsed = parseSIWFMessage(formatted)

    expect(parsed.expirationTime).toBe(original.expirationTime)
  })

  test('round-trip: format then parse preserves data', () => {
    const testCases: SIWFMessage[] = [
      {
        domain: 'app.example.com',
        fid: 1,
        custody: '0x0000000000000000000000000000000000000001' as Address,
        nonce: 'simple',
        issuedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        domain: 'sub.domain.example.org',
        fid: 999999999,
        custody: '0xffffffffffffffffffffffffffffffffffffffff' as Address,
        nonce: 'nonce-with-dashes-123',
        issuedAt: '2024-12-31T23:59:59.999Z',
        expirationTime: '2025-01-01T00:00:00.000Z',
      },
    ]

    for (const original of testCases) {
      const formatted = formatSIWFMessage(original)
      const parsed = parseSIWFMessage(formatted)

      expect(parsed.domain).toBe(original.domain)
      expect(parsed.fid).toBe(original.fid)
      expect(parsed.custody).toBe(original.custody)
      expect(parsed.nonce).toBe(original.nonce)
      expect(parsed.issuedAt).toBe(original.issuedAt)
      if (original.expirationTime) {
        expect(parsed.expirationTime).toBe(original.expirationTime)
      }
    }
  })

  test('handles edge case FID values', () => {
    for (const fid of [0, 1, 999999999]) {
      const message = createSIWFMessage({
        domain: 'test.com',
        fid,
        custody: '0x1234567890123456789012345678901234567890' as Address,
      })

      const formatted = formatSIWFMessage(message)
      const parsed = parseSIWFMessage(formatted)

      expect(parsed.fid).toBe(fid)
    }
  })
})

describe('generateAuthKitUrl', () => {
  test('generates correct URL', () => {
    const url = generateAuthKitUrl({
      channelToken: 'token123',
      nonce: 'nonce456',
      domain: 'example.com',
    })

    expect(url).toContain('https://warpcast.com/~/sign-in-with-farcaster')
    expect(url).toContain('channelToken=token123')
    expect(url).toContain('nonce=nonce456')
    expect(url).toContain('domain=example.com')
  })

  test('URL encodes special characters', () => {
    const url = generateAuthKitUrl({
      channelToken: 'token=special&chars',
      nonce: 'nonce+plus',
      domain: 'my domain.com',
    })

    // Check URL-encoded values
    expect(url).toContain('channelToken=token%3Dspecial%26chars')
    expect(url).toContain('nonce=nonce%2Bplus')
    expect(url).toContain('domain=my+domain.com')
  })
})

describe('SIWF message format edge cases', () => {
  test('handles domain with port', () => {
    const message = createSIWFMessage({
      domain: 'localhost:3000',
      fid: 123,
      custody: '0x1234567890123456789012345678901234567890' as Address,
    })

    const formatted = formatSIWFMessage(message)
    const parsed = parseSIWFMessage(formatted)

    expect(parsed.domain).toBe('localhost:3000')
  })

  test('handles long nonce values', () => {
    const longNonce = 'a'.repeat(100)
    const message = createSIWFMessage({
      domain: 'test.com',
      fid: 123,
      custody: '0x1234567890123456789012345678901234567890' as Address,
      nonce: longNonce,
    })

    const formatted = formatSIWFMessage(message)
    const parsed = parseSIWFMessage(formatted)

    expect(parsed.nonce).toBe(longNonce)
  })
})
