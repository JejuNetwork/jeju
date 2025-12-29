/**
 * Tests for Compute Benchmark Service
 *
 * Tests the public API of ComputeBenchmarkService:
 * - runFullBenchmark() - runs complete benchmark suite
 * - getProfile() - gets stored provider profile
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { ComputeBenchmarkService } from '../../api/compute/benchmark-service'

describe('Compute Benchmark Service', () => {
  let service: ComputeBenchmarkService
  const testNodeId = 'test-node'
  const testAddress = '0x1234567890123456789012345678901234567890' as Address

  beforeEach(() => {
    service = new ComputeBenchmarkService({
      cpuTestDurationMs: 100, // Reduce test duration for faster tests
      memoryTestSizeMb: 10,
      storageTestSizeMb: 10,
      networkTestServers: [], // Empty to skip network tests
      gpuTestIterations: 10,
      teeTestEnabled: false,
    })
  })

  describe('constructor', () => {
    test('creates service with default config', () => {
      const defaultService = new ComputeBenchmarkService()
      expect(defaultService).toBeDefined()
    })

    test('creates service with custom config', () => {
      const customService = new ComputeBenchmarkService({
        cpuTestDurationMs: 50,
      })
      expect(customService).toBeDefined()
    })
  })

  describe('getProfile', () => {
    test('returns null for unknown provider', () => {
      const profile = service.getProfile(
        '0x0000000000000000000000000000000000000000' as Address,
      )
      expect(profile).toBeNull()
    })
  })

  describe('runFullBenchmark', () => {
    test('runs full benchmark and returns valid result', async () => {
      const result = await service.runFullBenchmark(testNodeId, testAddress)

      // Check basic result structure
      expect(result.nodeId).toBe(testNodeId)
      expect(result.nodeAddress).toBe(testAddress)
      expect(result.timestamp).toBeGreaterThan(0)
      expect(result.version).toBe('1.0.0')

      // Check component benchmarks exist
      expect(result.cpu).toBeDefined()
      expect(result.memory).toBeDefined()
      expect(result.storage).toBeDefined()
      expect(result.network).toBeDefined()
      expect(result.tee).toBeDefined()

      // Check overall score (scale is 0-10000 basis points)
      expect(result.overallScore).toBeGreaterThanOrEqual(0)
      expect(result.overallScore).toBeLessThanOrEqual(10000)

      // Check attestation hash format
      expect(result.attestationHash).toBeDefined()
      expect(result.attestationHash.length).toBe(66) // 0x + 64 hex chars
    }, 60000)

    test('CPU benchmark returns valid metrics', async () => {
      const result = await service.runFullBenchmark(testNodeId, testAddress)

      expect(result.cpu.model).toBeTruthy()
      expect(result.cpu.coreCount).toBeGreaterThan(0)
      expect(result.cpu.singleCoreScore).toBeGreaterThan(0)
      expect(result.cpu.multiCoreScore).toBeGreaterThan(0)
      expect(result.cpu.architecture).toBeTruthy()
      expect(result.cpu.vendor).toBeTruthy()
    }, 60000)

    test('memory benchmark returns valid metrics', async () => {
      const result = await service.runFullBenchmark(testNodeId, testAddress)

      expect(result.memory.totalMb).toBeGreaterThan(0)
      expect(result.memory.availableMb).toBeGreaterThan(0)
      expect(result.memory.readBandwidthMbps).toBeGreaterThanOrEqual(0)
      expect(result.memory.writeBandwidthMbps).toBeGreaterThanOrEqual(0)
    }, 60000)

    test('storage benchmark returns valid metrics', async () => {
      const result = await service.runFullBenchmark(testNodeId, testAddress)

      expect(result.storage.sequentialReadMbps).toBeGreaterThanOrEqual(0)
      expect(result.storage.sequentialWriteMbps).toBeGreaterThanOrEqual(0)
      expect(result.storage.randomReadIops).toBeGreaterThanOrEqual(0)
      expect(result.storage.randomWriteIops).toBeGreaterThanOrEqual(0)
    }, 60000)

    test('TEE benchmark returns valid structure when disabled', async () => {
      const result = await service.runFullBenchmark(testNodeId, testAddress)

      expect(result.tee).toBeDefined()
      expect(result.tee.platform).toBeDefined()
      expect(typeof result.tee.supported).toBe('boolean')
      expect(typeof result.tee.attestationValid).toBe('boolean')
    }, 60000)

    test('network benchmark returns valid metrics', async () => {
      const result = await service.runFullBenchmark(testNodeId, testAddress)

      expect(result.network).toBeDefined()
      expect(typeof result.network.downloadMbps).toBe('number')
      expect(typeof result.network.uploadMbps).toBe('number')
      expect(typeof result.network.latencyMs).toBe('number')
      expect(typeof result.network.packetLossPercent).toBe('number')
    }, 60000)
  })
})
