/**
 * Shared entity helpers for processors
 * Consolidates common patterns across all event processors
 */

import { Account } from '../model';

/**
 * Common block header interface for event processors
 */
export interface BlockHeader {
  hash: string;
  height: number;
  timestamp: number;
}

/**
 * Common log data interface for event processors
 */
export interface LogData {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
  transactionIndex: number;
  transaction?: { hash: string };
}

/**
 * Creates an account entity factory with a shared cache
 */
export function createAccountFactory() {
  const accounts = new Map<string, Account>();

  return {
    /**
     * Get or create an account entity, caching by address
     * Updates lastSeenBlock/lastSeenAt on each access
     */
    getOrCreate(address: string, blockNumber: number, timestamp: Date): Account {
      const id = address.toLowerCase();
      let account = accounts.get(id);
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
        });
        accounts.set(id, account);
      } else {
        account.lastSeenBlock = blockNumber;
        account.lastSeenAt = timestamp;
      }
      return account;
    },

    /** Get all cached accounts */
    getAll(): Account[] {
      return [...accounts.values()];
    },

    /** Check if any accounts were created */
    hasAccounts(): boolean {
      return accounts.size > 0;
    },

    /** Get the underlying map for advanced operations */
    getMap(): Map<string, Account> {
      return accounts;
    },
  };
}

/** Type for the account factory */
export type AccountFactory = ReturnType<typeof createAccountFactory>;

