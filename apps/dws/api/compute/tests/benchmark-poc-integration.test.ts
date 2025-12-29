/**
 * Integration test for BenchmarkOrchestrator ↔ PoCNodeVerifier flow
 */
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import type { Hex } from 'viem'

import { PoCNodeVerifier, shutdownPoCNodeVerifier } from '../../infrastructure/poc-node-verifier'
import { MockPoCRegistryClient } from '../../poc/registry-client'
import * as quoteParser from '../../poc/quote-parser'
import { BenchmarkOrchestrator, type BenchmarkResults } from '../benchmark-orchestrator'

const TEST_SALT = '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' as Hex
const TEST_AGENT_ID = 12345n

// Valid TDX quote structure (matches quote-parser expectations)
function createTestTDXQuote(): Hex {
  const bytes = new Uint8Array(1200)
  
  // DCAP header
  bytes[0] = 0x03 // version
  bytes[1] = 0x00
  bytes[2] = 0x02 // attestation key type
  bytes[3] = 0x00
  bytes[4] = 0x81 // TDX TEE type
  bytes[5] = 0x00
  // Vendor ID (SGX_QL_VENDOR_INTEL)
  bytes.set([0x00, 0x00, 0xa0, 0x93, 0x04, 0x00, 0x00, 0x00], 12)
  
  // TDX report body starts at offset 48
  // MRSIGNER at offset 48+112 (16 bytes)
  for (let i = 0; i < 16; i++) bytes[48 + 112 + i] = 0x11 + i
  // MRENCLAVE/MRTD at offset 48+128 (48 bytes)
  for (let i = 0; i < 48; i++) bytes[48 + 128 + i] = 0xaa
  // REPORTDATA at offset 48+320 (64 bytes)
  for (let i = 0; i < 64; i++) bytes[48 + 320 + i] = 0xbb
  
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex
}

