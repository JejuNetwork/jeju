/**
 * Cache Provisioning Tests
 *
 * Tests for the cache provisioning manager:
 * - Instance creation and deletion
 * - Plan management
 * - Node registration
 * - Stats aggregation
 * - CQL persistence (when available)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import {
  type CacheProvisioningManager,
  initializeCacheProvisioning,
  resetCacheProvisioning,
} from '../api/cache/provisioning'
import {
  CacheErrorCode,
  CacheInstanceStatus,
  CacheTEEProvider,
  CacheTier,
} from '../api/cache/types'

const TEST_OWNER = '0x1234567890123456789012345678901234567890' as Address
const TEST_OWNER_2 = '0x0987654321098765432109876543210987654321' as Address

describe('CacheProvisioningManager', () => {
  let manager: CacheProvisioningManager

  beforeAll(async () => {
    manager = await initializeCacheProvisioning()
  })

  afterAll(() => {
    resetCacheProvisioning()
  })

  describe('Plans', () => {
    test('getPlans returns all default plans', () => {
      const plans = manager.getPlans()
      expect(plans.length).toBeGreaterThanOrEqual(5)

      const planIds = plans.map((p) => p.id)
      expect(planIds).toContain('standard-64')
      expect(planIds).toContain('standard-256')
      expect(planIds).toContain('premium-1024')
      expect(planIds).toContain('tee-256')
      expect(planIds).toContain('tee-1024')
    })

    test('getPlan returns specific plan', () => {
      const plan = manager.getPlan('standard-64')
      expect(plan).not.toBeNull()
      expect(plan?.tier).toBe(CacheTier.STANDARD)
      expect(plan?.maxMemoryMb).toBe(64)
      expect(plan?.pricePerHour).toBe(0n)
    })

    test('getPlan returns null for unknown plan', () => {
      const plan = manager.getPlan('nonexistent-plan')
      expect(plan).toBeNull()
    })

    test('TEE plans require TEE', () => {
      const teePlan = manager.getPlan('tee-256')
      expect(teePlan?.teeRequired).toBe(true)
      expect(teePlan?.tier).toBe(CacheTier.TEE)
    })
  })

  describe('Instance Lifecycle', () => {
    let instanceId: string

    test('createInstance creates standard instance', async () => {
      const instance = await manager.createInstance(
        TEST_OWNER,
        'standard-64',
        'test-namespace-1',
        24, // 24 hours
      )

      expect(instance.id).toBeDefined()
      expect(instance.owner).toBe(TEST_OWNER)
      expect(instance.namespace).toBe('test-namespace-1')
      expect(instance.tier).toBe(CacheTier.STANDARD)
      expect(instance.maxMemoryMb).toBe(64)
      expect(instance.status).toBe(CacheInstanceStatus.RUNNING)

      instanceId = instance.id
    })

    test('getInstance returns created instance', () => {
      const instance = manager.getInstance(instanceId)
      expect(instance).not.toBeNull()
      expect(instance?.id).toBe(instanceId)
    })

    test('getInstancesByOwner returns owner instances', () => {
      const instances = manager.getInstancesByOwner(TEST_OWNER)
      expect(instances.length).toBeGreaterThanOrEqual(1)
      expect(instances.some((i) => i.id === instanceId)).toBe(true)
    })

    test('getAllInstances includes created instance', () => {
      const instances = manager.getAllInstances()
      expect(instances.some((i) => i.id === instanceId)).toBe(true)
    })

    test('extendInstance extends duration', async () => {
      const before = manager.getInstance(instanceId)
      const beforeExpiry = before?.expiresAt ?? 0

      const updated = await manager.extendInstance(instanceId, TEST_OWNER, 12)
      expect(updated.expiresAt).toBeGreaterThan(beforeExpiry)
    })

    test('extendInstance fails for wrong owner', async () => {
      await expect(
        manager.extendInstance(instanceId, TEST_OWNER_2, 12),
      ).rejects.toMatchObject({ code: CacheErrorCode.UNAUTHORIZED })
    })

    test('deleteInstance removes instance', async () => {
      const success = await manager.deleteInstance(instanceId, TEST_OWNER)
      expect(success).toBe(true)
      expect(manager.getInstance(instanceId)).toBeNull()
    })

    test('deleteInstance fails for wrong owner', async () => {
      // Create a new instance to delete
      const instance = await manager.createInstance(
        TEST_OWNER,
        'standard-64',
        'delete-test',
      )

      await expect(
        manager.deleteInstance(instance.id, TEST_OWNER_2),
      ).rejects.toMatchObject({ code: CacheErrorCode.UNAUTHORIZED })

      // Clean up
      await manager.deleteInstance(instance.id, TEST_OWNER)
    })
  })

  describe('TEE Instances', () => {
    test('createInstance creates TEE instance with attestation', async () => {
      const instance = await manager.createInstance(
        TEST_OWNER,
        'tee-256',
        'tee-test-namespace',
        24,
      )

      expect(instance.tier).toBe(CacheTier.TEE)
      expect(instance.teeProvider).toBe(CacheTEEProvider.DSTACK)
      expect(instance.teeAttestation).toBeDefined()
      expect(instance.teeAttestation?.simulated).toBe(true) // In test mode

      // Clean up
      await manager.deleteInstance(instance.id, TEST_OWNER)
    })
  })

  describe('Instance by Namespace', () => {
    test('getInstanceByNamespace finds instance', async () => {
      const instance = await manager.createInstance(
        TEST_OWNER,
        'standard-64',
        'unique-namespace-xyz',
      )

      const found = manager.getInstanceByNamespace('unique-namespace-xyz')
      expect(found).not.toBeNull()
      expect(found?.id).toBe(instance.id)

      // Clean up
      await manager.deleteInstance(instance.id, TEST_OWNER)
    })

    test('getInstanceByNamespace returns null for unknown', () => {
      const found = manager.getInstanceByNamespace('nonexistent-namespace')
      expect(found).toBeNull()
    })
  })

  describe('Node Management', () => {
    const nodeId = 'test-cache-node-1'

    test('registerNode creates node', async () => {
      const node = await manager.registerNode(
        nodeId,
        TEST_OWNER,
        'http://localhost:4015',
        'us-east-1',
        CacheTier.STANDARD,
        1024,
      )

      expect(node.nodeId).toBe(nodeId)
      expect(node.status).toBe('online')
      expect(node.usedMemoryMb).toBe(0)
      expect(node.instanceCount).toBe(0)
    })

    test('getNode returns registered node', () => {
      const node = manager.getNode(nodeId)
      expect(node).not.toBeNull()
      expect(node?.endpoint).toBe('http://localhost:4015')
    })

    test('getAllNodes includes registered node', () => {
      const nodes = manager.getAllNodes()
      expect(nodes.some((n) => n.nodeId === nodeId)).toBe(true)
    })

    test('getNodesByTier filters by tier', () => {
      const standardNodes = manager.getNodesByTier(CacheTier.STANDARD)
      expect(standardNodes.some((n) => n.nodeId === nodeId)).toBe(true)

      const teeNodes = manager.getNodesByTier(CacheTier.TEE)
      expect(teeNodes.every((n) => n.nodeId !== nodeId)).toBe(true)
    })

    test('updateNodeHeartbeat updates timestamp', async () => {
      const before = manager.getNode(nodeId)?.lastHeartbeat ?? 0

      // Wait a bit to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10))

      const success = await manager.updateNodeHeartbeat(nodeId)
      expect(success).toBe(true)

      const after = manager.getNode(nodeId)?.lastHeartbeat ?? 0
      expect(after).toBeGreaterThan(before)
    })
  })

  describe('Global Stats', () => {
    test('getGlobalStats returns aggregated statistics', () => {
      const stats = manager.getGlobalStats()

      expect(typeof stats.totalInstances).toBe('number')
      expect(typeof stats.totalNodes).toBe('number')
      expect(typeof stats.totalMemoryMb).toBe('number')
      expect(typeof stats.usedMemoryMb).toBe('number')
      expect(typeof stats.totalKeys).toBe('number')
      expect(stats.tierBreakdown).toBeDefined()
      expect(typeof stats.tierBreakdown.standard).toBe('number')
      expect(typeof stats.tierBreakdown.premium).toBe('number')
      expect(typeof stats.tierBreakdown.tee).toBe('number')
    })
  })

  describe('Engine Access', () => {
    test('getEngine returns engine for standard instance', async () => {
      const instance = await manager.createInstance(
        TEST_OWNER,
        'standard-64',
        'engine-test-ns',
      )

      const engine = manager.getEngine(instance.id)
      expect(engine).not.toBeNull()

      // Can use the engine
      engine?.set('engine-test-ns', 'test-key', 'test-value')
      expect(engine?.get('engine-test-ns', 'test-key')).toBe('test-value')

      await manager.deleteInstance(instance.id, TEST_OWNER)
    })

    test('getEngineByNamespace returns correct engine', async () => {
      const instance = await manager.createInstance(
        TEST_OWNER,
        'standard-64',
        'engine-ns-lookup',
      )

      const engine = manager.getEngineByNamespace('engine-ns-lookup')
      expect(engine).not.toBeNull()

      await manager.deleteInstance(instance.id, TEST_OWNER)
    })

    test('getTEEProvider returns provider for TEE instance', async () => {
      const instance = await manager.createInstance(
        TEST_OWNER,
        'tee-256',
        'tee-provider-test',
      )

      const provider = manager.getTEEProvider(instance.id)
      expect(provider).not.toBeNull()

      const providerByNs =
        manager.getTEEProviderByNamespace('tee-provider-test')
      expect(providerByNs).not.toBeNull()

      await manager.deleteInstance(instance.id, TEST_OWNER)
    })
  })

  describe('Error Handling', () => {
    test('createInstance throws for invalid plan', async () => {
      await expect(
        manager.createInstance(TEST_OWNER, 'invalid-plan-id'),
      ).rejects.toMatchObject({ code: CacheErrorCode.INVALID_OPERATION })
    })

    test('extendInstance throws for nonexistent instance', async () => {
      await expect(
        manager.extendInstance('nonexistent-id', TEST_OWNER, 12),
      ).rejects.toMatchObject({ code: CacheErrorCode.INSTANCE_NOT_FOUND })
    })
  })
})
