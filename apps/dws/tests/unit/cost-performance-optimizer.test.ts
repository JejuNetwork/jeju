/**
 * Tests for Cost-Performance Optimizer
 *
 * Tests the actual CostPerformanceOptimizer API:
 * - rankProviders() - ranks providers by cost-efficiency or benchmark score
 * - calculateCostPerformanceScore() - calculates price/performance ratio
 */

import { describe, expect, test } from 'bun:test'
import {
  CostPerformanceOptimizer,
  type ProviderSpec,
} from '../../api/compute/cost-performance-optimizer'

describe('Cost-Performance Optimizer', () => {
  const optimizer = new CostPerformanceOptimizer()

  const testProviders: ProviderSpec[] = [
    {
      id: 'provider-1',
      name: 'Budget Provider',
      region: 'us-east-1',
      cpuCores: 4,
      memoryMb: 8192,
      storageMb: 50000,
      pricePerHour: 0.05,
      benchmarkScore: 60,
      hasGpu: false,
      hasTee: false,
    },
    {
      id: 'provider-2',
      name: 'Mid-Range Provider',
      region: 'us-east-1',
      cpuCores: 8,
      memoryMb: 16384,
      storageMb: 100000,
      pricePerHour: 0.15,
      benchmarkScore: 75,
      hasGpu: false,
      hasTee: false,
    },
    {
      id: 'provider-3',
      name: 'High Performance',
      region: 'eu-west-1',
      cpuCores: 16,
      memoryMb: 32768,
      storageMb: 200000,
      pricePerHour: 0.4,
      benchmarkScore: 95,
      hasGpu: true,
      gpuVramMb: 24576,
      hasTee: true,
    },
    {
      id: 'provider-4',
      name: 'GPU Specialist',
      region: 'us-west-2',
      cpuCores: 8,
      memoryMb: 65536,
      storageMb: 500000,
      pricePerHour: 1.2,
      benchmarkScore: 90,
      hasGpu: true,
      gpuVramMb: 81920,
      hasTee: false,
    },
  ]

  describe('rankProviders', () => {
    test('ranks providers by benchmark score by default', async () => {
      const ranked = await optimizer.rankProviders(testProviders)

      expect(ranked.length).toBe(4)
      // Default sort is by benchmark score (higher is better)
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].benchmarkScore).toBeGreaterThanOrEqual(
          ranked[i].benchmarkScore,
        )
      }
    })

    test('ranks providers by cost-efficiency when preferCostEfficiency is true', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        preferCostEfficiency: true,
      })

      expect(ranked.length).toBe(4)
      // Cost-performance score: lower is better (price/performance)
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].costPerformanceScore).toBeLessThanOrEqual(
          ranked[i].costPerformanceScore,
        )
      }
    })

    test('filters by minimum CPU cores', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        minCpuCores: 8,
      })

      expect(ranked.length).toBe(3)
      for (const p of ranked) {
        expect(p.cpuCores).toBeGreaterThanOrEqual(8)
      }
    })

    test('filters by minimum memory', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        minMemoryMb: 20000,
      })

      expect(ranked.length).toBe(2)
      for (const p of ranked) {
        expect(p.memoryMb).toBeGreaterThanOrEqual(20000)
      }
    })

    test('filters by GPU requirement', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        requireGpu: true,
      })

      expect(ranked.length).toBe(2)
      for (const p of ranked) {
        expect(p.hasGpu).toBe(true)
      }
    })

    test('filters by minimum GPU VRAM', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        requireGpu: true,
        minGpuVramMb: 50000,
      })

      expect(ranked.length).toBe(1)
      expect(ranked[0].id).toBe('provider-4')
    })

    test('filters by TEE requirement', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        requireTee: true,
      })

      expect(ranked.length).toBe(1)
      expect(ranked[0].id).toBe('provider-3')
    })

    test('filters by maximum price', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        maxPricePerHour: 0.2,
      })

      expect(ranked.length).toBe(2)
      for (const p of ranked) {
        expect(p.pricePerHour).toBeLessThanOrEqual(0.2)
      }
    })

    test('filters by region', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        region: 'us-east-1',
      })

      expect(ranked.length).toBe(2)
      for (const p of ranked) {
        expect(p.region).toBe('us-east-1')
      }
    })

    test('filters by minimum benchmark score', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        minBenchmarkScore: 80,
      })

      expect(ranked.length).toBe(2)
      for (const p of ranked) {
        expect(p.benchmarkScore).toBeGreaterThanOrEqual(80)
      }
    })

    test('combines multiple filters', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        minCpuCores: 8,
        requireGpu: true,
        minBenchmarkScore: 85,
      })

      expect(ranked.length).toBe(2)
      expect(ranked[0].hasGpu).toBe(true)
    })

    test('returns empty array when no providers match', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        minCpuCores: 100,
      })

      expect(ranked.length).toBe(0)
    })

    test('assigns rank numbers to providers', async () => {
      const ranked = await optimizer.rankProviders(testProviders)

      ranked.forEach((p, i) => {
        expect(p.rank).toBe(i + 1)
      })
    })
  })

  describe('calculateCostPerformanceScore', () => {
    test('calculates price/performance ratio', () => {
      const score = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.1,
        benchmarkScore: 100,
      })

      expect(score).toBe(0.001) // 0.1 / 100
    })

    test('returns Infinity for zero benchmark score', () => {
      const score = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.1,
        benchmarkScore: 0,
      })

      expect(score).toBe(Infinity)
    })

    test('lower price improves score (lower is better)', () => {
      const cheapScore = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.05,
        benchmarkScore: 80,
      })

      const expensiveScore = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.5,
        benchmarkScore: 80,
      })

      expect(cheapScore).toBeLessThan(expensiveScore)
    })

    test('higher benchmark improves score (lower is better)', () => {
      const highBenchScore = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.1,
        benchmarkScore: 90,
      })

      const lowBenchScore = optimizer.calculateCostPerformanceScore({
        pricePerHour: 0.1,
        benchmarkScore: 50,
      })

      expect(highBenchScore).toBeLessThan(lowBenchScore)
    })
  })

  describe('cost-efficiency ranking', () => {
    test('ranks budget provider first when preferring cost efficiency', async () => {
      const ranked = await optimizer.rankProviders(testProviders, {
        preferCostEfficiency: true,
      })

      // Budget provider (provider-1) has best cost/performance: 0.05/60 = 0.00083
      expect(ranked[0].id).toBe('provider-1')
    })

    test('ranks high performance first when not preferring cost efficiency', async () => {
      const ranked = await optimizer.rankProviders(testProviders)

      // High performance (provider-3) has highest benchmark: 95
      expect(ranked[0].id).toBe('provider-3')
    })
  })
})
