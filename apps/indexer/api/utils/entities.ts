/**
 * Entity helpers for processors
 */

import { Account } from '../model'
import type { Block, Log } from '../processor'

export type BlockHeader = Block
export type LogData = Log

// Import relationId directly from ./relation-id instead

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
