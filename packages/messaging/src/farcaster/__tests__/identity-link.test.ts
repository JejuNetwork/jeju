import { describe, expect, it } from 'bun:test'
import type { Address } from 'viem'
import {
  generateLinkProofMessage,
  parseLinkProofMessage,
} from '../identity/link'

/**
 * Identity Link Tests
 *
 * Pure unit tests for Farcaster identity linking utilities.
 * Tests generateLinkProofMessage and parseLinkProofMessage functions.
 */

describe('Identity Link (Pure Unit Tests)', () => {
  describe('generateLinkProofMessage', () => {
    it('generates correctly formatted message', () => {
      const message = generateLinkProofMessage({
        fid: 123,
        jejuAddress: '0xJeju0000000000000000000000000000000000001' as Address,
        timestamp: 1700000000,
        domain: 'jejunetwork.org',
      })

      expect(message).toContain(
        'jejunetwork.org wants to link your Farcaster account',
      )
      expect(message).toContain('Farcaster ID: 123')
      expect(message).toContain(
        'Jeju Address: 0xJeju0000000000000000000000000000000000001',
      )
      expect(message).toContain('Timestamp: 1700000000')
      expect(message).toContain(
        'Signing this message proves you control both accounts',
      )
    })

    it('handles different domains', () => {
      const message1 = generateLinkProofMessage({
        fid: 1,
        jejuAddress: '0x1' as Address,
        timestamp: 0,
        domain: 'app.jejunetwork.org',
      })

      const message2 = generateLinkProofMessage({
        fid: 1,
        jejuAddress: '0x1' as Address,
        timestamp: 0,
        domain: 'localhost:3000',
      })

      expect(message1).toContain('app.jejunetwork.org')
      expect(message2).toContain('localhost:3000')
    })
  })

  describe('parseLinkProofMessage', () => {
    it('parses valid message correctly', () => {
      const originalMessage = generateLinkProofMessage({
        fid: 123,
        jejuAddress: '0xJeju0000000000000000000000000000000000001' as Address,
        timestamp: 1700000000,
        domain: 'jejunetwork.org',
      })

      const parsed = parseLinkProofMessage(originalMessage)

      expect(parsed).not.toBeNull()
      expect(parsed?.fid).toBe(123)
      expect(parsed?.jejuAddress).toBe(
        '0xJeju0000000000000000000000000000000000001',
      )
      expect(parsed?.timestamp).toBe(1700000000)
      expect(parsed?.domain).toBe('jejunetwork.org')
    })

    it('returns null for invalid message format', () => {
      const invalidMessages = [
        'Invalid message without proper format',
        'Farcaster ID: abc', // Missing other fields
        '', // Empty string
      ]

      for (const msg of invalidMessages) {
        expect(parseLinkProofMessage(msg)).toBeNull()
      }
    })

    it('handles messages with extra whitespace', () => {
      const message = generateLinkProofMessage({
        fid: 456,
        jejuAddress: '0xTest0000000000000000000000000000000000001' as Address,
        timestamp: 1700000001,
        domain: 'test.domain',
      })

      const messageWithWhitespace = `  \n${message}\n  `
      parseLinkProofMessage(messageWithWhitespace)
    })
  })

  describe('roundtrip: generate -> parse', () => {
    it('parsed message matches original parameters', () => {
      const params = {
        fid: 999,
        jejuAddress: '0xRoundTrip000000000000000000000000000001' as Address,
        timestamp: 1700000999,
        domain: 'roundtrip.test',
      }

      const message = generateLinkProofMessage(params)
      const parsed = parseLinkProofMessage(message)

      expect(parsed).toEqual(params)
    })

    it('works with various FID values', () => {
      const fidValues = [1, 100, 10000, 999999]

      for (const fid of fidValues) {
        const params = {
          fid,
          jejuAddress: '0x1234567890123456789012345678901234567890' as Address,
          timestamp: 1700000000,
          domain: 'test',
        }

        const message = generateLinkProofMessage(params)
        const parsed = parseLinkProofMessage(message)

        expect(parsed?.fid).toBe(fid)
      }
    })
  })
})
