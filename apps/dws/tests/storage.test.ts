/**
 * Storage Service Tests
 *
 * Comprehensive tests for DWS storage:
 * - BackendManager operations
 * - HTTP API endpoints
 * - S3 compatibility
 * - IPFS compatibility
 * - Content integrity
 * - Concurrent operations
 *
 * Requires: IPFS and/or S3-compatible storage
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import {
  type BackendManager,
  createBackendManager,
} from '../api/storage/backends'
import { resetMultiBackendManager } from '../api/storage/multi-backend'
import { SKIP as INFRA_SKIP } from './infra-check'
import { dwsRequest } from './setup'

setDefaultTimeout(10000)

// Skip integration tests unless explicitly enabled or running via jeju test
const SKIP_INTEGRATION =
  process.env.SKIP_INTEGRATION === 'true' || INFRA_SKIP.STORAGE

// Check if storage service is available
const _storageAvailable = false
async function _checkStorageHealth(): Promise<boolean> {
  try {
    const res = await dwsRequest('/storage/health')
    return res.status === 200
  } catch {
    return false
  }
}

// Test response types
interface StorageHealthResponse {
  status: string
  backends: string[]
}

interface UploadResponse {
  cid: string
  size?: number
  tier?: string
}

interface CidResponse {
  cid: string
}

interface ExistsResponse {
  exists: boolean
  cid?: string
}

interface ContentMetadataResponse {
  cid: string
  tier: string
  category: string
}

interface ContentListResponse {
  items: Array<{ cid: string; tier?: string }>
  total: number
}

interface PopularItemsResponse {
  items: Array<{ cid: string; score?: number }>
}

interface IpfsAddResponse {
  Hash: string
  Size: string
  Name: string
}

interface S3BucketsResponse {
  Buckets: Array<{ Name: string }>
}

interface S3ObjectsResponse {
  Contents: Array<{ Key: string }>
}

// Helper Functions

function createTestBuffer(size: number, fill = 0): Buffer {
  return Buffer.alloc(size, fill)
}

async function uploadFile(
  content: Buffer,
  options: {
    filename?: string
    tier?: string
    category?: string
  } = {},
) {
  const formData = new FormData()
  formData.append('file', new Blob([content]), options.filename ?? 'test.bin')
  if (options.tier) formData.append('tier', options.tier)
  if (options.category) formData.append('category', options.category)

  return dwsRequest('/storage/upload', {
    method: 'POST',
    body: formData,
  })
}

// Backend Manager Tests - Uses in-memory/local backends, no external services needed

describe('BackendManager', () => {
  let backend: BackendManager

  beforeEach(() => {
    backend = createBackendManager()
  })

  describe('Basic Operations', () => {
    test('should list available backends', () => {
      const backends = backend.listBackends()
      expect(backends).toContain('local')
      expect(backends.length).toBeGreaterThanOrEqual(1)
    })

    test('should upload and download content', async () => {
      const content = createTestBuffer(1024, 0x42)
      const result = await backend.upload(content, {
        preferredBackend: 'local',
      })

      expect(result.cid).toBeDefined()
      expect(result.backend).toBe('local')
      expect(result.url).toContain(result.cid)

      const downloaded = await backend.download(result.cid)
      expect(downloaded.content.equals(content)).toBe(true)
      expect(downloaded.backend).toBe('local')
    })

    test('should check content existence', async () => {
      const content = createTestBuffer(256)
      const result = await backend.upload(content, {
        preferredBackend: 'local',
      })

      expect(await backend.exists(result.cid)).toBe(true)
      expect(await backend.exists('nonexistent-cid-123456789')).toBe(false)
    })

    test('should throw for non-existent content', async () => {
      await expect(backend.download('nonexistent-cid-12345')).rejects.toThrow()
    })
  })

  describe('CID Determinism', () => {
    test('same content produces same CID', async () => {
      const content = createTestBuffer(100, 0x42)
      const result1 = await backend.upload(content, {
        preferredBackend: 'local',
      })
      const result2 = await backend.upload(content, {
        preferredBackend: 'local',
      })
      expect(result1.cid).toBe(result2.cid)
    })

    test('different content produces different CID', async () => {
      const result1 = await backend.upload(createTestBuffer(100, 0x11), {
        preferredBackend: 'local',
      })
      const result2 = await backend.upload(createTestBuffer(100, 0x22), {
        preferredBackend: 'local',
      })
      expect(result1.cid).not.toBe(result2.cid)
    })
  })

  describe('Batch Operations', () => {
    test('uploadBatch handles multiple files', async () => {
      const items = [
        {
          content: createTestBuffer(100),
          options: { preferredBackend: 'local' },
        },
        {
          content: createTestBuffer(200),
          options: { preferredBackend: 'local' },
        },
        {
          content: createTestBuffer(300),
          options: { preferredBackend: 'local' },
        },
      ]

      const results = await backend.uploadBatch(items)

      expect(results).toHaveLength(3)
      expect(new Set(results.map((r) => r.cid)).size).toBe(3)
    })

    test('downloadBatch handles multiple CIDs', async () => {
      const cids: string[] = []
      for (let i = 0; i < 3; i++) {
        const result = await backend.upload(createTestBuffer(100, i), {
          preferredBackend: 'local',
        })
        cids.push(result.cid)
      }

      const results = await backend.downloadBatch(cids)

      expect(results.size).toBe(3)
      for (const cid of cids) {
        expect(results.has(cid)).toBe(true)
      }
    })

    test('downloadBatch skips non-existent CIDs', async () => {
      const result = await backend.upload(createTestBuffer(100), {
        preferredBackend: 'local',
      })

      const results = await backend.downloadBatch([
        result.cid,
        'nonexistent-cid',
      ])

      expect(results.size).toBe(1)
      expect(results.has(result.cid)).toBe(true)
    })
  })

  describe('Content Integrity', () => {
    test('preserves binary content exactly', async () => {
      const content = Buffer.alloc(256)
      for (let i = 0; i < 256; i++) content[i] = i

      const result = await backend.upload(content, {
        preferredBackend: 'local',
      })
      const downloaded = await backend.download(result.cid)
      expect(downloaded.content.equals(content)).toBe(true)
    })

    test('handles empty content', async () => {
      const result = await backend.upload(Buffer.alloc(0), {
        preferredBackend: 'local',
      })
      expect(result.cid).toBeDefined()

      const downloaded = await backend.download(result.cid)
      expect(downloaded.content.length).toBe(0)
    })

    test('handles large content (10MB)', async () => {
      const content = createTestBuffer(10 * 1024 * 1024)
      const result = await backend.upload(content, {
        preferredBackend: 'local',
      })

      const downloaded = await backend.download(result.cid)
      expect(downloaded.content.length).toBe(content.length)
      expect(downloaded.content.equals(content)).toBe(true)
    })

    test('handles null bytes', async () => {
      const content = Buffer.from([0x00, 0xff, 0x00, 0xfe, 0x00, 0x00])
      const result = await backend.upload(content, {
        preferredBackend: 'local',
      })

      const downloaded = await backend.download(result.cid)
      expect(downloaded.content.equals(content)).toBe(true)
    })

    test('handles special characters', async () => {
      const content = Buffer.from('Special chars: 日本語 🎉 émojis\n\t\r')
      const result = await backend.upload(content, {
        preferredBackend: 'local',
      })

      const downloaded = await backend.download(result.cid)
      expect(downloaded.content.equals(content)).toBe(true)
    })
  })

  describe('Concurrent Operations', () => {
    test('handles concurrent uploads', async () => {
      const uploads = Array.from({ length: 50 }, (_, i) =>
        backend.upload(createTestBuffer(100, i), { preferredBackend: 'local' }),
      )

      const results = await Promise.all(uploads)

      expect(results).toHaveLength(50)
      expect(new Set(results.map((r) => r.cid)).size).toBe(50)
    })

    test('handles concurrent downloads', async () => {
      const result = await backend.upload(createTestBuffer(100), {
        preferredBackend: 'local',
      })

      const downloads = Array.from({ length: 20 }, () =>
        backend.download(result.cid),
      )

      const results = await Promise.all(downloads)
      for (const r of results) expect(r.content.length).toBe(100)
    })
  })

  describe('Health Check', () => {
    test('returns status for all backends', async () => {
      const health = await backend.healthCheck()
      expect(health).toHaveProperty('local')
      expect(health.local).toBe(true)
    })
  })
})

// HTTP API Tests - These require storage service to be running
// Run with: jeju test (starts all services) or REQUIRE_SERVICES=true bun test

describe.skipIf(SKIP_INTEGRATION)('Storage HTTP API', () => {
  afterAll(() => {
    resetMultiBackendManager()
  })

  describe('Health', () => {
    test('GET /storage/health returns healthy', async () => {
      const res = await dwsRequest('/storage/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as StorageHealthResponse
      expect(body.status).toBe('healthy')
      expect(body.backends).toContain('local')
    })
  })

  describe('Upload', () => {
    test('POST /storage/upload accepts file and returns CID', async () => {
      const content = Buffer.from('test file content')
      const res = await uploadFile(content, { filename: 'test.txt' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as UploadResponse
      expect(body.cid).toBeDefined()
      expect(body.size).toBe(content.length)
    })

    test('POST /storage/upload without file returns 400', async () => {
      const res = await dwsRequest('/storage/upload', {
        method: 'POST',
        body: new FormData(),
      })
      expect(res.status).toBe(400)
    })

    test('POST /storage/upload handles binary files', async () => {
      const binaryData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])
      const res = await uploadFile(binaryData, { filename: 'test.png' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as UploadResponse
      expect(body.cid).toBeDefined()
      expect(body.size).toBe(8)
    })

    test('POST /storage/upload with tier', async () => {
      const res = await uploadFile(Buffer.from('tiered content'), {
        filename: 'test.txt',
        tier: 'popular',
        category: 'data',
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as UploadResponse
      expect(body.tier).toBe('popular')
    })

    test('POST /storage/upload/json uploads JSON data', async () => {
      const res = await dwsRequest('/storage/upload/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { name: 'test', value: 123 },
          tier: 'popular',
          name: 'test-data.json',
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as CidResponse
      expect(body.cid).toBeDefined()
    })
  })

  describe('Download', () => {
    let uploadedCid: string

    beforeAll(async () => {
      const res = await uploadFile(Buffer.from('download test content'), {
        filename: 'download-test.bin',
      })
      const body = (await res.json()) as CidResponse
      uploadedCid = body.cid
    })

    test('GET /storage/download/:cid returns content', async () => {
      const res = await dwsRequest(`/storage/download/${uploadedCid}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream')

      const content = await res.text()
      expect(content).toBe('download test content')
    })

    test('GET /storage/download/:cid returns 404 for non-existent', async () => {
      const res = await dwsRequest('/storage/download/nonexistent-cid-xyz')
      expect(res.status).toBe(404)
    })
  })

  describe('Exists', () => {
    let uploadedCid: string

    beforeAll(async () => {
      const res = await uploadFile(Buffer.from('exists check'), {
        filename: 'exists-test.txt',
      })
      const body = (await res.json()) as CidResponse
      uploadedCid = body.cid
    })

    test('GET /storage/exists/:cid returns true for existing', async () => {
      const res = await dwsRequest(`/storage/exists/${uploadedCid}`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ExistsResponse
      expect(body.exists).toBe(true)
      expect(body.cid).toBe(uploadedCid)
    })

    test('GET /storage/exists/:cid returns false for non-existent', async () => {
      const res = await dwsRequest('/storage/exists/nonexistent-cid-abc')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ExistsResponse
      expect(body.exists).toBe(false)
    })
  })

  describe('Content Management', () => {
    let testCid: string

    beforeAll(async () => {
      const res = await uploadFile(Buffer.from('management test'), {
        filename: 'manage-test.bin',
        tier: 'popular',
        category: 'data',
      })
      const body = (await res.json()) as CidResponse
      testCid = body.cid
    })

    test('GET /storage/content/:cid returns metadata', async () => {
      const res = await dwsRequest(`/storage/content/${testCid}`)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ContentMetadataResponse
      expect(body.cid).toBe(testCid)
      expect(body.tier).toBe('popular')
      expect(body.category).toBe('data')
    })

    test('GET /storage/content lists content', async () => {
      const res = await dwsRequest('/storage/content')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ContentListResponse
      expect(body.items).toBeInstanceOf(Array)
      expect(body.total).toBeGreaterThan(0)
    })

    test('GET /storage/content?tier=popular filters by tier', async () => {
      const res = await dwsRequest('/storage/content?tier=popular')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ContentListResponse
      for (const item of body.items) {
        expect(item.tier).toBe('popular')
      }
    })
  })

  describe('Popularity', () => {
    beforeAll(async () => {
      // Upload and access content multiple times
      for (let i = 0; i < 3; i++) {
        const res = await uploadFile(Buffer.from(`popularity test ${i}`), {
          tier: 'popular',
        })
        const body = (await res.json()) as CidResponse

        for (let j = 0; j < 5; j++) {
          await dwsRequest(`/storage/download/${body.cid}`)
        }
      }
    })

    test('GET /storage/popular returns popular content', async () => {
      const res = await dwsRequest('/storage/popular')
      expect(res.status).toBe(200)

      const body = (await res.json()) as PopularItemsResponse
      expect(body.items).toBeInstanceOf(Array)
    })

    test('GET /storage/popular?limit=5 respects limit', async () => {
      const res = await dwsRequest('/storage/popular?limit=5')
      expect(res.status).toBe(200)

      const body = (await res.json()) as PopularItemsResponse
      expect(body.items.length).toBeLessThanOrEqual(5)
    })
  })

  describe('IPFS Compatibility', () => {
    test('POST /storage/api/v0/add works like IPFS', async () => {
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([Buffer.from('ipfs compatible')]),
        'test.txt',
      )

      const res = await dwsRequest('/storage/api/v0/add', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(200)

      const body = (await res.json()) as IpfsAddResponse
      expect(body.Hash).toBeDefined()
      expect(body.Size).toBe('15')
    })

    test('GET /storage/ipfs/:cid serves content', async () => {
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([Buffer.from('ipfs gateway test')]),
        'test.txt',
      )

      const uploadRes = await dwsRequest('/storage/api/v0/add', {
        method: 'POST',
        body: formData,
      })

      const { Hash } = (await uploadRes.json()) as IpfsAddResponse

      const res = await dwsRequest(`/storage/ipfs/${Hash}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('X-Ipfs-Path')).toBe(`/ipfs/${Hash}`)
    })
  })
})

// S3 Compatibility Tests

describe.skipIf(SKIP_INTEGRATION)('S3 Compatibility', () => {
  const testBucket = `test-bucket-${Date.now()}`
  const testKey = 'test-object.txt'
  const testContent = 'Hello, DWS S3!'

  test('list buckets', async () => {
    const res = await dwsRequest('/s3')
    expect(res.status).toBe(200)

    const body = (await res.json()) as S3BucketsResponse
    expect(body.Buckets).toBeDefined()
  })

  test('create bucket', async () => {
    const res = await dwsRequest(`/s3/${testBucket}`, {
      method: 'PUT',
      headers: {
        'x-jeju-address': '0x1234567890123456789012345678901234567890',
      },
    })
    expect(res.status).toBe(200)
  })

  test('put object', async () => {
    const res = await dwsRequest(`/s3/${testBucket}/${testKey}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        'x-jeju-address': '0x1234567890123456789012345678901234567890',
      },
      body: testContent,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toBeTruthy()
  })

  test('get object', async () => {
    const res = await dwsRequest(`/s3/${testBucket}/${testKey}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(testContent)
  })

  test('head object', async () => {
    const res = await dwsRequest(`/s3/${testBucket}/${testKey}`, {
      method: 'HEAD',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe(String(testContent.length))
  })

  test('list objects', async () => {
    const res = await dwsRequest(`/s3/${testBucket}?list-type=2`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as S3ObjectsResponse
    expect(body.Contents).toBeDefined()
    expect(body.Contents.length).toBeGreaterThan(0)
  })

  test('delete object', async () => {
    const res = await dwsRequest(`/s3/${testBucket}/${testKey}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
  })

  test('delete bucket', async () => {
    const res = await dwsRequest(`/s3/${testBucket}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
  })
})

// Edge Cases

// Edge Cases - Uses local backends, no external services needed

describe('Edge Cases', () => {
  let backend: BackendManager

  beforeEach(() => {
    backend = createBackendManager()
  })

  test('handles content that looks like a CID', async () => {
    const content = Buffer.from(
      'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    )
    const result = await backend.upload(content, { preferredBackend: 'local' })

    const downloaded = await backend.download(result.cid)
    expect(downloaded.content.toString()).toBe(
      'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    )
  })

  test('handles exactly 1 byte content', async () => {
    const result = await backend.upload(Buffer.from([0x42]), {
      preferredBackend: 'local',
    })

    const downloaded = await backend.download(result.cid)
    expect(downloaded.content.length).toBe(1)
    expect(downloaded.content[0]).toBe(0x42)
  })

  test('handles filename with special characters', async () => {
    const result = await backend.upload(Buffer.from('test'), {
      preferredBackend: 'local',
      filename: 'file with spaces & special (chars).txt',
    })
    expect(result.cid).toBeDefined()
  })
})
