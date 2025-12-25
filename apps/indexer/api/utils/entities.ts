/**
 * Entity helpers for processors
 */

import { Account } from '../model'
import type { Block, Log } from '../processor'

export type BlockHeader = Block
export type LogData = Log

// Opaque type for relation references - TypeORM only needs the ID
declare const RelationRefBrand: unique symbol
type RelationRef<T> = T & { readonly [RelationRefBrand]?: never }

/**
 * Helper for TypeORM relations where only the ID is needed.
 * TypeORM handles the relation by the ID, so we only need to provide the ID field.
 * Returns a properly typed relation reference that TypeORM will resolve.
 */
export function relationId<T extends { id: string }>(
  id: string,
): RelationRef<T> {
  // At runtime, TypeORM only needs the ID to establish relations
  // This function creates a minimal object that satisfies the relation
  return { id } as RelationRef<T>
}

export function createAccountFactory() {
  const accounts = new Map<string, Account>()

  return {
    getOrCreate(
      address: string,
      blockNumber: number,
      timestamp: Date,
    ): Account {
      if (!address || address.trim().length === 0) {
        throw new Error('address is required and must be a non-empty string')
      }
      if (blockNumber < 0 || !Number.isInteger(blockNumber)) {
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

    getAll(): Account[] {
      return [...accounts.values()]
    },

    hasAccounts(): boolean {
      return accounts.size > 0
    },

    getMap(): Map<string, Account> {
      return accounts
    },
  }
}

export type AccountFactory = ReturnType<typeof createAccountFactory>
