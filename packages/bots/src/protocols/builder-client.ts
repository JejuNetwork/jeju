/**
 * Builder Partnership Submission Endpoints
 *
 * Direct submission to block builders for better inclusion.
 */

import { EventEmitter } from 'node:events'
import { type Hash, type Hex } from 'viem'

export interface BuilderConfig {
  chainId: number
  builders: Builder[]
  defaultTipPercent: number
}

interface Builder {
  name: string
  endpoint: string
  pubkey?: string
}

interface BundleSubmission {
  txs: Hex[]
  blockNumber: bigint
  minTimestamp?: number
  maxTimestamp?: number
  revertingTxHashes?: Hash[]
}

const DEFAULT_BUILDERS: Builder[] = [
  { name: 'flashbots', endpoint: 'https://relay.flashbots.net' },
  { name: 'beaverbuild', endpoint: 'https://rpc.beaverbuild.org' },
  { name: 'rsync', endpoint: 'https://rsync-builder.xyz' },
  { name: 'titan', endpoint: 'https://rpc.titanbuilder.xyz' },
]

export class BuilderClient extends EventEmitter {
  private config: BuilderConfig
  private running = false
  private submissionStats: Map<string, { success: number; failed: number }> = new Map()

  constructor(config: BuilderConfig) {
    super()
    this.config = config

    // Initialize stats
    for (const builder of config.builders) {
      this.submissionStats.set(builder.name, { success: 0, failed: 0 })
    }
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log(`🏗️ Builder Client: ${this.config.builders.length} builders`)
  }

  stop(): void {
    this.running = false
  }

  /**
   * Submit bundle to all builders in parallel
   */
  async submitToAll(bundle: BundleSubmission): Promise<Map<string, { success: boolean; hash?: string }>> {
    const results = new Map<string, { success: boolean; hash?: string }>()

    const submissions = this.config.builders.map(async (builder) => {
      try {
        const hash = await this.submitToBuilder(builder, bundle)
        results.set(builder.name, { success: true, hash })
        this.updateStats(builder.name, true)
      } catch {
        results.set(builder.name, { success: false })
        this.updateStats(builder.name, false)
      }
    })

    await Promise.all(submissions)
    return results
  }

  /**
   * Submit to best performing builder
   */
  async submitToBest(bundle: BundleSubmission): Promise<{ builder: string; hash: string }> {
    const sorted = Array.from(this.submissionStats.entries())
      .map(([name, stats]) => ({
        name,
        successRate: stats.success / (stats.success + stats.failed + 1),
      }))
      .sort((a, b) => b.successRate - a.successRate)

    for (const { name } of sorted) {
      const builder = this.config.builders.find((b) => b.name === name)
      if (!builder) continue

      try {
        const hash = await this.submitToBuilder(builder, bundle)
        this.updateStats(name, true)
        return { builder: name, hash }
      } catch {
        this.updateStats(name, false)
      }
    }

    throw new Error('All builders failed')
  }

  private async submitToBuilder(builder: Builder, bundle: BundleSubmission): Promise<string> {
    const response = await fetch(builder.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendBundle',
        params: [{
          txs: bundle.txs,
          blockNumber: `0x${bundle.blockNumber.toString(16)}`,
          minTimestamp: bundle.minTimestamp,
          maxTimestamp: bundle.maxTimestamp,
        }],
        id: 1,
      }),
    })

    const result = await response.json() as { result?: { bundleHash: string }; error?: { message: string } }
    if (result.error) throw new Error(result.error.message)
    return result.result?.bundleHash ?? ''
  }

  private updateStats(builder: string, success: boolean): void {
    const stats = this.submissionStats.get(builder)
    if (stats) {
      if (success) stats.success++
      else stats.failed++
    }
  }

  getStats(): Record<string, { success: number; failed: number; rate: number }> {
    const result: Record<string, { success: number; failed: number; rate: number }> = {}
    for (const [name, stats] of this.submissionStats) {
      result[name] = {
        ...stats,
        rate: stats.success / (stats.success + stats.failed + 1),
      }
    }
    return result
  }
}

export function createBuilderClient(config?: Partial<BuilderConfig>): BuilderClient {
  return new BuilderClient({
    chainId: config?.chainId ?? 1,
    builders: config?.builders ?? DEFAULT_BUILDERS,
    defaultTipPercent: config?.defaultTipPercent ?? 10,
  })
}

