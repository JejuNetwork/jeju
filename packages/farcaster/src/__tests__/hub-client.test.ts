import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Hex } from 'viem'
import { FarcasterClient } from '../hub/client'

// Mock fetch globally
const originalFetch = globalThis.fetch

describe('FarcasterClient', () => {
  let client: FarcasterClient
  let mockFetch: ReturnType<typeof mock>

  beforeEach(() => {
    client = new FarcasterClient({
      hubUrl: 'test-hub.example.com:2283',
      httpUrl: 'http://test-hub.example.com:2281',
      timeoutMs: 5000,
    })

    mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    )
    globalThis.fetch = mockFetch as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('constructor', () => {
    it('requires hubUrl in config', () => {
      const customClient = new FarcasterClient({
        hubUrl: 'custom-hub:2283',
      })
      expect(customClient).toBeDefined()
    })

    it('accepts custom configuration', () => {
      const customClient = new FarcasterClient({
        hubUrl: 'custom-hub:2283',
        httpUrl: 'http://custom-hub:2281',
        timeoutMs: 15000,
      })
      expect(customClient).toBeDefined()
    })
  })

  describe('getHubInfo', () => {
    it('returns hub info from API', async () => {
      const expectedInfo = {
        version: '1.0.0',
        isSyncing: false,
        nickname: 'test-hub',
        rootHash: '0xabcd',
        dbStats: { numMessages: 1000, numFidEvents: 100, numFnameEvents: 50 },
        peerId: 'peer-123',
        hubOperatorFid: 1,
      }

      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(expectedInfo),
        }),
      )

      const info = await client.getHubInfo()

      expect(info).toEqual(expectedInfo)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('throws on HTTP error', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        }),
      )

      await expect(client.getHubInfo()).rejects.toThrow(
        'Hub error: 500 Internal Server Error',
      )
    })
  })

  describe('isSyncing', () => {
    it('returns true when hub is syncing', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              version: '1.0.0',
              isSyncing: true,
              nickname: 'test-hub',
              rootHash: '0xabcd',
              dbStats: {
                numMessages: 1000,
                numFidEvents: 100,
                numFnameEvents: 50,
              },
              peerId: 'peer-123',
              hubOperatorFid: 1,
            }),
        }),
      )

      const syncing = await client.isSyncing()
      expect(syncing).toBe(true)
    })

    it('returns false when hub is not syncing', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              version: '1.0.0',
              isSyncing: false,
              nickname: 'test-hub',
              rootHash: '0xabcd',
              dbStats: {
                numMessages: 1000,
                numFidEvents: 100,
                numFnameEvents: 50,
              },
              peerId: 'peer-123',
              hubOperatorFid: 1,
            }),
        }),
      )

      const syncing = await client.isSyncing()
      expect(syncing).toBe(false)
    })
  })

  describe('getProfile', () => {
    it('builds profile from user data and verifications', async () => {
      // Mock getUserDataByFid response
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000000,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_USERNAME',
                      value: 'testuser',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000001,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_DISPLAY',
                      value: 'Test User',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000002,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_BIO',
                      value: 'Test bio',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000003,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_PFP',
                      value: 'https://pfp.example.com',
                    },
                  },
                },
              ],
            }),
        }),
      )

      // Mock getVerificationsByFid response
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000004,
                    verificationAddAddressBody: {
                      address: '0x1234567890123456789012345678901234567890',
                      protocol: 'PROTOCOL_ETHEREUM',
                      chainId: 1,
                    },
                  },
                },
              ],
            }),
        }),
      )

      // Mock getLinksByTargetFid (followers)
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 456,
                    timestamp: 1700000005,
                    linkBody: { type: 'follow', targetFid: 123 },
                  },
                },
              ],
            }),
        }),
      )

      // Mock getLinksByFid (following)
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000006,
                    linkBody: { type: 'follow', targetFid: 789 },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000007,
                    linkBody: { type: 'follow', targetFid: 790 },
                  },
                },
              ],
            }),
        }),
      )

      const profile = await client.getProfile(123)

      expect(profile.fid).toBe(123)
      expect(profile.username).toBe('testuser')
      expect(profile.displayName).toBe('Test User')
      expect(profile.bio).toBe('Test bio')
      expect(profile.pfpUrl).toBe('https://pfp.example.com')
      expect(profile.verifiedAddresses).toHaveLength(1)
      expect(profile.followerCount).toBe(1)
      expect(profile.followingCount).toBe(2)
    })
  })

  describe('getUserDataByFid', () => {
    it('parses user data types correctly', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000000,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_PFP',
                      value: 'pfp-url',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000001,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_DISPLAY',
                      value: 'Display Name',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000002,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_BIO',
                      value: 'Bio text',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000003,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_URL',
                      value: 'https://example.com',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000004,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_USERNAME',
                      value: 'username',
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000005,
                    userDataBody: {
                      type: 'USER_DATA_TYPE_LOCATION',
                      value: 'NYC',
                    },
                  },
                },
              ],
            }),
        }),
      )

      const userData = await client.getUserDataByFid(123)

      expect(userData).toHaveLength(6)
      expect(userData.find((d) => d.type === 'pfp')?.value).toBe('pfp-url')
      expect(userData.find((d) => d.type === 'display')?.value).toBe(
        'Display Name',
      )
      expect(userData.find((d) => d.type === 'bio')?.value).toBe('Bio text')
      expect(userData.find((d) => d.type === 'url')?.value).toBe(
        'https://example.com',
      )
      expect(userData.find((d) => d.type === 'username')?.value).toBe(
        'username',
      )
      expect(userData.find((d) => d.type === 'location')?.value).toBe('NYC')
    })
  })

  describe('getCastsByFid', () => {
    it('returns paginated casts', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  hash: '0xabc123',
                  data: {
                    fid: 123,
                    timestamp: 1700000000,
                    castAddBody: {
                      text: 'Hello world',
                      embeds: [],
                      mentions: [],
                      mentionsPositions: [],
                    },
                  },
                },
              ],
              nextPageToken: 'token123',
            }),
        }),
      )

      const result = await client.getCastsByFid(123)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].text).toBe('Hello world')
      expect(result.messages[0].fid).toBe(123)
      expect(result.nextPageToken).toBe('token123')
    })

    it('includes parent cast info for replies', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  hash: '0xreply123',
                  data: {
                    fid: 123,
                    timestamp: 1700000000,
                    castAddBody: {
                      text: 'This is a reply',
                      parentCastId: { fid: 456, hash: '0xparent456' },
                      embeds: [],
                      mentions: [],
                      mentionsPositions: [],
                    },
                  },
                },
              ],
            }),
        }),
      )

      const result = await client.getCastsByFid(123)

      expect(result.messages[0].parentFid).toBe(456)
      expect(result.messages[0].parentHash).toBe('0xparent456')
    })
  })

  describe('getCast', () => {
    it('returns cast by FID and hash', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              hash: '0xabc123',
              data: {
                fid: 123,
                timestamp: 1700000000,
                castAddBody: {
                  text: 'Test cast',
                  embeds: [{ url: 'https://example.com' }],
                  mentions: [456],
                  mentionsPositions: [5],
                },
              },
            }),
        }),
      )

      const cast = await client.getCast(123, '0xabc123' as Hex)

      expect(cast).not.toBeNull()
      expect(cast?.text).toBe('Test cast')
      expect(cast?.embeds).toHaveLength(1)
      expect(cast?.mentions).toEqual([456])
    })

    it('returns null when cast not found', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      )

      const cast = await client.getCast(123, '0xnonexistent' as Hex)
      expect(cast).toBeNull()
    })
  })

  describe('getReactionsByFid', () => {
    it('returns likes and recasts', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000000,
                    reactionBody: {
                      type: 'REACTION_TYPE_LIKE',
                      targetCastId: { fid: 456, hash: '0xtarget1' },
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000001,
                    reactionBody: {
                      type: 'REACTION_TYPE_RECAST',
                      targetCastId: { fid: 789, hash: '0xtarget2' },
                    },
                  },
                },
              ],
            }),
        }),
      )

      const reactions = await client.getReactionsByFid(123)

      expect(reactions.messages).toHaveLength(2)
      expect(reactions.messages[0].type).toBe('like')
      expect(reactions.messages[1].type).toBe('recast')
    })
  })

  describe('getLinksByFid', () => {
    it('returns following list', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000000,
                    linkBody: { type: 'follow', targetFid: 456 },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000001,
                    linkBody: { type: 'follow', targetFid: 789 },
                  },
                },
              ],
            }),
        }),
      )

      const links = await client.getLinksByFid(123)

      expect(links.messages).toHaveLength(2)
      expect(links.messages[0].targetFid).toBe(456)
      expect(links.messages[1].targetFid).toBe(789)
    })
  })

  describe('getVerificationsByFid', () => {
    it('returns Ethereum and Solana verifications', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000000,
                    verificationAddAddressBody: {
                      address: '0x1234567890123456789012345678901234567890',
                      protocol: 'PROTOCOL_ETHEREUM',
                      chainId: 1,
                    },
                  },
                },
                {
                  data: {
                    fid: 123,
                    timestamp: 1700000001,
                    verificationAddAddressBody: {
                      address: 'SolanaAddressHere123',
                      protocol: 'PROTOCOL_SOLANA',
                      chainId: 0,
                    },
                  },
                },
              ],
            }),
        }),
      )

      const verifications = await client.getVerificationsByFid(123)

      expect(verifications).toHaveLength(2)
      expect(verifications[0].protocol).toBe('ethereum')
      expect(verifications[1].protocol).toBe('solana')
    })
  })
})
