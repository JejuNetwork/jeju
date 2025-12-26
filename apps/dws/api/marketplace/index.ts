/**
 * Marketplace Matching Engine
 *
 * Matches compute/storage/CDN jobs to providers based on:
 * - Price
 * - SLA requirements
 * - Geographic preferences
 * - Provider reputation
 * - Availability
 *
 * Implements:
 * - Job queue management
 * - Provider matching
 * - SLA enforcement
 * - Dispute resolution
 */

import type { Address } from 'viem'

// ============================================================================
// Types
// ============================================================================

export interface Job {
  id: string
  type: 'compute' | 'storage' | 'cdn' | 'function'
  requester: Address
  requirements: JobRequirements
  budget: bigint
  deadline: number
  status: 'pending' | 'matched' | 'active' | 'completed' | 'disputed' | 'failed'
  provider?: Address
  matchedAt?: number
  completedAt?: number
  result?: JobResult
  createdAt: number
}

export interface JobRequirements {
  // Compute requirements
  cpuCores?: number
  memoryGb?: number
  gpuType?: string
  gpuCount?: number
  storageGb?: number

  // Geographic requirements
  regions?: string[]
  maxLatencyMs?: number

  // SLA requirements
  uptimeSla?: number // 0-100%
  maxResponseTimeMs?: number

  // TEE requirements
  teeRequired?: boolean
  teeProvider?: 'gramine' | 'sev' | 'tdx'

  // Duration
  durationSeconds?: number

  // Custom requirements
  custom?: Record<string, unknown>
}

export interface JobResult {
  success: boolean
  output?: string
  metrics?: {
    actualCpuMs?: number
    actualMemoryMb?: number
    actualStorageBytes?: number
    actualBandwidthBytes?: number
  }
  error?: string
}

export interface Provider {
  address: Address
  agentId: bigint
  capabilities: ProviderCapabilities
  pricing: ProviderPricing
  reputation: ProviderReputation
  status: 'active' | 'paused' | 'offline'
  regions: string[]
  lastSeen: number
}

export interface ProviderCapabilities {
  compute: boolean
  storage: boolean
  cdn: boolean
  functions: boolean

  // Compute specs
  cpuCores?: number
  memoryGb?: number
  gpuType?: string
  gpuCount?: number
  storageGb?: number

  // TEE
  teeProvider?: 'gramine' | 'sev' | 'tdx'

  // Bandwidth
  bandwidthMbps?: number
}

export interface ProviderPricing {
  cpuPerHour: bigint // wei per core per hour
  memoryPerHour: bigint // wei per GB per hour
  gpuPerHour: bigint // wei per GPU per hour
  storagePerMonth: bigint // wei per GB per month
  bandwidthPerGb: bigint // wei per GB
  functionInvocation: bigint // wei per invocation
}

export interface ProviderReputation {
  score: number // 0-100
  totalJobs: number
  completedJobs: number
  disputedJobs: number
  averageResponseTime: number
  uptimePercent: number
}

export interface Match {
  jobId: string
  providerId: Address
  score: number
  estimatedCost: bigint
  estimatedDuration: number
}

export interface SLAViolation {
  jobId: string
  providerId: Address
  type: 'uptime' | 'latency' | 'completion' | 'quality'
  details: string
  timestamp: number
  resolved: boolean
}

// ============================================================================
// Marketplace Engine
// ============================================================================

export class MarketplaceEngine {
  private jobs: Map<string, Job> = new Map()
  private providers: Map<string, Provider> = new Map()
  private slaViolations: Map<string, SLAViolation[]> = new Map()
  private matchingInterval: ReturnType<typeof setInterval> | null = null
  private slaCheckInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Start the matching engine
   */
  start(): void {
    console.log(`[Marketplace] Starting matching engine...`)

    // Run matching every 5 seconds
    this.matchingInterval = setInterval(() => {
      this.runMatching().catch(console.error)
    }, 5000)

    // Check SLAs every minute
    this.slaCheckInterval = setInterval(() => {
      this.checkSLAs().catch(console.error)
    }, 60000)

    console.log(`[Marketplace] Matching engine started`)
  }

  /**
   * Stop the matching engine
   */
  stop(): void {
    if (this.matchingInterval) {
      clearInterval(this.matchingInterval)
      this.matchingInterval = null
    }
    if (this.slaCheckInterval) {
      clearInterval(this.slaCheckInterval)
      this.slaCheckInterval = null
    }
    console.log(`[Marketplace] Matching engine stopped`)
  }