function createMockBenchmarkResults(overrides: Partial<BenchmarkResults> = {}): BenchmarkResults {
  return {
    cpuSingleCore: 5000,
    cpuMultiCore: 20000,
    cpuCores: 8,
    cpuModel: 'Test CPU',
    cpuFrequencyMhz: 3500,
    memoryMb: 32768,
    memoryBandwidthMbps: 25600,
    memoryLatencyNs: 80,
    storageMb: 512000,
    storageType: 'nvme',
    sequentialReadMbps: 3500,
    sequentialWriteMbps: 3000,
    randomReadIops: 500000,
    randomWriteIops: 400000,
    networkBandwidthMbps: 10000,
    networkLatencyMs: 1,
    gpuDetected: false,
    gpuModel: null,
    gpuMemoryMb: null,
    gpuFp32Tflops: null,
    gpuInferenceScore: null,
    teeDetected: true,
    teePlatform: 'intel_tdx',
    teeAttestationHash: createTestTDXQuote(),
    teeAttestationValid: true,
    pocVerified: false,
    pocLevel: null,
    pocCloudProvider: null,
    pocRegion: null,
    pocHardwareIdHash: null,
    pocReputationDelta: 0,
    overallScore: 7500,
    attestationHash: '0xabc123' as Hex,
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('BenchmarkOrchestrator → PoCNodeVerifier integration', () => {
  let orchestrator: BenchmarkOrchestrator
  let pocVerifier: PoCNodeVerifier
  let mockRegistry: MockPoCRegistryClient
  let parseQuoteSpy: ReturnType<typeof spyOn>
  let verifyQuoteSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockRegistry = new MockPoCRegistryClient()
    
    // Mock quote parser functions for controlled testing
    parseQuoteSpy = spyOn(quoteParser, 'parseQuote').mockImplementation((hex: Hex) => ({
      success: true,
      quote: {
        raw: hex,
        platform: 'intel_tdx' as const,
        version: 3,
        measurement: '0x' + 'aa'.repeat(48) as Hex,
        hardwareId: '0x' + '11'.repeat(16) as Hex,
        reportData: '0x' + 'bb'.repeat(64) as Hex,
        signature: '0x' + 'cc'.repeat(64) as Hex,
        certChain: [],
        securityVersion: { cpu: 2, tcb: 3 },
        timestamp: Date.now(),
      },
      error: null,
    }))

    verifyQuoteSpy = spyOn(quoteParser, 'verifyQuote').mockResolvedValue({
      valid: true,
      quote: parseQuoteSpy.mock.results[0]?.value?.quote,
      measurementMatch: true,
      certificateValid: true,
      signatureValid: true,
      tcbStatus: 'upToDate' as const,
      error: null,
    })

    pocVerifier = new PoCNodeVerifier({ hardwareIdSalt: TEST_SALT, cacheTtlMs: 100 })
    // @ts-expect-error - accessing private for testing
    pocVerifier.registryClient = mockRegistry

    orchestrator = new BenchmarkOrchestrator()
    orchestrator.setPoCVerifier(pocVerifier)
  })

  afterEach(() => {
    parseQuoteSpy.mockRestore()
    verifyQuoteSpy.mockRestore()
    shutdownPoCNodeVerifier()
  })

  test('PoC verification is triggered for TEE-enabled machines', async () => {
    // Add hardware to registry
    const hardwareIdHash = quoteParser.hashHardwareId('0x' + '11'.repeat(16) as Hex, TEST_SALT)
    mockRegistry.addMockEntry({
      hardwareIdHash,
      level: 2,
      cloudProvider: 'aws',
      region: 'us-east-1',
      evidenceHashes: [],
      endorsements: [],
      verifiedAt: Date.now() - 1000,
      lastVerifiedAt: Date.now() - 1000,
      monitoringCadence: 86400000,
      active: true,
    })

    // Access private method for testing
    const results = createMockBenchmarkResults()
    // @ts-expect-error - accessing private method for testing
    const updatedResults = await orchestrator.runPoCVerification(TEST_AGENT_ID, results)

    expect(updatedResults.pocVerified).toBe(true)
    expect(updatedResults.pocLevel).toBe(2)
    expect(updatedResults.pocCloudProvider).toBe('aws')
    expect(updatedResults.pocRegion).toBe('us-east-1')
    expect(updatedResults.pocReputationDelta).toBe(15) // Level 2 = +15
  })

  test('PoC failure results in negative reputation delta', async () => {
    // Don't add hardware to registry - verification should fail
    const results = createMockBenchmarkResults()
    // @ts-expect-error - accessing private method
    const updatedResults = await orchestrator.runPoCVerification(TEST_AGENT_ID, results)

    expect(updatedResults.pocVerified).toBe(false)
    expect(updatedResults.pocLevel).toBeNull()
    expect(updatedResults.pocReputationDelta).toBe(0) // Unregistered = 0
  })

  test('revoked hardware results in severe reputation penalty', async () => {
    const hardwareIdHash = quoteParser.hashHardwareId('0x' + '11'.repeat(16) as Hex, TEST_SALT)
    mockRegistry.addMockEntry({
      hardwareIdHash,
      level: 2,
      cloudProvider: 'aws',
      region: 'us-east-1',
      evidenceHashes: [],
      endorsements: [],
      verifiedAt: Date.now() - 1000,
      lastVerifiedAt: Date.now() - 1000,
      monitoringCadence: 86400000,
      active: false, // Revoked
    })

    const results = createMockBenchmarkResults()
    // @ts-expect-error - accessing private method
    const updatedResults = await orchestrator.runPoCVerification(TEST_AGENT_ID, results)

    expect(updatedResults.pocVerified).toBe(false)
    expect(updatedResults.pocReputationDelta).toBe(-50) // Revoked = -50
  })

  test('missing verifier skips PoC gracefully', async () => {
    orchestrator.setPoCVerifier(null as unknown as PoCNodeVerifier)

    const results = createMockBenchmarkResults()
    // @ts-expect-error - accessing private method
    const updatedResults = await orchestrator.runPoCVerification(TEST_AGENT_ID, results)

    // Should return unchanged
    expect(updatedResults.pocVerified).toBe(false)
    expect(updatedResults.pocReputationDelta).toBe(0)
  })

  test('missing attestation hash skips PoC gracefully', async () => {
    const results = createMockBenchmarkResults({ teeAttestationHash: null })
    // @ts-expect-error - accessing private method
    const updatedResults = await orchestrator.runPoCVerification(TEST_AGENT_ID, results)

    expect(updatedResults.pocVerified).toBe(false)
    expect(updatedResults.pocReputationDelta).toBe(0)
  })

  test('all PoC levels give correct reputation deltas', async () => {
    const levels: Array<{ level: 1 | 2 | 3; expectedDelta: number }> = [
      { level: 1, expectedDelta: 10 },
      { level: 2, expectedDelta: 15 },
      { level: 3, expectedDelta: 25 },
    ]

    for (const { level, expectedDelta } of levels) {
      // Reset verifier cache
      // @ts-expect-error - accessing private
      pocVerifier.cache.clear()

      const hardwareIdHash = quoteParser.hashHardwareId('0x' + '11'.repeat(16) as Hex, TEST_SALT)
      mockRegistry.addMockEntry({
        hardwareIdHash,
        level,
        cloudProvider: 'aws',
        region: 'us-east-1',
        evidenceHashes: [],
        endorsements: [],
        verifiedAt: Date.now() - 1000,
        lastVerifiedAt: Date.now() - 1000,
        monitoringCadence: 86400000,
        active: true,
      })

      const results = createMockBenchmarkResults()
      // @ts-expect-error - accessing private method
      const updatedResults = await orchestrator.runPoCVerification(TEST_AGENT_ID, results)

      expect(updatedResults.pocReputationDelta).toBe(expectedDelta)
    }
  })
})

