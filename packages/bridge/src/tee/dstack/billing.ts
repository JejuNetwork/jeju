/**
 * TEE Container Billing Tracker
 *
 * Tracks runtime costs for TEE containers and manages earnings withdrawal.
 *
 * Features:
 * - Runtime cost tracking per container
 * - Accumulated earnings calculation
 * - Auto-withdrawal at thresholds
 * - Cost reporting and analytics
 */

import { readContract, writeContract } from '@jejunetwork/contracts/viem'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('tee-billing')

// ============================================================================
// Types
// ============================================================================

/**
 * Cost Defaults Reference:
 *
 * These are EXAMPLE values based on typical cloud compute pricing.
 * Operators MUST configure these based on actual infrastructure costs.
 *
 * Reference pricing (as of 2024):
 * - AWS c7g.xlarge (4 vCPU, 8GB): ~$0.145/hr = ~40 gwei/sec
 * - AWS g4dn.xlarge (GPU): ~$0.526/hr = ~146 gwei/sec
 * - Memory: ~$0.05/GB-hr
 * - GPU (T4): ~$0.35/GPU-hr
 *
 * TEE premium: +20-50% for SGX/TDX overhead
 */

export interface BillingConfig {
  /** Viem public client for contract reads */
  publicClient: PublicClient
  /** Viem wallet client for withdrawal transactions */
  walletClient: WalletClient
  /** LedgerManager contract address for withdrawals */
  ledgerManagerAddress: Address
  /** Provider address (who receives earnings) */
  providerAddress: Address
  /**
   * Cost per second of container runtime (wei)
   * Should cover compute instance cost + TEE overhead
   * Example: 1 gwei/sec ≈ $0.11/hr at $3000 ETH
   */
  costPerSecond: bigint
  /**
   * Cost per GB of memory per hour (wei)
   * Memory costs are typically separate from compute
   * Example: 100 gwei/hr ≈ $0.0003/GB-hr at $3000 ETH
   */
  costPerGbHour: bigint
  /**
   * Cost per GPU hour (wei)
   * GPUs have significant fixed costs
   * Example: 1000 gwei/hr ≈ $0.003/GPU-hr at $3000 ETH
   */
  costPerGpuHour: bigint
  /**
   * Auto-withdraw threshold (wei)
   * When on-chain balance exceeds this, auto-withdraw is triggered
   * Default: 0.1 ETH
   */
  autoWithdrawThreshold: bigint
  /**
   * Minimum withdrawal amount (wei)
   * Prevents withdrawing tiny amounts (gas efficiency)
   * Default: 0.01 ETH
   */
  minWithdrawAmount: bigint
  /**
   * Billing update interval (ms)
   * How often to update cost calculations and check auto-withdraw
   * Default: 60000 (1 minute)
   */
  updateInterval: number
  /** Callback when withdrawal succeeds */
  onWithdrawal?: (amount: bigint, txHash: Hex) => void
  /** Callback when billing updates */
  onBillingUpdate?: (stats: BillingStats) => void
}

export interface ContainerCosts {
  /** Container ID */
  containerId: string
  /** Container start time */
  startTime: number
  /** Last billing update time */
  lastUpdateTime: number
  /** Total runtime (ms) */
  totalRuntimeMs: number
  /** Memory allocated (MB) */
  memoryMb: number
  /** GPUs allocated */
  gpuCount: number
  /** Total cost accumulated (wei) */
  totalCost: bigint
  /** Requests served */
  requestsServed: number
  /** Revenue generated (wei) */
  revenueGenerated: bigint
}

export interface BillingStats {
  /** Total containers tracked */
  totalContainers: number
  /** Active containers */
  activeContainers: number
  /** Total runtime across all containers (ms) */
  totalRuntimeMs: number
  /** Total costs (wei) */
  totalCosts: bigint
  /** Total revenue (wei) */
  totalRevenue: bigint
  /** Net earnings (revenue - costs) (wei) */
  netEarnings: bigint
  /** Pending withdrawal amount (wei) */
  pendingWithdrawal: bigint
  /** Total withdrawn (wei) */
  totalWithdrawn: bigint
  /** Average cost per request (wei) */
  avgCostPerRequest: bigint
  /** Average revenue per request (wei) */
  avgRevenuePerRequest: bigint
  /** Profit margin (percentage * 100) */
  profitMarginBps: number
}

