/**
 * Swarming Coordinator Tests
 *
 * Tests for the BitTorrent/WebTorrent swarming coordinator that handles:
 * - Peer discovery and management
 * - Content registration and tracking
 * - Regional content routing
 * - Transfer recording and statistics
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createSQLitServer } from '../../../packages/sqlit/v2/server'
import { resetMetadataService } from '../api/database/metadata-service'
import {
  type SwarmingConfig,
  SwarmingCoordinator,
} from '../api/storage/swarming'

const TEST_DATA_DIR = join(import.meta.dir, '.test-data-swarming')
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const TEST_PORT = 18570 + Math.floor(Math.random() * 100)

function createSwarmingConfig(
  overrides: Partial<SwarmingConfig> = {},
): SwarmingConfig {
  return {
    nodeId: `test-node-${Math.random().toString(36).slice(2, 10)}`,
    region: 'us-east',
    endpoint: `http://localhost:${TEST_PORT}`,
    sqlitEndpoint: `http://localhost:${TEST_PORT}`,
    databaseId: 'swarm-test',
    maxConcurrentDownloads: 5,
    maxConcurrentUploads: 10,
    healthCheckIntervalMs: 60000, // Disable by setting high
    rebalanceIntervalMs: 60000, // Disable by setting high
    minPeersPerContent: 3,
    targetPeersPerContent: 5,
    maxPeerConnections: 50,
    debug: false,
    ...overrides,
  }
}

describe('SwarmingCoordinator', () => {
  let server: Awaited<ReturnType<typeof createSQLitServer>>
  let databaseId: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'development'

    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }

    // Start SQLit server
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

    // Create database for swarming
    const result = await server.node.createDatabase({
      name: 'swarm-test',
      encryptionMode: 'none',
      replication: {},
    })
    databaseId = result.databaseId
  })

  beforeEach(async () => {
    await resetMetadataService()
  })

  afterAll(async () => {
    if (server) {
      await server.stop()
    }
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  describe('Initialization', () => {
    it('should initialize coordinator successfully', async () => {
      const coordinator = new SwarmingCoordinator(
        createSwarmingConfig({
          databaseId,
        }),
      )

      await coordinator.initialize()
      await coordinator.stop()
    })

    it('should register self as peer on initialization', async () => {
      const config = createSwarmingConfig({ databaseId })
      const coordinator = new SwarmingCoordinator(config)

      await coordinator.initialize()

      // Get stats which includes peer count
      const stats = await coordinator.getStats()
      expect(stats.totalPeers).toBeGreaterThanOrEqual(1)

      await coordinator.stop()
    })
  })

  describe('Peer Management', () => {
    let coordinator: SwarmingCoordinator

    beforeEach(async () => {
      coordinator = new SwarmingCoordinator(
        createSwarmingConfig({ databaseId }),
      )
      await coordinator.initialize()
    })

    afterAll(async () => {
      if (coordinator) {
        await coordinator.stop()
      }
    })

    it('should register a peer', async () => {
      await coordinator.registerPeer({
        nodeId: 'peer-1',
        endpoint: 'http://peer1.example.com:8546',
        region: 'us-west',
        lastSeen: Date.now(),
        latencyMs: 50,
        reputation: 1000,
        capabilities: ['ipfs', 'webtorrent'],
        uploadSpeed: 1000000,
        downloadSpeed: 500000,
      })

      const stats = await coordinator.getStats()
      expect(stats.totalPeers).toBeGreaterThanOrEqual(2) // Self + peer-1
    })

    it('should get regional peers', async () => {
      // Register peers in different regions
      await coordinator.registerPeer({
        nodeId: 'peer-us-east-1',
        endpoint: 'http://useast1.example.com:8546',
        region: 'us-east',
        lastSeen: Date.now(),
        latencyMs: 30,
        reputation: 1000,
        capabilities: ['ipfs'],
        uploadSpeed: 1000000,
        downloadSpeed: 500000,
      })

      await coordinator.registerPeer({
        nodeId: 'peer-eu-west-1',
        endpoint: 'http://euwest1.example.com:8546',
        region: 'eu-west',
        lastSeen: Date.now(),
        latencyMs: 100,
        reputation: 1000,
        capabilities: ['ipfs'],
        uploadSpeed: 1000000,
        downloadSpeed: 500000,
      })

      const regionalPeers = await coordinator.getRegionalPeers(10)
      expect(regionalPeers.length).toBeGreaterThanOrEqual(1)
      // Regional peers should include local region first
      expect(regionalPeers.some((p) => p.region === 'us-east')).toBe(true)
    })

    it('should get peers for content', async () => {
      const testCid = 'QmTestContent123'

      // Register content
      await coordinator.registerContent({
        cid: testCid,
        infoHash: '1234567890abcdef',
        size: 1024 * 1024,
        tier: 'popular',
      })

      // No seeders initially
      const peersWithContent = await coordinator.getPeersForContent(testCid)
      expect(peersWithContent.length).toBe(0)
    })
  })

  describe('Content Management', () => {
    let coordinator: SwarmingCoordinator

    beforeEach(async () => {
      coordinator = new SwarmingCoordinator(
        createSwarmingConfig({ databaseId }),
      )
      await coordinator.initialize()
    })

    afterAll(async () => {
      if (coordinator) {
        await coordinator.stop()
      }
    })

    it('should register content', async () => {
      const testCid = 'QmRegisterContent'

      await coordinator.registerContent({
        cid: testCid,
        infoHash: 'abcdef1234567890',
        size: 2048,
        tier: 'system',
      })

      const info = await coordinator.getContentInfo(testCid)
      expect(info).not.toBeNull()
      expect(info?.cid).toBe(testCid)
      expect(info?.tier).toBe('system')
      expect(info?.size).toBe(2048)
    })

    it('should track content health', async () => {
      const testCid = 'QmHealthContent'

      await coordinator.registerContent({
        cid: testCid,
        infoHash: 'healthhash123',
        size: 4096,
        tier: 'popular',
      })

      const info = await coordinator.getContentInfo(testCid)
      expect(info?.health).toBeDefined()
      expect(['excellent', 'good', 'degraded', 'critical']).toContain(
        info?.health,
      )
    })

    it('should track seeder and leecher counts', async () => {
      const testCid = 'QmSeederCount'

      await coordinator.registerContent({
        cid: testCid,
        infoHash: 'seedercounthash',
        size: 8192,
        tier: 'popular',
      })

      const info = await coordinator.getContentInfo(testCid)
      expect(info?.seederCount).toBeDefined()
      expect(info?.leecherCount).toBeDefined()
    })
  })

  describe('Transfer Recording', () => {
    let coordinator: SwarmingCoordinator

    beforeEach(async () => {
      coordinator = new SwarmingCoordinator(
        createSwarmingConfig({ databaseId }),
      )
      await coordinator.initialize()
    })

    afterAll(async () => {
      if (coordinator) {
        await coordinator.stop()
      }
    })

    it('should record successful transfer', async () => {
      // Register the peers first
      await coordinator.registerPeer({
        nodeId: 'peer-source',
        endpoint: 'http://source.example.com:8546',
        region: 'us-east',
        lastSeen: Date.now(),
        latencyMs: 20,
        reputation: 1000,
        capabilities: ['ipfs'],
        uploadSpeed: 1000000,
        downloadSpeed: 500000,
      })

      await coordinator.recordTransfer(
        'peer-source',
        'peer-dest',
        'QmTransfer1',
        1024 * 1024,
        5000,
        true,
      )

      const stats = await coordinator.getStats()
      expect(
        stats.totalBytesDownloaded + stats.totalBytesUploaded,
      ).toBeGreaterThanOrEqual(BigInt(0))
    })

    it('should record failed transfer', async () => {
      // Register the peers first
      await coordinator.registerPeer({
        nodeId: 'peer-source-2',
        endpoint: 'http://source2.example.com:8546',
        region: 'us-east',
        lastSeen: Date.now(),
        latencyMs: 20,
        reputation: 1000,
        capabilities: ['ipfs'],
        uploadSpeed: 1000000,
        downloadSpeed: 500000,
      })

      await coordinator.recordTransfer(
        'peer-source-2',
        'peer-dest',
        'QmTransferFailed',
        0,
        30000,
        false,
      )

      // Should not throw
    })
  })

  describe('Statistics', () => {
    let coordinator: SwarmingCoordinator

    beforeEach(async () => {
      coordinator = new SwarmingCoordinator(
        createSwarmingConfig({ databaseId }),
      )
      await coordinator.initialize()
    })

    afterAll(async () => {
      if (coordinator) {
        await coordinator.stop()
      }
    })

    it('should return stats', async () => {
      const stats = await coordinator.getStats()

      expect(typeof stats.totalPeers).toBe('number')
      expect(typeof stats.connectedPeers).toBe('number')
      expect(typeof stats.totalContent).toBe('number')
      expect(typeof stats.avgLatencyMs).toBe('number')
      expect(typeof stats.healthScore).toBe('number')
    })

    it('should calculate health score', async () => {
      // Register some peers and content
      await coordinator.registerPeer({
        nodeId: 'healthy-peer',
        endpoint: 'http://healthy.example.com:8546',
        region: 'us-east',
        lastSeen: Date.now(),
        latencyMs: 20,
        reputation: 1000,
        capabilities: ['ipfs', 'webtorrent'],
        uploadSpeed: 2000000,
        downloadSpeed: 1000000,
      })

      await coordinator.registerContent({
        cid: 'QmHealthyContent',
        infoHash: 'healthycontentinfo',
        size: 1024,
        tier: 'popular',
      })

      const stats = await coordinator.getStats()
      expect(stats.healthScore).toBeGreaterThanOrEqual(0)
      expect(stats.healthScore).toBeLessThanOrEqual(100)
    })
  })

  describe('Content Discovery', () => {
    let coordinator: SwarmingCoordinator

    beforeEach(async () => {
      coordinator = new SwarmingCoordinator(
        createSwarmingConfig({ databaseId }),
      )
      await coordinator.initialize()
    })

    afterAll(async () => {
      if (coordinator) {
        await coordinator.stop()
      }
    })

    it('should return null for non-existent content', async () => {
      const info = await coordinator.getContentInfo('QmNonExistent123')
      expect(info).toBeNull()
    })

    it('should get content info after registration', async () => {
      const testCid = 'QmGetInfoContent'

      await coordinator.registerContent({
        cid: testCid,
        infoHash: 'getinfocontenthash',
        size: 8192,
        tier: 'system',
      })

      const info = await coordinator.getContentInfo(testCid)
      expect(info).not.toBeNull()
      expect(info?.cid).toBe(testCid)
      expect(info?.infoHash).toBe('getinfocontenthash')
    })
  })
})
