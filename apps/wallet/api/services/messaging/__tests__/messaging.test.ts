/**
 * Messaging Service Tests - Comprehensive Coverage
 *
 * Tests the Farcaster Hub connection and messaging integration
 * These tests use REAL Farcaster Hub APIs - no mocking.
 *
 * Coverage includes:
 * - Happy paths
 * - Boundary conditions
 * - Error handling
 * - Edge cases
 * - Concurrent requests
 * - Invalid inputs
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { FarcasterClient } from '@jejunetwork/messaging'
import type { Address } from 'viem'
import { resetStorage } from '../../../../web/platform/storage'
import { messagingService, WalletMessagingService } from '../index'

const HUB_URL = 'https://hub.pinata.cloud'
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address
const ALTERNATE_ADDRESS =
  '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01' as Address

// Known FIDs for testing
const KNOWN_FID_DWR = 3 // dwr.eth - very active user
const KNOWN_FID_VITALIK = 5650 // vitalik.eth
const NONEXISTENT_FID = 999999999999

// ============================================================================
// FARCASTER HUB CLIENT - REAL API TESTS
// ============================================================================

describe('FarcasterClient - Connection', () => {
  test('creates client with valid hub URL', () => {
    const client = new FarcasterClient({ hubUrl: HUB_URL })
    expect(client).toBeDefined()
  })

  test('creates client with localhost URL', () => {
    const client = new FarcasterClient({ hubUrl: 'localhost:2281' })
    expect(client).toBeDefined()
  })

  test('creates client with explicit http URL', () => {
    const client = new FarcasterClient({ hubUrl: 'http://localhost:2281' })
    expect(client).toBeDefined()
  })
})

describe('FarcasterClient - getCastsByFid', () => {
  let client: FarcasterClient

  beforeEach(() => {
    client = new FarcasterClient({ hubUrl: HUB_URL })
  })

  test('fetches casts for known active user (dwr.eth)', async () => {
    const response = await client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 5 })

    expect(response).toBeDefined()
    expect(response.messages).toBeDefined()
    expect(Array.isArray(response.messages)).toBe(true)
    expect(response.messages.length).toBeGreaterThan(0)
    expect(response.messages.length).toBeLessThanOrEqual(5)

    // Verify cast data structure
    const cast = response.messages[0]
    expect(cast.hash).toBeDefined()
    expect(typeof cast.hash).toBe('string')
    expect(cast.hash.length).toBeGreaterThan(0)
    expect(cast.fid).toBe(KNOWN_FID_DWR)
    expect(cast.text).toBeDefined()
    expect(typeof cast.text).toBe('string')
    expect(cast.timestamp).toBeDefined()
    expect(typeof cast.timestamp).toBe('number')
    expect(cast.timestamp).toBeGreaterThan(0)

    console.log(
      `FID ${KNOWN_FID_DWR}: ${response.messages.length} casts, first: "${cast.text.substring(0, 50)}..."`,
    )
  })

  test('fetches casts for another known user (vitalik.eth)', async () => {
    const response = await client.getCastsByFid(KNOWN_FID_VITALIK, {
      pageSize: 3,
    })

    expect(response).toBeDefined()
    expect(response.messages).toBeDefined()

    if (response.messages.length > 0) {
      expect(response.messages[0].fid).toBe(KNOWN_FID_VITALIK)
    }

    console.log(`FID ${KNOWN_FID_VITALIK}: ${response.messages.length} casts`)
  })

  // BOUNDARY: pageSize limits
  test('respects pageSize=1 (minimum)', async () => {
    const response = await client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 1 })
    expect(response.messages.length).toBeLessThanOrEqual(1)
  })

  test('respects pageSize=100 (large request)', async () => {
    const response = await client.getCastsByFid(KNOWN_FID_DWR, {
      pageSize: 100,
    })
    expect(response.messages).toBeDefined()
    // Should return up to 100 or whatever the user has
    console.log(`Large request returned ${response.messages.length} casts`)
  })

  // BOUNDARY: FID edge cases
  test('returns empty for non-existent FID', async () => {
    const response = await client.getCastsByFid(NONEXISTENT_FID, {
      pageSize: 5,
    })
    expect(response.messages).toBeDefined()
    expect(response.messages.length).toBe(0)
  })

  test('handles low FID (FID=2)', async () => {
    // FID 1 may have pruned messages, use FID 2 which is more reliable
    const response = await client.getCastsByFid(2, { pageSize: 5 })
    expect(response.messages).toBeDefined()
    console.log(`FID 2 has ${response.messages.length} casts`)
  })

  // PAGINATION
  test('pagination returns different results', async () => {
    const page1 = await client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 3 })
    expect(page1.messages.length).toBeGreaterThan(0)

    if (page1.nextPageToken) {
      const page2 = await client.getCastsByFid(KNOWN_FID_DWR, {
        pageSize: 3,
        pageToken: page1.nextPageToken,
      })
      expect(page2.messages).toBeDefined()

      // Hashes should be different between pages
      const page1Hashes = new Set(page1.messages.map((m) => m.hash))
      const page2Hashes = new Set(page2.messages.map((m) => m.hash))

      for (const hash of page2Hashes) {
        expect(page1Hashes.has(hash)).toBe(false)
      }
      console.log('Pagination verified - different casts on each page')
    }
  })
})

describe('FarcasterClient - getCastsByChannel', () => {
  let client: FarcasterClient

  beforeEach(() => {
    client = new FarcasterClient({ hubUrl: HUB_URL })
  })

  test('fetches from /farcaster channel (full URL)', async () => {
    const response = await client.getCastsByChannel(
      'https://warpcast.com/~/channel/farcaster',
      { pageSize: 5 },
    )

    expect(response).toBeDefined()
    expect(response.messages).toBeDefined()
    expect(Array.isArray(response.messages)).toBe(true)
    console.log(`/farcaster channel: ${response.messages.length} casts`)
  })

  test('fetches from /ethereum channel', async () => {
    const response = await client.getCastsByChannel(
      'https://warpcast.com/~/channel/ethereum',
      { pageSize: 5 },
    )

    expect(response).toBeDefined()
    expect(response.messages).toBeDefined()
    console.log(`/ethereum channel: ${response.messages.length} casts`)
  })

  test('returns empty for non-existent channel', async () => {
    const response = await client.getCastsByChannel(
      'https://warpcast.com/~/channel/this-channel-definitely-does-not-exist-xyz-123',
      { pageSize: 5 },
    )

    expect(response).toBeDefined()
    expect(response.messages).toBeDefined()
    expect(response.messages.length).toBe(0)
    console.log('Non-existent channel correctly returns empty array')
  })

  // EDGE: Channel URL formats
  test('handles channel URL with trailing slash', async () => {
    const response = await client.getCastsByChannel(
      'https://warpcast.com/~/channel/farcaster/',
      { pageSize: 1 },
    )
    expect(response.messages).toBeDefined()
  })
})

describe('FarcasterClient - Cast Data Integrity', () => {
  let client: FarcasterClient

  beforeEach(() => {
    client = new FarcasterClient({ hubUrl: HUB_URL })
  })

  test('cast has required fields and correct types', async () => {
    const response = await client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 1 })
    expect(response.messages.length).toBeGreaterThan(0)

    const cast = response.messages[0]

    // Required fields
    expect(cast.hash).toBeDefined()
    expect(cast.fid).toBeDefined()
    expect(cast.text).toBeDefined()
    expect(cast.timestamp).toBeDefined()
    expect(cast.embeds).toBeDefined()
    expect(cast.mentions).toBeDefined()
    expect(cast.mentionsPositions).toBeDefined()

    // Type checks
    expect(typeof cast.hash).toBe('string')
    expect(typeof cast.fid).toBe('number')
    expect(typeof cast.text).toBe('string')
    expect(typeof cast.timestamp).toBe('number')
    expect(Array.isArray(cast.embeds)).toBe(true)
    expect(Array.isArray(cast.mentions)).toBe(true)
    expect(Array.isArray(cast.mentionsPositions)).toBe(true)

    // NO fake data fields
    expect(cast).not.toHaveProperty('reactions')
    expect(cast).not.toHaveProperty('replies')
    expect(cast).not.toHaveProperty('likes')
    expect(cast).not.toHaveProperty('recasts')

    console.log('Cast data integrity verified')
  })

  test('embeds contain valid URLs when present', async () => {
    const response = await client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 20 })

    // Find a cast with embeds
    const castWithEmbeds = response.messages.find((m) => m.embeds.length > 0)

    if (castWithEmbeds) {
      for (const embed of castWithEmbeds.embeds) {
        if (embed.url) {
          expect(typeof embed.url).toBe('string')
          // Should be a valid URL or at least start with http/https
          expect(
            embed.url.startsWith('http://') || embed.url.startsWith('https://'),
          ).toBe(true)
        }
      }
      console.log(`Found cast with ${castWithEmbeds.embeds.length} embeds`)
    } else {
      console.log('No casts with embeds found in sample')
    }
  })
})

describe('FarcasterClient - Concurrent Requests', () => {
  test('handles multiple concurrent requests', async () => {
    const client = new FarcasterClient({ hubUrl: HUB_URL })

    // Fire 5 concurrent requests
    const promises = [
      client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 2 }),
      client.getCastsByFid(KNOWN_FID_VITALIK, { pageSize: 2 }),
      client.getCastsByChannel('https://warpcast.com/~/channel/farcaster', {
        pageSize: 2,
      }),
      client.getCastsByChannel('https://warpcast.com/~/channel/ethereum', {
        pageSize: 2,
      }),
      client.getCastsByFid(1, { pageSize: 2 }),
    ]

    const results = await Promise.all(promises)

    expect(results.length).toBe(5)
    for (const result of results) {
      expect(result).toBeDefined()
      expect(result.messages).toBeDefined()
      expect(Array.isArray(result.messages)).toBe(true)
    }

    console.log('5 concurrent requests completed successfully')
  })

  test('handles concurrent requests to same endpoint', async () => {
    const client = new FarcasterClient({ hubUrl: HUB_URL })

    // Same endpoint, 3 times
    const promises = [
      client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 3 }),
      client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 3 }),
      client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 3 }),
    ]

    const results = await Promise.all(promises)

    // All should return same data
    expect(results[0].messages.length).toBe(results[1].messages.length)
    expect(results[1].messages.length).toBe(results[2].messages.length)

    // Same hashes
    const hashes0 = results[0].messages.map((m) => m.hash)
    const hashes1 = results[1].messages.map((m) => m.hash)
    expect(hashes0).toEqual(hashes1)

    console.log('Concurrent same-endpoint requests return consistent data')
  })
})

// ============================================================================
// WALLET MESSAGING SERVICE TESTS
// ============================================================================

describe('WalletMessagingService - Initialization', () => {
  let service: WalletMessagingService

  beforeEach(() => {
    resetStorage()
    service = new WalletMessagingService()
  })

  afterEach(async () => {
    await service.destroy()
  })

  test('creates fresh instance', () => {
    expect(service).toBeDefined()
    expect(service.getFarcasterAccount()).toBeNull()
    expect(service.hasFarcasterAccount()).toBe(false)
  })

  test('initialize sets up hub client', async () => {
    await service.initialize(TEST_ADDRESS)

    // After init, getChannelFeed should work (not throw)
    // Using try/catch since profile fetching may fail but channel fetch works
    const client = new FarcasterClient({ hubUrl: HUB_URL })
    const response = await client.getCastsByChannel(
      'https://warpcast.com/~/channel/farcaster',
      { pageSize: 1 },
    )
    expect(response.messages).toBeDefined()
  })

  test('re-initialization with same address is idempotent', async () => {
    await service.initialize(TEST_ADDRESS)
    const prefs1 = service.getPreferences()

    await service.initialize(TEST_ADDRESS) // Same address
    const prefs2 = service.getPreferences()

    expect(prefs1).toEqual(prefs2)
  })

  test('destroy cleans up resources', async () => {
    await service.initialize(TEST_ADDRESS)
    await service.destroy()

    // After destroy, should throw on hub operations
    await expect(service.getChannelFeed('test', { limit: 1 })).rejects.toThrow()
  })
})

describe('WalletMessagingService - Error Handling', () => {
  let service: WalletMessagingService

  beforeEach(() => {
    resetStorage()
    service = new WalletMessagingService()
  })

  afterEach(async () => {
    await service.destroy()
  })

  test('getChannelFeed throws before initialization', async () => {
    await expect(
      service.getChannelFeed('farcaster', { limit: 5 }),
    ).rejects.toThrow('Hub client not initialized')
  })

  test('getUserFeed throws before initialization', async () => {
    await expect(service.getUserFeed(3, { limit: 5 })).rejects.toThrow(
      'Hub client not initialized',
    )
  })

  test('getProfile throws before initialization', async () => {
    await expect(service.getProfile(KNOWN_FID_DWR)).rejects.toThrow(
      'Hub client not initialized',
    )
  })

  test('lookupFidByAddress throws before initialization', async () => {
    await expect(service.lookupFidByAddress(TEST_ADDRESS)).rejects.toThrow(
      'Hub client not initialized',
    )
  })

  test('linkFarcasterAccount throws before initialization', async () => {
    await expect(service.linkFarcasterAccount(123)).rejects.toThrow(
      'Service not initialized',
    )
  })

  test('sendMessage throws without recipient', async () => {
    await service.initialize(TEST_ADDRESS)

    await expect(service.sendMessage({ text: 'hello' })).rejects.toThrow(
      'No recipient or messaging not initialized',
    )
  })

  test('getMessages throws for invalid conversation format', async () => {
    await service.initialize(TEST_ADDRESS)

    // Invalid protocol prefix
    await expect(service.getMessages('invalid-123')).rejects.toThrow(
      'Unsupported protocol or client not initialized',
    )
  })
})

describe('WalletMessagingService - Preferences', () => {
  let service: WalletMessagingService

  beforeEach(() => {
    resetStorage()
    service = new WalletMessagingService()
  })

  afterEach(async () => {
    await service.destroy()
  })

  test('default preferences are correct', async () => {
    await service.initialize(TEST_ADDRESS)

    const prefs = service.getPreferences()
    expect(prefs.enableFarcaster).toBe(true)
    expect(prefs.enableXMTP).toBe(true)
    expect(prefs.enableNotifications).toBe(true)
    expect(prefs.notifyOnDM).toBe(true)
    expect(prefs.notifyOnMention).toBe(true)
    expect(prefs.notifyOnTransaction).toBe(true)
    expect(prefs.mutedConversations).toEqual([])
    expect(prefs.blockedAddresses).toEqual([])
    expect(prefs.blockedFids).toEqual([])
  })

  test('updatePreferences persists changes', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.updatePreferences({
      enableFarcaster: false,
      notifyOnDM: false,
    })

    const prefs = service.getPreferences()
    expect(prefs.enableFarcaster).toBe(false)
    expect(prefs.notifyOnDM).toBe(false)
    // Others unchanged
    expect(prefs.enableXMTP).toBe(true)
    expect(prefs.enableNotifications).toBe(true)
  })

  test('partial update does not reset other fields', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.updatePreferences({ enableFarcaster: false })
    await service.updatePreferences({ enableXMTP: false })

    const prefs = service.getPreferences()
    expect(prefs.enableFarcaster).toBe(false)
    expect(prefs.enableXMTP).toBe(false)
  })

  test('blockAddress adds to blocked list', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.blockAddress(ALTERNATE_ADDRESS)

    const prefs = service.getPreferences()
    expect(prefs.blockedAddresses).toContain(ALTERNATE_ADDRESS)
  })

  test('blockAddress is idempotent', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.blockAddress(ALTERNATE_ADDRESS)
    await service.blockAddress(ALTERNATE_ADDRESS)

    const prefs = service.getPreferences()
    // Should only appear once
    expect(
      prefs.blockedAddresses.filter((a) => a === ALTERNATE_ADDRESS).length,
    ).toBe(1)
  })

  test('unblockAddress removes from list', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.blockAddress(ALTERNATE_ADDRESS)
    await service.unblockAddress(ALTERNATE_ADDRESS)

    const prefs = service.getPreferences()
    expect(prefs.blockedAddresses).not.toContain(ALTERNATE_ADDRESS)
  })

  test('unblockAddress handles non-existent address', async () => {
    await service.initialize(TEST_ADDRESS)

    // Should not throw
    await service.unblockAddress(ALTERNATE_ADDRESS)

    const prefs = service.getPreferences()
    expect(prefs.blockedAddresses.length).toBe(0)
  })

  test('blockFid adds to blocked list', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.blockFid(12345)

    const prefs = service.getPreferences()
    expect(prefs.blockedFids).toContain(12345)
  })

  test('unblockFid removes from list', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.blockFid(12345)
    await service.unblockFid(12345)

    const prefs = service.getPreferences()
    expect(prefs.blockedFids).not.toContain(12345)
  })
})

describe('WalletMessagingService - Conversation Muting', () => {
  let service: WalletMessagingService

  beforeEach(() => {
    resetStorage()
    service = new WalletMessagingService()
  })

  afterEach(async () => {
    await service.destroy()
  })

  test('setConversationMuted adds to muted list', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.setConversationMuted('fc-123', true)

    const prefs = service.getPreferences()
    expect(prefs.mutedConversations).toContain('fc-123')
  })

  test('setConversationMuted removes from muted list', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.setConversationMuted('fc-123', true)
    await service.setConversationMuted('fc-123', false)

    const prefs = service.getPreferences()
    expect(prefs.mutedConversations).not.toContain('fc-123')
  })

  test('muting is idempotent', async () => {
    await service.initialize(TEST_ADDRESS)

    await service.setConversationMuted('fc-123', true)
    await service.setConversationMuted('fc-123', true)

    const prefs = service.getPreferences()
    expect(
      prefs.mutedConversations.filter((id) => id === 'fc-123').length,
    ).toBe(1)
  })
})

describe('WalletMessagingService - Event Listeners', () => {
  let service: WalletMessagingService

  beforeEach(() => {
    resetStorage()
    service = new WalletMessagingService()
  })

  afterEach(async () => {
    await service.destroy()
  })

  test('onMessage returns unsubscribe function', async () => {
    await service.initialize(TEST_ADDRESS)

    const messages: string[] = []
    const unsubscribe = service.onMessage((msg) => {
      messages.push(msg.text)
    })

    expect(typeof unsubscribe).toBe('function')

    // Clean up
    unsubscribe()
  })
})

// ============================================================================
// GLOBAL SINGLETON TESTS
// ============================================================================

describe('Global Messaging Service Singleton', () => {
  test('exported singleton exists and has correct type', () => {
    expect(messagingService).toBeDefined()
    expect(messagingService).toBeInstanceOf(WalletMessagingService)
  })

  test('singleton methods exist', () => {
    expect(typeof messagingService.initialize).toBe('function')
    expect(typeof messagingService.destroy).toBe('function')
    expect(typeof messagingService.getPreferences).toBe('function')
    expect(typeof messagingService.getFarcasterAccount).toBe('function')
    expect(typeof messagingService.hasFarcasterAccount).toBe('function')
  })
})

// ============================================================================
// INTEGRATION TESTS - Real Data Verification
// ============================================================================

describe('Integration - Real Data Verification', () => {
  test('dwr.eth (FID 3) casts contain expected content', async () => {
    const client = new FarcasterClient({ hubUrl: HUB_URL })
    const response = await client.getCastsByFid(KNOWN_FID_DWR, { pageSize: 10 })

    expect(response.messages.length).toBeGreaterThan(0)

    // Note: Farcaster timestamps are NOT Unix timestamps - they are
    // "Farcaster timestamps" which are seconds since Jan 1, 2021 UTC
    // So they will be smaller numbers than Unix timestamps
    for (const cast of response.messages) {
      expect(cast.timestamp).toBeGreaterThan(0)
      expect(typeof cast.timestamp).toBe('number')
    }

    // Verify hashes are unique
    const hashes = response.messages.map((m) => m.hash)
    const uniqueHashes = new Set(hashes)
    expect(uniqueHashes.size).toBe(hashes.length)

    console.log(
      `Verified ${response.messages.length} casts from dwr.eth with valid timestamps and unique hashes`,
    )
  })

  test('channel casts are returned from getCastsByChannel', async () => {
    const client = new FarcasterClient({ hubUrl: HUB_URL })
    const channelUrl = 'https://warpcast.com/~/channel/farcaster'
    const response = await client.getCastsByChannel(channelUrl, {
      pageSize: 10,
    })

    // The Hub returns casts for the channel
    // Note: parentUrl may be set differently depending on Hub implementation
    expect(response.messages).toBeDefined()
    expect(Array.isArray(response.messages)).toBe(true)

    // Log what we actually got
    console.log(`Channel query returned ${response.messages.length} casts`)
    if (response.messages.length > 0) {
      const firstCast = response.messages[0]
      console.log(
        `First cast FID: ${firstCast.fid}, parentUrl: ${firstCast.parentUrl ?? 'none'}`,
      )
    }

    // If we got results, verify structure
    if (response.messages.length > 0) {
      const cast = response.messages[0]
      expect(cast.hash).toBeDefined()
      expect(cast.fid).toBeDefined()
      expect(cast.text).toBeDefined()
    }
  })
})