export interface WithdrawalRecord {
  /** Withdrawal ID */
  id: string
  /** Amount withdrawn (wei) */
  amount: bigint
  /** Transaction hash */
  txHash: Hex
  /** Timestamp */
  timestamp: number
  /** Status */
  status: 'pending' | 'confirmed' | 'failed'
}

// ============================================================================
// Contract ABIs (LedgerManager - actual contract interface)
// ============================================================================

const LEDGER_MANAGER_ABI = [
  {
    name: 'getLedger',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalBalance', type: 'uint256' },
      { name: 'availableBalance', type: 'uint256' },
      { name: 'lockedBalance', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
    ],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getProviderBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'provider', type: 'address' },
    ],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const

// ============================================================================
// Billing Tracker Class
// ============================================================================

export class BillingTracker {
  private config: BillingConfig
  private containers: Map<string, ContainerCosts> = new Map()
  private withdrawals: WithdrawalRecord[] = []
  private totalWithdrawn: bigint = 0n
  private updateTimer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(config: BillingConfig) {
    this.config = {
      ...config,
      autoWithdrawThreshold:
        config.autoWithdrawThreshold ?? 100000000000000000n, // 0.1 ETH default
      minWithdrawAmount: config.minWithdrawAmount ?? 10000000000000000n, // 0.01 ETH default
      updateInterval: config.updateInterval ?? 60000, // 1 minute default
    }
  }

