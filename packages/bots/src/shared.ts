/**
 * Shared Utilities for Jeju Bots
 *
 * Common constants, types, and utilities used across the package
 */

import { WEIGHT_PRECISION } from './schemas'

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Convert weight (bigint with 18 decimals) to basis points (number)
 */
export function weightToBps(weight: bigint): number {
  return Number((weight * 10000n) / WEIGHT_PRECISION)
}

/**
 * Convert basis points (number) to weight (bigint with 18 decimals)
 */
export function bpsToWeight(bps: number): bigint {
  return (BigInt(bps) * WEIGHT_PRECISION) / 10000n
}

/**
 * Calculate percentage difference between two values
 */
export function percentageDiff(a: bigint, b: bigint): number {
  if (a === 0n && b === 0n) return 0
  const diff = a > b ? a - b : b - a
  const avg = (a + b) / 2n
  if (avg === 0n) return 0
  return Number((diff * 10000n) / avg) / 100 // Returns percentage
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Clamp a bigint value between min and max
 */
export function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Format bigint with decimals to string
 */
export function formatBigInt(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals)
  const wholePart = value / divisor
  const fracPart = value % divisor
  const fracStr = fracPart.toString().padStart(decimals, '0')
  // Remove trailing zeros
  const trimmedFrac = fracStr.replace(/0+$/, '')
  return trimmedFrac ? `${wholePart}.${trimmedFrac}` : wholePart.toString()
}

/**
 * Parse string to bigint with decimals
 */
export function parseBigInt(value: string, decimals: number): bigint {
  const [whole, frac = ''] = value.split('.')
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + paddedFrac)
}

/**
 * Generate a unique ID using cryptographically secure randomness
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Simple mutex for preventing race conditions in async operations
 *
 * Usage:
 * ```
 * const mutex = new Mutex();
 * const release = await mutex.acquire();
 * try {
 *   // critical section
 * } finally {
 *   release();
 * }
 * ```
 */
export class Mutex {
  private locked = false
  private queue: (() => void)[] = []

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true
          resolve(() => this.release())
        } else {
          this.queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      if (next) next()
    } else {
      this.locked = false
    }
  }

  isLocked(): boolean {
    return this.locked
  }
}

/**
 * Keyed mutex for protecting per-key resources (e.g., per-pool operations)
 */
export class KeyedMutex {
  private mutexes = new Map<string, Mutex>()

  async acquire(key: string): Promise<() => void> {
    let mutex = this.mutexes.get(key)
    if (!mutex) {
      mutex = new Mutex()
      this.mutexes.set(key, mutex)
    }
    return mutex.acquire()
  }

  isLocked(key: string): boolean {
    const mutex = this.mutexes.get(key)
    return mutex ? mutex.isLocked() : false
  }
}

/**
 * Nonce manager for preventing transaction failures due to nonce issues
 *
 * Tracks pending nonces locally to allow multiple transactions to be
 * submitted in parallel without waiting for confirmation.
 */
export class NonceManager {
  private pendingNonce: bigint | null = null
  private mutex = new Mutex()

  constructor(private getOnChainNonce: () => Promise<bigint>) {}

  /**
   * Get the next nonce to use
   * Call release() when the transaction is confirmed or failed
   */
  async acquire(): Promise<{
    nonce: bigint
    release: (confirmed: boolean) => void
  }> {
    const releaseMutex = await this.mutex.acquire()

    try {
      // Get current on-chain nonce if we don't have a pending one
      if (this.pendingNonce === null) {
        this.pendingNonce = await this.getOnChainNonce()
      }

      const nonce = this.pendingNonce
      this.pendingNonce = nonce + 1n

      return {
        nonce,
        release: (confirmed: boolean) => {
          // If transaction failed, we might need to reset pending nonce
          if (!confirmed) {
            // Reset to force re-fetch on next transaction
            // This handles the case where a transaction was dropped
            this.reset()
          }
        },
      }
    } finally {
      releaseMutex()
    }
  }

  /**
   * Reset the nonce manager (e.g., after a failed transaction)
   */
  reset(): void {
    this.pendingNonce = null
  }

  /**
   * Sync with on-chain nonce
   */
  async sync(): Promise<void> {
    const releaseMutex = await this.mutex.acquire()
    try {
      this.pendingNonce = await this.getOnChainNonce()
    } finally {
      releaseMutex()
    }
  }
}
