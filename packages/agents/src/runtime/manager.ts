/**
 * Agent Runtime Manager
 *
 * Manages ElizaOS runtime instances for agents.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { IAgentRuntime } from '@elizaos/core'

/**
 * Runtime cache entry
 */
interface RuntimeEntry {
  runtime: IAgentRuntime
  createdAt: Date
  lastAccessedAt: Date
}

/**
 * Agent Runtime Manager
 *
 * Caches and manages ElizaOS runtime instances.
 */
export class AgentRuntimeManager {
  private runtimes: Map<string, RuntimeEntry> = new Map()
  private maxCacheSize = 100
  private cacheTimeout = 30 * 60 * 1000 // 30 minutes

  /**
   * Get or create runtime for an agent
   */
  async getRuntime(agentId: string): Promise<IAgentRuntime | null> {
    const entry = this.runtimes.get(agentId)
    if (entry) {
      entry.lastAccessedAt = new Date()
      return entry.runtime
    }
    return null
  }

  /**
   * Set runtime for an agent
   */
  setRuntime(agentId: string, runtime: IAgentRuntime): void {
    // Evict old entries if cache is full
    if (this.runtimes.size >= this.maxCacheSize) {
      this.evictOldest()
    }

    this.runtimes.set(agentId, {
      runtime,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    })

    logger.debug('Runtime cached', { agentId })
  }

  /**
   * Clear runtime for an agent
   */
  async clearRuntime(agentId: string): Promise<void> {
    const entry = this.runtimes.get(agentId)
    if (entry) {
      // Clean up runtime resources if needed
      this.runtimes.delete(agentId)
      logger.debug('Runtime cleared', { agentId })
    }
  }

  /**
   * Check if runtime exists
   */
  hasRuntime(agentId: string): boolean {
    return this.runtimes.has(agentId)
  }

  /**
   * Get all cached runtime IDs
   */
  getCachedRuntimes(): string[] {
    return Array.from(this.runtimes.keys())
  }

  /**
   * Clear all runtimes
   */
  async clearAll(): Promise<void> {
    this.runtimes.clear()
    logger.info('All runtimes cleared')
  }

  /**
   * Evict stale entries
   */
  evictStale(): number {
    const now = Date.now()
    let evicted = 0

    for (const [agentId, entry] of this.runtimes) {
      if (now - entry.lastAccessedAt.getTime() > this.cacheTimeout) {
        this.runtimes.delete(agentId)
        evicted++
      }
    }

    if (evicted > 0) {
      logger.debug('Evicted stale runtimes', { count: evicted })
    }

    return evicted
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldestId: string | null = null
    let oldestTime = Date.now()

    for (const [agentId, entry] of this.runtimes) {
      if (entry.lastAccessedAt.getTime() < oldestTime) {
        oldestTime = entry.lastAccessedAt.getTime()
        oldestId = agentId
      }
    }

    if (oldestId) {
      this.runtimes.delete(oldestId)
      logger.debug('Evicted oldest runtime', { agentId: oldestId })
    }
  }
}

/** Singleton instance */
export const agentRuntimeManager = new AgentRuntimeManager()
