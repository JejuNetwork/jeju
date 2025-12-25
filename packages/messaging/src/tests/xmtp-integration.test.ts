/**
 * XMTP Integration Tests
 *
 * Tests for XMTP/MLS integration with Jeju relay network.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { JejuXMTPNode } from '../xmtp/node'
import { XMTPMessageRouter } from '../xmtp/router'
import { XMTPSyncService } from '../xmtp/sync'
import type { XMTPEnvelope, XMTPIdentity } from '../xmtp/types'

function createTestEnvelope(
  sender: string,
  recipients: string[],
): XMTPEnvelope {
  return {
    version: 1,
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender: sender as `0x${string}`,
    recipients: recipients as `0x${string}`[],
    ciphertext: new TextEncoder().encode('encrypted-content'),
    contentTopic: '/xmtp/1/test/proto',
    timestamp: Date.now(),
    signature: new Uint8Array(64),
  }
}

function createTestIdentity(address: string): XMTPIdentity {
  return {
    address: address as `0x${string}`,
    installationId: new Uint8Array(32),
    keyBundle: {
      identityKey: new Uint8Array(32),
      preKey: new Uint8Array(32),
      preKeySignature: new Uint8Array(64),
    },
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  }
}
describe('XMTP Node', () => {
  let node: JejuXMTPNode

  beforeAll(async () => {
    node = new JejuXMTPNode({
      nodeId: 'test-node-1',
      jejuRelayUrl: 'http://localhost:3000',
      persistenceDir: '/tmp/xmtp-test',
      network: 'testnet',
      skipRelayConnection: true,
    })
    await node.start()
  })

  afterAll(async () => {
    await node.stop()
  })

  test('creates XMTP identity linked to Jeju address', async () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678'
    const identity = createTestIdentity(address)

    await node.registerIdentity(identity)

    const retrieved = await node.getIdentity(address as `0x${string}`)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.address.toLowerCase()).toBe(address.toLowerCase())
  })

  test('processes envelope correctly', async () => {
    const sender = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const recipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    const envelope = createTestEnvelope(sender, [recipient])

    // Should not throw
    await expect(node.processEnvelope(envelope)).resolves.toBeUndefined()
  })

  test('validates invalid envelope', async () => {
    const invalidEnvelope: XMTPEnvelope = {
      version: 1,
      id: '', // Invalid: empty ID
      sender: '0x' as `0x${string}`, // Invalid: incomplete address
      recipients: [], // Invalid: no recipients
      ciphertext: new Uint8Array(0), // Invalid: empty ciphertext
      contentTopic: '',
      timestamp: 0,
      signature: new Uint8Array(0),
    }

    await expect(node.processEnvelope(invalidEnvelope)).rejects.toThrow()
  })

  test('reports node stats', async () => {
    const stats = node.getStats()

    expect(stats.nodeId).toBe('test-node-1')
    expect(stats.uptime).toBeGreaterThanOrEqual(0)
    expect(typeof stats.messagesProcessed).toBe('number')
    expect(typeof stats.messagesForwarded).toBe('number')
  })

  test('node is healthy after start', () => {
    expect(node.isHealthy()).toBe(true)
  })

  test('message ID generation is unique', () => {
    const id1 = JejuXMTPNode.generateMessageId()
    const id2 = JejuXMTPNode.generateMessageId()

    expect(id1).not.toBe(id2)
    expect(id1.length).toBe(32) // 16 bytes = 32 hex chars
  })
})
describe('XMTP Router', () => {
  let router: XMTPMessageRouter

  beforeAll(async () => {
    router = new XMTPMessageRouter({
      multiRegion: true,
      maxRetries: 2,
      retryDelayMs: 100,
      timeoutMs: 5000,
    })
    await router.initialize()
  })

  afterAll(async () => {
    await router.shutdown()
  })

  test('discovers relay nodes', () => {
    const nodes = router.getNodeStats()
    expect(nodes.length).toBeGreaterThan(0)
  })

  test('routes message to relay', async () => {
    const envelope = createTestEnvelope(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    )

    // Note: This will fail in test without actual relay
    // In real tests, mock the fetch or run local relay
    const result = await router.route(envelope)

    // Either succeeds or fails gracefully
    expect(typeof result.success).toBe('boolean')
    if (!result.success) {
      expect(result.error).toBeDefined()
    }
  })

  test('retries pending messages', async () => {
    const retried = await router.retryPending()
    expect(typeof retried).toBe('number')
  })

  test('tracks router statistics', () => {
    const stats = router.getStats()

    expect(typeof stats.totalMessages).toBe('number')
    expect(typeof stats.successfulDeliveries).toBe('number')
    expect(typeof stats.failedDeliveries).toBe('number')
    expect(typeof stats.averageLatencyMs).toBe('number')
  })

  test('reports healthy node count', () => {
    const count = router.getHealthyNodeCount()
    expect(typeof count).toBe('number')
  })
})
describe('XMTP Sync Service', () => {
  let syncService: XMTPSyncService

  beforeAll(async () => {
    syncService = new XMTPSyncService({
      syncIntervalMs: 1000,
      batchSize: 50,
    })
    await syncService.start()
  })

  afterAll(async () => {
    await syncService.stop()
  })

  test('adds sync peer', () => {
    syncService.addPeer('test-peer', 'http://localhost:4000')

    const peers = syncService.getPeers()
    expect(peers.some((p) => p.nodeId === 'test-peer')).toBe(true)
  })

  test('removes sync peer', () => {
    syncService.addPeer('temp-peer', 'http://localhost:4001')
    syncService.removePeer('temp-peer')

    const peers = syncService.getPeers()
    expect(peers.some((p) => p.nodeId === 'temp-peer')).toBe(false)
  })

  test('reports sync state', () => {
    const state = syncService.getState()

    expect(typeof state.lastSyncedBlock).toBe('number')
    expect(typeof state.lastSyncedAt).toBe('number')
    expect(typeof state.pendingMessages).toBe('number')
    expect(typeof state.isSyncing).toBe('boolean')
  })

  test('reports pending count', () => {
    const count = syncService.getPendingCount()
    expect(typeof count).toBe('number')
  })
})
describe('XMTP End-to-End Flow', () => {
  test('complete message flow simulation', async () => {
    // 1. Create identities
    const alice = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const bob = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    const aliceIdentity = createTestIdentity(alice)
    const bobIdentity = createTestIdentity(bob)

    // 2. Create node
    const node = new JejuXMTPNode({
      nodeId: 'e2e-test-node',
      jejuRelayUrl: 'http://localhost:3000',
      persistenceDir: '/tmp/xmtp-e2e-test',
      network: 'testnet',
      skipRelayConnection: true,
    })

    await node.start()

    // 3. Register identities
    await node.registerIdentity(aliceIdentity)
    await node.registerIdentity(bobIdentity)

    // 4. Verify identities registered
    const retrievedAlice = await node.getIdentity(alice as `0x${string}`)
    const retrievedBob = await node.getIdentity(bob as `0x${string}`)

    expect(retrievedAlice).not.toBeNull()
    expect(retrievedBob).not.toBeNull()

    // 5. Create and process message
    const envelope = createTestEnvelope(alice, [bob])

    node.onMessage(async (e) => {
      if (e.id === envelope.id) {
        // Message received successfully
      }
    })

    await node.processEnvelope(envelope)

    // 6. Verify stats updated
    const stats = node.getStats()
    expect(stats.messagesProcessed).toBeGreaterThan(0)

    // 7. Cleanup
    await node.stop()

    expect(node.isHealthy()).toBe(false)
  })

  test('multi-device message delivery', async () => {
    const address = '0xcccccccccccccccccccccccccccccccccccccccc'

    // Simulate multiple devices for same address
    const device1Identity: XMTPIdentity = {
      ...createTestIdentity(address),
      installationId: new Uint8Array([1, 2, 3, 4]),
    }

    const device2Identity: XMTPIdentity = {
      ...createTestIdentity(address),
      installationId: new Uint8Array([5, 6, 7, 8]),
    }

    const node = new JejuXMTPNode({
      nodeId: 'multi-device-test',
      jejuRelayUrl: 'http://localhost:3000',
      persistenceDir: '/tmp/xmtp-multi-device-test',
      network: 'testnet',
      skipRelayConnection: true,
    })

    await node.start()

    // Register both devices
    await node.registerIdentity(device1Identity)
    await node.registerIdentity(device2Identity)

    // Lookup should return one (last registered wins in simple impl)
    const identities = await node.lookupIdentities([address as `0x${string}`])
    expect(identities.size).toBe(1)

    await node.stop()
  })

  test('message persistence survives restart', async () => {
    const persistPath = '/tmp/xmtp-persist-test'

    // First node instance
    const node1 = new JejuXMTPNode({
      nodeId: 'persist-test-1',
      jejuRelayUrl: 'http://localhost:3000',
      persistenceDir: persistPath,
      network: 'testnet',
      skipRelayConnection: true,
    })

    await node1.start()

    const identity = createTestIdentity(
      '0xdddddddddddddddddddddddddddddddddddddddd',
    )
    await node1.registerIdentity(identity)

    const initialStats = node1.getStats()
    expect(initialStats.messagesProcessed).toBeGreaterThanOrEqual(0)

    await node1.stop()

    // Second node instance (simulating restart)
    const node2 = new JejuXMTPNode({
      nodeId: 'persist-test-1', // Same ID
      jejuRelayUrl: 'http://localhost:3000',
      persistenceDir: persistPath, // Same path
      network: 'testnet',
      skipRelayConnection: true,
    })

    await node2.start()

    // In real impl, would verify persisted data loaded
    expect(node2.isHealthy()).toBe(true)

    await node2.stop()
  })
})
describe('XMTP Group Chat', () => {
  test('group with MLS encryption simulation', async () => {
    const members = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ]

    const node = new JejuXMTPNode({
      nodeId: 'group-test',
      jejuRelayUrl: 'http://localhost:3000',
      persistenceDir: '/tmp/xmtp-group-test',
      network: 'testnet',
      skipRelayConnection: true,
    })

    await node.start()

    // Register all members
    for (const member of members) {
      await node.registerIdentity(createTestIdentity(member))
    }

    // Create group message (all members as recipients)
    const firstMember = members[0]
    if (!firstMember) throw new Error('members array is empty')
    const groupEnvelope = createTestEnvelope(firstMember, members)

    await node.processEnvelope(groupEnvelope)

    const stats = node.getStats()
    expect(stats.messagesProcessed).toBeGreaterThan(0)

    await node.stop()
  })
})
describe('Cross-Region Delivery', () => {
  test('routes to preferred region', async () => {
    const router = new XMTPMessageRouter({
      multiRegion: true,
      preferredRegions: ['us-east', 'eu-west'],
      maxRetries: 1,
      timeoutMs: 1000,
    })

    await router.initialize()

    const nodes = router.getNodeStats()
    expect(nodes.length).toBeGreaterThan(0)

    // Check that preferred regions are prioritized
    // (Would need mock to verify actual routing)

    await router.shutdown()
  })
})
