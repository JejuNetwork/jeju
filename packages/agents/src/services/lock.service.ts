/**
 * Agent Lock Service
 *
 * Provides distributed locking for agent operations to prevent concurrent
 * execution of conflicting actions (e.g., multiple autonomous ticks).
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'

/**
 * Lock options
 */
export interface LockOptions {
  /** Lock timeout in milliseconds */
  timeout?: number
  /** Retry attempts if lock is held */
  retries?: number
  /** Delay between retries in milliseconds */
  retryDelay?: number
}

/**
 * Lock result
 */
export interface LockResult {
  acquired: boolean
  lockId: string | null
  holder?: string
}

/**
 * Agent Lock Service
 */
export class AgentLockService {
  private locks: Map<string, { lockId: string; expiresAt: number }> = new Map()

  /**
   * Acquire a lock for an agent operation
   */
  async acquireLock(
    agentId: string,
    operation: string,
    options: LockOptions = {},
  ): Promise<LockResult> {
    const key = `${agentId}:${operation}`
    const timeout = options.timeout ?? 30000
    const retries = options.retries ?? 3
    const retryDelay = options.retryDelay ?? 100

    for (let attempt = 0; attempt < retries; attempt++) {
      const existing = this.locks.get(key)

      // Check if existing lock is expired
      if (existing && existing.expiresAt < Date.now()) {
        this.locks.delete(key)
      }

      if (!this.locks.has(key)) {
        const lockId = `${key}:${Date.now()}:${Math.random().toString(36).slice(2)}`
        this.locks.set(key, {
          lockId,
          expiresAt: Date.now() + timeout,
        })

        logger.debug('Lock acquired', { agentId, operation, lockId })
        return { acquired: true, lockId }
      }

      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }

    const holder = this.locks.get(key)?.lockId ?? null
    logger.debug(
      `Failed to acquire lock for ${agentId}:${operation}, held by ${holder ?? 'unknown'}`,
    )
    return { acquired: false, lockId: null, holder: holder ?? undefined }
  }

  /**
   * Release a lock
   */
  async releaseLock(
    agentId: string,
    operation: string,
    lockId: string,
  ): Promise<boolean> {
    const key = `${agentId}:${operation}`
    const existing = this.locks.get(key)

    if (existing?.lockId === lockId) {
      this.locks.delete(key)
      logger.debug('Lock released', { agentId, operation, lockId })
      return true
    }

    logger.warn(
      `Lock release failed for ${agentId}:${operation} - wrong lockId ${lockId} or not held (current: ${existing?.lockId ?? 'none'})`,
    )
    return false
  }

  /**
   * Check if a lock is held
   */
  async isLocked(agentId: string, operation: string): Promise<boolean> {
    const key = `${agentId}:${operation}`
    const existing = this.locks.get(key)

    if (existing && existing.expiresAt < Date.now()) {
      this.locks.delete(key)
      return false
    }

    return this.locks.has(key)
  }

  /**
   * Execute a function with a lock
   */
  async withLock<T>(
    agentId: string,
    operation: string,
    fn: () => Promise<T>,
    options: LockOptions = {},
  ): Promise<T> {
    const lock = await this.acquireLock(agentId, operation, options)

    if (!lock.acquired || !lock.lockId) {
      throw new Error(
        `Failed to acquire lock for ${agentId}:${operation}, held by ${lock.holder}`,
      )
    }

    try {
      return await fn()
    } finally {
      await this.releaseLock(agentId, operation, lock.lockId)
    }
  }
}

/** Singleton instance */
export const agentLockService = new AgentLockService()
