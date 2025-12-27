import { beforeEach, describe, expect, it } from 'bun:test'
import { FarcasterClient } from '../hub/client'

/**
 * FarcasterClient Live Integration Tests
 *
 * These tests validate the FarcasterClient against a real Farcaster hub.
 * Set FARCASTER_HUB_URL environment variable to run these tests.
 */

const HAS_HUB = Boolean(
  process.env.FARCASTER_HUB_URL || process.env.LIVE_INFRA_AVAILABLE,
)

describe.skipIf(!HAS_HUB)('FarcasterClient (LIVE INTEGRATION)', () => {
  let client: FarcasterClient

  beforeEach(() => {
    const hubUrl = process.env.FARCASTER_HUB_URL || 'nemes.farcaster.xyz:2283'
    const httpUrl =
      process.env.FARCASTER_HTTP_URL || 'https://nemes.farcaster.xyz:2281'
    client = new FarcasterClient({
      hubUrl,
      httpUrl,
      timeoutMs: 10000,
    })
  })

  describe('getHubInfo', () => {
    it('returns hub info from live hub', async () => {
      const info = await client.getHubInfo()

      expect(info.version).toBeDefined()
      expect(typeof info.isSyncing).toBe('boolean')
      expect(info.peerId).toBeDefined()
      console.log(
        `Live hub version: ${info.version}, syncing: ${info.isSyncing}`,
      )
    })
  })

  describe('getProfile', () => {
    it('fetches profile for known FID', async () => {
      // FID 1 is typically a well-known Farcaster account
      const profile = await client.getProfile(1)

      expect(profile.fid).toBe(1)
      expect(profile.username).toBeDefined()
      console.log(`Fetched profile for FID 1: @${profile.username}`)
    })
  })

  describe('getVerificationsByFid', () => {
    it('fetches verifications for known FID', async () => {
      const verifications = await client.getVerificationsByFid(1)

      expect(Array.isArray(verifications)).toBe(true)
      console.log(`FID 1 has ${verifications.length} verified addresses`)
    })
  })
})

describe('FarcasterClient (Unit Tests)', () => {
  describe('constructor', () => {
    it('requires hubUrl in config', () => {
      const client = new FarcasterClient({
        hubUrl: 'custom-hub:2283',
      })
      expect(client).toBeDefined()
    })

    it('accepts custom configuration', () => {
      const client = new FarcasterClient({
        hubUrl: 'custom-hub:2283',
        httpUrl: 'http://custom-hub:2281',
        timeoutMs: 15000,
      })
      expect(client).toBeDefined()
    })
  })
})
