/**
 * S3 Backend and WebTorrent Integration Tests
 *
 * Unit tests for:
 * - S3Backend wrapping BackendManager (uses IPFS storage)
 * - WebTorrentBackend using S3Backend for persistence
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type BackendManager,
  createBackendManager,
} from '../api/storage/backends'
import { S3Backend } from '../api/storage/s3-backend'
import type { ContentTier } from '../api/storage/types'
import {
  resetWebTorrentBackend,
  WebTorrentBackend,
} from '../api/storage/webtorrent-backend'

describe('S3Backend Unit Tests', () => {
  let backend: BackendManager
  let s3: S3Backend

  beforeEach(() => {
    backend = createBackendManager()
    s3 = new S3Backend(backend)
  })

  describe('Bucket Operations', () => {
    test('creates a bucket', async () => {
      const bucket = await s3.createBucket('test-bucket', 'test-owner')
      expect(bucket.name).toBe('test-bucket')
      expect(bucket.owner).toBe('test-owner')
      expect(bucket.versioning).toBe('Disabled')
    })

    test('throws on duplicate bucket', async () => {
      await s3.createBucket('dupe-bucket', 'owner')
      await expect(s3.createBucket('dupe-bucket', 'owner')).rejects.toThrow(
        'Bucket dupe-bucket already exists',
      )
    })

    test('lists buckets', async () => {
      await s3.createBucket('bucket-a', 'owner1')
      await s3.createBucket('bucket-b', 'owner2')

      const all = await s3.listBuckets()
      expect(all.length).toBeGreaterThanOrEqual(2)

      const owner1Buckets = await s3.listBuckets('owner1')
      expect(owner1Buckets.some((b) => b.name === 'bucket-a')).toBe(true)
    })

    test('gets bucket by name', async () => {
      await s3.createBucket('get-bucket', 'owner')
      const bucket = await s3.getBucket('get-bucket')
      expect(bucket).not.toBeNull()
      expect(bucket?.name).toBe('get-bucket')

      const missing = await s3.getBucket('nonexistent')
      expect(missing).toBeNull()
    })

    test('deletes empty bucket', async () => {
      await s3.createBucket('delete-me', 'owner')
      await s3.deleteBucket('delete-me')
      const bucket = await s3.getBucket('delete-me')
      expect(bucket).toBeNull()
    })
  })

  describe('Object Operations', () => {
    const testBucket = 'object-test-bucket'

    beforeEach(async () => {
      try {
        await s3.createBucket(testBucket, 'test-owner')
      } catch {
        // Bucket may already exist from previous test
      }
    })

    test('puts and gets object', async () => {
      const content = Buffer.from('Hello S3 World')

      const putResult = await s3.putObject({
        bucket: testBucket,
        key: 'hello.txt',
        body: content,
        contentType: 'text/plain',
      })

      expect(putResult.etag).toBeDefined()
      expect(putResult.etag.startsWith('"')).toBe(true)

      const getResult = await s3.getObject({
        bucket: testBucket,
        key: 'hello.txt',
      })

      expect(getResult.body.toString()).toBe('Hello S3 World')
      expect(getResult.contentType).toBe('text/plain')
    })

    test('puts object with metadata', async () => {
      await s3.putObject({
        bucket: testBucket,
        key: 'with-meta.txt',
        body: Buffer.from('metadata test'),
        metadata: {
          'x-custom-header': 'custom-value',
          'x-another': 'another-value',
        },
      })

      const result = await s3.getObject({
        bucket: testBucket,
        key: 'with-meta.txt',
      })

      expect(result.metadata['x-custom-header']).toBe('custom-value')
      expect(result.metadata['x-another']).toBe('another-value')
    })

    test('throws on get nonexistent key', async () => {
      await expect(
        s3.getObject({ bucket: testBucket, key: 'missing.txt' }),
      ).rejects.toThrow('Key missing.txt does not exist')
    })

    test('lists objects with prefix', async () => {
      await s3.putObject({
        bucket: testBucket,
        key: 'folder/file1.txt',
        body: Buffer.from('file1'),
      })
      await s3.putObject({
        bucket: testBucket,
        key: 'folder/file2.txt',
        body: Buffer.from('file2'),
      })
      await s3.putObject({
        bucket: testBucket,
        key: 'other/file3.txt',
        body: Buffer.from('file3'),
      })

      const result = await s3.listObjects({
        bucket: testBucket,
        prefix: 'folder/',
      })

      expect(result.contents.length).toBe(2)
      expect(result.contents.every((o) => o.key.startsWith('folder/'))).toBe(
        true,
      )
    })

    test('deletes object', async () => {
      await s3.putObject({
        bucket: testBucket,
        key: 'to-delete.txt',
        body: Buffer.from('delete me'),
      })

      await s3.deleteObject({
        bucket: testBucket,
        key: 'to-delete.txt',
      })

      await expect(
        s3.getObject({ bucket: testBucket, key: 'to-delete.txt' }),
      ).rejects.toThrow()
    })

    test('head object returns metadata', async () => {
      await s3.putObject({
        bucket: testBucket,
        key: 'head-test.txt',
        body: Buffer.from('head test content'),
        contentType: 'text/plain',
        metadata: { custom: 'value' },
      })

      const head = await s3.headObject(testBucket, 'head-test.txt')

      expect(head.contentLength).toBe(17) // 'head test content'.length
      expect(head.contentType).toBe('text/plain')
      expect(head.metadata.custom).toBe('value')
    })

    test('handles binary content', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f])

      await s3.putObject({
        bucket: testBucket,
        key: 'binary.bin',
        body: binaryData,
        contentType: 'application/octet-stream',
      })

      const result = await s3.getObject({
        bucket: testBucket,
        key: 'binary.bin',
      })

      expect(Buffer.compare(result.body, binaryData)).toBe(0)
    })
  })

  describe('Storage Integration', () => {
    test('content is persisted to BackendManager', async () => {
      const bucket = 'integration-bucket'
      try {
        await s3.createBucket(bucket, 'owner')
      } catch {
        // Bucket may exist
      }

      const content = Buffer.from('This should be stored in IPFS/local backend')

      await s3.putObject({
        bucket,
        key: 'integrated.txt',
        body: content,
      })

      // Verify through BackendManager that content was stored
      const stored = backend.getLocalStorage()
      expect(stored.size).toBeGreaterThan(0)
    })
  })
})

describe('WebTorrentBackend Unit Tests', () => {
  let backend: BackendManager

  beforeEach(() => {
    resetWebTorrentBackend()
    backend = createBackendManager()
  })

  describe('Initialization', () => {
    test('creates backend with default config', () => {
      const wtBackend = new WebTorrentBackend()
      expect(wtBackend.name).toBe('webtorrent')
      expect(wtBackend.type).toBe('webtorrent')
    })

    test('creates backend with custom config', () => {
      const wtBackend = new WebTorrentBackend({
        maxCacheSizeGB: 100,
        maxUploadSpeedMbps: 200,
      })
      expect(wtBackend.name).toBe('webtorrent')
    })

    test('creates backend with storage backend', () => {
      const wtBackend = new WebTorrentBackend({}, backend)
      expect(wtBackend.getS3Backend()).not.toBeNull()
    })

    test('can set storage backend after creation', () => {
      const wtBackend = new WebTorrentBackend()
      expect(wtBackend.getS3Backend()).toBeNull()

      wtBackend.setStorageBackend(backend)
      expect(wtBackend.getS3Backend()).not.toBeNull()
    })
  })

  describe('Storage Integration', () => {
    test('initializes storage bucket', async () => {
      const wtBackend = new WebTorrentBackend({}, backend)
      await wtBackend.initializeStorage()

      const s3 = wtBackend.getS3Backend()
      expect(s3).not.toBeNull()

      const bucket = await s3?.getBucket('webtorrent-content')
      expect(bucket).not.toBeNull()
    })
  })

  describe('Torrent Metadata', () => {
    test('hasTorrent returns false for nonexistent', () => {
      const wtBackend = new WebTorrentBackend()
      expect(wtBackend.hasTorrent('nonexistent-cid')).toBe(false)
    })

    test('getTorrent returns null for nonexistent', () => {
      const wtBackend = new WebTorrentBackend()
      expect(wtBackend.getTorrent('nonexistent')).toBeNull()
    })

    test('getMagnetUri returns null for nonexistent', () => {
      const wtBackend = new WebTorrentBackend()
      expect(wtBackend.getMagnetUri('nonexistent-cid')).toBeNull()
    })

    test('getTorrentsByTier returns empty for no torrents', () => {
      const wtBackend = new WebTorrentBackend()
      const tiers: ContentTier[] = ['system', 'popular', 'private']
      for (const tier of tiers) {
        expect(wtBackend.getTorrentsByTier(tier)).toEqual([])
      }
    })
  })

  describe('Event Emitter (Workerd Compatible)', () => {
    test('emits and receives events', () => {
      const wtBackend = new WebTorrentBackend()
      let received = false

      wtBackend.on('test-event', () => {
        received = true
      })

      wtBackend.emit('test-event', { data: 'test' })
      expect(received).toBe(true)
    })

    test('removes event listeners', () => {
      const wtBackend = new WebTorrentBackend()
      let count = 0

      const handler = () => {
        count++
      }

      wtBackend.on('count-event', handler)
      wtBackend.emit('count-event')
      expect(count).toBe(1)

      wtBackend.removeListener('count-event', handler)
      wtBackend.emit('count-event')
      expect(count).toBe(1) // Should not increment
    })

    test('once listener fires only once', () => {
      const wtBackend = new WebTorrentBackend()
      let count = 0

      wtBackend.once('once-event', () => {
        count++
      })

      wtBackend.emit('once-event')
      wtBackend.emit('once-event')
      expect(count).toBe(1)
    })
  })
})
