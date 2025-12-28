/**
 * Tests for Cost-Performance Optimizer
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
const { CostPerformanceOptimizer } = await import('../../api/compute/cost-performance-optimizer')

describe('Cost-Performance Optimizer', () => {
  let optimizer: CostPerformanceOptimizer

  beforeEach(() => {
    optimizer = new CostPerformanceOptimizer()
    mockQuery.mockClear()
    mockExec.mockClear()
  })

  describe('rankProviders', () => {
    test('ranks providers by cost efficiency', async () => {
      const providers = [
        {
          id: 'provider-1',
          name: 'High Cost',
          pricePerHour: 0.50,
          benchmarkScore: 80,
          cpuCores: 4,
          memoryMb: 8192,
          hasGpu: false,
          hasTee: false,
        },
        {
          id: 'provider-2',
          name: 'Best Value',
          pricePerHour: 0.20,
          benchmarkScore: 85,
          cpuCores: 4,
          memoryMb: 8192,
          hasGpu: false,
          hasTee: false,
        },
        {
          id: 'provider-3',
          name: 'Budget Option',
          pricePerHour: 0.10,
          benchmarkScore: 60,
          cpuCores: 2,
          memoryMb: 4096,
          hasGpu: false,
          hasTee: false,
        },
      ]

      const ranked = await optimizer.rankProviders(providers, {
        minCpuCores: 2,
        minMemoryMb: 4096,
        preferCostEfficiency: true,
      })

      expect(ranked).toHaveLength(3)
      // Best value should be ranked first (best score per dollar)
      expect(ranked[0].id).toBe('provider-2')
    })

    test('filters by minimum requirements', async () => {
      const providers = [
        {
          id: 'provider-1',
          name: 'Small',
          pricePerHour: 0.10,
          benchmarkScore: 50,
          cpuCores: 1,
          memoryMb: 1024,
          hasGpu: false,
          hasTee: false,
        },
        {
          id: 'provider-2',
          name: 'Medium',
          pricePerHour: 0.20,
          benchmarkScore: 70,
          cpuCores: 4,
          memoryMb: 8192,
          hasGpu: false,
          hasTee: false,
        },
      ]

      const ranked = await optimizer.rankProviders(providers, {
        minCpuCores: 4,
        minMemoryMb: 8192,
      })

      expect(ranked).toHaveLength(1)
      expect(ranked[0].id).toBe('provider-2')
    })

    test('filters by GPU requirement', async () => {
      const providers = [
        {
          id: 'provider-1',
          name: 'No GPU',
          pricePerHour: 0.20,
          benchmarkScore: 80,
          cpuCores: 4,
          memoryMb: 8192,
          hasGpu: false,
          hasTee: false,
        },
        {
          id: 'provider-2',
          name: 'With GPU',
          pricePerHour: 1.00,
          benchmarkScore: 95,
          cpuCores: 8,
          memoryMb: 32768,
          hasGpu: true,
          gpuModel: 'NVIDIA A100',
          gpuVramMb: 40960,
          hasTee: false,
        },
      ]

      const ranked = await optimizer.rankProviders(providers, {
        requireGpu: true,
        minGpuVramMb: 40000,
      })

      expect(ranked).toHaveLength(1)
      expect(ranked[0].id).toBe('provider-2')
    })

    test('filters by TEE requirement', async () => {
      const providers = [
        {
          id: 'provider-1',
          name: 'No TEE',
          pricePerHour: 0.20,
          benchmarkScore: 80,
          cpuCores: 4,
          memoryMb: 8192,
          hasGpu: false,
          hasTee: false,
        },
        {
          id: 'provider-2',
          name: 'With TEE',
          pricePerHour: 0.30,
          benchmarkScore: 75,
          cpuCores: 4,
          memoryMb: 8192,
          hasGpu: false,
          hasTee: true,
          teeType: 'IntelSGX',
        },
      ]

      const ranked = await optimizer.rankProviders(providers, {
        requireTee: true,
      })

      expect(ranked).toHaveLength(1)
      expect(ranked[0].id).toBe('provider-2')
    })
  })

  describe('calculateCostPerformanceScore', () => {
    test('calculates cost per performance unit', () => {
      const score = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.50,
        benchmarkScore: 100,
      })

      expect(score).toBe(0.005) // $0.50 / 100 = $0.005 per score unit
    })

    test('handles zero benchmark score', () => {
      const score = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.50,
        benchmarkScore: 0,
      })

      expect(score).toBe(Infinity)
    })
  })

  describe('findOptimalProvider', () => {
    test('finds the most cost-efficient provider meeting requirements', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'provider-1',
            name: 'Expensive',
            price_per_hour: 1.00,
            benchmark_score: 90,
            cpu_cores: 8,
            memory_mb: 16384,
            has_gpu: 0,
            has_tee: 0,
          },
          {
            id: 'provider-2',
            name: 'Best',
            price_per_hour: 0.25,
            benchmark_score: 85,
            cpu_cores: 4,
            memory_mb: 8192,
            has_gpu: 0,
            has_tee: 0,
          },
          {
            id: 'provider-3',
            name: 'Cheap',
            price_per_hour: 0.10,
            benchmark_score: 40,
            cpu_cores: 2,
            memory_mb: 4096,
            has_gpu: 0,
            has_tee: 0,
          },
        ],
      })

      const optimal = await optimizer.findOptimalProvider({
        minCpuCores: 4,
        minMemoryMb: 8192,
        minBenchmarkScore: 80,
      })

      expect(optimal).not.toBeNull()
      expect(optimal?.id).toBe('provider-2')
    })

    test('returns null when no provider meets requirements', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'provider-1',
            name: 'Small',
            price_per_hour: 0.10,
            benchmark_score: 50,
            cpu_cores: 2,
            memory_mb: 4096,
            has_gpu: 0,
            has_tee: 0,
          },
        ],
      })

      const optimal = await optimizer.findOptimalProvider({
        minCpuCores: 8,
        minMemoryMb: 32768,
        minBenchmarkScore: 90,
      })

      expect(optimal).toBeNull()
    })
  })

  describe('estimateCost', () => {
    test('estimates hourly cost', () => {
      const cost = optimizer.estimateCost({
        pricePerHour: 0.50,
        durationHours: 24,
      })

      expect(cost).toBe(12.0)
    })

    test('estimates monthly cost', () => {
      const cost = optimizer.estimateCost({
        pricePerHour: 0.50,
        durationHours: 24 * 30,
      })

      expect(cost).toBe(360.0)
    })
  })

  describe('compareCosts', () => {
    test('compares costs between providers', () => {
      const comparison = optimizer.compareCosts([
        { id: 'provider-1', pricePerHour: 0.50, benchmarkScore: 80 },
        { id: 'provider-2', pricePerHour: 0.30, benchmarkScore: 75 },
        { id: 'provider-3', pricePerHour: 0.20, benchmarkScore: 60 },
      ], 720) // 30 days

      expect(comparison).toHaveLength(3)
      expect(comparison[0].totalCost).toBe(360)
      expect(comparison[1].totalCost).toBe(216)
      expect(comparison[2].totalCost).toBe(144)
    })
  })

  describe('getRecommendation', () => {
    test('recommends best provider for workload type', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'gpu-provider',
            name: 'GPU Instance',
            price_per_hour: 2.00,
            benchmark_score: 95,
            cpu_cores: 8,
            memory_mb: 32768,
            has_gpu: 1,
            gpu_model: 'NVIDIA A100',
            has_tee: 0,
          },
          {
            id: 'cpu-provider',
            name: 'CPU Instance',
            price_per_hour: 0.30,
            benchmark_score: 80,
            cpu_cores: 8,
            memory_mb: 16384,
            has_gpu: 0,
            has_tee: 0,
          },
        ],
      })

      const recommendation = await optimizer.getRecommendation({
        workloadType: 'ml-inference',
        expectedDurationHours: 24,
        budget: 100,
      })

      expect(recommendation).not.toBeNull()
      expect(recommendation?.providerId).toBe('gpu-provider')
    })

    test('recommends cheapest option for simple workloads', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'expensive',
            name: 'Large',
            price_per_hour: 1.00,
            benchmark_score: 90,
            cpu_cores: 16,
            memory_mb: 65536,
            has_gpu: 0,
            has_tee: 0,
          },
          {
            id: 'budget',
            name: 'Small',
            price_per_hour: 0.05,
            benchmark_score: 50,
            cpu_cores: 1,
            memory_mb: 1024,
            has_gpu: 0,
            has_tee: 0,
          },
        ],
      })

      const recommendation = await optimizer.getRecommendation({
        workloadType: 'web-hosting',
        expectedDurationHours: 720,
        budget: 50,
      })

      expect(recommendation).not.toBeNull()
      expect(recommendation?.providerId).toBe('budget')
      expect(recommendation?.estimatedCost).toBe(36) // 0.05 * 720
    })
  })
})
