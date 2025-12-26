import { describe, expect, it } from 'bun:test'
import {
  ContentStatus,
  ContentStatusSchema,
  ContentViolationType,
  ContentViolationTypeSchema,
  ContentTier,
  ContentTierSchema,
  ContentRecordSchema,
  SeederStatsSchema,
  TorrentFileSchema,
  TorrentInfoSchema,
  TorrentStatsSchema,
  SeedingInfoSchema,
  TorrentUploadOptionsSchema,
  TorrentUploadResultSchema,
  SwarmInfoSchema,
  PeerInfoSchema,
  DeliveryMethodSchema,
  DeliveryRouteSchema,
  ContentIdentifierSchema,
  ContentScanResultSchema,
  ModerationReportSchema,
  EncryptedContentSchema,
  DecryptionRequestSchema,
  CONTENT_REGISTRY_ABI,
} from '../torrent'

describe('Torrent Types', () => {
  describe('ContentStatus', () => {
    it('has correct numeric values', () => {
      expect(ContentStatus.UNKNOWN).toBe(0)
      expect(ContentStatus.APPROVED).toBe(1)
      expect(ContentStatus.FLAGGED).toBe(2)
      expect(ContentStatus.BANNED).toBe(3)
    })
  })

  describe('ContentViolationType', () => {
    it('has correct numeric values', () => {
      expect(ContentViolationType.NONE).toBe(0)
      expect(ContentViolationType.CSAM).toBe(1)
      expect(ContentViolationType.ILLEGAL_MATERIAL).toBe(2)
      expect(ContentViolationType.COPYRIGHT).toBe(3)
      expect(ContentViolationType.SPAM).toBe(4)
    })
  })

  describe('ContentTier', () => {
    it('has correct numeric values', () => {
      expect(ContentTier.NETWORK_FREE).toBe(0)
      expect(ContentTier.COMMUNITY).toBe(1)
      expect(ContentTier.STANDARD).toBe(2)
      expect(ContentTier.PRIVATE_ENCRYPTED).toBe(3)
      expect(ContentTier.PREMIUM_HOT).toBe(4)
    })
  })

  describe('ContentRecordSchema', () => {
    it('validates content record', () => {
      const record = {
        contentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        status: '1',
        violationType: '0',
        tier: '2',
        uploader: '0x1234567890123456789012345678901234567890',
        uploadedAt: Date.now(),
        size: 1024000,
        seedCount: 5,
        rewardPool: 1000000000000000000n,
      }
      expect(() => ContentRecordSchema.parse(record)).not.toThrow()
    })
  })

  describe('SeederStatsSchema', () => {
    it('validates seeder stats', () => {
      const stats = {
        totalBytesServed: 1000000000n,
        pendingRewards: 50000000000000000n,
        activeTorrents: 10,
        lastReportTime: Date.now(),
      }
      expect(() => SeederStatsSchema.parse(stats)).not.toThrow()
    })
  })

  describe('TorrentFileSchema', () => {
    it('validates torrent file', () => {
      const file = {
        name: 'video.mp4',
        path: '/downloads/video.mp4',
        size: 1073741824,
        offset: 0,
      }
      expect(() => TorrentFileSchema.parse(file)).not.toThrow()
    })
  })

  describe('TorrentInfoSchema', () => {
    it('validates torrent info', () => {
      const info = {
        infohash: 'abcdef1234567890abcdef1234567890abcdef12',
        magnetUri: 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12',
        name: 'My Torrent',
        size: 1073741824,
        files: [
          { name: 'file1.txt', path: '/file1.txt', size: 1000, offset: 0 },
          { name: 'file2.txt', path: '/file2.txt', size: 2000, offset: 1000 },
        ],
        createdAt: Date.now(),
        contentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      }
      expect(() => TorrentInfoSchema.parse(info)).not.toThrow()
    })
  })

  describe('TorrentStatsSchema', () => {
    it('validates torrent stats', () => {
      const stats = {
        downloaded: 500000000,
        uploaded: 200000000,
        downloadSpeed: 5000000,
        uploadSpeed: 2000000,
        peers: 25,
        seeds: 10,
        progress: 0.75,
        timeRemaining: 300,
      }
      expect(() => TorrentStatsSchema.parse(stats)).not.toThrow()
    })
  })

  describe('SeedingInfoSchema', () => {
    it('validates seeding info', () => {
      const info = {
        infohash: 'abcdef1234567890abcdef1234567890abcdef12',
        bytesUploaded: 10000000000,
        peersServed: 150,
        startedAt: Date.now() - 86400000,
        lastActivity: Date.now(),
        estimatedRewards: 100000000000000000n,
      }
      expect(() => SeedingInfoSchema.parse(info)).not.toThrow()
    })
  })

  describe('TorrentUploadOptionsSchema', () => {
    it('validates upload options', () => {
      const options = {
        name: 'My Upload',
        tier: '2',
        trackers: ['udp://tracker.example.com:6969'],
        comment: 'Test upload',
        private: false,
      }
      expect(() => TorrentUploadOptionsSchema.parse(options)).not.toThrow()
    })

    it('validates minimal options', () => {
      const options = {
        name: 'Simple Upload',
        tier: '0',
      }
      expect(() => TorrentUploadOptionsSchema.parse(options)).not.toThrow()
    })
  })

  describe('TorrentUploadResultSchema', () => {
    it('validates upload result', () => {
      const result = {
        infohash: 'abcdef1234567890abcdef1234567890abcdef12',
        magnetUri: 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12',
        contentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        size: 1073741824,
        tier: '2',
        rewardPoolRequired: 10000000000000000n,
      }
      expect(() => TorrentUploadResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('SwarmInfoSchema', () => {
    it('validates swarm info', () => {
      const info = {
        infohash: 'abcdef1234567890abcdef1234567890abcdef12',
        seeders: 50,
        leechers: 25,
        completed: 1000,
        lastSeen: Date.now(),
      }
      expect(() => SwarmInfoSchema.parse(info)).not.toThrow()
    })
  })

  describe('PeerInfoSchema', () => {
    it('validates peer info', () => {
      const info = {
        id: 'peer-123',
        address: '192.168.1.100',
        port: 51413,
        client: 'Transmission 4.0',
        downloadSpeed: 1000000,
        uploadSpeed: 500000,
        downloaded: 100000000,
        uploaded: 50000000,
      }
      expect(() => PeerInfoSchema.parse(info)).not.toThrow()
    })
  })

  describe('DeliveryMethodSchema', () => {
    it('validates all delivery methods', () => {
      const methods = ['torrent', 'ipfs', 'cdn', 'proxy']
      for (const method of methods) {
        expect(DeliveryMethodSchema.parse(method)).toBe(method)
      }
    })
  })

  describe('DeliveryRouteSchema', () => {
    it('validates delivery route with fallbacks', () => {
      const route = {
        method: 'cdn',
        endpoint: 'https://cdn.example.com/file',
        latencyEstimate: 50,
        cost: 0n,
        fallbacks: [
          {
            method: 'torrent',
            endpoint: 'magnet:?xt=urn:btih:abc123',
            latencyEstimate: 500,
            cost: 1000000000000000n,
            fallbacks: [],
          },
        ],
      }
      expect(() => DeliveryRouteSchema.parse(route)).not.toThrow()
    })
  })

  describe('ContentIdentifierSchema', () => {
    it('validates content identifier', () => {
      const id = {
        contentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        infohash: 'abcdef1234567890abcdef1234567890abcdef12',
        magnetUri: 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12',
      }
      expect(() => ContentIdentifierSchema.parse(id)).not.toThrow()
    })

    it('validates minimal content identifier', () => {
      const id = {
        contentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      }
      expect(() => ContentIdentifierSchema.parse(id)).not.toThrow()
    })
  })

  describe('ContentScanResultSchema', () => {
    it('validates content scan result', () => {
      const result = {
        safe: true,
        violationType: '0',
        confidence: 0.99,
        scanDuration: 5000,
        details: {
          csamScore: 0.001,
          nsfwScore: 0.05,
          malwareDetected: false,
          sensitiveDataFound: false,
        },
      }
      expect(() => ContentScanResultSchema.parse(result)).not.toThrow()
    })

    it('validates unsafe scan result', () => {
      const result = {
        safe: false,
        violationType: '3',
        confidence: 0.95,
        scanDuration: 3000,
        details: {
          csamScore: 0,
          nsfwScore: 0.1,
          malwareDetected: false,
          sensitiveDataFound: true,
        },
      }
      expect(() => ContentScanResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('ModerationReportSchema', () => {
    it('validates moderation report', () => {
      const report = {
        contentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        reporter: '0x1234567890123456789012345678901234567890',
        violationType: '3',
        evidenceHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timestamp: Date.now(),
        caseId: '0x0000000000000000000000000000000000000000000000000000000000000001',
      }
      expect(() => ModerationReportSchema.parse(report)).not.toThrow()
    })
  })

  describe('EncryptedContentSchema', () => {
    it('validates encrypted content', () => {
      const content = {
        cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        infohash: 'abcdef1234567890abcdef1234567890abcdef12',
        magnetUri: 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12',
        keyId: 'key-123',
        accessControlHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        encryptedSize: 1100000000,
        originalSize: 1073741824,
      }
      expect(() => EncryptedContentSchema.parse(content)).not.toThrow()
    })
  })

  describe('DecryptionRequestSchema', () => {
    it('validates decryption request', () => {
      const request = {
        identifier: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        authSignature: {
          sig: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
          message: 'I authorize access to this content',
          address: '0x1234567890123456789012345678901234567890',
        },
      }
      expect(() => DecryptionRequestSchema.parse(request)).not.toThrow()
    })
  })

  describe('CONTENT_REGISTRY_ABI', () => {
    it('has required functions', () => {
      const functionNames = CONTENT_REGISTRY_ABI.filter(
        (item) => item.type === 'function'
      ).map((item) => item.name)

      expect(functionNames).toContain('registerContent')
      expect(functionNames).toContain('flagContent')
      expect(functionNames).toContain('canServe')
      expect(functionNames).toContain('isBlocked')
      expect(functionNames).toContain('getContent')
      expect(functionNames).toContain('startSeeding')
      expect(functionNames).toContain('stopSeeding')
      expect(functionNames).toContain('reportSeeding')
      expect(functionNames).toContain('claimRewards')
      expect(functionNames).toContain('getSeederStats')
      expect(functionNames).toContain('getRewardRate')
      expect(functionNames).toContain('getBlocklistLength')
      expect(functionNames).toContain('getBlocklistBatch')
      expect(functionNames).toContain('topUpRewardPool')
    })
  })
})

