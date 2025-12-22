/**
 * Unit tests for contributor utility functions
 * Tests platform hash parsing and related helper functions
 */

import { describe, expect, test } from 'bun:test'
import { keccak256, toBytes } from 'viem'
import type { SocialPlatform } from '../../types/funding'
import { SOCIAL_PLATFORMS } from '../../types/funding'

// Re-implement the parsePlatformFromHash function for testing
// (The original is not exported from the hooks file)
const PLATFORM_HASHES: Record<SocialPlatform, `0x${string}`> = {
  github: keccak256(toBytes('github')),
  discord: keccak256(toBytes('discord')),
  twitter: keccak256(toBytes('twitter')),
  farcaster: keccak256(toBytes('farcaster')),
}

function parsePlatformFromHash(hash: string): SocialPlatform {
  for (const [platform, platformHash] of Object.entries(PLATFORM_HASHES)) {
    if (platformHash === hash) {
      return platform as SocialPlatform
    }
  }
  return 'github'
}

describe('Platform Hash Generation', () => {
  test('generates deterministic hash for github', () => {
    const hash1 = keccak256(toBytes('github'))
    const hash2 = keccak256(toBytes('github'))
    expect(hash1).toBe(hash2)
  })

  test('generates unique hashes for each platform', () => {
    const hashes = SOCIAL_PLATFORMS.map((platform) =>
      keccak256(toBytes(platform)),
    )
    const uniqueHashes = new Set(hashes)
    expect(uniqueHashes.size).toBe(SOCIAL_PLATFORMS.length)
  })

  test('all platform hashes are 66 characters (0x + 64 hex)', () => {
    Object.values(PLATFORM_HASHES).forEach((hash) => {
      expect(hash.length).toBe(66)
      expect(hash.startsWith('0x')).toBe(true)
    })
  })

  test('platform hashes are lowercase hex', () => {
    Object.values(PLATFORM_HASHES).forEach((hash) => {
      expect(hash).toBe(hash.toLowerCase())
    })
  })
})

describe('Platform Hash Parsing', () => {
  test('correctly parses github hash', () => {
    const hash = keccak256(toBytes('github'))
    expect(parsePlatformFromHash(hash)).toBe('github')
  })

  test('correctly parses discord hash', () => {
    const hash = keccak256(toBytes('discord'))
    expect(parsePlatformFromHash(hash)).toBe('discord')
  })

  test('correctly parses twitter hash', () => {
    const hash = keccak256(toBytes('twitter'))
    expect(parsePlatformFromHash(hash)).toBe('twitter')
  })

  test('correctly parses farcaster hash', () => {
    const hash = keccak256(toBytes('farcaster'))
    expect(parsePlatformFromHash(hash)).toBe('farcaster')
  })

  test('returns github for unknown hash', () => {
    const unknownHash = keccak256(toBytes('unknown_platform')) as `0x${string}`
    expect(parsePlatformFromHash(unknownHash)).toBe('github')
  })

  test('returns github for invalid hash format', () => {
    expect(parsePlatformFromHash('invalid')).toBe('github')
    expect(parsePlatformFromHash('')).toBe('github')
    expect(parsePlatformFromHash('0x')).toBe('github')
  })

  test('round-trip hash-to-platform-to-hash', () => {
    SOCIAL_PLATFORMS.forEach((platform) => {
      const hash = keccak256(toBytes(platform))
      const parsed = parsePlatformFromHash(hash)
      const rehashed = keccak256(toBytes(parsed))
      expect(rehashed).toBe(hash)
    })
  })
})

describe('Social Platforms List', () => {
  test('contains all expected platforms', () => {
    expect(SOCIAL_PLATFORMS).toContain('github')
    expect(SOCIAL_PLATFORMS).toContain('discord')
    expect(SOCIAL_PLATFORMS).toContain('twitter')
    expect(SOCIAL_PLATFORMS).toContain('farcaster')
  })

  test('has exactly 4 platforms', () => {
    expect(SOCIAL_PLATFORMS).toHaveLength(4)
  })

  test('all platforms are lowercase', () => {
    SOCIAL_PLATFORMS.forEach((platform) => {
      expect(platform).toBe(platform.toLowerCase())
    })
  })

  test('PLATFORM_HASHES covers all platforms', () => {
    SOCIAL_PLATFORMS.forEach((platform) => {
      expect(PLATFORM_HASHES[platform as SocialPlatform]).toBeDefined()
    })
  })
})

describe('Hash Collisions', () => {
  test('github and discord have different hashes', () => {
    expect(PLATFORM_HASHES.github).not.toBe(PLATFORM_HASHES.discord)
  })

  test('twitter and farcaster have different hashes', () => {
    expect(PLATFORM_HASHES.twitter).not.toBe(PLATFORM_HASHES.farcaster)
  })

  test('no platform hash matches zero bytes32', () => {
    const zeroHash = `0x${'0'.repeat(64)}`
    Object.values(PLATFORM_HASHES).forEach((hash) => {
      expect(hash).not.toBe(zeroHash)
    })
  })
})
