/**
 * Metadata Service Tests
 *
 * Tests for the distributed metadata service that uses SQLit v2
 * for content metadata storage and discovery.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createSQLitServer } from '../../../packages/sqlit/v2/server'
import {
  MetadataService,
  resetMetadataService,
} from '../api/database/metadata-service'
import type {
  ContentCategory,
  ContentMetadata,
  ContentTier,
} from '../api/storage/types'

const TEST_DATA_DIR = join(import.meta.dir, '.test-data-metadata')
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const TEST_PORT = 18560 + Math.floor(Math.random() * 100) // Random port to avoid conflicts

// Mock content metadata generator
function createMockContent(
  overrides: Partial<ContentMetadata> = {},
): ContentMetadata {
  const cid = `Qm${Math.random().toString(36).slice(2, 15)}${Math.random().toString(36).slice(2, 15)}`
  return {
    cid,
    size: 1024,
    contentType: 'application/octet-stream',
    tier: 'private' as ContentTier,
    category: 'data' as ContentCategory,
    name: `test-content-${cid.slice(0, 8)}`,
    description: 'Test content for metadata service',
    createdAt: Date.now(),
    sha256: `0x${Math.random().toString(16).slice(2, 66).padEnd(64, '0')}`,
    addresses: {
      cid,
      backends: ['ipfs'],
    },
    encrypted: false,
    accessCount: 0,
    ...overrides,
  }
}

describe('MetadataService', () => {
  let server: Awaited<ReturnType<typeof createSQLitServer>>
  let service: MetadataService
  let databaseId: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'development'

    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }

    // Start SQLit server (includes node)
    server = await createSQLitServer({
      port: TEST_PORT,
      host: 'localhost',
      nodeConfig: {
        operatorPrivateKey: TEST_PRIVATE_KEY,
        endpoint: `http://localhost:${TEST_PORT}`,
        wsEndpoint: `ws://localhost:${TEST_PORT}/ws`,
        dataDir: TEST_DATA_DIR,
        region: 'global',
        teeEnabled: false,
        l2RpcUrl: 'http://localhost:8545',
        registryAddress: '0x0000000000000000000000000000000000000000',
        version: '2.0.0-test',
      },
    })

    // Create database for metadata
    const result = await server.node.createDatabase({
      name: 'dws-metadata-test',
      encryptionMode: 'none',
      replication: {},
    })
    databaseId = result.databaseId
  })

  beforeEach(async () => {
    // Reset singleton
    await resetMetadataService()

    // Create fresh service
    service = new MetadataService({
      sqlitEndpoint: `http://localhost:${TEST_PORT}`,
      databaseId,
      debug: false,
    })
  })

  afterAll(async () => {
    if (server) {
      await server.stop()
    }
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  describe('Content Registration', () => {
    it('should register new content', async () => {
      const content = createMockContent()

      await service.registerContent(content)

      const retrieved = await service.getContent(content.cid)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.cid).toBe(content.cid)
      expect(retrieved?.name).toBe(content.name)
      expect(retrieved?.size).toBe(content.size)
    })

    it('should update existing content', async () => {
      const content = createMockContent()
      await service.registerContent(content)

      // Update with new access count
      const updatedContent = {
        ...content,
        accessCount: 100,
        updatedAt: Date.now(),
      }
      await service.registerContent(updatedContent)

      const retrieved = await service.getContent(content.cid)
      expect(retrieved?.accessCount).toBe(100)
    })

    it('should store content addresses', async () => {
      const content = createMockContent({
        addresses: {
          cid: 'QmTest123',
          backends: ['ipfs', 'arweave'],
          arweaveTxId: 'arweave-tx-123',
        },
      })

      await service.registerContent(content)

      const retrieved = await service.getContent(content.cid)
      expect(retrieved?.addresses.backends).toContain('ipfs')
      expect(retrieved?.addresses.backends).toContain('arweave')
      expect(retrieved?.addresses.arweaveTxId).toBe('arweave-tx-123')
    })

    it('should store regional stats', async () => {
      const content = createMockContent({
        regionalStats: {
          'us-east': {
            region: 'us-east',
            accessCount: 50,
            seederCount: 3,
            avgLatencyMs: 25,
            lastAccessed: Date.now(),
          },
        },
      })

      await service.registerContent(content)

      const retrieved = await service.getContent(content.cid)
      expect(retrieved?.regionalStats?.['us-east']).toBeDefined()
      expect(retrieved?.regionalStats?.['us-east']?.accessCount).toBe(50)
    })
  })

  describe('Content Retrieval', () => {
    it('should return null for non-existent content', async () => {
      const result = await service.getContent('QmNonExistent')
      expect(result).toBeNull()
    })

    it('should retrieve content by CID', async () => {
      const content = createMockContent()
      await service.registerContent(content)

      const retrieved = await service.getContent(content.cid)
      expect(retrieved?.cid).toBe(content.cid)
      expect(retrieved?.tier).toBe(content.tier)
      expect(retrieved?.category).toBe(content.category)
    })
  })

  describe('Access Recording', () => {
    it('should increment access count', async () => {
      const content = createMockContent({ accessCount: 0 })
      await service.registerContent(content)

      await service.recordAccess(content.cid)
      await service.recordAccess(content.cid)

      const retrieved = await service.getContent(content.cid)
      expect(retrieved?.accessCount).toBe(2)
    })

    it('should track regional access', async () => {
      const content = createMockContent()
      await service.registerContent(content)

      await service.recordAccess(content.cid, 'us-west')
      await service.recordAccess(content.cid, 'us-west')
      await service.recordAccess(content.cid, 'eu-west')

      const retrieved = await service.getContent(content.cid)
      expect(retrieved?.regionalStats?.['us-west']?.accessCount).toBe(2)
      expect(retrieved?.regionalStats?.['eu-west']?.accessCount).toBe(1)
    })
  })

  describe('Content Deletion', () => {
    it('should delete content', async () => {
      const content = createMockContent()
      await service.registerContent(content)

      await service.deleteContent(content.cid)

      const retrieved = await service.getContent(content.cid)
      expect(retrieved).toBeNull()
    })
  })

  describe('Content Queries', () => {
    beforeEach(async () => {
      // Register multiple contents for query tests
      const owner = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

      await service.registerContent(
        createMockContent({
          cid: 'Qm1',
          owner: owner as `0x${string}`,
          tier: 'system',
          category: 'static',
          accessCount: 100,
        }),
      )

      await service.registerContent(
        createMockContent({
          cid: 'Qm2',
          owner: owner as `0x${string}`,
          tier: 'popular',
          category: 'media',
          accessCount: 50,
        }),
      )

      await service.registerContent(
        createMockContent({
          cid: 'Qm3',
          owner: '0x0000000000000000000000000000000000000001' as `0x${string}`,
          tier: 'private',
          category: 'data',
          accessCount: 10,
        }),
      )
    })

    it('should list content by owner', async () => {
      const owner =
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`
      const results = await service.listByOwner(owner)

      expect(results.length).toBe(2)
      expect(results.every((r) => r.owner === owner)).toBe(true)
    })

    it('should filter by tier', async () => {
      const owner =
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`
      const results = await service.listByOwner(owner, { tier: 'system' })

      expect(results.length).toBe(1)
      expect(results[0].tier).toBe('system')
    })

    it('should find by tier and category', async () => {
      const results = await service.findByTierAndCategory('popular', 'media')

      expect(results.length).toBe(1)
      expect(results[0].cid).toBe('Qm2')
    })

    it('should get popular content', async () => {
      const results = await service.getPopular({ limit: 2 })

      expect(results.length).toBe(2)
      // Sorted by access count desc
      expect(results[0].accessCount).toBeGreaterThanOrEqual(
        results[1].accessCount,
      )
    })
  })

  describe('Content Replication', () => {
    it('should register replicas', async () => {
      const content = createMockContent()
      await service.registerContent(content)

      await service.registerReplica(content.cid, 'node-1', 'us-east')
      await service.registerReplica(content.cid, 'node-2', 'eu-west')

      const nodes = await service.getContentNodes(content.cid)
      // Replicas start as pending, so they won't show until verified
      expect(nodes.length).toBe(0) // Pending replicas not returned by getContentNodes
    })

    it('should verify and activate replicas', async () => {
      const content = createMockContent()
      await service.registerContent(content)

      await service.registerReplica(content.cid, 'node-1', 'us-east')
      await service.verifyReplica(
        content.cid,
        'node-1',
        '0x1234567890abcdef' as `0x${string}`,
      )

      const nodes = await service.getContentNodes(content.cid)
      expect(nodes.length).toBe(1)
      expect(nodes[0].nodeId).toBe('node-1')
      expect(nodes[0].status).toBe('active')
    })

    it('should update seeder count after verification', async () => {
      const content = createMockContent()
      await service.registerContent(content)

      await service.registerReplica(content.cid, 'node-1', 'us-east')
      await service.verifyReplica(
        content.cid,
        'node-1',
        '0xabc' as `0x${string}`,
      )
      await service.registerReplica(content.cid, 'node-2', 'us-west')
      await service.verifyReplica(
        content.cid,
        'node-2',
        '0xdef' as `0x${string}`,
      )

      const retrieved = await service.getContent(content.cid)
      expect(retrieved?.seederCount).toBe(2)
    })
  })

  describe('Health Check', () => {
    it('should report healthy status', async () => {
      const healthy = await service.isHealthy()
      expect(healthy).toBe(true)
    })
  })
})