  // ============================================================================
  // Job Management
  // ============================================================================

  /**
   * Submit a new job
   */
  submitJob(
    type: Job['type'],
    requester: Address,
    requirements: JobRequirements,
    budget: bigint,
    deadline: number,
  ): Job {
    const id = crypto.randomUUID()

    const job: Job = {
      id,
      type,
      requester,
      requirements,
      budget,
      deadline,
      status: 'pending',
      createdAt: Date.now(),
    }

    this.jobs.set(id, job)
    console.log(`[Marketplace] Job submitted: ${id} (${type})`)

    return job
  }

  /**
   * Get job status
   */
  getJob(id: string): Job | null {
    return this.jobs.get(id) ?? null
  }

  /**
   * List jobs for a requester
   */
  listJobs(requester?: Address, status?: Job['status']): Job[] {
    return Array.from(this.jobs.values()).filter((job) => {
      if (requester && job.requester !== requester) return false
      if (status && job.status !== status) return false
      return true
    })
  }

  /**
   * Cancel a job
   */
  cancelJob(id: string, requester: Address): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    if (job.requester !== requester) return false
    if (job.status !== 'pending' && job.status !== 'matched') return false

    job.status = 'failed'
    console.log(`[Marketplace] Job cancelled: ${id}`)
    return true
  }

  /**
   * Complete a job
   */
  completeJob(id: string, provider: Address, result: JobResult): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    if (job.provider !== provider) return false
    if (job.status !== 'active') return false

    job.status = result.success ? 'completed' : 'failed'
    job.completedAt = Date.now()
    job.result = result

    // Update provider stats
    const providerData = this.providers.get(provider)
    if (providerData) {
      providerData.reputation.totalJobs++
      if (result.success) {
        providerData.reputation.completedJobs++
      }
      this.updateReputationScore(providerData)
    }

    console.log(
      `[Marketplace] Job completed: ${id} (success: ${result.success})`,
    )
    return true
  }

  // ============================================================================
  // Provider Management
  // ============================================================================

  /**
   * Register or update a provider
   */
  registerProvider(
    address: Address,
    agentId: bigint,
    capabilities: ProviderCapabilities,
    pricing: ProviderPricing,
    regions: string[],
  ): Provider {
    const existing = this.providers.get(address)

    const provider: Provider = {
      address,
      agentId,
      capabilities,
      pricing,
      regions,
      status: 'active',
      lastSeen: Date.now(),
      reputation: existing?.reputation ?? {
        score: 50,
        totalJobs: 0,
        completedJobs: 0,
        disputedJobs: 0,
        averageResponseTime: 0,
        uptimePercent: 100,
      },
    }

    this.providers.set(address, provider)
    console.log(`[Marketplace] Provider registered: ${address}`)

    return provider
  }

  /**
   * Update provider status
   */
  updateProviderStatus(address: Address, status: Provider['status']): boolean {
    const provider = this.providers.get(address)
    if (!provider) return false

    provider.status = status
    provider.lastSeen = Date.now()
    return true
  }

  /**
   * Get provider info
   */
  getProvider(address: Address): Provider | null {
    return this.providers.get(address) ?? null
  }

  /**
   * List providers
   */
  listProviders(filters?: {
    type?: keyof ProviderCapabilities
    region?: string
    minScore?: number
    status?: Provider['status']
  }): Provider[] {
    return Array.from(this.providers.values()).filter((provider) => {
      if (filters?.status && provider.status !== filters.status) return false
      if (filters?.type && !provider.capabilities[filters.type]) return false
      if (filters?.region && !provider.regions.includes(filters.region))
        return false
      if (filters?.minScore && provider.reputation.score < filters.minScore)
        return false
      return true
    })
  }

  // ============================================================================
  // Matching Algorithm
  // ============================================================================

  /**
   * Run the matching algorithm
   */
  private async runMatching(): Promise<void> {
    const pendingJobs = Array.from(this.jobs.values()).filter(
      (job) => job.status === 'pending' && job.deadline > Date.now(),
    )

    for (const job of pendingJobs) {
      const matches = this.findMatches(job)

      if (matches.length > 0) {
        // Select best match
        const bestMatch = matches[0]
        await this.assignJob(job, bestMatch)
      }
    }
  }

  /**
   * Find matching providers for a job
   */
  findMatches(job: Job): Match[] {
    const candidates = this.providers.values()
    const matches: Match[] = []

    for (const provider of candidates) {
      if (provider.status !== 'active') continue
      if (!this.meetsRequirements(provider, job.requirements)) continue

      const score = this.calculateMatchScore(provider, job)
      const estimatedCost = this.estimateCost(provider, job)

      if (estimatedCost <= job.budget) {
        matches.push({
          jobId: job.id,
          providerId: provider.address,
          score,
          estimatedCost,
          estimatedDuration: job.requirements.durationSeconds ?? 3600,
        })
      }
    }

    // Sort by score (descending)
    return matches.sort((a, b) => b.score - a.score)
  }

  /**
   * Check if provider meets job requirements
   */
  private meetsRequirements(
    provider: Provider,
    requirements: JobRequirements,
  ): boolean {
    const caps = provider.capabilities

    // Check compute requirements
    if (
      requirements.cpuCores &&
      (!caps.cpuCores || caps.cpuCores < requirements.cpuCores)
    ) {
      return false
    }
    if (
      requirements.memoryGb &&
      (!caps.memoryGb || caps.memoryGb < requirements.memoryGb)
    ) {
      return false
    }
    if (requirements.gpuType && caps.gpuType !== requirements.gpuType) {
      return false
    }
    if (
      requirements.gpuCount &&
      (!caps.gpuCount || caps.gpuCount < requirements.gpuCount)
    ) {
      return false
    }
    if (
      requirements.storageGb &&
      (!caps.storageGb || caps.storageGb < requirements.storageGb)
    ) {
      return false
    }

    // Check TEE requirements
    if (requirements.teeRequired && !caps.teeProvider) {
      return false
    }
    if (
      requirements.teeProvider &&
      caps.teeProvider !== requirements.teeProvider
    ) {
      return false
    }

    // Check region requirements
    if (requirements.regions && requirements.regions.length > 0) {
      const hasRegion = requirements.regions.some((r) =>
        provider.regions.includes(r),
      )
      if (!hasRegion) return false
    }

    // Check SLA requirements
    if (
      requirements.uptimeSla &&
      provider.reputation.uptimePercent < requirements.uptimeSla
    ) {
      return false
    }

    return true
  }

  /**
   * Calculate match score
   */
  private calculateMatchScore(provider: Provider, job: Job): number {
    let score = 0

    // Base reputation score (40%)
    score += provider.reputation.score * 0.4

    // Price efficiency (30%)
    const cost = this.estimateCost(provider, job)
    const costRatio = Number(cost) / Number(job.budget)
    const priceScore = Math.max(0, 100 - costRatio * 100)
    score += priceScore * 0.3

    // Region match bonus (15%)
    if (job.requirements.regions) {
      const regionMatch = job.requirements.regions.some((r) =>
        provider.regions.includes(r),
      )
      if (regionMatch) score += 15
    }

    // Uptime bonus (15%)
    score += (provider.reputation.uptimePercent / 100) * 15

    return Math.round(score)
  }

  /**
   * Estimate job cost
   */
  private estimateCost(provider: Provider, job: Job): bigint {
    const pricing = provider.pricing
    const reqs = job.requirements
    const hours = BigInt(Math.ceil((reqs.durationSeconds ?? 3600) / 3600))

    let cost = BigInt(0)

    if (reqs.cpuCores) {
      cost += pricing.cpuPerHour * BigInt(reqs.cpuCores) * hours
    }
    if (reqs.memoryGb) {
      cost += pricing.memoryPerHour * BigInt(reqs.memoryGb) * hours
    }
    if (reqs.gpuCount) {
      cost += pricing.gpuPerHour * BigInt(reqs.gpuCount) * hours
    }

    return cost
  }

  /**
   * Assign job to provider
   *
   * In production, this triggers:
   * 1. On-chain escrow deposit
   * 2. Provider notification via P2P
   * 3. Provider acceptance transaction
   *
   * Job transitions: pending -> matched -> active
   * The matched->active transition requires provider confirmation.
   */
  private async assignJob(job: Job, match: Match): Promise<void> {
    job.provider = match.providerId
    job.matchedAt = Date.now()
    job.status = 'matched'

    console.log(
      `[Marketplace] Job ${job.id} matched to provider ${match.providerId}`,
    )

    // In development mode, auto-accept for testing
    // In production, this waits for provider's acceptJob() call
    if (process.env.NODE_ENV !== 'production') {
      // Schedule acceptance check - provider has 60s to accept
      const acceptanceTimeout = 60000
      const checkInterval = setInterval(() => {
        const currentJob = this.jobs.get(job.id)
        if (!currentJob || currentJob.status !== 'matched') {
          clearInterval(checkInterval)
          return
        }

        // For dev: auto-accept
        currentJob.status = 'active'
        console.log(`[Marketplace] Job ${job.id} activated (dev auto-accept)`)
        clearInterval(checkInterval)
      }, 1000)

      // Timeout after 60s if not accepted
      setTimeout(() => {
        clearInterval(checkInterval)
        const currentJob = this.jobs.get(job.id)
        if (currentJob?.status === 'matched') {
          currentJob.status = 'pending' // Return to queue
          currentJob.provider = undefined
          console.log(
            `[Marketplace] Job ${job.id} returned to queue - provider timeout`,
          )
        }
      }, acceptanceTimeout)
    }
  }

  /**
   * Provider accepts a matched job
   * Called by provider to confirm they will execute the job
   */
  acceptJob(jobId: string, provider: Address): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    if (job.status !== 'matched') return false
    if (job.provider !== provider) return false

    job.status = 'active'
    console.log(`[Marketplace] Job ${jobId} accepted by provider ${provider}`)
    return true
  }

  // ============================================================================
  // SLA Enforcement
  // ============================================================================

  /**
   * Check SLA compliance
   */
  private async checkSLAs(): Promise<void> {
    const activeJobs = Array.from(this.jobs.values()).filter(
      (job) => job.status === 'active',
    )

    for (const job of activeJobs) {
      if (!job.provider) continue

      // Check deadline
      if (Date.now() > job.deadline && job.status === 'active') {
        this.recordViolation(
          job.id,
          job.provider,
          'completion',
          'Job exceeded deadline',
        )
      }

      // Additional SLA checks would be implemented here based on monitoring data
    }
  }

  /**
   * Record SLA violation
   */
  recordViolation(
    jobId: string,
    providerId: Address,
    type: SLAViolation['type'],
    details: string,
  ): void {
    const violation: SLAViolation = {
      jobId,
      providerId,
      type,
      details,
      timestamp: Date.now(),
      resolved: false,
    }

    const existing = this.slaViolations.get(jobId) ?? []
    existing.push(violation)
    this.slaViolations.set(jobId, existing)

    // Update provider reputation
    const provider = this.providers.get(providerId)
    if (provider) {
      provider.reputation.disputedJobs++
      this.updateReputationScore(provider)
    }

    console.log(
      `[Marketplace] SLA violation recorded: ${type} for job ${jobId}`,
    )
  }

  /**
   * Get violations for a job
   */
  getViolations(jobId: string): SLAViolation[] {
    return this.slaViolations.get(jobId) ?? []
  }

  /**
   * Resolve a violation
   */
  resolveViolation(jobId: string, index: number): boolean {
    const violations = this.slaViolations.get(jobId)
    if (!violations || !violations[index]) return false

    violations[index].resolved = true
    return true
  }

  // ============================================================================
  // Reputation Management
  // ============================================================================

  /**
   * Update provider reputation score
   */
  private updateReputationScore(provider: Provider): void {
    const rep = provider.reputation

    // Completion rate (40% weight)
    const completionRate =
      rep.totalJobs > 0 ? (rep.completedJobs / rep.totalJobs) * 100 : 50

    // Dispute rate (30% weight, inverted)
    const disputeRate =
      rep.totalJobs > 0 ? 100 - (rep.disputedJobs / rep.totalJobs) * 100 : 100

    // Uptime (30% weight)
    const uptimeScore = rep.uptimePercent

    rep.score = Math.round(
      completionRate * 0.4 + disputeRate * 0.3 + uptimeScore * 0.3,
    )
  }

  // ============================================================================
  // Stats
  // ============================================================================

  /**
   * Get marketplace stats
   */
  getStats(): {
    totalJobs: number
    pendingJobs: number
    activeJobs: number
    completedJobs: number
    totalProviders: number
    activeProviders: number
  } {
    const jobs = Array.from(this.jobs.values())
    const providers = Array.from(this.providers.values())

    return {
      totalJobs: jobs.length,
      pendingJobs: jobs.filter((j) => j.status === 'pending').length,
      activeJobs: jobs.filter((j) => j.status === 'active').length,
      completedJobs: jobs.filter((j) => j.status === 'completed').length,
      totalProviders: providers.length,
      activeProviders: providers.filter((p) => p.status === 'active').length,
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createMarketplaceEngine(): MarketplaceEngine {
  return new MarketplaceEngine()
}
