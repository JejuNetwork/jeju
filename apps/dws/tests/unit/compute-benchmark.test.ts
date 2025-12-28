/**
 * Tests for Compute Benchmark Service
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'

// Mock EQLite before importing
const mockQuery = mock(() => Promise.resolve({ rows: [] }))
const mockExec = mock(() => Promise.resolve())

mock.module('@jejunetwork/db', () => ({
  getEQLite: () => ({
    query: mockQuery,
    exec: mockExec,
  }),
}))

// Import after mocking
const { ComputeBenchmarkService } = await import('../../api/compute/benchmark-service')

describe('Compute Benchmark Service', () => {
  let service: ComputeBenchmarkService

  beforeEach(() => {
    service = new ComputeBenchmarkService()
    mockQuery.mockClear()
    mockExec.mockClear()
  })

  describe('runCpuBenchmark', () => {
    test('runs CPU benchmark and returns results', async () => {
      const result = await service.runCpuBenchmark('node-1')

      expect(result).toHaveProperty('singleThreadScore')
      expect(result).toHaveProperty('multiThreadScore')
      expect(result).toHaveProperty('compressionScore')
      expect(typeof result.singleThreadScore).toBe('number')
      expect(typeof result.multiThreadScore).toBe('number')
    })
  })

  describe('runMemoryBenchmark', () => {
    test('runs memory benchmark and returns results', async () => {
      const result = await service.runMemoryBenchmark('node-1')

      expect(result).toHaveProperty('readBandwidthMbps')
      expect(result).toHaveProperty('writeBandwidthMbps')
      expect(result).toHaveProperty('latencyNs')
      expect(typeof result.readBandwidthMbps).toBe('number')
    })
  })

  describe('runDiskBenchmark', () => {
    test('runs disk benchmark and returns results', async () => {
      const result = await service.runDiskBenchmark('node-1')

      expect(result).toHaveProperty('seqReadMbps')
      expect(result).toHaveProperty('seqWriteMbps')
      expect(result).toHaveProperty('randReadIops')
      expect(result).toHaveProperty('randWriteIops')
      expect(typeof result.seqReadMbps).toBe('number')
    })
  })

  describe('runNetworkBenchmark', () => {
    test('runs network benchmark and returns results', async () => {
      const result = await service.runNetworkBenchmark('node-1')

      expect(result).toHaveProperty('downloadMbps')
      expect(result).toHaveProperty('uploadMbps')
      expect(result).toHaveProperty('latencyMs')
      expect(typeof result.downloadMbps).toBe('number')
    })
  })

  describe('runGpuBenchmark', () => {
    test('runs GPU benchmark and returns results', async () => {
      const result = await service.runGpuBenchmark('node-1')

      expect(result).toHaveProperty('fp32Tflops')
      expect(result).toHaveProperty('fp16Tflops')
      expect(result).toHaveProperty('memoryBandwidthGbps')
      expect(result).toHaveProperty('inferenceLatencyMs')
    })
  })

  describe('runTeeAttestation', () => {
    test('runs TEE attestation and returns results', async () => {
      const result = await service.runTeeAttestation('node-1')

      expect(result).toHaveProperty('teeType')
      expect(result).toHaveProperty('attestationHash')
      expect(result).toHaveProperty('maxEnclaveMemoryMb')
      expect(result).toHaveProperty('remoteAttestationSupported')
    })
  })

  describe('runFullBenchmark', () => {
    test('runs full benchmark suite', async () => {
      const result = await service.runFullBenchmark('node-1')

      expect(result).toHaveProperty('nodeId')
      expect(result).toHaveProperty('cpu')
      expect(result).toHaveProperty('memory')
      expect(result).toHaveProperty('disk')
      expect(result).toHaveProperty('network')
      expect(result).toHaveProperty('overallScore')
      expect(result.nodeId).toBe('node-1')
    })
  })

  describe('calculateOverallScore', () => {
    test('calculates overall score from component scores', () => {
      const score = service.calculateOverallScore({
        cpuScore: 80,
        memoryScore: 70,
        diskScore: 60,
        networkScore: 75,
        gpuScore: 90,
        teeScore: 50,
      })

      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(100)
    })

    test('handles missing GPU score', () => {
      const score = service.calculateOverallScore({
        cpuScore: 80,
        memoryScore: 70,
        diskScore: 60,
        networkScore: 75,
        gpuScore: 0,
        teeScore: 0,
      })

      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(100)
    })
  })

  describe('saveBenchmarkResult', () => {
    test('saves benchmark result to database', async () => {
      await service.saveBenchmarkResult('node-1', {
        nodeId: 'node-1',
        cpu: {
          singleThreadScore: 1000,
          multiThreadScore: 8000,
          compressionScore: 500,
        },
        memory: {
          readBandwidthMbps: 50000,
          writeBandwidthMbps: 40000,
          latencyNs: 80,
        },
        disk: {
          seqReadMbps: 3000,
          seqWriteMbps: 2500,
          randReadIops: 100000,
          randWriteIops: 80000,
        },
        network: {
          downloadMbps: 10000,
          uploadMbps: 10000,
          latencyMs: 5,
        },
        overallScore: 85,
        timestamp: Date.now(),
      })

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('getBenchmarkResult', () => {
    test('returns benchmark result from database', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [{
          node_id: 'node-1',
          cpu_single_thread_score: 1000,
          cpu_multi_thread_score: 8000,
          cpu_compression_score: 500,
          memory_read_bandwidth_mbps: 50000,
          memory_write_bandwidth_mbps: 40000,
          memory_latency_ns: 80,
          disk_seq_read_mbps: 3000,
          disk_seq_write_mbps: 2500,
          disk_rand_read_iops: 100000,
          disk_rand_write_iops: 80000,
          network_download_mbps: 10000,
          network_upload_mbps: 10000,
          network_latency_ms: 5,
          overall_score: 85,
          timestamp: now,
        }],
      })

      const result = await service.getBenchmarkResult('node-1')

      expect(result).not.toBeNull()
      expect(result?.nodeId).toBe('node-1')
      expect(result?.overallScore).toBe(85)
    })

    test('returns null for non-existent node', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.getBenchmarkResult('node-999')

      expect(result).toBeNull()
    })
  })

  describe('getTopNodes', () => {
    test('returns top nodes by score', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { node_id: 'node-1', overall_score: 95 },
          { node_id: 'node-2', overall_score: 90 },
          { node_id: 'node-3', overall_score: 85 },
        ],
      })

      const nodes = await service.getTopNodes(3)

      expect(nodes).toHaveLength(3)
      expect(nodes[0].nodeId).toBe('node-1')
      expect(nodes[0].score).toBe(95)
    })
  })

  describe('getNodesWithGpu', () => {
    test('returns nodes with GPU capability', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { node_id: 'node-1', gpu_model: 'NVIDIA H100', gpu_vram_mb: 80000 },
          { node_id: 'node-2', gpu_model: 'NVIDIA A100', gpu_vram_mb: 40000 },
        ],
      })

      const nodes = await service.getNodesWithGpu()

      expect(nodes).toHaveLength(2)
      expect(nodes[0].gpuModel).toBe('NVIDIA H100')
    })
  })

  describe('getNodesWithTee', () => {
    test('returns nodes with TEE capability', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { node_id: 'node-1', tee_type: 'IntelSGX', attestation_hash: '0x123' },
          { node_id: 'node-2', tee_type: 'AMDSEV', attestation_hash: '0x456' },
        ],
      })

      const nodes = await service.getNodesWithTee()

      expect(nodes).toHaveLength(2)
      expect(nodes[0].teeType).toBe('IntelSGX')
    })
  })
})
