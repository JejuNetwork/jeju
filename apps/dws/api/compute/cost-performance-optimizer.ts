/**
 * Cost-Performance Optimizer
 *
 * Selects optimal compute providers based on:
 * - Cost per performance unit
 * - Benchmark scores
 * - Required capabilities (GPU, TEE, memory)
 * - Geographic requirements
 * - Budget constraints
 */

import { type EQLiteClient, getEQLite } from '@jejunetwork/db'

// ============ Types ============

export interface ProviderSpec {
  id: string
  name: string
  pricePerHour: number
  benchmarkScore: number
  cpuCores: number
  memoryMb: number
  hasGpu: boolean
  gpuModel?: string
  gpuVramMb?: number
  hasTee: boolean
  teeType?: string
  region?: string
  provider?: string
}

export interface RequirementFilter {
  minCpuCores?: number
  minMemoryMb?: number
  minBenchmarkScore?: number
  requireGpu?: boolean
  minGpuVramMb?: number
  requireTee?: boolean
  maxPricePerHour?: number
  region?: string
  preferCostEfficiency?: boolean
}

export interface RankedProvider extends ProviderSpec {
  costPerformanceScore: number // Lower is better (cost per score unit)
  rank: number
}

export interface CostComparison {
  id: string
  pricePerHour: number
  totalCost: number
  benchmarkScore: number
  costPerScore: number
}

export interface Recommendation {
  providerId: string
  providerName: string
  estimatedCost: number
  benchmarkScore: number
  matchScore: number // How well it matches requirements (0-100)
  reason: string
}

// ============ Database ============

const OPTIMIZER_DATABASE_ID = 'dws-optimizer'
let eqliteClient: EQLiteClient | null = null

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite()
    await ensureOptimizerTables()
  }
  return eqliteClient
}

