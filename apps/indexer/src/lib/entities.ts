/**
 * Shared entity helpers for processors
 * Consolidates common patterns across all event processors
 */

import { Account } from '../model'
import type { Block, Log } from '../processor'

/**
 * Re-export processor types for use in event processors
 * These are the actual subsquid types parameterized with our field selection
 */
export type BlockHeader = Block
export type LogData = Log

/**
 * Creates an account entity factory with a shared cache
 */
export function createAccountFactory() {
  const accounts = new Map<string, Account>()

  return {
    /**
     * Get or create an account entity, caching by address
     * Updates lastSeenBlock/lastSeenAt on each access
     */
    getOrCreate(
      address: string,
      blockNumber: number,
      timestamp: Date,
    ): Account {
      if (
        !address ||
        typeof address !== 'string' ||
        address.trim().length === 0
      ) {
        throw new Error('address is required and must be a non-empty string')
      }
      if (
        typeof blockNumber !== 'number' ||
        blockNumber < 0 ||
        !Number.isInteger(blockNumber)
      ) {
        throw new Error(
          `Invalid blockNumber: ${blockNumber}. Must be a non-negative integer.`,
        )
      }
      if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
        throw new Error('timestamp must be a valid Date object')
      }

      const id = address.toLowerCase()
      let account = accounts.get(id)
      if (!account) {
        account = new Account({
          id,
          address: id,
          isContract: false,
          firstSeenBlock: blockNumber,
          lastSeenBlock: blockNumber,
          transactionCount: 0,
          totalValueSent: 0n,
          totalValueReceived: 0n,
          labels: [],
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
        })
        accounts.set(id, account)
      } else {
        account.lastSeenBlock = blockNumber
        account.lastSeenAt = timestamp
      }
      return account
    },

    /** Get all cached accounts */
    getAll(): Account[] {
      return [...accounts.values()]
    },

    /** Check if any accounts were created */
    hasAccounts(): boolean {
      return accounts.size > 0
    },

    /** Get the underlying map for advanced operations */
    getMap(): Map<string, Account> {
      return accounts
    },
  }
}

/** Type for the account factory */
export type AccountFactory = ReturnType<typeof createAccountFactory>
