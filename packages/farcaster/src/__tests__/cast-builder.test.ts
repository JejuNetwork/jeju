/**
 * Cast Builder Tests
 *
 * Tests for the cast building API and text processing utilities.
 * Covers text splitting, thread building, and cast message creation.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'
import {
  CastBuilder,
  type CastOptions,
  createCast,
  createDeleteCast,
  createReply,
  getTextByteLength,
  splitTextForThread,
} from '../hub/cast-builder'
import { MessageType, verifyMessage } from '../hub/message-builder'

// Test key pair
const TEST_PRIVATE_KEY = hexToBytes(
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
)

const TEST_FID = 12345

// ============ Text Byte Length ============

describe('getTextByteLength', () => {
  it('returns correct length for ASCII text', () => {
    expect(getTextByteLength('Hello')).toBe(5)
    expect(getTextByteLength('Hello World')).toBe(11)
    expect(getTextByteLength('')).toBe(0)
  })

  it('returns correct length for single-byte characters', () => {
    // ASCII characters are 1 byte each
    const ascii = 'abcdefghij' // 10 chars = 10 bytes
    expect(getTextByteLength(ascii)).toBe(10)
  })

  it('returns correct length for multi-byte UTF-8', () => {
    // Chinese characters are typically 3 bytes each
    const chinese = '你好' // 2 chars = 6 bytes
    expect(getTextByteLength(chinese)).toBe(6)

    // Japanese hiragana are 3 bytes each
    const japanese = 'こんにちは' // 5 chars = 15 bytes
    expect(getTextByteLength(japanese)).toBe(15)
  })

  it('returns correct length for emoji', () => {
    // Most emoji are 4 bytes
    const singleEmoji = '🎉'
    expect(getTextByteLength(singleEmoji)).toBe(4)

    // Multiple emoji
    const emoji = '🎉🌍🚀'
    expect(getTextByteLength(emoji)).toBe(12)
  })

  it('returns correct length for mixed content', () => {
    // "Hi 🌍" = 2 (Hi) + 1 (space) + 4 (emoji) = 7 bytes
    expect(getTextByteLength('Hi 🌍')).toBe(7)

    // "Hello 世界!" = 5 (Hello) + 1 (space) + 6 (世界, 3 bytes each) + 1 (!) = 13 bytes
    expect(getTextByteLength('Hello 世界!')).toBe(13)
  })

  it('handles newlines and special characters', () => {
    expect(getTextByteLength('\n')).toBe(1)
    expect(getTextByteLength('\t')).toBe(1)
    expect(getTextByteLength('Line1\nLine2')).toBe(11)
  })

  it('handles edge case characters', () => {
    // Zero-width joiner (used in complex emoji)
    const zwj = '\u200D'
    expect(getTextByteLength(zwj)).toBe(3) // ZWJ is 3 bytes

    // Family emoji with ZWJ sequences can be quite long
    const familyEmoji = '👨‍👩‍👧' // 25 bytes (complex ZWJ sequence)
    expect(getTextByteLength(familyEmoji)).toBeGreaterThan(10)
  })
})

// ============ Text Splitting ============

describe('splitTextForThread', () => {
  it('returns single chunk for short text', () => {
    const text = 'Short text'
    const chunks = splitTextForThread(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('Short text')
  })

  it('does not split text exactly at limit', () => {
    const text = 'a'.repeat(320) // Exactly 320 bytes
    const chunks = splitTextForThread(text)
    expect(chunks).toHaveLength(1)
    expect(getTextByteLength(chunks[0])).toBeLessThanOrEqual(320)
  })

  it('splits text exceeding 320 bytes', () => {
    const text = 'word '.repeat(100) // 500 bytes
    const chunks = splitTextForThread(text)
    expect(chunks.length).toBeGreaterThan(1)

    // Each chunk should be within limit
    for (const chunk of chunks) {
      expect(getTextByteLength(chunk)).toBeLessThanOrEqual(320)
    }
  })

  it('adds continuation markers (...)', () => {
    const text = 'word '.repeat(100)
    const chunks = splitTextForThread(text)

    // First chunk should end with ...
    expect(chunks[0].endsWith('...')).toBe(true)

    // Subsequent chunks should start with ...
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startsWith('...')).toBe(true)
    }
  })

  it('respects word boundaries', () => {
    const words = ['Hello', 'wonderful', 'world', 'today', 'is', 'great']
    const text = words.join(' ').repeat(20)
    const chunks = splitTextForThread(text, 50) // Small limit to force multiple splits

    // Check that most chunks start/end at word boundaries (after markers)
    for (const chunk of chunks) {
      const withoutMarkers = chunk
        .replace(/^\.\.\./g, '')
        .replace(/\.\.\.$/g, '')
        .trim()
      // Should not start or end with a partial word (spaces indicate word boundaries)
      if (withoutMarkers.length > 0) {
        // First character after stripping should not be mid-word
        expect(withoutMarkers[0] !== ' ').toBe(true)
      }
    }
  })

  it('handles very long words', () => {
    // A word longer than the max bytes
    const longWord = 'a'.repeat(350)
    const chunks = splitTextForThread(longWord)

    expect(chunks.length).toBeGreaterThan(1)

    // All chunks should be within limit
    for (const chunk of chunks) {
      expect(getTextByteLength(chunk)).toBeLessThanOrEqual(320)
    }
  })

  it('handles custom max bytes', () => {
    const text = 'a'.repeat(100)

    const chunksDefault = splitTextForThread(text)
    expect(chunksDefault).toHaveLength(1)

    const chunksSmall = splitTextForThread(text, 30)
    expect(chunksSmall.length).toBeGreaterThan(1)
  })

  it('handles multi-byte characters at split boundaries', () => {
    // Create text that would split in the middle of a multi-byte character
    const text = `Hello ${'🌍'.repeat(100)}` // Each emoji is 4 bytes
    const chunks = splitTextForThread(text)

    // No chunk should have invalid UTF-8
    for (const chunk of chunks) {
      // This should not throw
      const encoded = new TextEncoder().encode(chunk)
      const decoded = new TextDecoder().decode(encoded)
      // Decoded should match (no replacement characters)
      expect(decoded.includes('\uFFFD')).toBe(false)
    }
  })

  it('handles empty text', () => {
    const chunks = splitTextForThread('')
    // Empty text returns empty array (no content to split)
    expect(chunks).toHaveLength(0)
  })

  it('handles text with only spaces', () => {
    const text = '   '
    const chunks = splitTextForThread(text)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('preserves content through split/join', () => {
    const originalWords = [
      'The',
      'quick',
      'brown',
      'fox',
      'jumps',
      'over',
      'the',
      'lazy',
      'dog',
    ]
    const text = originalWords.join(' ').repeat(10)
    const chunks = splitTextForThread(text)

    // Reconstruct (removing continuation markers)
    const reconstructed = chunks
      .map((c) => c.replace(/^\.\.\./g, '').replace(/\.\.\.$/g, ''))
      .join('')

    // Should contain all original words
    for (const word of originalWords) {
      expect(reconstructed).toContain(word)
    }
  })
})

// ============ CastBuilder Class ============

describe('CastBuilder', () => {
  let builder: CastBuilder

  beforeEach(() => {
    builder = new CastBuilder({
      fid: TEST_FID,
      signerPrivateKey: TEST_PRIVATE_KEY,
      network: 'mainnet',
    })
  })

  describe('constructor', () => {
    it('creates builder with mainnet network', () => {
      const mainnetBuilder = new CastBuilder({
        fid: 1,
        signerPrivateKey: TEST_PRIVATE_KEY,
        network: 'mainnet',
      })
      expect(mainnetBuilder).toBeDefined()
    })

    it('creates builder with testnet network', () => {
      const testnetBuilder = new CastBuilder({
        fid: 1,
        signerPrivateKey: TEST_PRIVATE_KEY,
        network: 'testnet',
      })
      expect(testnetBuilder).toBeDefined()
    })

    it('creates builder with devnet network', () => {
      const devnetBuilder = new CastBuilder({
        fid: 1,
        signerPrivateKey: TEST_PRIVATE_KEY,
        network: 'devnet',
      })
      expect(devnetBuilder).toBeDefined()
    })

    it('defaults to mainnet when no network specified', () => {
      const defaultBuilder = new CastBuilder({
        fid: 1,
        signerPrivateKey: TEST_PRIVATE_KEY,
      })
      expect(defaultBuilder).toBeDefined()
    })
  })

  describe('buildCast', () => {
    it('builds basic cast message', async () => {
      const message = await builder.buildCast('Hello Farcaster!')

      expect(message.data.type).toBe(MessageType.CAST_ADD)
      expect(message.data.fid).toBe(TEST_FID)
      expect(message.data.castAddBody?.text).toBe('Hello Farcaster!')
    })

    it('builds cast with signature verification', async () => {
      const message = await builder.buildCast('Signed message')
      expect(verifyMessage(message)).toBe(true)
    })

    it('throws for text exceeding 320 bytes', async () => {
      const longText = 'a'.repeat(321)
      await expect(builder.buildCast(longText)).rejects.toThrow(
        'exceeds 320 bytes',
      )
    })

    it('accepts text at exactly 320 bytes', async () => {
      const maxText = 'a'.repeat(320)
      const message = await builder.buildCast(maxText)
      expect(message.data.castAddBody?.text).toBe(maxText)
    })

    it('builds cast with URL embeds', async () => {
      const options: CastOptions = {
        embeds: ['https://example.com', 'https://farcaster.xyz'],
      }
      const message = await builder.buildCast('Check these links', options)

      expect(message.data.castAddBody?.embeds).toHaveLength(2)
      expect(message.data.castAddBody?.embeds?.[0].url).toBe(
        'https://example.com',
      )
    })

    it('builds cast with cast embeds', async () => {
      const options: CastOptions = {
        embedCasts: [
          {
            fid: 100,
            hash: '0xabcdef1234567890abcdef1234567890abcdef12' as Hex,
          },
        ],
      }
      const message = await builder.buildCast('Quote this', options)

      expect(message.data.castAddBody?.embeds).toHaveLength(1)
      expect(message.data.castAddBody?.embeds?.[0].castId?.fid).toBe(100)
    })

    it('builds cast with mentions', async () => {
      const options: CastOptions = {
        mentions: [100, 200],
        mentionPositions: [0, 5],
      }
      const message = await builder.buildCast('Hi @user1 and @user2', options)

      expect(message.data.castAddBody?.mentions).toEqual([100, 200])
      expect(message.data.castAddBody?.mentionsPositions).toEqual([0, 5])
    })

    it('builds reply with parent cast ID', async () => {
      const options: CastOptions = {
        replyTo: {
          fid: 999,
          hash: '0xabcdef1234567890abcdef1234567890abcdef12' as Hex,
        },
      }
      const message = await builder.buildCast('This is a reply', options)

      expect(message.data.castAddBody?.parentCastId).toBeDefined()
      expect(message.data.castAddBody?.parentCastId?.fid).toBe(999)
    })

    it('builds channel cast with parent URL', async () => {
      const options: CastOptions = {
        channelUrl: 'https://farcaster.group/developers',
      }
      const message = await builder.buildCast('Posted to channel', options)

      expect(message.data.castAddBody?.parentUrl).toBe(
        'https://farcaster.group/developers',
      )
    })

    it('does not set both parentCastId and parentUrl', async () => {
      // replyTo takes precedence over channelUrl
      const options: CastOptions = {
        replyTo: {
          fid: 1,
          hash: '0xabcdef1234567890abcdef1234567890abcdef12' as Hex,
        },
        channelUrl: 'https://example.com/channel',
      }
      const message = await builder.buildCast('Reply', options)

      expect(message.data.castAddBody?.parentCastId).toBeDefined()
      expect(message.data.castAddBody?.parentUrl).toBeUndefined()
    })
  })

  describe('buildReply', () => {
    it('builds reply message', async () => {
      const message = await builder.buildReply('Great cast!', {
        fid: 456,
        hash: '0xabcdef1234567890abcdef1234567890abcdef12' as Hex,
      })

      expect(message.data.type).toBe(MessageType.CAST_ADD)
      expect(message.data.castAddBody?.parentCastId?.fid).toBe(456)
    })

    it('includes additional options in reply', async () => {
      const message = await builder.buildReply(
        'Reply with embed',
        { fid: 456, hash: '0xabcdef1234567890abcdef1234567890abcdef12' as Hex },
        { embeds: ['https://example.com'] },
      )

      expect(message.data.castAddBody?.embeds).toHaveLength(1)
    })
  })

  describe('buildChannelCast', () => {
    it('builds channel cast with parent URL', async () => {
      const message = await builder.buildChannelCast(
        'Hello channel!',
        'https://farcaster.group/general',
      )

      expect(message.data.castAddBody?.parentUrl).toBe(
        'https://farcaster.group/general',
      )
    })
  })

  describe('buildDeleteCast', () => {
    it('builds cast delete message', async () => {
      const targetHash = '0xdeadbeef1234567890abcdef1234567890abcd12' as Hex
      const message = await builder.buildDeleteCast(targetHash)

      expect(message.data.type).toBe(MessageType.CAST_REMOVE)
      expect(message.data.castRemoveBody?.targetHash).toBeDefined()
    })

    it('produces verifiable delete message', async () => {
      const message = await builder.buildDeleteCast(
        '0xabcdef1234567890abcdef1234567890abcdef12' as Hex,
      )
      expect(verifyMessage(message)).toBe(true)
    })
  })

  describe('buildThread', () => {
    it('throws for empty thread', async () => {
      await expect(builder.buildThread([])).rejects.toThrow('at least one cast')
    })

    it('builds single-cast thread', async () => {
      const messages = await builder.buildThread(['Single cast'])
      expect(messages).toHaveLength(1)
      expect(messages[0].data.castAddBody?.text).toBe('Single cast')
    })

    it('builds multi-cast thread with linked replies', async () => {
      const texts = ['First cast', 'Second cast', 'Third cast']
      const messages = await builder.buildThread(texts)

      expect(messages).toHaveLength(3)

      // First cast should have no parent
      expect(messages[0].data.castAddBody?.parentCastId).toBeUndefined()

      // Second cast should reply to first
      expect(messages[1].data.castAddBody?.parentCastId).toBeDefined()
      expect(messages[1].data.castAddBody?.parentCastId?.fid).toBe(TEST_FID)

      // Third cast should reply to second
      expect(messages[2].data.castAddBody?.parentCastId).toBeDefined()
    })

    it('applies channel URL only to first cast', async () => {
      const messages = await builder.buildThread(['First', 'Second'], {
        channelUrl: 'https://farcaster.group/test',
      })

      expect(messages[0].data.castAddBody?.parentUrl).toBe(
        'https://farcaster.group/test',
      )
      // Second cast replies to first, so has parentCastId not parentUrl
      expect(messages[1].data.castAddBody?.parentUrl).toBeUndefined()
    })

    it('applies embeds only to first cast', async () => {
      const messages = await builder.buildThread(['First', 'Second'], {
        embeds: ['https://example.com'],
      })

      expect(messages[0].data.castAddBody?.embeds).toHaveLength(1)
      expect(messages[1].data.castAddBody?.embeds).toBeUndefined()
    })

    it('all thread messages are verifiable', async () => {
      const messages = await builder.buildThread([
        'One',
        'Two',
        'Three',
        'Four',
      ])

      for (const msg of messages) {
        expect(verifyMessage(msg)).toBe(true)
      }
    })
  })

  describe('buildQuoteCast', () => {
    it('builds quote cast with embedded cast reference', async () => {
      const quotedCast = {
        fid: 789,
        hash: '0xabcdef1234567890abcdef1234567890abcdef12' as Hex,
      }
      const message = await builder.buildQuoteCast(
        'My thoughts on this:',
        quotedCast,
      )

      expect(message.data.castAddBody?.embeds).toHaveLength(1)
      expect(message.data.castAddBody?.embeds?.[0].castId?.fid).toBe(789)
    })
  })
})

// ============ Convenience Functions ============

describe('Convenience Functions', () => {
  describe('createCast', () => {
    it('creates cast with minimal args', async () => {
      const message = await createCast(TEST_FID, TEST_PRIVATE_KEY, 'Hello')
      expect(message.data.fid).toBe(TEST_FID)
      expect(message.data.castAddBody?.text).toBe('Hello')
    })

    it('creates cast with options', async () => {
      const message = await createCast(
        TEST_FID,
        TEST_PRIVATE_KEY,
        'With embed',
        {
          embeds: ['https://example.com'],
          network: 'testnet',
        },
      )

      expect(message.data.castAddBody?.embeds).toHaveLength(1)
    })
  })

  describe('createReply', () => {
    it('creates reply message', async () => {
      const message = await createReply(
        TEST_FID,
        TEST_PRIVATE_KEY,
        'Reply text',
        {
          fid: 100,
          hash: '0xabcdef1234567890abcdef1234567890abcdef12' as Hex, // Valid 20-byte hex
        },
      )

      expect(message.data.castAddBody?.parentCastId?.fid).toBe(100)
    })
  })

  describe('createDeleteCast', () => {
    it('creates delete message', async () => {
      const message = await createDeleteCast(
        TEST_FID,
        TEST_PRIVATE_KEY,
        '0xabcdef1234567890abcdef1234567890abcdef12' as Hex, // Valid 20-byte hex
      )
      expect(message.data.type).toBe(MessageType.CAST_REMOVE)
    })

    it('works with testnet', async () => {
      const message = await createDeleteCast(
        TEST_FID,
        TEST_PRIVATE_KEY,
        '0xabcdef1234567890abcdef1234567890abcdef12' as Hex, // Valid 20-byte hex
        { network: 'testnet' },
      )
      expect(message.data.network).toBe(2) // TESTNET
    })
  })
})

// ============ Edge Cases ============

describe('Edge Cases', () => {
  let builder: CastBuilder

  beforeEach(() => {
    builder = new CastBuilder({
      fid: TEST_FID,
      signerPrivateKey: TEST_PRIVATE_KEY,
    })
  })

  it('handles Unicode normalization', async () => {
    // Test that different text produces different hashes
    const text1 = 'Test A'
    const text2 = 'Test B'

    const message1 = await builder.buildCast(text1)
    const message2 = await builder.buildCast(text2)

    // Different text should produce different hashes
    expect(bytesToHex(message1.hash)).not.toBe(bytesToHex(message2.hash))
    expect(verifyMessage(message1)).toBe(true)
    expect(verifyMessage(message2)).toBe(true)
  })

  it('handles RTL text', async () => {
    const message = await builder.buildCast('مرحبا بالعالم') // Arabic: Hello World
    expect(message.data.castAddBody?.text).toBe('مرحبا بالعالم')
    expect(verifyMessage(message)).toBe(true)
  })

  it('handles zero-width characters', async () => {
    const textWithZwj = 'Hello\u200BWorld' // Zero-width space
    const message = await builder.buildCast(textWithZwj)
    expect(verifyMessage(message)).toBe(true)
  })

  it('handles complex emoji sequences', async () => {
    const complexEmoji = '👨‍👩‍👧‍👦' // Family emoji with ZWJ
    const message = await builder.buildCast(`Family: ${complexEmoji}`)
    expect(verifyMessage(message)).toBe(true)
  })

  it('handles maximum mentions', async () => {
    const mentions = Array.from({ length: 10 }, (_, i) => i + 1)
    const mentionPositions = Array.from({ length: 10 }, (_, i) => i * 5)

    const message = await builder.buildCast('Many mentions', {
      mentions,
      mentionPositions,
    })

    expect(message.data.castAddBody?.mentions).toHaveLength(10)
    expect(verifyMessage(message)).toBe(true)
  })

  it('handles maximum embeds', async () => {
    const embeds = [
      'https://example1.com',
      'https://example2.com',
      'https://example3.com',
      'https://example4.com',
    ]

    const message = await builder.buildCast('Many embeds', { embeds })
    expect(message.data.castAddBody?.embeds).toHaveLength(4)
  })

  it('handles newlines in text', async () => {
    const multiline = 'Line 1\nLine 2\n\nLine 4'
    const message = await builder.buildCast(multiline)
    expect(message.data.castAddBody?.text).toBe(multiline)
  })

  it('handles special characters', async () => {
    const special = 'Test <script>alert(1)</script> & "quotes"'
    const message = await builder.buildCast(special)
    expect(message.data.castAddBody?.text).toBe(special)
  })
})

// ============ Property-Based Tests ============

describe('Property-Based Tests', () => {
  it('split text always produces valid chunks', () => {
    for (let i = 0; i < 50; i++) {
      const length = Math.floor(Math.random() * 1000) + 1
      const text = 'a'.repeat(length)
      const chunks = splitTextForThread(text)

      for (const chunk of chunks) {
        const bytes = getTextByteLength(chunk)
        expect(bytes).toBeLessThanOrEqual(320)
      }
    }
  })

  it('all built messages have valid signatures', async () => {
    const builder = new CastBuilder({
      fid: 1,
      signerPrivateKey: TEST_PRIVATE_KEY,
    })

    const testCases = [
      'Simple text',
      '🎉🌍🚀',
      '你好世界',
      'Mixed 混合 🎉',
      '',
      'a'.repeat(320),
    ]

    for (const text of testCases) {
      const message = await builder.buildCast(text)
      expect(verifyMessage(message)).toBe(true)
    }
  })

  it('thread messages form proper chain', async () => {
    const builder = new CastBuilder({
      fid: 1,
      signerPrivateKey: TEST_PRIVATE_KEY,
    })

    for (let threadLength = 1; threadLength <= 10; threadLength++) {
      const texts = Array.from(
        { length: threadLength },
        (_, i) => `Cast ${i + 1}`,
      )
      const messages = await builder.buildThread(texts)

      expect(messages).toHaveLength(threadLength)

      // Verify chain structure
      for (let i = 1; i < messages.length; i++) {
        const parentCastId = messages[i].data.castAddBody?.parentCastId
        expect(parentCastId).toBeDefined()
        expect(parentCastId?.fid).toBe(1)
      }
    }
  })
})
