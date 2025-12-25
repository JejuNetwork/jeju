/**
 * Message Builder Tests
 *
 * Tests for Farcaster message encoding, hashing, and signing.
 * Covers protobuf-style encoding, BLAKE3 hashing, and Ed25519 signatures.
 */

import { describe, expect, it } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519'
import { blake3 } from '@noble/hashes/blake3'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import {
  buildMessage,
  createCastId,
  encodeMessageData,
  FarcasterNetwork,
  fromFarcasterTimestamp,
  getFarcasterTimestamp,
  getMessageHashHex,
  HashScheme,
  hashMessageData,
  hexToMessageBytes,
  type Message,
  type MessageData,
  MessageType,
  messageBytesToHex,
  messageToHex,
  ReactionType,
  SignatureScheme,
  serializeMessage,
  signMessageHash,
  toFarcasterTimestamp,
  UserDataType,
  verifyMessage,
} from '../hub/message-builder'

const FARCASTER_EPOCH = 1609459200 // Jan 1, 2021 00:00:00 UTC

// Test key pair (deterministic for reproducible tests)
const TEST_PRIVATE_KEY = hexToBytes(
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
)
const TEST_PUBLIC_KEY = ed25519.getPublicKey(TEST_PRIVATE_KEY)
describe('Timestamp Functions', () => {
  describe('getFarcasterTimestamp', () => {
    it('returns a positive integer', () => {
      const ts = getFarcasterTimestamp()
      expect(ts).toBeGreaterThan(0)
      expect(Number.isInteger(ts)).toBe(true)
    })

    it('is less than current Unix timestamp', () => {
      const fcTs = getFarcasterTimestamp()
      const unixTs = Math.floor(Date.now() / 1000)
      expect(fcTs).toBeLessThan(unixTs)
    })

    it('equals Unix time minus Farcaster epoch', () => {
      const before = Math.floor(Date.now() / 1000)
      const fcTs = getFarcasterTimestamp()
      const after = Math.floor(Date.now() / 1000)

      // Should be within 1 second tolerance
      expect(fcTs).toBeGreaterThanOrEqual(before - FARCASTER_EPOCH)
      expect(fcTs).toBeLessThanOrEqual(after - FARCASTER_EPOCH + 1)
    })
  })

  describe('toFarcasterTimestamp', () => {
    it('converts Farcaster epoch start to 0', () => {
      expect(toFarcasterTimestamp(FARCASTER_EPOCH)).toBe(0)
    })

    it('converts 1 second after epoch to 1', () => {
      expect(toFarcasterTimestamp(FARCASTER_EPOCH + 1)).toBe(1)
    })

    it('handles typical Unix timestamps', () => {
      // Test with a known date: Jan 1, 2024 00:00:00 UTC = 1704067200
      const unixTs = 1704067200
      const expected = unixTs - FARCASTER_EPOCH // 94608000 (about 3 years)
      expect(toFarcasterTimestamp(unixTs)).toBe(expected)
    })
  })

  describe('fromFarcasterTimestamp', () => {
    it('converts 0 back to Farcaster epoch', () => {
      expect(fromFarcasterTimestamp(0)).toBe(FARCASTER_EPOCH)
    })

    it('is inverse of toFarcasterTimestamp', () => {
      const testTimestamps = [
        FARCASTER_EPOCH,
        1700000000,
        1704067200,
        1750000000,
      ]
      for (const unix of testTimestamps) {
        const fc = toFarcasterTimestamp(unix)
        const backToUnix = fromFarcasterTimestamp(fc)
        expect(backToUnix).toBe(unix)
      }
    })
  })

  describe('timestamp roundtrip', () => {
    it('preserves timestamp through conversion cycle', () => {
      const now = Math.floor(Date.now() / 1000)
      const fcTs = toFarcasterTimestamp(now)
      const restored = fromFarcasterTimestamp(fcTs)
      expect(restored).toBe(now)
    })
  })
})
describe('Message Encoding', () => {
  describe('encodeMessageData', () => {
    it('encodes basic CAST_ADD message', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: {
          text: 'Hello',
        },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
      expect(encoded.length).toBeGreaterThan(0)
    })

    it('encodes CAST_ADD with all fields', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 12345,
        timestamp: 50000,
        network: FarcasterNetwork.MAINNET,
        castAddBody: {
          text: 'Test cast with mentions and embeds',
          mentions: [100, 200, 300],
          mentionsPositions: [0, 10, 20],
          embeds: [{ url: 'https://example.com' }],
          parentUrl: 'https://farcaster.group/test',
        },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
      expect(encoded.length).toBeGreaterThan(50) // Should be reasonably sized
    })

    it('encodes CAST_ADD with parent cast ID', () => {
      const parentHash = new Uint8Array(20).fill(0xab)
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: {
          text: 'Reply',
          parentCastId: {
            fid: 999,
            hash: parentHash,
          },
        },
      }

      const encoded = encodeMessageData(data)
      // Should contain parent cast ID bytes
      expect(encoded.length).toBeGreaterThan(30)
    })

    it('encodes CAST_REMOVE message', () => {
      const targetHash = new Uint8Array(20).fill(0xcd)
      const data: MessageData = {
        type: MessageType.CAST_REMOVE,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castRemoveBody: {
          targetHash,
        },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('encodes REACTION_ADD message', () => {
      const data: MessageData = {
        type: MessageType.REACTION_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        reactionBody: {
          type: ReactionType.LIKE,
          targetCastId: {
            fid: 123,
            hash: new Uint8Array(20).fill(0xff),
          },
        },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('encodes REACTION_ADD with target URL', () => {
      const data: MessageData = {
        type: MessageType.REACTION_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        reactionBody: {
          type: ReactionType.RECAST,
          targetUrl: 'https://example.com/cast/123',
        },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('encodes LINK_ADD message', () => {
      const data: MessageData = {
        type: MessageType.LINK_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        linkBody: {
          type: 'follow',
          targetFid: 456,
        },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('encodes USER_DATA_ADD message', () => {
      const data: MessageData = {
        type: MessageType.USER_DATA_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        userDataBody: {
          type: UserDataType.DISPLAY,
          value: 'Test User',
        },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('produces deterministic output for same input', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 999,
        timestamp: 12345,
        network: FarcasterNetwork.MAINNET,
        castAddBody: {
          text: 'Deterministic test',
        },
      }

      const encoded1 = encodeMessageData(data)
      const encoded2 = encodeMessageData(data)

      expect(bytesToHex(encoded1)).toBe(bytesToHex(encoded2))
    })

    it('encodes different FIDs differently', () => {
      const data1: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Same text' },
      }

      const data2: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 2,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Same text' },
      }

      const encoded1 = encodeMessageData(data1)
      const encoded2 = encodeMessageData(data2)

      expect(bytesToHex(encoded1)).not.toBe(bytesToHex(encoded2))
    })

    it('encodes networks correctly', () => {
      const networks = [
        FarcasterNetwork.MAINNET,
        FarcasterNetwork.TESTNET,
        FarcasterNetwork.DEVNET,
      ]

      const encodings: string[] = []
      for (const network of networks) {
        const data: MessageData = {
          type: MessageType.CAST_ADD,
          fid: 1,
          timestamp: 100,
          network,
          castAddBody: { text: 'Test' },
        }
        encodings.push(bytesToHex(encodeMessageData(data)))
      }

      // All encodings should be different
      expect(new Set(encodings).size).toBe(3)
    })
  })

  describe('varint encoding via encodeMessageData', () => {
    it('encodes small FIDs (single byte)', () => {
      // FID 1 should encode efficiently
      const data1: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 1,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: '' },
      }

      const data127: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 127,
        timestamp: 1,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: '' },
      }

      const encoded1 = encodeMessageData(data1)
      const encoded127 = encodeMessageData(data127)

      // FID 127 should still fit in single byte varint encoding
      // Both should be very close in size
      expect(Math.abs(encoded1.length - encoded127.length)).toBeLessThanOrEqual(
        1,
      )
    })

    it('encodes large FIDs (multi-byte varint)', () => {
      // FID > 127 requires more bytes
      const dataSmall: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 100,
        timestamp: 1,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: '' },
      }

      const dataLarge: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1000000,
        timestamp: 1,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: '' },
      }

      const encodedSmall = encodeMessageData(dataSmall)
      const encodedLarge = encodeMessageData(dataLarge)

      // Large FID should result in larger encoding
      expect(encodedLarge.length).toBeGreaterThan(encodedSmall.length)
    })
  })

  describe('UTF-8 text encoding', () => {
    it('encodes ASCII text', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Hello World' },
      }

      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('encodes emoji correctly', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: '🎉 Hello 世界 🌍' },
      }

      const encoded = encodeMessageData(data)
      // Multi-byte UTF-8 characters should result in larger encoding
      expect(encoded.length).toBeGreaterThan(20)
    })

    it('encodes empty text', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: '' },
      }

      // Should not throw
      const encoded = encodeMessageData(data)
      expect(encoded).toBeInstanceOf(Uint8Array)
    })

    it('encodes text at 320 byte limit', () => {
      // Create exactly 320 ASCII characters
      const text = 'a'.repeat(320)
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text },
      }

      const encoded = encodeMessageData(data)
      expect(encoded.length).toBeGreaterThan(320)
    })
  })
})
describe('Message Hashing', () => {
  describe('hashMessageData', () => {
    it('produces 20-byte hash (per Farcaster spec)', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test' },
      }

      const hash = hashMessageData(data)
      expect(hash.length).toBe(20)
    })

    it('produces deterministic hash', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 12345,
        timestamp: 67890,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Deterministic test message' },
      }

      const hash1 = hashMessageData(data)
      const hash2 = hashMessageData(data)

      expect(bytesToHex(hash1)).toBe(bytesToHex(hash2))
    })

    it('produces different hashes for different data', () => {
      const data1: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Message 1' },
      }

      const data2: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Message 2' },
      }

      const hash1 = hashMessageData(data1)
      const hash2 = hashMessageData(data2)

      expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2))
    })

    it('uses BLAKE3 (verifiable)', () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 1,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: '' },
      }

      const encoded = encodeMessageData(data)
      const expectedFullHash = blake3(encoded)
      const expectedTruncated = expectedFullHash.slice(0, 20)

      const actualHash = hashMessageData(data)
      expect(bytesToHex(actualHash)).toBe(bytesToHex(expectedTruncated))
    })
  })
})
describe('Message Signing', () => {
  describe('signMessageHash', () => {
    it('produces Ed25519 signature (64 bytes)', async () => {
      const hash = new Uint8Array(20).fill(0xab)
      const signature = await signMessageHash(hash, TEST_PRIVATE_KEY)
      expect(signature.length).toBe(64)
    })

    it('produces verifiable signature', async () => {
      const hash = new Uint8Array(20).fill(0x42)
      const signature = await signMessageHash(hash, TEST_PRIVATE_KEY)

      const isValid = ed25519.verify(signature, hash, TEST_PUBLIC_KEY)
      expect(isValid).toBe(true)
    })

    it('produces deterministic signature', async () => {
      const hash = new Uint8Array(20).fill(0xcd)
      const sig1 = await signMessageHash(hash, TEST_PRIVATE_KEY)
      const sig2 = await signMessageHash(hash, TEST_PRIVATE_KEY)

      expect(bytesToHex(sig1)).toBe(bytesToHex(sig2))
    })

    it('produces different signatures for different hashes', async () => {
      const hash1 = new Uint8Array(20).fill(0x11)
      const hash2 = new Uint8Array(20).fill(0x22)

      const sig1 = await signMessageHash(hash1, TEST_PRIVATE_KEY)
      const sig2 = await signMessageHash(hash2, TEST_PRIVATE_KEY)

      expect(bytesToHex(sig1)).not.toBe(bytesToHex(sig2))
    })
  })

  describe('buildMessage', () => {
    it('creates complete signed message', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 12345,
        timestamp: getFarcasterTimestamp(),
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test message' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)

      expect(message.data).toEqual(data)
      expect(message.hash.length).toBe(20)
      expect(message.hashScheme).toBe(HashScheme.BLAKE3)
      expect(message.signature.length).toBe(64)
      expect(message.signatureScheme).toBe(SignatureScheme.ED25519)
      expect(message.signer.length).toBe(32)
    })

    it('includes correct public key as signer', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      expect(bytesToHex(message.signer)).toBe(bytesToHex(TEST_PUBLIC_KEY))
    })

    it('produces verifiable message', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 999,
        timestamp: 50000,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Verify me' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      const isValid = verifyMessage(message)
      expect(isValid).toBe(true)
    })
  })

  describe('verifyMessage', () => {
    it('returns true for valid message', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Valid message' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      expect(verifyMessage(message)).toBe(true)
    })

    it('returns false for tampered signature', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)

      // Tamper with signature
      const tamperedSig = new Uint8Array(message.signature)
      tamperedSig[0] ^= 0xff

      const tamperedMessage: Message = { ...message, signature: tamperedSig }
      expect(verifyMessage(tamperedMessage)).toBe(false)
    })

    it('returns false for wrong signer', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)

      // Use wrong public key
      const wrongPrivKey = hexToBytes(
        '1111111111111111111111111111111111111111111111111111111111111111',
      )
      const wrongPubKey = ed25519.getPublicKey(wrongPrivKey)

      const wrongSignerMessage: Message = { ...message, signer: wrongPubKey }
      expect(verifyMessage(wrongSignerMessage)).toBe(false)
    })

    it('returns false for tampered hash', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)

      // Tamper with hash
      const tamperedHash = new Uint8Array(message.hash)
      tamperedHash[0] ^= 0xff

      const tamperedMessage: Message = { ...message, hash: tamperedHash }
      expect(verifyMessage(tamperedMessage)).toBe(false)
    })
  })
})
describe('Message Serialization', () => {
  describe('serializeMessage', () => {
    it('serializes message to bytes', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      const serialized = serializeMessage(message)

      expect(serialized).toBeInstanceOf(Uint8Array)
      expect(serialized.length).toBeGreaterThan(0)
    })

    it('produces deterministic output', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Deterministic' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)

      const serialized1 = serializeMessage(message)
      const serialized2 = serializeMessage(message)

      expect(bytesToHex(serialized1)).toBe(bytesToHex(serialized2))
    })

    it('includes all message components', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 12345,
        timestamp: 50000,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Test with all components' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      const serialized = serializeMessage(message)

      // Serialized form should contain:
      // - Encoded data
      // - 20-byte hash
      // - 1-byte hash scheme
      // - 64-byte signature
      // - 1-byte signature scheme
      // - 32-byte signer
      // Plus length prefixes and field tags
      expect(serialized.length).toBeGreaterThan(20 + 1 + 64 + 1 + 32)
    })
  })

  describe('messageToHex', () => {
    it('returns 0x-prefixed hex string', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Hex test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      const hex = messageToHex(message)

      expect(hex.startsWith('0x')).toBe(true)
      expect(/^0x[a-f0-9]+$/i.test(hex)).toBe(true)
    })

    it('is consistent with serializeMessage', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Consistency test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      const serialized = serializeMessage(message)
      const hex = messageToHex(message)

      expect(hex).toBe(`0x${bytesToHex(serialized)}`)
    })
  })

  describe('getMessageHashHex', () => {
    it('returns 0x-prefixed 40-char hex (20 bytes)', async () => {
      const data: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Hash test' },
      }

      const message = await buildMessage(data, TEST_PRIVATE_KEY)
      const hashHex = getMessageHashHex(message)

      expect(hashHex.startsWith('0x')).toBe(true)
      expect(hashHex.length).toBe(42) // 0x + 40 hex chars = 20 bytes
    })
  })
})
describe('Utility Functions', () => {
  describe('hexToMessageBytes', () => {
    it('converts 0x-prefixed hex to bytes', () => {
      const hex = '0xdeadbeef'
      const bytes = hexToMessageBytes(hex)
      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })

    it('handles non-prefixed hex', () => {
      const hex = 'deadbeef'
      const bytes = hexToMessageBytes(hex)
      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })

    it('handles empty string', () => {
      const bytes = hexToMessageBytes('0x')
      expect(bytes).toEqual(new Uint8Array([]))
    })
  })

  describe('messageBytesToHex', () => {
    it('converts bytes to 0x-prefixed hex', () => {
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      const hex = messageBytesToHex(bytes)
      expect(hex).toBe('0xdeadbeef')
    })

    it('handles empty array', () => {
      const hex = messageBytesToHex(new Uint8Array([]))
      expect(hex).toBe('0x')
    })

    it('is inverse of hexToMessageBytes', () => {
      const original = '0xabcdef1234567890'
      const bytes = hexToMessageBytes(original)
      const restored = messageBytesToHex(bytes)
      expect(restored).toBe(original)
    })
  })

  describe('createCastId', () => {
    it('creates CastId from fid and hex hash', () => {
      const castId = createCastId(123, '0xdeadbeef')
      expect(castId.fid).toBe(123)
      expect(castId.hash).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })

    it('creates CastId from fid and Uint8Array hash', () => {
      const hashBytes = new Uint8Array([1, 2, 3, 4, 5])
      const castId = createCastId(456, hashBytes)
      expect(castId.fid).toBe(456)
      expect(castId.hash).toBe(hashBytes)
    })
  })
})
describe('Property-Based Tests', () => {
  describe('message building', () => {
    it('always produces valid signatures for random FIDs', async () => {
      for (let i = 0; i < 20; i++) {
        const fid = Math.floor(Math.random() * 1000000) + 1
        const data: MessageData = {
          type: MessageType.CAST_ADD,
          fid,
          timestamp: Math.floor(Math.random() * 100000),
          network: FarcasterNetwork.MAINNET,
          castAddBody: { text: `Random test ${i}` },
        }

        const message = await buildMessage(data, TEST_PRIVATE_KEY)
        expect(verifyMessage(message)).toBe(true)
      }
    })

    it('produces unique hashes for different timestamps', async () => {
      const hashes = new Set<string>()
      for (let t = 0; t < 100; t++) {
        const data: MessageData = {
          type: MessageType.CAST_ADD,
          fid: 1,
          timestamp: t,
          network: FarcasterNetwork.MAINNET,
          castAddBody: { text: 'Same text' },
        }

        const hash = hashMessageData(data)
        hashes.add(bytesToHex(hash))
      }

      expect(hashes.size).toBe(100)
    })

    it('message types affect encoding', async () => {
      const types = [
        MessageType.CAST_ADD,
        MessageType.REACTION_ADD,
        MessageType.LINK_ADD,
        MessageType.USER_DATA_ADD,
      ]

      const hashes = new Set<string>()
      for (const type of types) {
        const data: MessageData = {
          type,
          fid: 1,
          timestamp: 100,
          network: FarcasterNetwork.MAINNET,
          castAddBody:
            type === MessageType.CAST_ADD ? { text: 'Test' } : undefined,
          reactionBody:
            type === MessageType.REACTION_ADD
              ? {
                  type: ReactionType.LIKE,
                  targetCastId: { fid: 1, hash: new Uint8Array(20) },
                }
              : undefined,
          linkBody:
            type === MessageType.LINK_ADD
              ? { type: 'follow', targetFid: 1 }
              : undefined,
          userDataBody:
            type === MessageType.USER_DATA_ADD
              ? { type: UserDataType.BIO, value: 'Test' }
              : undefined,
        }

        const encoded = encodeMessageData(data)
        hashes.add(bytesToHex(encoded))
      }

      expect(hashes.size).toBe(4)
    })
  })

  describe('hash collision resistance', () => {
    it('small text changes produce different hashes', () => {
      const baseData: MessageData = {
        type: MessageType.CAST_ADD,
        fid: 1,
        timestamp: 100,
        network: FarcasterNetwork.MAINNET,
        castAddBody: { text: 'Hello World' },
      }

      const modifiedData: MessageData = {
        ...baseData,
        castAddBody: { text: 'Hello Wor1d' }, // Changed l to 1
      }

      const hash1 = hashMessageData(baseData)
      const hash2 = hashMessageData(modifiedData)

      expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2))
    })
  })
})