async function ensureOptimizerTables(): Promise<void> {
  if (!eqliteClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS provider_specs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_per_hour REAL NOT NULL,
      benchmark_score INTEGER NOT NULL,
      cpu_cores INTEGER NOT NULL,
      memory_mb INTEGER NOT NULL,
      has_gpu INTEGER DEFAULT 0,
      gpu_model TEXT,
      gpu_vram_mb INTEGER,
      has_tee INTEGER DEFAULT 0,
      tee_type TEXT,
      region TEXT,
      provider TEXT,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS optimization_history (
      id TEXT PRIMARY KEY,
      workload_type TEXT NOT NULL,
      requirements TEXT NOT NULL,
      selected_provider TEXT,
      estimated_cost REAL,
      created_at INTEGER NOT NULL
    )`,
  ]

  for (const ddl of tables) {
    await eqliteClient.exec(ddl, [], OPTIMIZER_DATABASE_ID)
  }

  console.log('[CostOptimizer] EQLite tables ensured')
}

// ============ Main Service ============

export class CostPerformanceOptimizer {
  /**
   * Rank providers by cost-efficiency
   */
  async rankProviders(
    providers: ProviderSpec[],
    requirements: RequirementFilter = {},
  ): Promise<RankedProvider[]> {
    // Filter providers by requirements
    const filtered = providers.filter((p) => {
      if (requirements.minCpuCores && p.cpuCores < requirements.minCpuCores) {
        return false
      }
      if (requirements.minMemoryMb && p.memoryMb < requirements.minMemoryMb) {
        return false
      }
      if (
        requirements.minBenchmarkScore &&
        p.benchmarkScore < requirements.minBenchmarkScore
      ) {
        return false
      }
      if (requirements.requireGpu && !p.hasGpu) {
        return false
      }
      if (
        requirements.minGpuVramMb &&
        (!p.gpuVramMb || p.gpuVramMb < requirements.minGpuVramMb)
      ) {
        return false
      }
      if (requirements.requireTee && !p.hasTee) {
        return false
      }
      if (
        requirements.maxPricePerHour &&
        p.pricePerHour > requirements.maxPricePerHour
      ) {
        return false
      }
      if (requirements.region && p.region !== requirements.region) {
        return false
      }
      return true
    })

    // Calculate cost-performance score for each
    const ranked: RankedProvider[] = filtered.map((p) => ({
      ...p,
      costPerformanceScore: this.calculateCostPerformanceScore({
        pricePerHour: p.pricePerHour,
        benchmarkScore: p.benchmarkScore,
      }),
      rank: 0,
    }))

    // Sort by cost-performance score (lower is better = more cost efficient)
    if (requirements.preferCostEfficiency) {
      ranked.sort((a, b) => a.costPerformanceScore - b.costPerformanceScore)
    } else {
      // Sort by benchmark score (higher is better)
      ranked.sort((a, b) => b.benchmarkScore - a.benchmarkScore)
    }

    // Assign ranks
    ranked.forEach((p, i) => {
      p.rank = i + 1
    })

    return ranked
  }

  /**
   * Calculate cost per performance unit
   */
  calculateCostPerformanceScore(params: {
    pricePerHour: number
    benchmarkScore: number
  }): number {
    if (params.benchmarkScore <= 0) {
      return Infinity
    }
    return params.pricePerHour / params.benchmarkScore
  }

  /**
   * Find the optimal provider from the database
   */
  async findOptimalProvider(
    requirements: RequirementFilter,
  ): Promise<ProviderSpec | null> {
    const client = await getEQLiteClient()

    const result = await client.query<{
      id: string
      name: string
      price_per_hour: number
      benchmark_score: number
      cpu_cores: number
      memory_mb: number
      has_gpu: number
      gpu_model: string | null
      gpu_vram_mb: number | null
      has_tee: number
      tee_type: string | null
      region: string | null
      provider: string | null
    }>(
      'SELECT * FROM provider_specs ORDER BY (price_per_hour / benchmark_score) ASC',
      [],
      OPTIMIZER_DATABASE_ID,
    )

    const providers: ProviderSpec[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      pricePerHour: row.price_per_hour,
      benchmarkScore: row.benchmark_score,
      cpuCores: row.cpu_cores,
      memoryMb: row.memory_mb,
      hasGpu: row.has_gpu === 1,
      gpuModel: row.gpu_model ?? undefined,
      gpuVramMb: row.gpu_vram_mb ?? undefined,
      hasTee: row.has_tee === 1,
      teeType: row.tee_type ?? undefined,
      region: row.region ?? undefined,
      provider: row.provider ?? undefined,
    }))

    const ranked = await this.rankProviders(providers, {
      ...requirements,
      preferCostEfficiency: true,
    })

    return ranked.length > 0 ? ranked[0] : null
  }

  /**
   * Estimate cost for a duration
   */
  estimateCost(params: {
    pricePerHour: number
    durationHours: number
  }): number {
    return params.pricePerHour * params.durationHours
  }

  /**
   * Compare costs between multiple providers
   */
  compareCosts(
    providers: Array<{
      id: string
      pricePerHour: number
      benchmarkScore: number
    }>,
    durationHours: number,
  ): CostComparison[] {
    return providers.map((p) => ({
      id: p.id,
      pricePerHour: p.pricePerHour,
      totalCost: this.estimateCost({
        pricePerHour: p.pricePerHour,
        durationHours,
      }),
      benchmarkScore: p.benchmarkScore,
      costPerScore: this.calculateCostPerformanceScore({
        pricePerHour: p.pricePerHour,
        benchmarkScore: p.benchmarkScore,
      }),
    }))
  }

  /**
   * Get a recommendation for a workload type
   */
  async getRecommendation(params: {
    workloadType:
      | 'web-hosting'
      | 'ml-inference'
      | 'ml-training'
      | 'database'
      | 'general'
    expectedDurationHours: number
    budget: number
  }): Promise<Recommendation | null> {
    const client = await getEQLiteClient()

    // Define requirements based on workload type
    let requirements: RequirementFilter = {}
    let sortColumn = 'price_per_hour / benchmark_score'

    switch (params.workloadType) {
      case 'ml-inference':
        requirements = { requireGpu: true, minBenchmarkScore: 50 }
        sortColumn = 'benchmark_score DESC'
        break
      case 'ml-training':
        requirements = {
          requireGpu: true,
          minGpuVramMb: 16000,
          minBenchmarkScore: 70,
        }
        sortColumn = 'benchmark_score DESC'
        break
      case 'database':
        requirements = { minMemoryMb: 8192, minCpuCores: 4 }
        break
      case 'web-hosting':
        requirements = {
          maxPricePerHour: params.budget / params.expectedDurationHours,
        }
        break
      default:
        break
    }

    const result = await client.query<{
      id: string
      name: string
      price_per_hour: number
      benchmark_score: number
      cpu_cores: number
      memory_mb: number
      has_gpu: number
    }>(
      `SELECT * FROM provider_specs ORDER BY ${sortColumn} LIMIT 10`,
      [],
      OPTIMIZER_DATABASE_ID,
    )

    const providers: ProviderSpec[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      pricePerHour: row.price_per_hour,
      benchmarkScore: row.benchmark_score,
      cpuCores: row.cpu_cores,
      memoryMb: row.memory_mb,
      hasGpu: row.has_gpu === 1,
      hasTee: false,
    }))

    const ranked = await this.rankProviders(providers, requirements)

    // Find best option within budget
    for (const provider of ranked) {
      const estimatedCost = this.estimateCost({
        pricePerHour: provider.pricePerHour,
        durationHours: params.expectedDurationHours,
      })

      if (estimatedCost <= params.budget) {
        // Calculate match score
        let matchScore = 50 // Base score
        if (provider.benchmarkScore >= 80) matchScore += 20
        if (provider.hasGpu && params.workloadType.includes('ml'))
          matchScore += 20
        if (estimatedCost < params.budget * 0.5) matchScore += 10

        return {
          providerId: provider.id,
          providerName: provider.name,
          estimatedCost,
          benchmarkScore: provider.benchmarkScore,
          matchScore: Math.min(100, matchScore),
          reason: `Best cost-efficient option for ${params.workloadType}`,
        }
      }
    }

    return null
  }

  /**
   * Save provider specs to database
   */
  async saveProviderSpec(spec: ProviderSpec): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    await client.exec(
      `INSERT INTO provider_specs (id, name, price_per_hour, benchmark_score, cpu_cores, memory_mb, has_gpu, gpu_model, gpu_vram_mb, has_tee, tee_type, region, provider, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = ?, price_per_hour = ?, benchmark_score = ?, cpu_cores = ?, memory_mb = ?,
         has_gpu = ?, gpu_model = ?, gpu_vram_mb = ?, has_tee = ?, tee_type = ?,
         region = ?, provider = ?, updated_at = ?`,
      [
        spec.id,
        spec.name,
        spec.pricePerHour,
        spec.benchmarkScore,
        spec.cpuCores,
        spec.memoryMb,
        spec.hasGpu ? 1 : 0,
        spec.gpuModel ?? null,
        spec.gpuVramMb ?? null,
        spec.hasTee ? 1 : 0,
        spec.teeType ?? null,
        spec.region ?? null,
        spec.provider ?? null,
        now,
        // Update values
        spec.name,
        spec.pricePerHour,
        spec.benchmarkScore,
        spec.cpuCores,
        spec.memoryMb,
        spec.hasGpu ? 1 : 0,
        spec.gpuModel ?? null,
        spec.gpuVramMb ?? null,
        spec.hasTee ? 1 : 0,
        spec.teeType ?? null,
        spec.region ?? null,
        spec.provider ?? null,
        now,
      ],
      OPTIMIZER_DATABASE_ID,
    )
  }

  /**
   * Get all provider specs from database
   */
  async getAllProviderSpecs(): Promise<ProviderSpec[]> {
    const client = await getEQLiteClient()

    const result = await client.query<{
      id: string
      name: string
      price_per_hour: number
      benchmark_score: number
      cpu_cores: number
      memory_mb: number
      has_gpu: number
      gpu_model: string | null
      gpu_vram_mb: number | null
      has_tee: number
      tee_type: string | null
      region: string | null
      provider: string | null
    }>('SELECT * FROM provider_specs', [], OPTIMIZER_DATABASE_ID)

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      pricePerHour: row.price_per_hour,
      benchmarkScore: row.benchmark_score,
      cpuCores: row.cpu_cores,
      memoryMb: row.memory_mb,
      hasGpu: row.has_gpu === 1,
      gpuModel: row.gpu_model ?? undefined,
      gpuVramMb: row.gpu_vram_mb ?? undefined,
      hasTee: row.has_tee === 1,
      teeType: row.tee_type ?? undefined,
      region: row.region ?? undefined,
      provider: row.provider ?? undefined,
    }))
  }
}

// ============ Singleton ============

let optimizer: CostPerformanceOptimizer | null = null

export function getCostPerformanceOptimizer(): CostPerformanceOptimizer {
  if (!optimizer) {
    optimizer = new CostPerformanceOptimizer()
  }
  return optimizer
}