  /**
   * Start the billing tracker
   */
  start(): void {
    if (this.running) {
      log.warn('Billing tracker already running')
      return
    }

    this.running = true
    log.info('Billing tracker started', {
      updateInterval: this.config.updateInterval,
      autoWithdrawThreshold: this.config.autoWithdrawThreshold.toString(),
    })

    // Start periodic updates
    this.updateTimer = setInterval(() => {
      this.updateBilling().catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error)
        log.error('Billing update failed', { error: errorMsg })
      })
    }, this.config.updateInterval)

    // Initial update
    this.updateBilling().catch((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('Initial billing update failed', { error: errorMsg })
    })
  }

  /**
   * Stop the billing tracker
   */
  stop(): void {
    if (!this.running) return

    this.running = false

    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }

    log.info('Billing tracker stopped')
  }

  /**
   * Track a new container
   */
  trackContainer(
    containerId: string,
    memoryMb: number,
    gpuCount: number,
  ): void {
    const now = Date.now()

    this.containers.set(containerId, {
      containerId,
      startTime: now,
      lastUpdateTime: now,
      totalRuntimeMs: 0,
      memoryMb,
      gpuCount,
      totalCost: 0n,
      requestsServed: 0,
      revenueGenerated: 0n,
    })

    log.debug('Container tracked', { containerId, memoryMb, gpuCount })
  }

  /**
   * Stop tracking a container
   */
  untrackContainer(containerId: string): ContainerCosts | null {
    const container = this.containers.get(containerId)
    if (!container) return null

    // Final cost update
    this.updateContainerCosts(containerId)

    this.containers.delete(containerId)
    log.debug('Container untracked', {
      containerId,
      totalCost: container.totalCost.toString(),
    })

    return container
  }

  /**
   * Record a request served by a container
   */
  recordRequest(containerId: string, revenue: bigint): void {
    const container = this.containers.get(containerId)
    if (!container) {
      log.warn('Request recorded for unknown container', { containerId })
      return
    }

    container.requestsServed++
    container.revenueGenerated += revenue

    log.debug('Request recorded', {
      containerId,
      revenue: revenue.toString(),
      totalRequests: container.requestsServed,
    })
  }

  /**
   * Get current billing statistics (local calculations only)
   * NOTE: pendingWithdrawal is estimated from local tracking.
   * Use getStatsWithOnChain() for accurate on-chain balance.
   */
  getStats(): BillingStats {
    // Update all container costs first
    for (const containerId of this.containers.keys()) {
      this.updateContainerCosts(containerId)
    }

    let totalRuntimeMs = 0
    let totalCosts = 0n
    let totalRevenue = 0n
    let totalRequests = 0
    let activeContainers = 0

    for (const container of this.containers.values()) {
      totalRuntimeMs += container.totalRuntimeMs
      totalCosts += container.totalCost
      totalRevenue += container.revenueGenerated
      totalRequests += container.requestsServed
      activeContainers++
    }

    const netEarnings = totalRevenue - totalCosts
    const avgCostPerRequest =
      totalRequests > 0 ? totalCosts / BigInt(totalRequests) : 0n
    const avgRevenuePerRequest =
      totalRequests > 0 ? totalRevenue / BigInt(totalRequests) : 0n

    // Calculate profit margin in basis points
    let profitMarginBps = 0
    if (totalRevenue > 0n) {
      profitMarginBps = Number((netEarnings * 10000n) / totalRevenue)
    }

    // Local estimate only - for accurate balance use getStatsWithOnChain()
    const estimatedPending =
      netEarnings > 0n ? netEarnings - this.totalWithdrawn : 0n

    return {
      totalContainers: this.containers.size,
      activeContainers,
      totalRuntimeMs,
      totalCosts,
      totalRevenue,
      netEarnings,
      pendingWithdrawal: estimatedPending,
      totalWithdrawn: this.totalWithdrawn,
      avgCostPerRequest,
      avgRevenuePerRequest,
      profitMarginBps,
    }
  }

  /**
   * Get billing statistics with accurate on-chain balance
   * This fetches the real withdrawable amount from the contract
   */
  async getStatsWithOnChain(): Promise<BillingStats> {
    const localStats = this.getStats()

    // Fetch real on-chain balance
    const onChainBalance = await this.getOnChainBalance()

    return {
      ...localStats,
      // Override with real on-chain balance
      pendingWithdrawal: onChainBalance,
    }
  }

  /**
   * Get container-specific costs
   */
  getContainerCosts(containerId: string): ContainerCosts | null {
    const container = this.containers.get(containerId)
    if (!container) return null

    this.updateContainerCosts(containerId)
    return { ...container }
  }

  /**
   * Get all container costs
   */
  getAllContainerCosts(): ContainerCosts[] {
    // Update all container costs first
    for (const containerId of this.containers.keys()) {
      this.updateContainerCosts(containerId)
    }

    return Array.from(this.containers.values()).map((c) => ({ ...c }))
  }

  /**
   * Get withdrawal history
   */
  getWithdrawalHistory(): WithdrawalRecord[] {
    return [...this.withdrawals]
  }

  /**
   * Manually trigger a withdrawal
   * Verifies on-chain balance before attempting withdrawal
   */
  async withdraw(amount?: bigint): Promise<WithdrawalRecord> {
    // CRITICAL: Verify on-chain balance FIRST
    const onChainBalance = await this.getOnChainBalance()

    // Determine withdrawal amount - use on-chain balance if no amount specified
    const withdrawAmount = amount ?? onChainBalance

    if (withdrawAmount <= 0n) {
      throw new Error('No funds available for withdrawal')
    }

    if (withdrawAmount < this.config.minWithdrawAmount) {
      throw new Error(
        `Withdrawal amount ${withdrawAmount} below minimum ${this.config.minWithdrawAmount}`,
      )
    }

    // CRITICAL: Verify requested amount doesn't exceed on-chain balance
    if (withdrawAmount > onChainBalance) {
      throw new Error(
        `Withdrawal amount ${withdrawAmount} exceeds on-chain balance ${onChainBalance}`,
      )
    }

    const withdrawalId = `withdraw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const record: WithdrawalRecord = {
      id: withdrawalId,
      amount: withdrawAmount,
      txHash: '0x' as Hex,
      timestamp: Date.now(),
      status: 'pending',
    }

    this.withdrawals.push(record)

    try {
      log.info('Initiating withdrawal', {
        amount: withdrawAmount.toString(),
        onChainBalance: onChainBalance.toString(),
      })

      const hash = await writeContract(this.config.walletClient, {
        address: this.config.ledgerManagerAddress,
        abi: LEDGER_MANAGER_ABI,
        functionName: 'withdraw',
        args: [withdrawAmount],
      })

      record.txHash = hash as Hex
      record.status = 'confirmed'
      this.totalWithdrawn += withdrawAmount

      log.info('Withdrawal successful', {
        amount: withdrawAmount.toString(),
        txHash: hash,
      })

      if (this.config.onWithdrawal) {
        this.config.onWithdrawal(withdrawAmount, hash as Hex)
      }

      return record
    } catch (error) {
      record.status = 'failed'
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('Withdrawal failed', { error: errorMsg })
      throw error
    }
  }

  /**
   * Check on-chain available balance for withdrawal
   */
  async getOnChainBalance(): Promise<bigint> {
    const result = await readContract(this.config.publicClient, {
      address: this.config.ledgerManagerAddress,
      abi: LEDGER_MANAGER_ABI,
      functionName: 'getLedger',
      args: [this.config.providerAddress],
    })

    const [, availableBalance] = result as [bigint, bigint, bigint, bigint]
    return availableBalance
  }

  /**
   * Get on-chain ledger stats
   */
  async getOnChainStats(): Promise<{
    totalBalance: bigint
    availableBalance: bigint
    lockedBalance: bigint
  }> {
    const result = await readContract(this.config.publicClient, {
      address: this.config.ledgerManagerAddress,
      abi: LEDGER_MANAGER_ABI,
      functionName: 'getLedger',
      args: [this.config.providerAddress],
    })

    const [totalBalance, availableBalance, lockedBalance] = result as [
      bigint,
      bigint,
      bigint,
      bigint,
    ]

    return { totalBalance, availableBalance, lockedBalance }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private updateContainerCosts(containerId: string): void {
    const container = this.containers.get(containerId)
    if (!container) return

    const now = Date.now()
    const elapsed = now - container.lastUpdateTime

    if (elapsed <= 0) return

    container.totalRuntimeMs += elapsed
    container.lastUpdateTime = now

    // Calculate costs for the elapsed period
    const elapsedSeconds = BigInt(Math.floor(elapsed / 1000))
    const elapsedHours = BigInt(Math.floor(elapsed / 3600000))

    // Base runtime cost
    const runtimeCost = elapsedSeconds * this.config.costPerSecond

    // Memory cost (convert MB to GB)
    const memoryGb = BigInt(Math.ceil(container.memoryMb / 1024))
    const memoryCost = memoryGb * elapsedHours * this.config.costPerGbHour

    // GPU cost
    const gpuCost =
      BigInt(container.gpuCount) * elapsedHours * this.config.costPerGpuHour

    container.totalCost += runtimeCost + memoryCost + gpuCost
  }

  private async updateBilling(): Promise<void> {
    // Update all container costs
    for (const containerId of this.containers.keys()) {
      this.updateContainerCosts(containerId)
    }

    // Get stats with real on-chain balance for accurate auto-withdraw decision
    const stats = await this.getStatsWithOnChain()

    log.debug('Billing updated', {
      activeContainers: stats.activeContainers,
      totalCosts: stats.totalCosts.toString(),
      totalRevenue: stats.totalRevenue.toString(),
      netEarnings: stats.netEarnings.toString(),
      pendingWithdrawal: stats.pendingWithdrawal.toString(),
    })

    // Notify callback
    if (this.config.onBillingUpdate) {
      this.config.onBillingUpdate(stats)
    }

    // Auto-withdraw if on-chain balance exceeds threshold
    if (stats.pendingWithdrawal >= this.config.autoWithdrawThreshold) {
      log.info('Auto-withdraw threshold reached', {
        onChainBalance: stats.pendingWithdrawal.toString(),
        threshold: this.config.autoWithdrawThreshold.toString(),
      })

      try {
        await this.withdraw()
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        log.error('Auto-withdraw failed', { error: errorMsg })
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createBillingTracker(config: BillingConfig): BillingTracker {
  return new BillingTracker(config)
}
